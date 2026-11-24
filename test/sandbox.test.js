import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { badSignature, fits, same, starter } from '../src/harness.js';
import { killAll } from '../src/providers.js';
import { LANGUAGES, runCode, runProgram, selfTest, sweep } from '../src/sandbox.js';

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
    assert.equal(r.compileError, null);
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
  assert.match((await run('def f():\n    a = []\n    import time\n    for _ in range(40): a.append(b"x" * 50_000_000)\n    time.sleep(3)\n    return 1.0')).results[0].error, /1 GB of memory|MemoryError/);
});

test('sandbox refuses home, writes, network, fork and inherited environment', async () => {
  process.env.SSH_AUTH_SOCK ??= '/tmp/fake';
  assert.deepEqual(await selfTest(), { ok: true, detail: '' });
});

test('sandbox failure never falls back to an unsandboxed run', async () => {
  for (const sandbox of ['/usr/bin/false', '/nonexistent']) {
    const r = await runCode({ language: 'python', code: good.python, signature: add, cases, sandbox });
    assert.ok(r.unavailable && r.compileError);
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

test('trace records real values at each line, survives errors and is capped', async () => {
  const signature = { name: 'f', params: [{ name: 'xs', type: 'int[]' }], returns: 'int' };
  const run = (code, args = [[1, 2]], language = 'python') => runCode({ language, code, signature, cases: [{ args }], trace: true, timeout: 5000 });
  const r = await run('import collections\ndef f(xs):\n    seen = set()\n    q = collections.deque()\n    d = {}\n    for x in xs:\n        seen.add(x); q.append(x); d[x] = [x]\n        xs[0] += 1\n    return len(seen)\n');
  assert.equal(r.results[0].status, 'pass');
  const last = r.trace.at(-1);
  assert.deepEqual([last.event, last.value, last.function], ['return', 2, 'f']);
  assert.deepEqual([last.vars.seen, last.vars.q, last.vars.d], [{ set: [1, 2] }, { deque: [1, 2] }, { 1: [1], 2: [2] }]);
  assert.ok(r.trace.some((s) => s.vars.xs[0] === 1) && last.vars.xs[0] === 3);
  const bad = await run('def f(xs):\n    return xs[9]\n');
  assert.match(bad.results[0].error, /IndexError/);
  assert.ok(bad.trace.some((s) => s.event === 'exception'));
  const long = await run('def f(xs):\n    t = 0\n    for i in range(5000): t += i\n    return t\n');
  assert.ok(long.trace.length === 400 && long.traceCut && !r.traceCut);
  assert.equal((await run('def f(xs):\n    while True: pass\n')).results[0].status, 'timeout');
  assert.equal((await run('const f = (xs) => xs.length', [[1]], 'javascript')).trace, undefined);
  assert.equal((await runCode({ language: 'python', code: 'def f(xs):\n    return 1\n', signature, cases: [{ args: [[]] }] })).trace, undefined);
});

test('folders without permissions are cleaned up', async () => {
  const r = await runCode({ language: 'python', code: 'import os\ndef f():\n    os.mkdir("d"); open("d/x", "w").close(); os.chmod("d", 0)\n    return os.getcwd()', signature: { name: 'f', params: [], returns: 'string' }, cases: [{ args: [] }] });
  assert.equal(r.results[0].status, 'pass');
  assert.equal(fs.existsSync(r.results[0].actual), false);
  const old = path.join(os.tmpdir(), 'interview-buddy-run-testold');
  fs.mkdirSync(path.join(old, 'd'), { recursive: true });
  fs.chmodSync(path.join(old, 'd'), 0);
  fs.utimesSync(old, 1, 1);
  await sweep();
  assert.equal(fs.existsSync(old), false);
});

test('stopping the app stops code that is asleep', async () => {
  const running = runCode({ language: 'python', code: 'import time\ndef f():\n    time.sleep(60)\n    return 1', signature: { name: 'f', params: [], returns: 'int' }, cases: [{ args: [] }], timeout: 30000 });
  await new Promise((r) => setTimeout(r, 700));
  const started = Date.now();
  killAll();
  assert.match((await running).results[0].error, /Crashed \(SIGKILL\)/);
  assert.ok(Date.now() - started < 3000);
});

test('leaving early is an error on that test, not a compile error', async () => {
  const signature = { name: 'f', params: [], returns: 'int' };
  for (const [language, code] of [['python', 'import os\ndef f():\n    os._exit(3)'], ['javascript', 'function f() { process.exit(3) }'], ['cpp', 'long long f() { exit(3); }']]) {
    const r = await runCode({ language, code, signature, cases: [{ args: [] }, { args: [] }] });
    assert.equal(r.compileError, null, language);
    assert.deepEqual(r.results.map((x) => x.status), ['error', 'skipped']);
    assert.match(r.results[0].error, /code 3/);
  }
});

test('pad files with their own main, prints and failing asserts still test', async () => {
  const signature = { name: 'twice', params: [{ name: 'x', type: 'int' }], returns: 'int' };
  const pads = {
    python: 'def twice(x):\n    return 2 * x\n\nprint("loose")\nif __name__ == "__main__":\n    print("main", twice(4))\nassert twice(1) == 3\n',
    javascript: "const assert = require('node:assert');\nconst twice = (x) => 2 * x;\nconsole.log('loose');\nif (require.main === module) console.log('main', twice(4));\nassert.equal(twice(1), 3);\n",
    cpp: '#include <cassert>\n#include <iostream>\nusing namespace std;\nlong long twice(long long x) { return 2 * x; }\nint main() { cout << "main " << twice(4) << endl; assert(twice(1) == 3); }\n',
  };
  for (const [language, code] of Object.entries(pads)) {
    const t = await runCode({ language, code, signature, cases: [{ args: [3], expected: 6 }, { args: [0], expected: 0 }] });
    assert.deepEqual(t.results.map((r) => r.status), ['pass', 'pass'], `${language} ${t.compileError}`);
    assert.ok(!t.stdout.includes('main'));
    const p = await runProgram({ language, code });
    assert.ok(p.stdout.includes('main 8') && p.failed && /[Aa]ssert/.test(p.stderr), `${language} ${JSON.stringify(p)}`);
  }
  for (const [language, code] of [['python', 'def twice(x):\n    return 2 * x\nwhile True: pass'], ['javascript', 'const twice = (x) => 2 * x; process.exit(2)']]) {
    const t = await runCode({ language, code, signature, cases: [{ args: [1], expected: 2 }], timeout: 1500 });
    assert.notEqual(t.results[0].status, 'pass');
  }
});

test('programs report exit, crash, timeout, compile errors and a sandbox that will not start', async () => {
  assert.deepEqual(await runProgram({ language: 'python', code: 'print(1)' }).then((r) => [r.stdout, r.failed, /^Finished in \d+ ms$/.test(r.note)]), ['1\n', false, true]);
  assert.equal((await runProgram({ language: 'python', code: 'import sys; sys.exit(3)' })).note, 'Exited with code 3');
  assert.match((await runProgram({ language: 'cpp', code: 'int main() { *(volatile int*)0 = 1; }' })).note, /Crashed/);
  assert.match((await runProgram({ language: 'javascript', code: 'while (true);', timeout: 800 })).note, /longer/);
  const c = await runProgram({ language: 'cpp', code: 'int main() {\n  return nope;\n}' });
  assert.ok(c.note === 'Did not compile' && /main\.cpp:2/.test(c.stderr) && !c.stderr.includes('/var/folders'), c.stderr);
  assert.equal((await runProgram({ language: 'python', code: 'print(1)', sandbox: '/nonexistent' })).note, 'Not run');
  assert.match((await runProgram({ language: 'python', code: 'open("/private/tmp/ib-x", "w")' })).stderr, /PermissionError/);
  assert.match((await runProgram({ language: 'sql', code: 'SELEC', data: '' })).stderr, /syntax error/);
});

test('starting files run as they are in every language', async () => {
  const shapes = [['int', 1], ['float', 1.5], ['string', 'a "q"'], ['bool', true], ['int[]', [1, 2]], ['string[][]', [['a'], []]], ['bool[]', [true, false]]];
  for (const [type, value] of shapes) {
    const signature = { name: 'f', params: [{ name: 'a', type }, { name: 'b', type: 'int[][]' }], returns: type };
    for (const language of LANGUAGES) {
      const code = starter(language, signature, [value, [[1], [2, 3]]]);
      const p = await runProgram({ language, code });
      assert.ok(!p.failed, `${language} ${type} ${p.stderr}\n${code}`);
    }
  }
  assert.ok(!starter('python', { name: 'f', params: [{ name: 'a', type: 'string' }], returns: 'int' }, ['x'.repeat(400)]).includes('__main__'));
});
