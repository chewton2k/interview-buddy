import { randomUUID } from 'node:crypto';
import { findQuote } from './answers.js';
import { badSignature, close, fits, same, starter } from './harness.js';
import { fetchPage } from './link.js';
import { ask, ProviderError } from './providers.js';
import { checkFiles, runCode, runProject, tools } from './sandbox.js';
import { createSetFile, ensureSet, Invalid, listSets, readSet, chosen, updateProblem, updateSet } from './store.js';

export const GROUPS = {
  Engineering: ['Coding', 'AI-native coding', 'System design', 'Frontend', 'SQL and data', 'Machine learning', 'Circuit design', 'Mechanical'],
  'Quant and science': ['Quant', 'Math', 'Statistics', 'Physics', 'Chemistry', 'Biology'],
  'Design and product': ['UI/UX design', 'Product sense'],
  'Business and people': ['Case study', 'Finance', 'Behavioral'],
};
export const SUBJECTS = Object.values(GROUPS).flat();
const KINDS = ['code', 'project', 'numeric', 'written', 'ui', 'sql'];
const KIND_GUIDE = 'kind is "code" for a function the candidate writes and runs against tests in Python, JavaScript or C++, "project" for an AI-native coding round where the candidate works in a small existing multi-file Python codebase with data files, tests and an AI assistant, and fixes, extends and verifies it, "sql" for one SQLite query run against several datasets, "ui" for an interface built in HTML, CSS and JavaScript with a preview and checks, "numeric" for one number as the answer, and "written" for design, derivation, explanation, critique, a case or a story that a rubric grades. In written problems the candidate can write, typeset equations and draw diagrams or wireframes.';
export const LEVELS = ['Intern', 'New grad', 'Mid', 'Senior'];
const TYPES = 'int, float, string, bool, and lists of them written int[], string[][] and so on, up to three levels deep';
const MAX_TRIES = 3;

export const str = { type: 'string' };
const list = (items) => ({ type: 'array', items });
export const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const oneOf = (...values) => ({ type: 'string', enum: values });

export const planSchema = (subjects) => obj({ problems: list(obj({ title: str, subject: oneOf(...subjects), kind: oneOf(...KINDS), difficulty: oneOf('Easy', 'Medium', 'Hard'), topic: str, quote: str })) });
const common = { statement: str, hints: list(str), rubric: list(str), solution_text: str };
export const problemSchema = {
  code: obj({ ...common, function_name: str, params: list(obj({ name: str, type: str })), returns: str, compare: oneOf('exact', 'unordered'), examples: list(obj({ args_json: str, expected_json: str, explanation: str })), case_args_json: list(str), solution_python: str, brute_python: str }),
  numeric: obj({ ...common, figure_svg: str, answer: { type: 'number' }, unit: str, tolerance: { type: 'number' }, solver_python: str }),
  written: obj({ ...common, figure_svg: str }),
  project: obj({ ...common, files: list(obj({ path: str, content: str })), hidden_tests: str, solution_files: list(obj({ path: str, content: str })) }),
  ui: obj({ ...common, starter_html: str, reference_html: str, checks: list(obj({ name: str, js: str })) }),
  sql: obj({ ...common, setup_sql: str, datasets: list(str), ordered: { type: 'boolean' }, reference_sql: str, second_sql: str }),
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

const briefSchema = (subjects) => obj({ title: str, subject: oneOf(...subjects), kind: oneOf(...KINDS), difficulty: oneOf('Easy', 'Medium', 'Hard'), topic: str });
const briefPrompt = (intake, p) => `A candidate asked for one practice problem. Plan it.
${KIND_GUIDE} Follow the kind they ask for. Otherwise use the one an interviewer in that subject would use.
topic is two or three sentences telling the author exactly what to write. title is at most 8 words in sentence case.
${data({ request: p.request, guidance: p.guidance, level: intake.level, ...(intake.personal ? {} : { company: intake.company, role: intake.role }), source: p.source })}`;

const covers = ({ subjects, count }) => subjects.length <= count;
const planPrompt = (intake, existing) => `Plan a practice set of exactly ${intake.count} problems for the interview described below.
${existing.length ? 'They join the problems in "existing". Do not repeat the task, method or quote of any of those.\n' : ''}${covers(intake) ? 'Use every listed subject at least once and no other subject.' : 'Use only the listed subjects.'} Match the level, the company's domain and what the rounds test. Order from easier to harder, and vary the topics.
${KIND_GUIDE} Prefer project for AI-native coding and whenever the rounds mention an AI assistant, an existing codebase or several files, code for coding and machine learning, sql for SQL, ui for frontend, numeric for quant, math, statistics, physics, chemistry, mechanics, circuits and finance, and written for system design, UI/UX, product, case, biology and behavioral, unless the rounds suggest otherwise. Behavioral problems ask for a real story and are graded on situation, actions, result and reflection.
quote must be 3 to 15 consecutive words copied exactly from "posting" or "rounds" that the problem trains. Prefer a different quote for each problem. Use an empty string only when nothing fits.
topic is one sentence telling the author what to write. title is at most 8 words in sentence case.
${data(existing.length ? { ...intake, existing: existing.map((p) => ({ title: p.title, subject: p.subject, topic: p.topic, quote: p.quote })) } : intake)}`;

const rules = {
  code: `kind: code. The candidate writes one function. Types allowed: ${TYPES}. No other types, so express trees, graphs, linked lists and class designs with lists or lists of operations.
function_name and parameter names: lowercase first letter, only letters, digits and underscores, not a keyword in Python, JavaScript or C++.
args_json is a JSON array with one value per parameter. expected_json is the JSON return value. Give 2 or 3 examples.
case_args_json holds 10 to 14 more inputs, inputs only. Include the smallest and empty inputs the statement allows, duplicates, negatives, extremes, and a few of 30 to 200 elements. Every input must obey the constraints in the statement and stay small enough for the brute force to finish in one second. Strings use printable ASCII only.
The answer must be unique. Use compare "unordered" only when the statement says the result may be in any order.
solution_python is an efficient solution. brute_python solves the same task by a different, simpler method. Both define function_name with exactly those parameters, use only the standard library, never mutate shared state and never print. Both will be executed and must agree on every input.
State constraints and the expected time complexity in the statement. Do not repeat the examples in the statement.`,
  project: `kind: project. This is a 45 to 60 minute AI-native coding round. The candidate works in an existing codebase with an AI assistant beside the editor, runs main.py and the tests, and talks it through with the interviewer, as in a real multi-file IDE.
files is a small, realistic Python 3 project that the company could own, such as a service, a library, a data pipeline or a command line tool. 6 to 12 files and 250 to 600 lines in all, standard library only. Include README.md describing the project, main.py that runs a short demo and prints its result, a package of modules that call each other, one or two data files (CSV or JSON) that the code reads with paths relative to the project root, and tests/test_*.py with 3 to 8 unittest tests. Paths use only letters, digits, underscores, dots, dashes and slashes, and no path starts with a dot.
The code reads like real team code: sensible names, some docstrings, one or two real bugs that the visible tests or the data expose, and at least one feature that is missing or unfinished. No comment points at a bug or says TODO for the task.
statement sets the scene in two sentences, then gives three parts that build on each other, each starting with **Part 1**, **Part 2** and **Part 3**. Part 1: find and fix why something is wrong, without saying where. Part 2: add a feature inside the existing structure. Part 3: a harder extension, such as a new requirement, scale, a contract change or messy data, ending with a question on runtime or trade-offs. Mention the commands: Run main runs main.py and Run tests runs tests/.
hidden_tests is the full text of one unittest file the candidate never sees, run from the project root with the project importable as in tests/. It holds 6 to 12 tests covering all three parts and their edge cases.
solution_files holds the complete new text of every file the reference solution changes or adds, never a file under tests/. With those files every test in tests/ and hidden_tests passes, main.py exits cleanly, and on the starting files at least two tests fail.
The rubric covers, in order: reading and explaining the existing code, a correct and maintainable change, verification with tests and edge cases, use of the AI assistant with its output checked rather than pasted blindly, and the runtime or trade-off answer.`,
  numeric: `kind: numeric. The answer is one finite real number in the stated unit (empty string for a pure number). Say in the statement which unit, and how many significant figures are needed. tolerance is the relative error to accept, between 0.0001 and 0.05.
solver_python defines solve() with no parameters and returns the number, computed from the givens in the statement without using your stated answer. Standard library only. It will be executed and must match answer.`,
  written: `kind: written. Ask for a design, derivation or explanation that can be answered in 10 to 20 minutes of writing or drawing. The candidate has a drawing canvas, so ask for a diagram where an interviewer would. No number or code is checked, so the rubric decides.`,
  ui: `kind: ui. The candidate builds one interface or component as a single HTML file with inline <style> and <script>, no libraries, no network, no storage, no alert. Say in the statement exactly which labels, roles, ids or data-testid values the checks rely on, plus the states, keyboard behavior and accessibility you expect.
starter_html is a small valid starting file. reference_html is a complete solution. checks holds 5 to 10 tests. Each js is the body of an async function that runs inside the page with $(selector), $$(selector), assert(condition, message), await click(selectorOrNode), await type(selectorOrNode, text), await press(selectorOrNode, key) which focuses the node and acts like a real Enter, Space or Escape key, await wait(ms). Every check runs on its own fresh load of the page, so start from the initial state and never create frames or reload. Test behavior a user can see, never implementation details or exact styles. Every check must pass on reference_html and fail on starter_html.`,
  sql: `kind: sql. The candidate writes one SQLite SELECT statement. setup_sql holds the CREATE TABLE statements. datasets holds 5 to 8 strings of INSERT statements for those tables, starting with a small readable one, then empty tables (an empty string), ties, NULLs, duplicates and larger ones up to 60 rows. Describe every table and column, the exact output columns in order, and the order of rows in the statement. ordered is true only when the statement fixes the row order completely. reference_sql and second_sql are two queries written in different ways, each a single SELECT or WITH statement that must return the same rows on every dataset. Printable ASCII only.`,
};
const figure = `figure_svg: an inline SVG drawing when one genuinely helps, such as a circuit, free-body diagram or apparatus, otherwise an empty string. Include xmlns, a viewBox about 400 wide, black strokes on white, text of at least 14px, no scripts, no external references.`;
const problemPrompt = (kind, intake, brief, problem) => `Write one original interview problem.
${rules[kind]}
${kind === 'numeric' || kind === 'written' ? figure : ''}
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
    if (!plainText(value)) throw new Rejected(`the result ${show(value)} uses characters outside printable ASCII`);
    if (!same(value, brute.results[i].actual, d.compare)) throw new Rejected(`on ${show(c.args)} solution_python returned ${show(value)} and brute_python returned ${show(brute.results[i].actual)}`);
    if ('expected' in c && !same(value, c.expected, d.compare)) throw new Rejected(`the example ${show(c.args)} says ${show(c.expected)} but both solutions returned ${show(value)}`);
  });
  return { signature, compare: d.compare, exampleCount: examples.length, cases: cases.map((c, i) => ({ args: c.args, expected: solution.results[i].actual, ...(c.explanation && { explanation: c.explanation }) })), solutionCode: d.solution_python };
}

const QUERY = { name: 'query', params: [{ name: 'data', type: 'string' }], returns: 'string[][]' };
async function verifySql(d) {
  const cases = [...new Set(d.datasets)].slice(0, 12).map((x) => ({ args: [`${d.setup_sql.trim()}\n${x.trim()}`.trim()] }));
  if (cases.length < 4) throw new Rejected('fewer than 4 different datasets were given');
  for (const { args } of cases) if (!plainText(args) || args[0].length > 20000) throw new Rejected('datasets must be printable ASCII and under 20,000 characters');
  const compare = d.ordered ? 'exact' : 'unordered';
  const [a, b] = await Promise.all([d.reference_sql, d.second_sql].map((code) => trial({ language: 'sql', code, signature: QUERY, cases })));
  for (const [name, r] of [['reference_sql', a], ['second_sql', b]]) {
    const i = r.results.findIndex((x) => x.status !== 'pass');
    if (i >= 0) throw new Rejected(`${name} failed on dataset ${i + 1}: ${r.results[i].error}`);
  }
  cases.forEach((_, i) => {
    if (!same(a.results[i].actual, b.results[i].actual, compare)) throw new Rejected(`on dataset ${i + 1} reference_sql returned ${show(a.results[i].actual)} and second_sql returned ${show(b.results[i].actual)}`);
  });
  if (!a.results[0].actual.length) throw new Rejected('the first dataset must give at least one row');
  return { signature: QUERY, compare, exampleCount: 1, cases: cases.map((c, i) => ({ args: c.args, expected: a.results[i].actual })), solutionCode: d.reference_sql };
}

export const PROJECT_LIMIT = 80000;
const mapOf = (list, what) => {
  const map = {};
  for (const { path, content } of list) {
    if (path in map) throw new Rejected(`${what} lists ${path} twice`);
    map[path] = content;
  }
  try {
    return checkFiles(map, PROJECT_LIMIT);
  } catch (e) {
    throw new Rejected(`${what}: ${e.message}`);
  }
};
const failing = (r) => r.tests.filter((t) => t.status !== 'pass').map((t) => t.id);
async function verifyProject(d) {
  const files = mapOf(d.files, 'files');
  const changes = mapOf(d.solution_files, 'solution_files');
  const paths = Object.keys(files);
  if (!files['main.py']) throw new Rejected('files has no main.py');
  if (!paths.some((p) => /^tests\/test[^/]*\.py$/.test(p))) throw new Rejected('files has no tests/test_*.py');
  if (paths.some((p) => p.startsWith('hidden/'))) throw new Rejected('files must not use the hidden/ folder');
  if (Object.keys(changes).some((p) => p.startsWith('tests/'))) throw new Rejected('solution_files must not change tests/');
  const hidden = { 'hidden/test_hidden.py': d.hidden_tests };
  const solved = { ...files, ...changes };
  const all = ['tests', 'hidden'];
  const [before, after, main] = await Promise.all([runProject({ files: { ...files, ...hidden }, folders: all }), runProject({ files: { ...solved, ...hidden }, folders: all }), runProject({ files: solved })]);
  if (after.blocked) throw new ProviderError('missing', after.stderr);
  const tail = (r) => `${r.note} ${r.stderr.slice(-600)}`.trim();
  if (after.failed || !after.tests.length || failing(after).length) throw new Rejected(`with solution_files these tests do not pass: ${failing(after).join(', ') || 'none ran'}. ${tail(after)}`);
  if (after.tests.length < 8) throw new Rejected(`only ${after.tests.length} tests ran, at least 8 are needed across tests/ and hidden_tests`);
  if (failing(before).length < 2) throw new Rejected('on the starting files fewer than two tests fail, so there is nothing to fix');
  if (main.failed) throw new Rejected(`main.py fails with solution_files: ${tail(main)}`);
  const listing = (map) => Object.entries(map).map(([p, t]) => `### ${p}\n\`\`\`\n${t}\n\`\`\``).join('\n\n');
  return { files, hiddenTests: d.hidden_tests, solutionFiles: changes, solutionCode: listing(changes) };
}

const UI_LIMIT = 60000;
function verifyUi(d) {
  if (d.checks.length < 3) throw new Rejected('fewer than 3 checks were given');
  for (const c of d.checks) {
    try {
      new Function(`return async () => {\n${c.js}\n}`);
    } catch (e) {
      throw new Rejected(`the check "${c.name}" does not parse: ${e.message}`);
    }
  }
  if (!d.reference_html.trim() || d.reference_html.length > UI_LIMIT || d.starter_html.length > UI_LIMIT) throw new Rejected('reference_html must be a full page under 60,000 characters');
  return { starter: d.starter_html, solutionCode: d.reference_html, checks: d.checks.slice(0, 12) };
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
  if (kind === 'sql') return { ...base, ...(await verifySql(d)) };
  if (kind === 'ui') return { ...base, ...verifyUi(d) };
  if (kind === 'project') return { ...base, ...(await verifyProject(d)) };
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

async function plan(intake, existing, choice, signal) {
  for (let attempt = 1; ; attempt++) {
    const { problems } = await ask({ ...choice, prompt: planPrompt(intake, existing), schema: planSchema(intake.subjects), signal });
    const briefs = problems.slice(0, intake.count);
    const missing = !covers(intake) ? [] : intake.subjects.filter((s) => !briefs.some((b) => b.subject === s));
    if (briefs.length === intake.count && !missing.length) {
      return briefs.map((b) => ({ ...b, quote: findQuote(intake.posting, b.quote) ?? findQuote(intake.rounds, b.quote) ?? '' }));
    }
    if (attempt === 2) throw new ProviderError('badjson', missing.length ? `The plan left out ${missing.join(', ')}. Try again or pick another model.` : 'The plan had the wrong number of problems. Try again or pick another model.');
  }
}

const blank = (b) => ({ id: randomUUID(), ...b, status: 'queued', step: null, error: null, body: null, progress: 'open', draft: {}, feedback: null });

const FULL = 100;
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
    const choice = await chosen();
    if (brief.request && !brief.kind) Object.assign(brief, await planOne(set.intake, brief, choice, job.signal, put));
    const { title, subject, kind, difficulty, topic, request, guidance, source } = brief;
    const body = await writeProblem({ intake: set.intake, brief: { title, subject, kind, difficulty, topic, request, guidance, source }, choice, signal: job.signal, onStep: (step) => put({ status: 'writing', step }) });
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
    if (--job.count === 0 && jobs.get(setId) === job) jobs.delete(setId);
  }
}

const runQueued = (setId, pids, job) => Promise.all(pids.map((pid) => turn(() => generate(setId, pid, job))));

/** `more` adds to a planned set. Its failure is kept apart, so the problems already there stay usable. */
async function planAndRun(setId, more) {
  await tracked(setId, async (job) => {
    try {
      const { intake, problems } = await readSet(setId);
      const choice = await chosen();
      const wanted = more ? { ...intake, count: more.count, subjects: more.subject ? [more.subject] : intake.subjects } : intake;
      const briefs = await turn(() => plan(wanted, problems, choice, job.signal));
      const pids = await updateSet(setId, (s) => {
        s.status = 'ready';
        delete s.adding;
        const made = briefs.map((b) => blank(b));
        s.problems.push(...made);
        return made.map((p) => p.id);
      });
      await runQueued(setId, pids, job);
    } catch (e) {
      if (job.signal.aborted) return;
      await updateSet(setId, (s) => void Object.assign(s, more ? { adding: { ...more, error: e.message } } : { status: 'failed', error: e.message }));
    }
  });
}

export async function createSet(body) {
  const set = await createSetFile(checkIntake(body));
  planAndRun(set.id);
  return set;
}

/** Plans more problems for a set from its posting, different from the ones it has. */
export async function addMore(setId, body) {
  if (!Number.isInteger(body?.count) || body.count < 1 || body.count > 10) throw new Invalid('Choose between 1 and 10 problems');
  const more = { count: body.count, subject: body.subject ? text(body.subject, 'Subject', 40, true) : '' };
  await updateSet(setId, (s) => {
    if (s.status !== 'ready') throw new Invalid('Wait until this set is planned');
    if (s.intake.personal) throw new Invalid('This set has no posting. Make a problem from a link or an idea.');
    if (s.adding && !s.adding.error) throw new Invalid('Wait until the problems you already asked for are planned');
    if (s.problems.length + more.count > FULL) throw new Invalid(`A set holds up to ${FULL} problems`);
    s.adding = more;
  });
  planAndRun(setId, more);
}

export const checkRequest = (b) => ({ request: text(b?.request, 'Link or idea', 6000, true), subject: b.subject ? text(b.subject, 'Subject', 40, true) : '' });

/** Adds one problem made from a link or an idea. Only `links` are opened, never links found elsewhere. */
export async function addProblem(setId, { request, subject, links, guidance = '' }) {
  const p = blank({ title: 'New problem', subject, kind: '', difficulty: '', topic: '', quote: '', request, guidance, links });
  await updateSet(setId, (s) => {
    if (s.status !== 'ready') throw new Invalid('Wait until this set is planned');
    if (s.problems.length >= FULL) throw new Invalid('This set is full. Start another one.');
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

export function stopSet(setId) {
  jobs.get(setId)?.controller.abort();
  jobs.delete(setId);
}

/** Work cut off by a closed server becomes a retryable failure. Call only once this process owns the port. */
export async function recoverInterrupted() {
  const message = 'Interview Buddy was closed before this finished';
  for (const { id } of await listSets()) {
    await updateSet(id, (s) => {
      if (s.status === 'planning') Object.assign(s, { status: 'failed', error: message });
      if (s.adding) s.adding.error ??= message;
      for (const p of s.problems) if (p.status === 'queued' || p.status === 'writing') Object.assign(p, { status: 'failed', step: null, error: message });
      for (const p of s.problems) {
        if (p.chatBusy) Object.assign(p, { chatBusy: false, chatError: message });
        if (p.assistantBusy) Object.assign(p, { assistantBusy: false, assistantError: message });
        if (p.visual?.status === 'working') Object.assign(p.visual, { status: p.visual.html ? 'ready' : 'failed', step: null, error: message });
      }
    });
  }
}

export async function grade({ problem, answer, outcome, drawing, signal }) {
  const choice = await chosen();
  const { statement, rubric, solutionText, solutionCode, answer: correct, unit } = problem.body;
  const prompt = `Grade this interview answer as a fair, specific interviewer. Give one entry in points for each of the ${rubric.length} rubric points, in order. mark is met, partial or missed. note is one or two sentences addressed to the candidate that point at what they wrote, and is empty when the point is fully met. summary is two sentences with the single most useful next step. Grade only what is written. When there is an interview transcript, let summary also say how well they communicated, such as clarifying, explaining the approach and testing. When there is an AI assistant transcript, judge what they asked it and whether they checked its answers before using them. Use $...$ for math.
${data({ statement, rubric, reference: solutionCode ?? solutionText, correct_answer: correct === undefined ? undefined : `${correct} ${unit}`, outcome, candidate_answer: answer, candidate_drawing: drawing?.outline, interview_transcript: problem.chat?.slice(-30).map(({ role, text }) => ({ role: role === 'user' ? 'candidate' : 'interviewer', text })), ai_assistant_transcript: problem.assistant?.slice(-30).map(({ role, text }) => ({ role: role === 'user' ? 'candidate' : 'assistant', text })), clock: problem.session ?? undefined })}${drawing ? '\nThe attached image is the drawing that is part of their answer. Judge what it shows.' : ''}`;
  const g = await ask({ ...choice, prompt, schema: gradeSchema, images: drawing ? [drawing.png] : [], signal });
  if (g.points.length !== rubric.length) throw new ProviderError('badjson', 'The grader skipped part of the rubric. Try again.');
  const score = g.points.reduce((s, p) => s + (p.mark === 'met' ? 1 : p.mark === 'partial' ? 0.5 : 0), 0) / rubric.length;
  return { summary: g.summary, score, points: g.points.map((p, i) => ({ point: rubric[i], mark: p.mark, note: p.note })) };
}
