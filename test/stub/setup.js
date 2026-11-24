import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-buddy-test-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const bin = path.join(root, 'bin');
fs.mkdirSync(bin);
for (const n of ['claude', 'codex']) {
  fs.writeFileSync(path.join(bin, n), `#!${process.execPath}\n` + fs.readFileSync(new URL('./cli.mjs', import.meta.url), 'utf8').replace(/^import (\w+) from '([^']+)';$/gm, "const $1 = require('$2');"), { mode: 0o755 });
}
process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.STUB_DIR = root;
process.env.INTERVIEW_BUDDY_HOME = path.join(root, 'home');

export const replies = (list) => fs.writeFileSync(path.join(root, 'replies.json'), JSON.stringify(list));
export const calls = () => {
  const f = path.join(root, 'calls.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};
export const clearCalls = () => fs.rmSync(path.join(root, 'calls.jsonl'), { force: true });
export const emptyPath = bin;

export const intake = { company: 'Alder Point', role: 'Trader', posting: 'You will reason quickly about expected value.\nYou write clean Python every day.', rounds: 'One probability round', subjects: ['Coding'], level: 'Intern', count: 1 };
export const brief = (over = {}) => ({ title: 'Double it', subject: 'Coding', kind: 'code', difficulty: 'Easy', topic: 'doubling', quote: 'write  clean python', ...over });
const common = { statement: 'Double $x$.', hints: ['a', 'b', 'c'], rubric: ['Is right', 'Is fast'], solution_text: 'Multiply.' };
export const code = (over = {}) => ({ ...common, function_name: 'twice', params: [{ name: 'x', type: 'int' }], returns: 'int', compare: 'exact', examples: [{ args_json: '[1]', expected_json: '2', explanation: 'e' }, { args_json: '[2]', expected_json: '4', explanation: '' }], case_args_json: ['[0]', '[-3]', '[10]', '[99]', '[1]'], solution_python: 'def twice(x):\n    return x * 2', brute_python: 'def twice(x):\n    return x + x', ...over });
export const numeric = (over = {}) => ({ ...common, figure_svg: '<svg viewBox="0 0 1 1"></svg>', answer: 0.25, unit: 'V', tolerance: 0.01, solver_python: 'def solve():\n    return 1 / 4', ...over });
export const written = (over = {}) => ({ ...common, figure_svg: 'not svg', ...over });
export const sql = (over = {}) => ({ ...common, setup_sql: 'CREATE TABLE t (name TEXT, v REAL);', datasets: ["INSERT INTO t VALUES ('a', 1), ('a', 2);", '', "INSERT INTO t VALUES ('a', 1), ('b', NULL);", "INSERT INTO t VALUES ('x', 1.5);"], ordered: false, reference_sql: 'SELECT name, SUM(v) FROM t GROUP BY name', second_sql: 'SELECT DISTINCT name, (SELECT SUM(v) FROM t u WHERE u.name = t.name) FROM t', ...over });
export const ui = (over = {}) => ({ ...common, starter_html: '<p>start</p>', reference_html: '<button>Go</button>', checks: [{ name: 'has a button', js: "assert($('button'))" }, { name: 'b', js: 'await wait(1)' }, { name: 'c', js: "await click('button')" }], ...over });
