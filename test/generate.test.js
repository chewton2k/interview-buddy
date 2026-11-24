import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { brief, calls, clearCalls, code, intake, numeric, replies, written } from './stub/setup.js';
import { checkNumber, findQuote, parseNumber } from '../src/answers.js';
import { checkIntake, createSet, grade, recoverInterrupted, retryProblem, retrySet, stopSet, SUBJECTS, writeProblem } from '../src/generate.js';
import { createSetFile, deleteSet, readSet, updateProblem, updateSet } from '../src/store.js';

const choice = { provider: 'claude', model: 'sonnet', effort: '' };
const plan = (...problems) => ({ match: 'Plan a practice set', reply: { problems } });
const write = (reply, extra) => ({ match: 'Write one original', reply, ...extra });
async function settled(id) {
  for (let i = 0; i < 400; i++) {
    const s = await readSet(id);
    if (s.status === 'failed' || (s.status === 'ready' && s.problems.every((p) => p.status === 'ready' || p.status === 'failed'))) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('never settled');
}
const tryWrite = async (list, b = brief()) => {
  replies(list);
  clearCalls();
  return writeProblem({ intake, brief: b, choice });
};

test('every intake field reaches the plan prompt inside a data block', async () => {
  const full = { ...intake, company: 'Co & </data> inject', role: 'Role Z', posting: 'Posting text here', rounds: 'Rounds text', subjects: ['Coding', 'Biology'], level: 'Senior', count: 2 };
  replies([plan(brief(), brief({ subject: 'Biology', kind: 'written' })), { match: 'kind: code.', reply: code() }, { match: 'kind: written.', reply: written() }]);
  clearCalls();
  const s = await settled((await createSet(full)).id);
  const { prompt } = calls()[0];
  const block = prompt.slice(prompt.indexOf('<data>'));
  for (const v of ['Role Z', 'Posting text here', 'Rounds text', 'Biology', 'Senior']) assert.ok(block.includes(v), v);
  assert.equal(prompt.split('</data>').length, 2);
  assert.deepEqual(s.problems.map((p) => p.status), ['ready', 'ready']);
});

test('a verified code problem keeps executed answers and drops duplicate inputs', async () => {
  const b = await tryWrite([write(code())]);
  assert.deepEqual(b.cases.map((c) => c.expected), [2, 4, 0, -6, 20, 198]);
  assert.equal(b.exampleCount, 2);
});

const rejected = {
  'wrong reference': { solution_python: 'def twice(x):\n    return x * 2 if x < 50 else 0' },
  'wrong example': { examples: [{ args_json: '[1]', expected_json: '3', explanation: '' }, { args_json: '[2]', expected_json: '4', explanation: '' }] },
  'crashing brute force': { brute_python: 'def twice(x):\n    return 1 // 0' },
  'bad args json': { case_args_json: ['[1'] },
  'wrong arg type': { case_args_json: ['["a"]', '[0]', '[-3]', '[10]', '[99]'] },
  'wrong expected type': { examples: [{ args_json: '[1]', expected_json: '"2"', explanation: '' }, { args_json: '[2]', expected_json: '4', explanation: '' }] },
  'too few cases': { case_args_json: [] },
  'one example': { examples: [{ args_json: '[1]', expected_json: '2', explanation: '' }] },
  'unsafe name': { function_name: 'a(); evil' },
  'empty statement': { statement: ' ' },
  'missing rubric': { rubric: [] },
  'missing fields': { examples: undefined },
  'string outside ASCII': { params: [{ name: 'x', type: 'string' }], case_args_json: ['["h\u00e9"]'] },
  'name that C++ reserves': { function_name: 'compl', solution_python: 'def compl(x):\n    return x * 2', brute_python: 'def compl(x):\n    return x + x' },
  'name that C++ already defines': { function_name: 'abs', solution_python: 'def abs(x):\n    return x * 2', brute_python: 'def abs(x):\n    return x + x' },
  'non-text hint': { hints: [1, 2, 3] },
  'huge input': { params: [{ name: 'x', type: 'string' }], case_args_json: [JSON.stringify(['x'.repeat(20001)])] },
};
for (const [name, over] of Object.entries(rejected)) {
  test(`rejects ${name}, says why and accepts the corrected retry`, async () => {
    const b = await tryWrite([write(code(over), { once: true }), write(code())]);
    assert.equal(b.cases.length, 6);
    const [, second] = calls();
    assert.match(second.prompt, /previous attempt was rejected by the checks: \S/);
  });
}

test('gives up after three rejected drafts', async () => {
  await assert.rejects(tryWrite([write(code({ brute_python: 'def twice(x):\n    return 0' }))]), /after 3 tries.*brute_python returned 0/s);
  assert.equal(calls().length, 3);
});

test('account errors are not retried', async () => {
  await assert.rejects(tryWrite([{ match: 'Write one', exit: 'usage limit' }]), { kind: 'rate' });
  assert.equal(calls().length, 1);
});

test('numeric problems need a solver that agrees', async () => {
  const b = await tryWrite([write(numeric())], brief({ kind: 'numeric' }));
  assert.deepEqual([b.answer, b.unit, b.tolerance], [0.25, 'V', 0.01]);
  assert.match(b.figure, /xmlns/);
  for (const over of [{ answer: 0.5 }, { solver_python: 'def solve():\n    return float("inf")' }, { solver_python: 'nope' }]) {
    await assert.rejects(tryWrite([write(numeric(over))], brief({ kind: 'numeric' })), /after 3 tries/);
  }
  assert.equal((await tryWrite([write(numeric({ tolerance: 9 }))], brief({ kind: 'numeric' }))).tolerance, 0.05);
  assert.equal((await tryWrite([write(written())], brief({ kind: 'written' }))).figure, '');
});

for (const subject of SUBJECTS) {
  test(`${subject} yields one verified problem`, async () => {
    const kind = subject === 'Coding' ? 'code' : 'numeric';
    replies([plan(brief({ subject, kind })), write(kind === 'code' ? code() : numeric())]);
    const s = await settled((await createSet({ ...intake, subjects: [subject] })).id);
    assert.equal(s.problems[0].status, 'ready', s.problems[0].error);
    assert.equal(s.problems[0].quote, 'write clean Python');
  });
}

test('a quote that is not in the posting is dropped', async () => {
  replies([plan(brief({ quote: 'never written anywhere here' })), write(code())]);
  assert.equal((await settled((await createSet(intake)).id)).problems[0].quote, '');
});

test('a plan that misses a subject is asked again, then fails and can be retried', async () => {
  const two = { ...intake, subjects: ['Coding', 'Math'], count: 2 };
  replies([plan(brief(), brief())]);
  clearCalls();
  const { id } = await createSet(two);
  const s = await settled(id);
  assert.match(s.error, /left out Math/);
  assert.equal(calls().length, 2);
  replies([plan(brief(), brief({ subject: 'Math', kind: 'numeric' })), { match: 'kind: code.', reply: code() }, { match: 'kind: numeric.', reply: numeric() }]);
  await retrySet(id);
  assert.deepEqual((await settled(id)).problems.map((p) => p.status), ['ready', 'ready']);
  await assert.rejects(retrySet(id), /not waiting/);
  replies([{ match: 'Plan', reply: { problems: [] } }]);
  assert.match((await settled((await createSet(intake)).id)).error, /left out Coding/);
});

test('a usage limit stops the rest of the set, and one problem can be retried', async () => {
  replies([plan(brief(), brief(), brief(), brief()), { match: 'Write one', exit: 'usage limit reached' }]);
  clearCalls();
  const { id } = await createSet({ ...intake, count: 4 });
  const s = await settled(id);
  assert.ok(s.problems.every((p) => p.status === 'failed' && /usage limit/.test(p.error)));
  assert.ok(calls().length <= 3);
  replies([write(code())]);
  await retryProblem(id, s.problems[0].id);
  assert.equal((await settled(id)).problems[0].status, 'ready');
  await assert.rejects(retryProblem(id, s.problems[0].id), /not waiting/);
});

test('deleting a set stops its running calls', async () => {
  replies([plan(brief()), { match: 'Write one', hang: true }]);
  const { id } = await createSet(intake);
  while ((await readSet(id)).problems[0]?.status !== 'writing') await new Promise((r) => setTimeout(r, 25));
  const alive = () => spawnSync('pgrep', ['-f', `${process.env.STUB_DIR}/bin/claude`]).status === 0;
  assert.ok(alive());
  stopSet(id);
  await deleteSet(id);
  for (let i = 0; alive() && i < 50; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(!alive());
  await assert.rejects(readSet(id));
  await assert.rejects(deleteSet(id));
});

test('interrupted work becomes a retryable failure and concurrent writes are all kept', async () => {
  const set = await createSetFile(checkIntake(intake));
  await recoverInterrupted();
  assert.equal((await readSet(set.id)).status, 'failed');
  await updateSet(set.id, (s) => (s.problems = [{ id: 'a', status: 'writing', n: 0 }, { id: 'b', status: 'ready', n: 0 }]));
  await recoverInterrupted();
  assert.deepEqual((await readSet(set.id)).problems.map((p) => p.status), ['failed', 'ready']);
  await Promise.all([...Array(20)].map(() => updateProblem(set.id, 'b', (p) => void p.n++)));
  assert.equal((await readSet(set.id)).problems[1].n, 20);
  await assert.rejects(updateProblem(set.id, 'zzz', () => {}));
  await assert.rejects(readSet('../../etc/passwd'));
});

test('grading maps marks to the rubric and refuses a short reply', async () => {
  const problem = { body: { statement: 's', rubric: ['one', 'two'], solutionText: 't' } };
  replies([{ match: 'Grade this', reply: { summary: 'sum', points: [{ mark: 'met', note: '' }, { mark: 'partial', note: 'n' }] } }]);
  const g = await grade({ problem, answer: 'a', outcome: '' });
  assert.equal(g.score, 0.75);
  assert.deepEqual(g.points[1], { point: 'two', mark: 'partial', note: 'n' });
  replies([{ match: 'Grade this', reply: { summary: '', points: [] } }]);
  await assert.rejects(grade({ problem, answer: 'a', outcome: '' }), { kind: 'badjson' });
});

test('intake validation', () => {
  assert.equal(checkIntake({ ...intake, company: ' A ' }).company, 'A');
  for (const bad of [{ company: '' }, { role: 5 }, { subjects: [] }, { subjects: 'Coding' }, { subjects: ['x'.repeat(41)] }, { level: 'Boss' }, { count: 0 }, { count: 2.5 }, { count: 11 }, { posting: 'x'.repeat(30001) }, { rounds: 'x'.repeat(6001) }, { subjects: ['a', 'b'], count: 1 }]) assert.throws(() => checkIntake({ ...intake, ...bad }), JSON.stringify(bad).slice(0, 60));
  assert.throws(() => checkIntake(null));
  assert.equal(checkIntake({ ...intake, posting: undefined }).posting, '');
});

test('number parsing and checking', () => {
  const table = [['12', 12], [' -0.5 ', -0.5], ['1.2e-3', 0.0012], ['3/8', 0.375], ['3 / 8', 0.375], ['37.5%', 0.375], ['1,200', 1200], ['−2', -2], ['.5', 0.5], ['5.', 5], ['1/0', null], ['', null], ['abc', null], ['1/2/3', null], ['1e999', null], ['0x10', null], ['1,2', null]];
  for (const [t, v] of table) assert.equal(parseNumber(t), v, t);
  const p = { answer: 63.4, tolerance: 0.01, unit: 'degrees' };
  assert.equal(checkNumber('63', p), true);
  assert.equal(checkNumber('60', p), false);
  assert.equal(checkNumber('x', p), null);
  assert.equal(checkNumber('0', { answer: 1.6e-19, tolerance: 0.01, unit: 'C' }), false);
  assert.equal(checkNumber('1.6e-19', { answer: 1.602e-19, tolerance: 0.01, unit: 'C' }), true);
  assert.equal(checkNumber('0', { answer: 0, tolerance: 0.01, unit: '' }), true);
  assert.equal(checkNumber('25%', { answer: 25, tolerance: 0.01, unit: '%' }), true);
  assert.equal(checkNumber('25%', { answer: 0.25, tolerance: 0.01, unit: '' }), true);
});

test('quotes are matched across case and line breaks and returned as written', () => {
  assert.equal(findQuote('We Want\n  clean code (always)', 'want clean code (always)'), 'Want\n  clean code (always)');
  assert.equal(findQuote('We expect calm reasoning.', '"expect calm reasoning."'), 'expect calm reasoning');
  for (const q of ['one', '', 'a '.repeat(30), 'not there']) assert.equal(findQuote('some text here', q), null);
});

test('a computer that cannot run code is reported once, without more model calls', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    for (const [kind, reply] of [['code', code()], ['numeric', numeric()]]) {
      await assert.rejects(tryWrite([write(reply)], brief({ kind })), (e) => e.kind === 'missing' && /macOS only/.test(e.message));
      assert.equal(calls().length, 1);
    }
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});
