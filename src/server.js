import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNumber } from './answers.js';
import { addProblem, checkRequest, createSet, grade, GROUPS, LEVELS, personalSet, retryProblem, retrySet, stopSet } from './generate.js';
import { fits, same, starter } from './harness.js';
import { findLinks } from './link.js';
import { ping, ProviderError, providerStatus } from './providers.js';
import { LANGUAGES, runCode, runProgram, selfTest, tools } from './sandbox.js';
import { checkDrawing, checkSettings, deleteSet, Invalid, listSets, NotFound, readDrawing, readSet, readSettings, saveDrawing, saveSettings, updateProblem } from './store.js';
import { analyze, chat, repair, visualOf } from './tutor.js';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const FRAME_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const EDITORS = [...LANGUAGES, 'sql', 'html'];
const BODY_LIMIT = 6 << 20;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class Page {
  constructor(content, csp) {
    Object.assign(this, { content, csp });
  }
}

/** The model-written analysis with its kit inlined. The policy gives it an opaque origin and no network. */
async function framePage({ html, data }, theme) {
  const [css, kit] = await Promise.all(['stage.css', 'stage.js'].map((f) => fs.readFile(path.join(DIST, f), 'utf8')));
  const json = JSON.stringify(data ?? {}).replace(/</g, '\\u003c');
  return new Page(
    `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Analysis</title><style>${css}</style></head><body><script type="application/json" id="stage-data">${json}</script><script>${kit.replace(/<\/script/gi, '<\\/script')}</script><div id="stage">${html}</div></body></html>`,
    FRAME_CSP,
  );
}
const add = async (setId, body) => {
  const { request, subject } = checkRequest(body);
  return { setId, id: await addProblem(setId, { request, subject, links: findLinks(request) }) };
};

async function readBody(req) {
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Send JSON');
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > BODY_LIMIT) throw new HttpError(413, 'That is larger than 6 MB');
    chunks.push(c);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (value && typeof value === 'object') return value;
  } catch {}
  throw new Invalid('The request was not valid JSON');
}

const needText = (v, name, max = 100000) => {
  if (typeof v !== 'string' || v.length > max) throw new Invalid(`${name} must be text of at most ${max.toLocaleString('en-US')} characters`);
  return v;
};
async function readyProblem(setId, pid) {
  const set = await readSet(setId);
  const problem = set.problems.find((p) => p.id === pid);
  if (!problem) throw new NotFound();
  if (problem.status !== 'ready') throw new Invalid('This problem is not ready yet');
  return problem;
}
const advance = (solved) => (p) => {
  if (p.progress !== 'solved') p.progress = solved ? 'solved' : 'tried';
};
const kindOnly = (problem, ...kinds) => {
  if (!kinds.includes(problem.kind)) throw new Invalid('That does not apply to this kind of problem');
};

function languageFor(problem, body) {
  kindOnly(problem, 'code', 'sql');
  const language = problem.kind === 'sql' ? 'sql' : body.language;
  if (language !== 'sql' && !LANGUAGES.includes(language)) throw new Invalid('Choose a language');
  return language;
}

async function runFor(setId, pid, body, examplesOnly) {
  const problem = await readyProblem(setId, pid);
  const language = languageFor(problem, body);
  const { signature, compare, cases, exampleCount } = problem.body;
  const given = cases.slice(0, examplesOnly ? exampleCount : undefined).map((c, i) => ({ args: c.args, expected: c.expected, label: i < exampleCount ? `Example ${i + 1}` : `Test ${i + 1}` }));
  const own = (problem.tests ?? []).map((t, i) => ({ args: t.args, expected: t.expected, label: `Your test ${i + 1}`, own: true }));
  const tests = [...given, ...own];
  const r = await runCode({ language, code: needText(body.code, 'Code'), signature, cases: tests, compare });
  return { ...r, tests };
}

const TESTS_LIMIT = 50;
const readValue = (raw, type, name) => {
  const t = needText(raw, name, 20000).trim();
  let value;
  try {
    value = JSON.parse(t);
  } catch {
    if (type === 'string') return t;
    throw new Invalid(`${name} must be written like ${type.endsWith('[]') ? '[1, 2, 3]' : type === 'bool' ? 'true' : '5'}`);
  }
  if (type === 'string' && typeof value !== 'string') return t;
  if (!fits(value, type)) throw new Invalid(`${name} must be of type ${type}`);
  return value;
};

/** Saves a test the user wrote. Without an expected value, the reference solution fills it in. */
async function addTest(setId, pid, body) {
  const problem = await readyProblem(setId, pid);
  kindOnly(problem, 'code', 'sql');
  const { signature, compare, solutionCode } = problem.body;
  if (!Array.isArray(body.args) || body.args.length !== signature.params.length) throw new Invalid('Fill in every input');
  const args = signature.params.map((p, i) => readValue(body.args[i], p.type, p.name));
  const written = needText(body.expected ?? '', 'Expected', 20000).trim();
  const { results } = await runCode({ language: problem.kind === 'sql' ? 'sql' : 'python', code: solutionCode, signature, cases: [{ args }] });
  const reference = results[0].status === 'pass' ? results[0].actual : undefined;
  if (!written && reference === undefined) throw new Invalid(`The reference solution could not answer this input (${results[0].error}). Write the expected value yourself.`);
  const expected = written ? readValue(written, signature.returns, 'Expected') : reference;
  const test = { id: randomUUID(), args, expected };
  // Both values are kept in view, because the reference can be wrong on inputs the statement rules out.
  if (reference !== undefined && !same(expected, reference, compare)) test.reference = reference;
  await updateProblem(setId, pid, (p) => {
    p.tests ??= [];
    if (p.tests.length >= TESTS_LIMIT) throw new Invalid(`You can keep up to ${TESTS_LIMIT} tests`);
    p.tests.push(test);
  });
  return { test };
}

const routes = [
  ['GET', /^\/api\/options$/, async () => ({ groups: GROUPS, levels: LEVELS })],
  ['GET', /^\/api\/settings$/, async () => ({ settings: await readSettings() })],
  ['GET', /^\/api\/status$/, async () => {
    const [providers, sandbox, found] = await Promise.all([providerStatus(), selfTest(), tools()]);
    return { providers, sandbox, languages: { python: found.python?.version, javascript: found.javascript.version, cpp: found.cpp?.version } };
  }],
  ['PUT', /^\/api\/settings$/, async (_, body) => ({ settings: await saveSettings(body) })],
  ['POST', /^\/api\/settings\/test$/, async (_, body) => {
    const r = await ping(checkSettings(body));
    if (r.ok !== true) throw new ProviderError('badjson', 'The model replied, but not as asked');
    return { ok: true };
  }],
  ['GET', /^\/api\/sets$/, async () => ({
    sets: (await listSets()).map((s) => ({ id: s.id, createdAt: s.createdAt, company: s.intake.company, role: s.intake.role, level: s.intake.level, status: s.status, busy: s.status === 'planning' || s.problems.some((p) => ['queued', 'writing'].includes(p.status)), total: s.problems.length, solved: s.problems.filter((p) => p.progress === 'solved').length, quote: s.problems.find((p) => p.quote)?.quote ?? '' })),
  })],
  ['POST', /^\/api\/sets$/, async (_, body) => ({ id: (await createSet(body)).id })],
  ['GET', /^\/api\/sets\/([^/]+)$/, async ([id]) => {
    const set = await readSet(id);
    for (const p of set.problems) if (p.body?.signature) p.starters = Object.fromEntries((p.kind === 'sql' ? ['sql'] : LANGUAGES).map((l) => [l, starter(l, p.body.signature, p.body.cases[0].args)]));
    for (const p of set.problems) {
      delete p.source;
      if (p.visual) for (const k of ['html', 'data']) delete p.visual[k];
    }
    return { set };
  }],
  ['POST', /^\/api\/problems$/, async (_, body) => {
    checkRequest(body);
    return add(await personalSet(), body);
  }],
  ['POST', /^\/api\/sets\/([^/]+)\/problems$/, ([id], body) => add(id, body)],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/chat$/, async ([id, pid], body) => (await chat(id, pid, body), {})],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/analyze$/, async ([id, pid], body) => (await analyze(id, pid, body), {})],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/analyze\/repair$/, async ([id, pid], body) => (await repair(id, pid, body), {})],
  ['GET', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/visual$/, async ([id, pid], _, __, url) => {
    const visual = await visualOf(id, pid);
    if (!visual) throw new NotFound();
    return framePage(visual, url.searchParams.get('theme') === 'dark' ? 'dark' : 'light');
  }],
  ['DELETE', /^\/api\/sets\/([^/]+)$/, async ([id]) => {
    stopSet(id);
    await deleteSet(id);
    return {};
  }],
  ['POST', /^\/api\/sets\/([^/]+)\/retry$/, async ([id]) => (await retrySet(id), {})],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/retry$/, async ([id, pid]) => (await retryProblem(id, pid), {})],
  ['PUT', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/draft$/, async ([id, pid], body) => {
    const draft = {};
    if (EDITORS.includes(body.language)) draft.language = body.language;
    for (const l of EDITORS) if (body.code?.[l] !== undefined) (draft.code ??= {})[l] = needText(body.code[l], 'Code');
    for (const k of ['answer', 'working']) if (body[k] !== undefined) draft[k] = needText(body[k], 'Your answer');
    await updateProblem(id, pid, (p) => void (p.draft = draft));
    return {};
  }],
  ['GET', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/drawing$/, ([id, pid]) => readDrawing(id, pid)],
  ['PUT', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/drawing$/, async ([id, pid], body) => (await saveDrawing(id, pid, body.elements), {})],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/program$/, async ([id, pid], body) => {
    const problem = await readyProblem(id, pid);
    return runProgram({ language: languageFor(problem, body), code: needText(body.code, 'Code'), data: problem.body.cases[0].args[0] });
  }],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/run$/, ([id, pid], body) => runFor(id, pid, body, true)],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/tests$/, async ([id, pid], body) => addTest(id, pid, body)],
  ['DELETE', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/tests\/([^/]+)$/, async ([id, pid, tid]) => {
    await updateProblem(id, pid, (p) => {
      const left = (p.tests ?? []).filter((t) => t.id !== tid);
      if (left.length === (p.tests ?? []).length) throw new NotFound();
      p.tests = left;
    });
    return {};
  }],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/session$/, async ([id, pid], body) => {
    const problem = await readyProblem(id, pid);
    kindOnly(problem, 'code', 'sql');
    if (!['start', 'end', 'clear'].includes(body.action)) throw new Invalid('Choose start, end or clear');
    if (body.action === 'start' && ![30, 45, 60].includes(body.minutes)) throw new Invalid('Choose 30, 45 or 60 minutes');
    await updateProblem(id, pid, (p) => {
      const now = new Date().toISOString();
      if (body.action === 'start') p.session = { startedAt: now, endedAt: null, minutes: body.minutes };
      else if (body.action === 'clear') p.session = null;
      else p.session = { ...(p.session ?? { startedAt: null, minutes: null }), endedAt: p.session?.endedAt ?? now };
    });
    return {};
  }],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/submit$/, async ([id, pid], body) => {
    const r = await runFor(id, pid, body, false);
    const given = r.tests.map((t, i) => (t.own ? null : r.results[i].status)).filter(Boolean);
    await updateProblem(id, pid, advance(given.every((s) => s === 'pass')));
    return r;
  }],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/check$/, async ([id, pid], body) => {
    const problem = await readyProblem(id, pid);
    kindOnly(problem, 'numeric');
    const correct = checkNumber(needText(body.answer, 'Your answer', 100), problem.body);
    if (correct === null) throw new Invalid('Type a number such as 0.25, 1.2e-3, 1/4 or 25%');
    await updateProblem(id, pid, advance(correct));
    return { correct };
  }],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/checked$/, async ([id, pid], body) => {
    kindOnly(await readyProblem(id, pid), 'ui');
    if (!Number.isInteger(body.passed) || !Number.isInteger(body.total) || body.total < 1) throw new Invalid('The results could not be read');
    await updateProblem(id, pid, advance(body.passed === body.total));
    return {};
  }],
  ['POST', /^\/api\/sets\/([^/]+)\/problems\/([^/]+)\/feedback$/, async ([id, pid], body, signal) => {
    const problem = await readyProblem(id, pid);
    const answer = needText(body.answer, 'Your answer');
    const drawing = checkDrawing(body.drawing);
    if (!answer.trim() && !drawing) throw new Invalid('Write or draw an answer first');
    const feedback = await grade({ problem, answer, drawing, outcome: needText(body.outcome ?? '', 'Outcome', 6000), signal });
    await updateProblem(id, pid, (p) => {
      p.feedback = feedback;
      if (p.kind === 'written') advance(feedback.score >= 0.8)(p);
    });
    return { feedback };
  }],
];

const STATUS = { auth: 502, rate: 429, timeout: 504, missing: 502, exit: 502, badjson: 502, aborted: 499 };

async function api(req, res, url) {
  const matched = routes.map(([method, re, fn]) => ({ method, fn, m: url.pathname.match(re) })).filter((r) => r.m);
  const route = matched.find((r) => r.method === req.method);
  if (!route) throw new HttpError(matched.length ? 405 : 404, 'There is nothing at this address');
  const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : undefined;
  const left = new AbortController();
  res.on('close', () => !res.writableFinished && left.abort());
  return route.fn(route.m.slice(1), body, left.signal, url);
}

async function asset(url) {
  let name = 'index.html';
  try {
    if (url.pathname !== '/') name = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new HttpError(400, 'Bad address');
  }
  const file = path.join(DIST, name);
  const type = TYPES[path.extname(file)];
  if (!file.startsWith(DIST + path.sep) || !type || name.includes('\0')) throw new HttpError(404, 'There is nothing at this address');
  const content = await fs.readFile(file).catch(() => null);
  if (!content) throw new HttpError(404, name === 'index.html' ? 'The page is not built. Run npm run build.' : 'There is nothing at this address');
  return { content, type };
}

export function createServer() {
  const server = http.createServer(async (req, res) => {
    const headers = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-store' };
    const send = (status, type, content) => {
      if (!res.headersSent) res.writeHead(status, { ...headers, 'content-type': type }).end(content);
    };
    try {
      const { port } = server.address();
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      if (!hosts.includes(req.headers.host)) throw new HttpError(403, 'Open Interview Buddy on localhost');
      // A foreign page cannot forge Origin, so this keeps other sites from running code or spending the subscription.
      if (req.method !== 'GET' && req.method !== 'HEAD' && !hosts.map((h) => `http://${h}`).includes(req.headers.origin)) throw new HttpError(403, 'Requests must come from Interview Buddy');
      if (!['same-origin', 'none', undefined].includes(req.headers['sec-fetch-site']) && req.url.startsWith('/api/')) throw new HttpError(403, 'Requests must come from Interview Buddy');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        const value = await api(req, res, url);
        if (value instanceof Page) return void res.writeHead(200, { ...headers, 'content-security-policy': value.csp, 'content-type': TYPES['.html'] }).end(value.content);
        return send(200, 'application/json', JSON.stringify(value));
      }
      if (req.method !== 'GET') throw new HttpError(405, 'There is nothing at this address');
      const { content, type } = await asset(url);
      // The preview shows the user's own page, so it gets the same locked policy as an analysis, plus form events.
      if (url.pathname === '/preview.html') return void res.writeHead(200, { ...headers, 'content-security-policy': FRAME_CSP.replace('allow-scripts', 'allow-scripts allow-forms'), 'content-type': type }).end(content);
      send(200, type, content);
    } catch (e) {
      const status = e.status ?? (e instanceof Invalid ? 400 : e instanceof NotFound ? 404 : e instanceof ProviderError ? STATUS[e.kind] : 500);
      if (status === 500) console.error(e);
      const message = status === 500 ? 'Something broke in Interview Buddy. The terminal has the details.' : e.message || 'This was not found. It may have been deleted.';
      send(status, 'application/json', JSON.stringify({ error: message, kind: e.kind }));
      if (status === 413) req.destroy();
    }
  });
  return server;
}
