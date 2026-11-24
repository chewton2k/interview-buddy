import { randomUUID } from 'node:crypto';
import { findQuote } from './answers.js';
import { badSignature, close, fits, same, starter } from './harness.js';
import { fetchPage } from './link.js';
import { ask, ProviderError } from './providers.js';
import { runCode, tools } from './sandbox.js';
import { createSetFile, ensureSet, Invalid, listSets, readSet, readSettings, updateProblem, updateSet } from './store.js';

export const SUBJECTS = ['Coding', 'Quant', 'Math', 'Physics', 'Chemistry', 'Circuit design'];
export const LEVELS = ['Intern', 'New grad', 'Mid', 'Senior'];
const TYPES = 'int, float, string, bool, and lists of them written int[], string[][] and so on, up to three levels deep';
const MAX_TRIES = 3;

export const str = { type: 'string' };
const list = (items) => ({ type: 'array', items });
export const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const oneOf = (...values) => ({ type: 'string', enum: values });

export const planSchema = (subjects) => obj({ problems: list(obj({ title: str, subject: oneOf(...subjects), kind: oneOf('code', 'numeric', 'written'), difficulty: oneOf('Easy', 'Medium', 'Hard'), topic: str, quote: str })) });
const common = { statement: str, hints: list(str), rubric: list(str), solution_text: str };
export const problemSchema = {
  code: obj({ ...common, function_name: str, params: list(obj({ name: str, type: str })), returns: str, compare: oneOf('exact', 'unordered'), examples: list(obj({ args_json: str, expected_json: str, explanation: str })), case_args_json: list(str), solution_python: str, brute_python: str }),
  numeric: obj({ ...common, figure_svg: str, answer: { type: 'number' }, unit: str, tolerance: { type: 'number' }, solver_python: str }),
  written: obj({ ...common, figure_svg: str }),
};
const gradeSchema = obj({ summary: str, points: list(obj({ mark: oneOf('met', 'partial', 'missed'), note: str })) });

export const data = (value) => `<data>\n${JSON.stringify(value, null, 1).replace(/</g, '\\u003c')}\n</data>`;

const text = (v, name, max, required) => {
  if (v === undefined && !required) return '';
  if (typeof v !== 'string') throw new Invalid(`${name} must be text`);
  const t = v.trim();
  if (required && !t) throw new Invalid(`Add the ${name.toLowerCase()}`);
  if (t.length > max) throw new Invalid(`${name} is longer than ${max.toLocaleString('en-US')} characters`);
  return t;
};
export function checkIntake(b) {
  const intake = { company: text(b?.company, 'Company', 120, true), role: text(b.role, 'Role', 120, true), posting: text(b.posting, 'Job posting', 30000), rounds: text(b.rounds, 'What the interview has', 6000) };
  if (!Array.isArray(b.subjects)) throw new Invalid('Choose at least one subject');
  intake.subjects = [...new Set(b.subjects.map((s) => text(s, 'Subject', 40, true)))];
  if (!intake.subjects.length) throw new Invalid('Choose at least one subject');
  if (!LEVELS.includes(b.level)) throw new Invalid('Choose a level');
  if (!Number.isInteger(b.count) || b.count < 1 || b.count > 10) throw new Invalid('Choose between 1 and 10 problems');
  if (intake.subjects.length > b.count) throw new Invalid('Choose at least as many problems as subjects');
  return { ...intake, level: b.level, count: b.count };
}

const briefSchema = (subjects) => obj({ title: str, subject: oneOf(...subjects), kind: oneOf('code', 'numeric', 'written'), difficulty: oneOf('Easy', 'Medium', 'Hard'), topic: str });
const briefPrompt = (intake, p) => `A candidate asked for one practice problem. Plan it.
kind is "code" for a function run against tests, "numeric" for one number as the answer, "written" for design, derivation or explanation graded on a rubric. Follow the kind they ask for. Otherwise prefer code for coding and numeric for quant, math, physics, chemistry and circuits.
topic is two or three sentences telling the author exactly what to write. title is at most 8 words in sentence case.
${data({ request: p.request, guidance: p.guidance, level: intake.level, ...(intake.personal ? {} : { company: intake.company, role: intake.role }), source: p.source })}`;

const planPrompt = (intake) => `Plan a practice set of exactly ${intake.count} problems for the interview described below.
Use every listed subject at least once and no other subject. Match the level, the company's domain and what the rounds test. Order from easier to harder, and vary the topics.
kind is "code" for a function the candidate writes and runs against tests, "numeric" for one number as the answer, "written" for design, derivation or explanation that a rubric grades. Prefer code for coding subjects and numeric for quant, math, physics, chemistry and circuits. Use written where an interviewer would want the reasoning.
quote must be 3 to 15 consecutive words copied exactly from "posting" or "rounds" that the problem trains. Prefer a different quote for each problem. Use an empty string only when nothing fits.
topic is one sentence telling the author what to write. title is at most 8 words in sentence case.
${data(intake)}`;

const rules = {
  code: `kind: code. The candidate writes one function. Types allowed: ${TYPES}. No other types, so express trees, graphs, linked lists and class designs with lists or lists of operations.
function_name and parameter names: lowercase first letter, only letters, digits and underscores, not a keyword in Python, JavaScript or C++.
args_json is a JSON array with one value per parameter. expected_json is the JSON return value. Give 2 or 3 examples.
case_args_json holds 10 to 14 more inputs, inputs only. Include the smallest and empty inputs the statement allows, duplicates, negatives, extremes, and a few of 30 to 200 elements. Every input must obey the constraints in the statement and stay small enough for the brute force to finish in one second. Strings use printable ASCII only.
The answer must be unique. Use compare "unordered" only when the statement says the result may be in any order.
solution_python is an efficient solution. brute_python solves the same task by a different, simpler method. Both define function_name with exactly those parameters, use only the standard library, never mutate shared state and never print. Both will be executed and must agree on every input.
State constraints and the expected time complexity in the statement. Do not repeat the examples in the statement.`,
  numeric: `kind: numeric. The answer is one finite real number in the stated unit (empty string for a pure number). Say in the statement which unit, and how many significant figures are needed. tolerance is the relative error to accept, between 0.0001 and 0.05.
solver_python defines solve() with no parameters and returns the number, computed from the givens in the statement without using your stated answer. Standard library only. It will be executed and must match answer.`,
  written: `kind: written. Ask for a design, derivation or explanation that can be answered in 10 to 20 minutes of writing. No number or code is checked, so the rubric decides.`,
};
const figure = `figure_svg: an inline SVG drawing when one genuinely helps, such as a circuit, free-body diagram or apparatus, otherwise an empty string. Include xmlns, a viewBox about 400 wide, black strokes on white, text of at least 14px, no scripts, no external references.`;
const problemPrompt = (kind, intake, brief, problem) => `Write one original interview problem.
${rules[kind]}
${kind === 'code' ? '' : figure}
statement is Markdown with $...$ or $$...$$ for math. It must be complete and unambiguous on its own. Do not reveal the method. Do not use headings. Never write a dollar sign for money, write USD.
hints: exactly 3, from gentle to nearly the method. rubric: 3 to 5 short points an interviewer would check in the reasoning or code, each one sentence. solution_text explains the full solution in Markdown.
${brief.request ? 'Write the problem the request asks for. When there is source material, build on its idea and change the setting, the numbers and the wording, so the result is original and complete without the source.' : 'Write an original problem shaped by this company and role, not a copy of a published one.'}
${data({ ...(intake.personal ? {} : { company: intake.company, role: intake.role, rounds: intake.rounds }), level: intake.level, brief })}
${problem ? `Your previous attempt was rejected by the checks: ${problem}\nWrite the whole problem again with that fixed.` : ''}`;

export class Rejected extends Error {}

async function trial(options) {
  const r = await runCode(options);
  if (r.unavailable) throw new ProviderError('missing', r.compileError);
  return r;
}
const plainText = (v) => (Array.isArray(v) ? v.every(plainText) : typeof v !== 'string' || /^[\x20-\x7e\n\t]*$/.test(v));

const parseJson = (s, what) => {
  try {
    return JSON.parse(s);
  } catch {
    throw new Rejected(`${what} is not valid JSON: ${s.slice(0, 120)}`);
  }
};
const show = (v) => JSON.stringify(v).slice(0, 300);

async function verifyCode(d) {
  const signature = { name: d.function_name, params: d.params, returns: d.returns };
  const bad = badSignature(signature);
  if (bad) throw new Rejected(bad);
  if (d.examples.length < 2) throw new Rejected('at least 2 examples are needed');
  const examples = d.examples.map((e) => ({ args: parseJson(e.args_json, 'args_json'), expected: parseJson(e.expected_json, 'expected_json'), explanation: e.explanation }));
  const extra = d.case_args_json.map((a) => ({ args: parseJson(a, 'case_args_json') }));
  const seen = new Set(examples.map((c) => JSON.stringify(c.args)));
  const fresh = extra.filter((c) => !seen.has(JSON.stringify(c.args)) && seen.add(JSON.stringify(c.args)));
  const cases = [...examples, ...fresh].slice(0, 30);
  if (cases.length < 6) throw new Rejected('fewer than 6 different inputs were given');
  for (const c of cases) {
    if (!Array.isArray(c.args) || c.args.length !== d.params.length || !c.args.every((a, i) => fits(a, d.params[i].type))) throw new Rejected(`input ${show(c.args)} does not match the parameter types`);
    if (JSON.stringify(c.args).length > 20000) throw new Rejected('an input is longer than 20,000 characters');
    if (!plainText(c.args) || !plainText(c.expected)) throw new Rejected('strings must use only printable ASCII characters, because languages count other characters differently');
    if ('expected' in c && !fits(c.expected, d.returns)) throw new Rejected(`expected value ${show(c.expected)} is not of type ${d.returns}`);
  }
  for (const language of ['javascript', 'cpp']) {
    if (!(await tools())[language]) continue;
    const r = await trial({ language, code: starter(language, signature), signature, cases: [{ args: cases[0].args }] });
    if (r.compileError) throw new Rejected(`the function or parameter names do not work in ${language}: ${r.compileError.slice(0, 200)}`);
  }
  const runOne = (code) => trial({ language: 'python', code, signature, cases: cases.map(({ args }) => ({ args })) });
  const [solution, brute] = await Promise.all([runOne(d.solution_python), runOne(d.brute_python)]);
  for (const [name, r] of [['solution_python', solution], ['brute_python', brute]]) {
    const i = r.results.findIndex((x) => x.status !== 'pass');
    if (i >= 0) throw new Rejected(`${name} failed on ${show(cases[i].args)}: ${r.results[i].error ?? show(r.results[i].actual)}`);
  }
  cases.forEach((c, i) => {
    const value = solution.results[i].actual;
    if (!same(value, brute.results[i].actual, d.compare)) throw new Rejected(`on ${show(c.args)} solution_python returned ${show(value)} and brute_python returned ${show(brute.results[i].actual)}`);
    if ('expected' in c && !same(value, c.expected, d.compare)) throw new Rejected(`the example ${show(c.args)} says ${show(c.expected)} but both solutions returned ${show(value)}`);
  });
  return { signature, compare: d.compare, exampleCount: examples.length, cases: cases.map((c, i) => ({ args: c.args, expected: solution.results[i].actual, ...(c.explanation && { explanation: c.explanation }) })), solutionCode: d.solution_python };
}

async function verifyNumeric(d) {
  const r = await trial({ language: 'python', code: d.solver_python, signature: { name: 'solve', params: [], returns: 'float' }, cases: [{ args: [] }] });
  const { status, actual, error } = r.results[0];
  if (status !== 'pass') throw new Rejected(`solver_python failed: ${error}`);
  const tolerance = Math.min(0.05, Math.max(0.0001, d.tolerance));
  if (!close(d.answer, actual, tolerance, actual === 0 ? 1e-12 : 0)) throw new Rejected(`the stated answer is ${d.answer} but solver_python returned ${actual}`);
  return { answer: actual, unit: d.unit.trim(), tolerance };
}

const svg = (s) => (/^\s*<svg[\s>]/i.test(s ?? '') && s.length < 60000 ? (s.includes('xmlns=') ? s : s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')) : '');

async function verify(kind, d) {
  if (!d.statement.trim()) throw new Rejected('the statement is empty');
  if (!d.rubric.length) throw new Rejected('the rubric is empty');
  const base = { statement: d.statement, hints: d.hints.slice(0, 3), rubric: d.rubric.slice(0, 6), solutionText: d.solution_text, figure: svg(d.figure_svg) };
  if (kind === 'code') return { ...base, ...(await verifyCode(d)) };
  if (kind === 'numeric') return { ...base, ...(await verifyNumeric(d)) };
  return base;
}

/** Asks until the local checks pass. Only rejected content is retried, never account or network errors. */
export async function writeProblem({ intake, brief, choice, signal, onStep = () => {} }) {
  let reason = '';
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    await onStep(attempt === 1 ? 'Writing' : 'Fixing');
    try {
      const draft = await ask({ ...choice, prompt: problemPrompt(brief.kind, intake, brief, reason), schema: problemSchema[brief.kind], signal });
      await onStep('Checking');
      return await verify(brief.kind, draft);
    } catch (e) {
      if (e instanceof Rejected || e.kind === 'badjson') reason = e.message;
      else throw e;
    }
  }
  throw new Rejected(`Did not pass the checks after ${MAX_TRIES} tries. Last problem: ${reason}`);
}

async function plan(intake, choice, signal) {
  for (let attempt = 1; ; attempt++) {
    const { problems } = await ask({ ...choice, prompt: planPrompt(intake), schema: planSchema(intake.subjects), signal });
    const briefs = problems.slice(0, intake.count);
    const missing = intake.subjects.filter((s) => !briefs.some((b) => b.subject === s));
    if (briefs.length === intake.count && !missing.length) {
      return briefs.map((b) => ({ ...b, quote: findQuote(intake.posting, b.quote) ?? findQuote(intake.rounds, b.quote) ?? '' }));
    }
    if (attempt === 2) throw new ProviderError('badjson', missing.length ? `The plan left out ${missing.join(', ')}. Try again or pick another model.` : 'The plan had the wrong number of problems. Try again or pick another model.');
  }
}

const blank = (b) => ({ id: randomUUID(), ...b, status: 'queued', step: null, error: null, body: null, progress: 'open', draft: {}, feedback: null });

const jobs = new Map();
const STOPS = ['auth', 'rate', 'timeout', 'missing'];
let busy = 0;
const line = [];
async function turn(fn) {
  if (busy >= 2) await new Promise((r) => line.push(r));
  busy++;
  try {
    return await fn();
  } finally {
    busy--;
    line.shift()?.();
  }
}

async function planOne(intake, p, choice, signal, put) {
  const patch = {};
  if (p.links.length && !p.source) {
    await put({ status: 'writing', step: 'Reading the link' });
    patch.source = (await Promise.all(p.links.map((l) => fetchPage(l, { signal })))).join('\n\n');
  }
  await put({ status: 'writing', step: 'Planning', ...patch });
  const subjects = p.subject ? [p.subject] : [...new Set([...SUBJECTS, ...intake.subjects])];
  const { title, subject, kind, difficulty, topic } = await ask({ ...choice, prompt: briefPrompt(intake, { ...p, ...patch }), schema: briefSchema(subjects), signal });
  Object.assign(patch, { title, subject, kind, difficulty, topic });
  await put(patch);
  return patch;
}

async function generate(setId, pid, job) {
  if (job.signal.aborted) return;
  const set = await readSet(setId);
  const brief = set.problems.find((p) => p.id === pid);
  if (brief?.status !== 'queued') return;
  const put = (patch) => updateProblem(setId, pid, (p) => void Object.assign(p, patch));
  try {
    const { write } = await readSettings();
    if (brief.request && !brief.kind) Object.assign(brief, await planOne(set.intake, brief, write, job.signal, put));
    const { title, subject, kind, difficulty, topic, request, guidance, source } = brief;
    const body = await writeProblem({ intake: set.intake, brief: { title, subject, kind, difficulty, topic, request, guidance, source }, choice: write, signal: job.signal, onStep: (step) => put({ status: 'writing', step }) });
    await put({ status: 'ready', step: null, error: null, body });
  } catch (e) {
    if (job.signal.aborted) return;
    await put({ status: 'failed', step: null, error: e.message });
    if (STOPS.includes(e.kind)) {
      await updateSet(setId, (s) => {
        for (const p of s.problems) if (p.status === 'queued') Object.assign(p, { status: 'failed', error: e.message });
      });
    }
  }
}

function jobFor(setId) {
  if (!jobs.has(setId)) jobs.set(setId, { controller: new AbortController(), count: 0 });
  return jobs.get(setId);
}
export async function tracked(setId, fn) {
  const job = jobFor(setId);
  job.count++;
  try {
    await fn({ signal: job.controller.signal });
  } catch (e) {
    if (!job.controller.signal.aborted) console.error(e);
  } finally {
    if (--job.count === 0) jobs.delete(setId);
  }
}

const runQueued = (setId, pids, job) => Promise.all(pids.map((pid) => turn(() => generate(setId, pid, job))));

async function planAndRun(setId) {
  await tracked(setId, async (job) => {
    try {
      const { intake } = await readSet(setId);
      const { write } = await readSettings();
      const briefs = await turn(() => plan(intake, write, job.signal));
      const pids = await updateSet(setId, (s) => {
        s.status = 'ready';
        s.problems = briefs.map((b) => blank(b));
        return s.problems.map((p) => p.id);
      });
      await runQueued(setId, pids, job);
    } catch (e) {
      if (job.signal.aborted) return;
      await updateSet(setId, (s) => void Object.assign(s, { status: 'failed', error: e.message }));
    }
  });
}

export async function createSet(body) {
  const set = await createSetFile(checkIntake(body));
  planAndRun(set.id);
  return set;
}

export const checkRequest = (b) => ({ request: text(b?.request, 'Link or idea', 6000, true), subject: b.subject ? text(b.subject, 'Subject', 40, true) : '' });

/** Adds one problem made from a link or an idea. Only `links` are opened, never links found elsewhere. */
export async function addProblem(setId, { request, subject, links, guidance = '' }) {
  const p = blank({ title: 'New problem', subject, kind: '', difficulty: '', topic: '', quote: '', request, guidance, links });
  await updateSet(setId, (s) => {
    if (s.status !== 'ready') throw new Invalid('Wait until this set is planned');
    if (s.problems.length >= 100) throw new Invalid('This set is full. Start another one.');
    s.problems.push(p);
  });
  tracked(setId, (job) => runQueued(setId, [p.id], job));
  return p.id;
}

const PERSONAL = '00000000-0000-4000-8000-000000000000';
export const personalSet = async () => (await ensureSet(PERSONAL, { status: 'ready', intake: { company: 'My problems', role: '', posting: '', rounds: '', subjects: SUBJECTS, level: 'Mid', count: 1, personal: true } })).id;

export async function retrySet(setId) {
  await updateSet(setId, (s) => {
    if (s.status !== 'failed') throw new Invalid('This set is not waiting for a retry');
    Object.assign(s, { status: 'planning', error: null });
  });
  planAndRun(setId);
}

export async function retryProblem(setId, pid) {
  await updateProblem(setId, pid, (p) => {
    if (p.status !== 'failed') throw new Invalid('This problem is not waiting for a retry');
    Object.assign(p, { status: 'queued', error: null });
  });
  tracked(setId, (job) => runQueued(setId, [pid], job));
}

export const stopSet = (setId) => jobs.get(setId)?.controller.abort();

/** Work cut off by a closed server becomes a retryable failure. Call only once this process owns the port. */
export async function recoverInterrupted() {
  const message = 'Interview Buddy was closed before this finished';
  for (const { id } of await listSets()) {
    await updateSet(id, (s) => {
      if (s.status === 'planning') Object.assign(s, { status: 'failed', error: message });
      for (const p of s.problems) if (p.status === 'queued' || p.status === 'writing') Object.assign(p, { status: 'failed', step: null, error: message });
      for (const p of s.problems) {
        if (p.chatBusy) Object.assign(p, { chatBusy: false, chatError: message });
        if (p.visual?.status === 'working') Object.assign(p.visual, { status: 'failed', step: null, error: message });
      }
    });
  }
}

export async function grade({ problem, answer, outcome, signal }) {
  const { grade: choice } = await readSettings();
  const { statement, rubric, solutionText, solutionCode, answer: correct, unit } = problem.body;
  const prompt = `Grade this interview answer as a fair, specific interviewer. Give one entry in points for each of the ${rubric.length} rubric points, in order. mark is met, partial or missed. note is one or two sentences addressed to the candidate that point at what they wrote, and is empty when the point is fully met. summary is two sentences with the single most useful next step. Grade only what is written. Use $...$ for math.
${data({ statement, rubric, reference: solutionCode ?? solutionText, correct_answer: correct === undefined ? undefined : `${correct} ${unit}`, outcome, candidate_answer: answer })}`;
  const g = await ask({ ...choice, prompt, schema: gradeSchema, signal });
  if (g.points.length !== rubric.length) throw new ProviderError('badjson', 'The grader skipped part of the rubric. Try again.');
  const score = g.points.reduce((s, p) => s + (p.mark === 'met' ? 1 : p.mark === 'partial' ? 0.5 : 0), 0) / rubric.length;
  return { summary: g.summary, score, points: g.points.map((p, i) => ({ point: rubric[i], mark: p.mark, note: p.note })) };
}
