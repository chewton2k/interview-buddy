import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { brief, calls, clearCalls, code, intake, numeric, replies, sql, ui, written } from './stub/setup.js';
import { createServer } from '../src/server.js';

const server = createServer();
let port;
before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((port = server.address().port), r()))));
after(() => server.close());

function raw(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d)).on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: res.headers['content-type']?.includes('json') ? JSON.parse(t) : null }));
    });
    req.on('error', reject).end(body);
  });
}
const call = (method, path, body, headers = {}) => raw(method, path, { body: body === undefined ? undefined : JSON.stringify(body), headers: { origin: `http://localhost:${port}`, ...(body !== undefined && { 'content-type': 'application/json' }), ...headers } });

async function ready(id) {
  for (let i = 0; i < 400; i++) {
    const { set } = (await call('GET', `/api/sets/${id}`)).json;
    if (set.status !== 'planning' && set.problems.every((p) => ['ready', 'failed'].includes(p.status))) return set;
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('one account and model reach every kind of call', async () => {
  const settings = { provider: 'codex', model: 'gpt-x' };
  assert.equal((await call('PUT', '/api/settings', settings)).status, 200);
  assert.deepEqual((await call('GET', '/api/settings')).json.settings, settings);
  replies([
    { match: 'Plan a', reply: { problems: [brief()] } },
    { match: 'Write one', reply: code() },
    { match: 'Grade this', reply: { summary: 's', points: [{ mark: 'met', note: '' }, { mark: 'met', note: '' }] } },
    { match: 'last message in the transcript', reply: { reply: 'ok', new_problem: '' } },
    { match: 'interactive picture', reply: { summary: 's', html: '<p>x</p>' } },
  ]);
  clearCalls();
  const { id } = (await call('POST', '/api/sets', intake)).json;
  const set = await ready(id);
  const at = `/api/sets/${id}/problems/${set.problems[0].id}`;
  const everything = async () => {
    const before = calls().length;
    assert.equal((await call('POST', `${at}/feedback`, { answer: 'def twice(x): return 2*x', outcome: 'all pass' })).json.feedback.score, 1);
    await call('POST', `${at}/chat`, { message: 'hi' });
    await call('POST', `${at}/analyze`, { language: 'python', code: 'def twice(x):\n    return 2 * x' });
    for (let i = 0; calls().length < before + 3 && i < 300; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 200));
  };
  await everything();
  assert.equal(calls().length, 5);
  for (const c of calls()) assert.ok(c.name === 'codex' && c.args.join(' ').includes('--model gpt-x') && c.args.includes('model_reasoning_effort=medium'), c.name);
  await call('PUT', '/api/settings', { provider: 'claude', model: 'opus' });
  clearCalls();
  await everything();
  for (const c of calls()) assert.ok(c.name === 'claude' && c.args.join(' ').includes('--model opus'), c.name);
  for (const bad of [{ provider: 'codex', model: '-x' }, { provider: 'gemini', model: '' }, {}]) assert.equal((await call('PUT', '/api/settings', bad)).status, 400);
  const old = { write: { provider: 'codex', model: 'gpt-old', effort: 'high' }, grade: { provider: 'claude', model: 'haiku', effort: '' } };
  fs.writeFileSync(path.join(process.env.INTERVIEW_BUDDY_HOME, 'settings.json'), JSON.stringify(old));
  assert.deepEqual((await call('GET', '/api/settings')).json.settings, { provider: 'codex', model: 'gpt-old' });
  fs.writeFileSync(path.join(process.env.INTERVIEW_BUDDY_HOME, 'settings.json'), '{broken');
  assert.deepEqual((await call('GET', '/api/settings')).json.settings, { provider: 'claude', model: 'sonnet' });
});

test('the pad runs the file, keeps tests the user wrote and times the interview', async () => {
  replies([{ match: 'Plan a', reply: { problems: [brief(), brief({ kind: 'sql' }), brief({ kind: 'written' })] } }, { match: 'kind: code.', reply: code() }, { match: 'kind: sql.', reply: sql() }, { match: 'kind: written.', reply: written() }]);
  const { id } = (await call('POST', '/api/sets', { ...intake, count: 3 })).json;
  const set = await ready(id);
  const [c, q, w] = set.problems.map((p) => `/api/sets/${id}/problems/${p.id}`);
  const problem = async (i = 0) => (await ready(id)).problems[i];

  const starter = set.problems[0].starters;
  assert.match(starter.python, /print\(twice\(1\)\)/);
  const out = (await call('POST', `${c}/program`, { language: 'python', code: 'print("hi")\nraise ValueError("boom")' })).json;
  assert.ok(out.stdout === 'hi\n' && /ValueError: boom/.test(out.stderr) && out.failed && !/private|var\/folders/.test(out.stderr), JSON.stringify(out));
  assert.match((await call('POST', `${q}/program`, { code: 'SELECT name, SUM(v) AS total FROM t GROUP BY name' })).json.stdout, /name  total\n----  -----\na     3\n\n1 row\n/);

  const blank = (await call('POST', `${c}/tests`, { args: ['21'], expected: '' })).json.test;
  assert.deepEqual([blank.args, blank.expected, blank.reference], [[21], 42, undefined]);
  const wrong = (await call('POST', `${c}/tests`, { args: ['5'], expected: '11' })).json.test;
  assert.deepEqual([wrong.expected, wrong.reference], [11, 10]);
  for (const bad of [{ args: ['x'] }, { args: ['1.5'] }, { args: [] }, { args: ['1', '2'] }, { args: 'x' }, { args: ['1'], expected: '"a"' }, { args: [5] }]) assert.equal((await call('POST', `${c}/tests`, bad)).status, 400, JSON.stringify(bad));
  assert.equal((await call('POST', `${w}/tests`, { args: [] })).status, 400);
  assert.deepEqual((await call('POST', `${q}/tests`, { args: ['12321'], expected: '[["1"]]' })).json.test.args, ['12321']);
  await call('DELETE', `${q}/tests/${(await problem(1)).tests[0].id}`);

  const good = { language: 'python', code: 'def twice(x):\n    return x * 2' };
  let r = (await call('POST', `${c}/run`, good)).json;
  assert.deepEqual(r.tests.map((t) => t.label), ['Example 1', 'Example 2', 'Your test 1', 'Your test 2']);
  assert.deepEqual(r.results.map((x) => x.status), ['pass', 'pass', 'pass', 'fail']);
  r = (await call('POST', `${c}/submit`, good)).json;
  assert.equal(r.results.length, 8);
  assert.equal((await problem()).progress, 'solved');
  await call('PUT', `${c}/draft`, { language: 'python', code: { python: 'x' } });
  assert.equal((await problem()).tests.length, 2);
  assert.equal((await call('DELETE', `${c}/tests/${wrong.id}`)).status, 200);
  assert.equal((await call('DELETE', `${c}/tests/${wrong.id}`)).status, 404);
  assert.equal((await problem()).tests.length, 1);
  const rows = (await call('POST', `${q}/tests`, { args: ["CREATE TABLE t (name TEXT, v REAL); INSERT INTO t VALUES ('z', 4);"], expected: '' })).json.test;
  assert.deepEqual(rows.expected, [['z', '4']]);

  assert.equal((await call('POST', `${c}/session`, { action: 'start', minutes: 45 })).status, 200);
  assert.ok((await problem()).session.startedAt);
  await call('POST', `${c}/session`, { action: 'end' });
  assert.ok((await problem()).session.endedAt && (await problem()).session.minutes === 45);
  const first = (await problem()).session.endedAt;
  await new Promise((r) => setTimeout(r, 20));
  await call('POST', `${c}/session`, { action: 'end' });
  assert.equal((await problem()).session.endedAt, first);
  await call('POST', `${c}/session`, { action: 'clear' });
  assert.equal((await problem()).session, null);
  for (const bad of [{ action: 'start', minutes: 7 }, { action: 'nope' }]) assert.equal((await call('POST', `${c}/session`, bad)).status, 400);
  assert.equal((await call('POST', `${w}/session`, { action: 'end' })).status, 400);
  assert.equal((await call('POST', `${w}/program`, { language: 'python', code: '' })).status, 400);
});

test('a set can be listed, solved in every kind and deleted', async () => {
  replies([
    { match: 'Plan a', reply: { problems: [brief(), brief({ subject: 'Math', kind: 'numeric' }), brief({ subject: 'Math', kind: 'written' })] } },
    { match: 'kind: code.', reply: code() },
    { match: 'kind: numeric.', reply: numeric() },
    { match: 'kind: written.', reply: written() },
    { match: 'Grade this', reply: { summary: 's', points: [{ mark: 'met', note: '' }, { mark: 'partial', note: 'n' }] }, once: true },
    { match: 'Grade this', reply: { summary: 's', points: [{ mark: 'met', note: '' }, { mark: 'met', note: '' }] } },
  ]);
  const { id } = (await call('POST', '/api/sets', { ...intake, subjects: ['Coding', 'Math'], count: 3 })).json;
  const set = await ready(id);
  assert.deepEqual(set.problems.map((p) => p.status), ['ready', 'ready', 'ready']);
  const [c, n, w] = set.problems.map((p) => `/api/sets/${id}/problems/${p.id}`);
  const progress = async () => (await ready(id)).problems.map((p) => p.progress);

  assert.match(set.problems[0].starters.cpp, /long long twice\(long long x\)/);
  const ok = { language: 'javascript', code: 'const twice = (x) => 2 * x' };
  assert.equal((await call('POST', `${c}/run`, ok)).json.results.length, 2);
  assert.deepEqual(await progress(), ['open', 'open', 'open']);
  assert.equal((await call('POST', `${c}/submit`, { language: 'python', code: 'def twice(x):\n    return 2' })).json.results.length, 6);
  assert.deepEqual(await progress(), ['tried', 'open', 'open']);
  await call('POST', `${c}/submit`, ok);
  await call('POST', `${c}/submit`, { language: 'python', code: 'broken(' });

  assert.equal((await call('POST', `${n}/check`, { answer: 'zzz' })).status, 400);
  assert.equal((await call('POST', `${n}/check`, { answer: '1' })).json.correct, false);
  assert.equal((await call('POST', `${n}/check`, { answer: '1/4' })).json.correct, true);

  assert.equal((await call('POST', `${w}/feedback`, { answer: ' ' })).status, 400);
  assert.equal((await call('POST', `${w}/feedback`, { answer: 'a' })).json.feedback.score, 0.75);
  assert.deepEqual(await progress(), ['solved', 'solved', 'tried']);
  await call('POST', `${w}/feedback`, { answer: 'better' });
  assert.deepEqual(await progress(), ['solved', 'solved', 'solved']);

  await call('PUT', `${c}/draft`, { language: 'cpp', code: { cpp: 'x', ruby: 'y' }, answer: '1', extra: 1 });
  assert.deepEqual((await ready(id)).problems[0].draft, { language: 'cpp', code: { cpp: 'x' }, answer: '1' });
  assert.equal((await call('PUT', `${c}/draft`, { code: { cpp: 5 } })).status, 400);

  const row = (await call('GET', '/api/sets')).json.sets.find((s) => s.id === id);
  assert.deepEqual([row.total, row.solved, row.quote], [3, 3, 'write clean Python']);

  for (const [path, body] of [[`${n}/run`, ok], [`${c}/check`, { answer: '1' }], [`${c}/run`, { ...ok, language: 'ruby' }], [`${c}/run`, { language: 'python' }], [`${c}/retry`, {}], [`/api/sets/${id}/retry`, {}]]) assert.equal((await call('POST', path, body)).status, 400, path);
  assert.equal((await call('POST', `/api/sets/${id}/problems/nope/run`, ok)).status, 404);
  assert.equal((await call('DELETE', `/api/sets/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/sets/${id}`)).status, 404);
  assert.equal((await call('DELETE', `/api/sets/${id}`)).status, 404);
});

test('SQL and interface problems can be solved, and the preview page is locked', async () => {
  replies([{ match: 'Plan a', reply: { problems: [brief({ kind: 'sql' }), brief({ kind: 'ui' })] } }, { match: 'kind: sql.', reply: sql() }, { match: 'kind: ui.', reply: ui() }]);
  const { id } = (await call('POST', '/api/sets', { ...intake, count: 2 })).json;
  const set = await ready(id);
  assert.deepEqual(set.problems.map((p) => p.status), ['ready', 'ready']);
  assert.deepEqual(Object.keys(set.problems[0].starters), ['sql']);
  const [q, u] = set.problems.map((p) => `/api/sets/${id}/problems/${p.id}`);
  const submit = async (c) => (await call('POST', `${q}/submit`, { code: c })).json.results.map((r) => r.status);
  assert.deepEqual(await submit("SELECT name, TOTAL(v) FROM t GROUP BY name HAVING 'caf\u00e9 \u{1f642}' > '' ORDER BY 1 DESC"), ['pass', 'pass', 'fail', 'pass']);
  assert.deepEqual(await submit('SELECT name, SUM(v) FROM t GROUP BY 1'), ['pass', 'pass', 'pass', 'pass']);
  assert.match((await call('POST', `${q}/run`, { code: 'SELEC' })).json.results[0].error, /syntax error/);
  assert.equal((await call('POST', `${u}/run`, { code: '' })).status, 400);
  assert.equal((await call('POST', `${u}/checked`, { passed: 2, total: 3 })).status, 200);
  assert.equal((await call('POST', `${u}/checked`, { passed: 'x', total: 3 })).status, 400);
  assert.equal((await call('POST', `${q}/checked`, { passed: 3, total: 3 })).status, 400);
  await call('POST', `${u}/checked`, { passed: 3, total: 3 });
  assert.deepEqual((await ready(id)).problems.map((p) => p.progress), ['solved', 'solved']);
  replies([{ match: 'interactive picture', reply: { summary: 's', html: '<p>x</p>' } }]);
  clearCalls();
  await call('POST', `${q}/analyze`, { code: 'SELECT 1, 2' });
  await call('POST', `${u}/analyze`, { code: '<b>mine</b>', outcome: '1 of 3 checks pass' });
  for (let i = 0; calls().length < 2 && i < 200; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(calls().some((c) => c.prompt.includes('SELECT 1, 2')) && calls().some((c) => c.prompt.includes('1 of 3 checks pass')));
  const page = await raw('GET', '/preview.html');
  assert.match(page.headers['content-security-policy'], /^sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'/);
});

test('a failed problem reports its error and refuses answers', async () => {
  replies([{ match: 'Plan a', reply: { problems: [brief()] } }, { match: 'Write one', exit: 'not logged in' }]);
  const { id } = (await call('POST', '/api/sets', intake)).json;
  const set = await ready(id);
  assert.match(set.problems[0].error, /not logged in/);
  assert.equal((await call('POST', `/api/sets/${id}/problems/${set.problems[0].id}/run`, {})).status, 400);
  replies([{ match: 'Write one', reply: code() }]);
  assert.equal((await call('POST', `/api/sets/${id}/problems/${set.problems[0].id}/retry`, {})).status, 200);
  assert.equal((await ready(id)).problems[0].status, 'ready');
});

test('model test reports success and the raw failure', async () => {
  const choice = { provider: 'claude', model: 'sonnet', effort: '' };
  replies([{ match: 'Set ok', reply: { ok: true } }]);
  assert.equal((await call('POST', '/api/settings/test', choice)).status, 200);
  replies([{ match: 'Set ok', reply: { ok: false } }]);
  assert.equal((await call('POST', '/api/settings/test', choice)).status, 502);
  replies([{ match: 'Set ok', exit: 'unknown option --effort' }]);
  const r = await call('POST', '/api/settings/test', choice);
  assert.equal(r.status, 502);
  assert.match(r.json.error, /unknown option --effort/);
  replies([{ match: 'Set ok', exit: 'usage limit' }]);
  assert.equal((await call('POST', '/api/settings/test', choice)).status, 429);
});

test('status and options', async () => {
  const s = (await call('GET', '/api/status')).json;
  assert.equal(s.sandbox.ok, true, s.sandbox.detail);
  for (const v of Object.values(s.languages)) assert.match(v, /^\d+\./);
  assert.equal(s.providers.length, 2);
  assert.equal(Object.keys((await call('GET', '/api/options')).json.groups).length, 4);
});

test('requests from other sites and malformed requests are refused', async () => {
  const body = JSON.stringify(intake);
  const json = { 'content-type': 'application/json' };
  const origin = `http://localhost:${port}`;
  const expected = [
    [403, 'GET', '/api/sets', { headers: { host: 'evil.example' } }],
    [403, 'GET', '/', { headers: { host: `evil.example:${port}` } }],
    [403, 'POST', '/api/sets', { body, headers: { ...json, origin: 'https://evil.example' } }],
    [403, 'POST', '/api/sets', { body, headers: json }],
    [403, 'DELETE', '/api/sets/x', {}],
    [403, 'GET', '/api/status', { headers: { 'sec-fetch-site': 'cross-site' } }],
    [415, 'POST', '/api/sets', { body, headers: { origin, 'content-type': 'text/plain' } }],
    [400, 'POST', '/api/sets', { body: '{', headers: { ...json, origin } }],
    [400, 'POST', '/api/sets', { body: 'null', headers: { ...json, origin } }],
    [400, 'POST', '/api/sets', { body: '{}', headers: { ...json, origin } }],
    [413, 'POST', '/api/sets', { body: JSON.stringify({ a: 'x'.repeat(6 << 20) }), headers: { ...json, origin } }],
    [404, 'GET', '/api/nothing', {}],
    [405, 'PUT', '/api/sets', { body, headers: { ...json, origin } }],
    [404, 'GET', '/api/sets/..%2f..%2fsettings', {}],
    [404, 'GET', '/..%2fpackage.json', {}],
    [404, 'GET', '/%00.js', {}],
    [400, 'GET', '/%zz', {}],
    [403, 'POST', '/api/problems', { body: JSON.stringify({ request: 'x' }), headers: { ...json, origin: 'null' } }],
    [405, 'POST', '/', { body, headers: { ...json, origin } }],
  ];
  for (const [status, method, path, o] of expected) {
    const r = await raw(method, path, o).catch((e) => ({ status: e.code, headers: {} }));
    assert.ok(r.status === status || (status === 413 && ['EPIPE', 'ECONNRESET'].includes(r.status)), `${method} ${path} gave ${r.status}, wanted ${status}`);
    assert.ok(!Object.keys(r.headers).some((h) => h.startsWith('access-control')));
  }
});

test('the page is served with a strict policy', async () => {
  const r = await raw('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /default-src 'none'; script-src 'self'/);
  assert.match(r.text, /<title>Interview Buddy/);
  assert.equal((await raw('GET', '/app.js')).headers['content-type'], 'text/javascript; charset=utf-8');
});

test('the command starts, answers and points at a running copy', { timeout: 30000 }, async () => {
  const run = (...args) => {
    const p = spawn(process.execPath, ['bin/interview-buddy.js', '--no-open', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.out = '';
    p.stdout.on('data', (d) => (p.out += d));
    p.stderr.on('data', (d) => (p.out += d));
    p.done = new Promise((r) => p.on('close', r));
    return p;
  };
  const a = run('--port', '0');
  while (!/running at/.test(a.out)) await new Promise((r) => setTimeout(r, 20));
  const url = a.out.match(/http:\S+/)[0];
  assert.equal((await fetch(`${url}/api/settings`)).status, 200);
  const b = run('--port', new URL(url).port);
  await b.done;
  assert.match(b.out, /already in use/);
  a.kill('SIGTERM');
  assert.equal(await a.done, 0);
  for (const args of [['--port', 'x'], ['--what']]) {
    const c = run(...args);
    assert.equal(await c.done, 1);
    assert.match(c.out, /Usage/);
  }
  const h = run('--help');
  assert.equal(await h.done, 0);
  assert.ok(fs.statSync('bin/interview-buddy.js').mode & 0o100);
});
