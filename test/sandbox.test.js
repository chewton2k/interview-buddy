import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badSignature, fits, same, starter } from '../src/harness.js';
import { runCode, selfTest, LANGUAGES } from '../src/sandbox.js';

const add = { name: 'addAll', params: [{ name: 'xs', type: 'int[]' }, { name: 'label', type: 'string' }], returns: 'int' };
const cases = [
  { args: [[1, 2, 3], 'a"\\?\n é'], expected: 6 },
  { args: [[], ''], expected: 0 },
  { args: [[-5, 9007199254740991 - 5], 'x'], expected: 9007199254740981 },
];
const good = {
  python: 'def addAll(xs, label):\n    print("hi")\n    return sum(xs)\n',
  javascript: 'function addAll(xs, label) { console.log("hi"); return xs.reduce((a, b) => a + b, 0); }',
  cpp: '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\nlong long addAll(vector<long long>& xs, string& label) { cout << "hi\\n"; long long t = 0; for (auto x : xs) t += x; return t; }',
};
const wrong = { python: 'def addAll(xs, label):\n    return 6\n', javascript: 'const addAll = () => 6', cpp: good.cpp.replace('return t', 'return 6') };
const throws = {
  python: 'def addAll(xs, label):\n    raise ValueError("boom")\n',
  javascript: 'function addAll() { throw new Error("boom") }',
  cpp: '#include <stdexcept>\n' + good.cpp.replace('return t', 'throw runtime_error("boom")'),
};
const broken = { python: 'def addAll(:\n', javascript: 'function addAll( {', cpp: 'int addAll( {' };
const missing = { python: 'x = 1', javascript: 'const x = 1', cpp: '#include <vector>\nint x;' };
const loops = { python: 'def addAll(xs, label):\n    while xs: pass\n    return 0\n', javascript: 'function addAll(xs) { while (xs.length); return 0 }', cpp: good.cpp.replace('for (auto', 'volatile bool go = xs.size() > 0; while (go) {} for (auto') };

for (const language of LANGUAGES) {
  const go = (code, extra) => runCode({ language, code: code[language], signature: add, cases, ...extra });
  test(`${language} passes and captures print`, async () => {
    const r = await go(good);
    assert.equal(r.compileError, null);
    assert.deepEqual(r.results.map((x) => x.status), ['pass', 'pass', 'pass']);
    assert.match(r.stdout, /hi/);
  });
  test(`${language} reports a wrong answer with the actual value`, async () => {
    const r = await go(wrong);
    assert.deepEqual(r.results.map((x) => x.status), ['pass', 'fail', 'fail']);
    assert.equal(r.results[1].actual, 6);
  });
  test(`${language} reports exceptions per test`, async () => {
    const r = await go(throws);
    assert.equal(r.results.length, 3);
    for (const x of r.results) assert.match(x.error, /boom/);
  });
  test(`${language} reports syntax errors and a missing function`, async () => {
    assert.ok((await go(broken)).compileError);
    assert.ok((await go(missing)).compileError);
  });
  test(`${language} times out on the looping test only`, async () => {
    const r = await runCode({ language, code: loops[language], signature: add, cases: [cases[1], cases[0], cases[2]], timeout: 1500 });
    assert.deepEqual(r.results.map((x) => x.status), ['pass', 'timeout', 'skipped']);
  });
  test(`${language} starter code compiles`, async () => {
    const r = await runCode({ language, code: starter(language, add), signature: add, cases: [cases[0]], timeout: 5000 });
    assert.ok(!/SyntaxError|undeclared|unknown type/.test(r.compileError ?? ''), r.compileError);
  });
}

test('nested types survive all languages', async () => {
  const signature = { name: 'echo', params: [{ name: 'a', type: 'float[][]' }, { name: 'b', type: 'string[]' }, { name: 'c', type: 'bool[]' }], returns: 'string[]' };
  const code = {
    python: 'def echo(a, b, c):\n    return b\n',
    javascript: 'function echo(a, b, c) { return b }',
    cpp: '#include <string>\n#include <vector>\nstd::vector<std::string> echo(std::vector<std::vector<double>> a, std::vector<std::string> b, std::vector<bool> c) { return b; }',
  };
  const b = ['"q"', 'back\\slash', 'tab\t', 'é 🙂', '??/', '\u0001'];
  for (const language of LANGUAGES) {
    const r = await runCode({ language, code: code[language], signature, cases: [{ args: [[[1.5, -2], []], b, [true, false]], expected: b }] });
    assert.equal(r.results[0].status, 'pass', `${language} ${JSON.stringify(r)}`);
  }
  const bools = await runCode({ language: 'cpp', code: 'std::vector<bool> flip(std::vector<bool> v) { v.flip(); return v; }', signature: { name: 'flip', params: [{ name: 'v', type: 'bool[]' }], returns: 'bool[]' }, cases: [{ args: [[true, false]], expected: [false, true] }] });
  assert.equal(bools.results[0].status, 'pass', JSON.stringify(bools));
});

test('C++ solution without its own includes still links, and a crash is reported', async () => {
  const r = await runCode({ language: 'cpp', code: 'int* p = nullptr;\nlong long f(long long x) { if (x) *(volatile int*)p = 1; return 7; }', signature: { name: 'f', params: [{ name: 'x', type: 'int' }], returns: 'int' }, cases: [{ args: [0], expected: 7 }, { args: [1], expected: 7 }] });
  assert.equal(r.results[0].status, 'pass', JSON.stringify(r));
  assert.match(r.results[1].error, /Crashed/);
});

test('wrong types, NaN and output floods are refused', async () => {
  const signature = { name: 'f', params: [], returns: 'float' };
  const run = (code, language = 'python') => runCode({ language, code, signature, cases: [{ args: [] }], timeout: 5000 });
  assert.equal((await run('def f():\n    return "x"')).results[0].status, 'fail');
  assert.equal((await run('def f():\n    return float("nan")')).results[0].status, 'error');
  assert.equal((await run('function f() { return 1 / 0 }', 'javascript')).results[0].status, 'error');
  assert.equal((await run('function f() { }', 'javascript')).results[0].status, 'error');
  assert.match((await run('def f():\n    while True: print("x" * 10000)')).results[0].error, /1 MB/);
  assert.match((await run('def f():\n    a = []\n    while True: a.append(bytes(50_000_000).replace(b"\\0", b"x"))')).results[0].error, /memory|longer|MemoryError/i);
});

test('sandbox refuses home, writes, network, fork and inherited environment', async () => {
  process.env.SSH_AUTH_SOCK ??= '/tmp/fake';
  assert.deepEqual(await selfTest(), { ok: true, detail: '' });
});

test('sandbox failure never falls back to an unsandboxed run', async () => {
  for (const sandbox of ['/usr/bin/false', '/nonexistent']) {
    const r = await runCode({ language: 'python', code: good.python, signature: add, cases, sandbox });
    assert.ok(r.compileError);
    assert.ok(r.results.every((x) => x.status === 'error'));
  }
});

test('mismatched cases and unsafe signatures never reach a compiler', async () => {
  const r = await runCode({ language: 'cpp', code: good.cpp, signature: add, cases: [{ args: [['1'], 'x'] }] });
  assert.match(r.compileError, /does not match/);
  assert.match((await runCode({ language: 'javascript', code: '', signature: { ...add, name: 'a;b' }, cases: [] })).compileError, /identifier/);
  assert.match(badSignature({ ...add, params: [{ name: 'class', type: 'int' }] }), /not usable/);
  assert.match(badSignature({ ...add, returns: 'map' }), /not supported/);
  assert.match(badSignature({ name: 'f', params: [{ name: 'f', type: 'int' }], returns: 'int' }), /differ/);
  assert.match(badSignature({ name: 'f', returns: 'int' }), /list/);
});

test('value checks and comparison', () => {
  assert.ok(fits([[1]], 'int[][]') && !fits([1.5], 'int[]') && !fits(2 ** 53, 'int') && !fits(NaN, 'float') && fits('', 'string') && fits(false, 'bool'));
  assert.ok(same([1, [2.0000000001]], [1, [2]]));
  assert.ok(!same([1, 2], [2, 1]) && same([1, 2], [2, 1], 'unordered') && !same([1, 1], [1, 2], 'unordered') && !same([1], [1, 1]));
  assert.ok(same([[1, 2], [3]], [[3], [1, 2]], 'unordered') && !same([[2, 1]], [[1, 2]], 'unordered'));
  assert.ok(!same(1, '1') && same('a', 'a') && same(0, 1e-12) && !same(1000000, 1000001) && !same([1], 1));
});
