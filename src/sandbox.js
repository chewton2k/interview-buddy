import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { track } from './providers.js';
import { Invalid } from './store.js';
import { badSignature, build, fits, program, same } from './harness.js';

const exec = promisify(execFile);
const PREFIX = 'interview-buddy-run-';
const OUT_LIMIT = 1 << 20;
const RSS_LIMIT_KB = 1 << 20;
export const LANGUAGES = ['python', 'javascript', 'cpp'];

// shortcut: macOS sandbox-exec only, add a bwrap profile when Linux users need it.
const PROFILE = (tools, fork) => `(version 1)
(allow default)
(deny network*)
(deny mach-lookup)
(deny appleevent-send)
(deny signal (target others))
${fork ? '' : '(deny process-fork)'}
(deny file-write*)
(allow file-write* (subpath (param "DIR")) (literal "/dev/null"))
(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/private/var/tmp"))
${['DIR', ...tools.map((_, i) => `TOOL${i}`)].map((p) => `(allow file-read* (subpath (param "${p}")))\n(allow file-read-metadata (path-ancestors (param "${p}")))`).join('\n')}`;

let toolsPromise;
// Resolves interpreters once; version managers keep them under the home folder, which the profile otherwise hides.
export function tools() {
  return (toolsPromise ??= (async () => {
    const python = await exec('python3', ['-I', '-c', 'import sys,platform,os;print(os.path.realpath(sys.executable));print(sys.base_prefix);print(platform.python_version())'], { cwd: os.tmpdir() })
      .then((r) => r.stdout.trim().split('\n'))
      .catch(() => null);
    const clang = await exec('clang++', ['--version'], { cwd: os.tmpdir() })
      .then((r) => r.stdout.match(/version (\S+)/)?.[1])
      .catch(() => null);
    const node = await fs.realpath(process.execPath);
    return {
      python: python && { bin: python[0], prefix: python[1], version: python[2] },
      javascript: { bin: node, prefix: path.dirname(path.dirname(node)), version: process.versions.node },
      cpp: clang && { bin: '/usr/bin/clang++', version: clang },
    };
  })());
}

function launch(dir, command, { fork = false, timeout, reads, sandbox }) {
  const params = ['-D', `DIR=${dir}`, ...reads.flatMap((r, i) => ['-D', `TOOL${i}=${r}`])];
  const cpuSeconds = Math.ceil(timeout / 1000) + 1;
  const child = spawn(sandbox, [...params, '-p', PROFILE(reads, fork), '/bin/sh', '-c', `ulimit -f 131072; ulimit -t ${cpuSeconds}; exec "$@"`, 'sh', ...command], {
    cwd: dir,
    env: { PATH: '/usr/bin:/bin', HOME: dir, TMPDIR: dir, LANG: 'en_US.UTF-8', PYTHONIOENCODING: 'utf-8', NODE_V8_COVERAGE: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    detached: true,
  });
  track(child);
  return new Promise((resolve) => {
    const out = ['', '', '', ''];
    let reason = null;
    const kill = (why) => {
      reason ??= why;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    const timer = setTimeout(() => kill('timeout'), timeout);
    const watch = setInterval(async () => {
      const { stdout } = await exec('/bin/ps', ['-o', 'rss=', '-g', String(child.pid)]).catch(() => ({ stdout: '' }));
      if (stdout.split('\n').some((kb) => Number(kb) > RSS_LIMIT_KB)) kill('memory');
    }, 250);
    for (const fd of [1, 2, 3]) {
      child.stdio[fd].setEncoding('utf8');
      child.stdio[fd].on('data', (d) => {
        out[fd] += d;
        if (out[fd].length > OUT_LIMIT * (fd === 3 ? 8 : 1)) kill('output');
      });
    }
    const done = (code, signal, spawnError) => {
      clearTimeout(timer);
      clearInterval(watch);
      resolve({ code, signal, reason, spawnError, stdout: out[1].slice(0, OUT_LIMIT), stderr: out[2].slice(0, 20000), channel: out[3] });
    };
    child.on('error', (e) => done(null, null, e.message));
    child.on('close', (code, signal) => done(code, signal));
  });
}

let active = 0;
const waiting = [];
async function slot(fn) {
  if (active >= 2) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const WHY = { timeout: 'Took longer than 10 seconds', memory: 'Used more than 1 GB of memory', output: 'Printed more than 1 MB' };

/** With `trace`, Python runs also return the line by line values of the last case. cases: [{args, expected?}]. A case without `expected` passes when it returns a value of the declared type. */
export function runCode(options) {
  return slot(() => run(options));
}

/** Writes the files, compiles when needed and runs. `blocked` means this computer could not run it at all. */
async function execute(plan, language, { timeout, sandbox }) {
  const blocked = (why) => ({ blocked: why });
  if (process.platform !== 'darwin') return blocked('Code runs on macOS only for now.');
  const tool = (await tools())[language === 'sql' ? 'python' : language];
  if (!tool) return blocked(language !== 'cpp' ? 'python3 was not found. Install Python 3 and restart.' : 'clang++ was not found. Run xcode-select --install and restart.');
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), PREFIX)));
  const refused = (r) => r.spawnError ?? (/^sandbox-exec:/.test(r.stderr) ? r.stderr.trim() : null);
  const tidy = (text) => text.replaceAll(`${dir}/`, '');
  try {
    for (const [f, text] of Object.entries(plan.files)) {
      await fs.mkdir(path.dirname(path.join(dir, f)), { recursive: true });
      await fs.writeFile(path.join(dir, f), text);
    }
    const reads = tool.prefix ? [tool.prefix, path.dirname(tool.bin)] : [];
    if (plan.compile) {
      const c = await launch(dir, [tool.bin, ...plan.compile.slice(1)], { fork: true, timeout: 30000, reads, sandbox });
      if (refused(c)) return blocked(`The sandbox could not start: ${refused(c)}`);
      if (c.code !== 0) return { compileError: (c.reason && `Compiling stopped: ${c.reason}`) ?? (tidy(c.stderr).trim() || 'Compiling failed') };
    }
    const started = performance.now();
    const r = await launch(dir, plan.compile ? [path.join(dir, 'main'), ...plan.run.slice(1)] : [tool.bin, ...plan.run.slice(1)], { timeout, reads, sandbox });
    if (refused(r)) return blocked(`The sandbox could not start: ${refused(r)}`);
    return { r: { ...r, stdout: tidy(r.stdout), stderr: tidy(r.stderr), ms: performance.now() - started } };
  } finally {
    await discard(dir);
  }
}

/** Runs the file as a program and returns what a terminal would show. */
export const runProgram = ({ language, code, data = '', timeout = 10000, sandbox = '/usr/bin/sandbox-exec' }) =>
  slot(async () => {
    const { blocked, compileError, r } = await execute(program(language, code, data), language, { timeout, sandbox });
    if (blocked ?? compileError) return { stdout: '', stderr: blocked ?? compileError, failed: true, note: blocked ? 'Not run' : 'Did not compile' };
    const died = r.signal ?? (r.code > 128 ? `signal ${r.code - 128}` : null);
    const note = WHY[r.reason] ?? (died ? `Crashed (${died})` : r.code ? `Exited with code ${r.code}` : `Finished in ${Math.round(r.ms)} ms`);
    return { stdout: r.stdout, stderr: r.stderr, failed: Boolean(r.reason || died || r.code), note };
  });

const PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*){0,4}$/;
/** Paths are written into the run folder outside the sandbox, so only plain relative ones get through. */
export function checkFiles(files, max) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Invalid('Files must be a map of paths to text');
  const entries = Object.entries(files);
  if (!entries.length || entries.length > 40) throw new Invalid('A project has 1 to 40 files');
  let size = 0;
  for (const [p, text] of entries) {
    if (p.length > 120 || !PATH.test(p)) throw new Invalid(`${p.slice(0, 120)} is not a plain relative path, such as tests/test_cart.py`);
    if (typeof text !== 'string') throw new Invalid(`${p} must be text`);
    size += text.length;
  }
  const dirs = new Set(entries.flatMap(([p]) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  const clash = entries.find(([p]) => dirs.has(p));
  if (clash) throw new Invalid(`${clash[0]} is both a file and a folder`);
  if (size > max) throw new Invalid(`The files are longer than ${max.toLocaleString('en-US')} characters together`);
  return Object.fromEntries(entries);
}

const RUNNER = `import json, os, sys, unittest
class Result(unittest.TextTestResult):
    def mark(self, test, status):
        os.write(3, (json.dumps({"test": test.id(), "status": status}) + "\\n").encode())
    def addSuccess(self, test):
        super().addSuccess(test); self.mark(test, "pass")
    def addFailure(self, test, err):
        super().addFailure(test, err); self.mark(test, "fail")
    def addError(self, test, err):
        super().addError(test, err); self.mark(test, "error")
    def addSubTest(self, test, sub, err):
        super().addSubTest(test, sub, err)
        if err is not None: self.mark(test, "fail")
    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err); self.mark(test, "pass")
    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test); self.mark(test, "fail")
suite = unittest.TestSuite()
for folder in sys.argv[1:]:
    if os.path.isdir(folder):
        suite.addTests(unittest.TestLoader().discover(folder, pattern="test*.py", top_level_dir=folder))
unittest.TextTestRunner(verbosity=2, resultclass=Result).run(suite)
`;
const RANK = { pass: 0, fail: 1, error: 2 };

/** Runs a Python project: main.py, or the unittest files in \`folders\`. Tests come back worst status first per test id. */
export const runProject = ({ files, folders, timeout = 10000, sandbox = '/usr/bin/sandbox-exec' }) =>
  slot(async () => {
    const plan = folders ? { files: { ...files, '.ib_tests.py': RUNNER }, run: ['python3', '-B', '-u', '.ib_tests.py', ...folders] } : { files, run: ['python3', '-B', '-u', 'main.py'] };
    const { blocked, r } = await execute(plan, 'python', { timeout, sandbox });
    if (blocked) return { stdout: '', stderr: blocked, failed: true, note: 'Not run', blocked: true, tests: [] };
    const tests = new Map();
    for (const l of r.channel.split('\n').filter(Boolean)) {
      try {
        const { test, status } = JSON.parse(l);
        if (!tests.has(test) || RANK[status] > RANK[tests.get(test)]) tests.set(test, status);
      } catch {}
    }
    const died = r.signal ?? (r.code > 128 ? `signal ${r.code - 128}` : null);
    const note = WHY[r.reason] ?? (died ? `Crashed (${died})` : folders ? '' : r.code ? `Exited with code ${r.code}` : `Finished in ${Math.round(r.ms)} ms`);
    return { stdout: r.stdout, stderr: r.stderr, failed: Boolean(r.reason || died || (!folders && r.code)), note, tests: [...tests].map(([id, status]) => ({ id, status })) };
  });

async function run({ language, code, signature, cases, compare = 'exact', timeout = 10000, trace = false, sandbox = '/usr/bin/sandbox-exec' }) {
  const fail = (compileError) => ({ results: cases.map(() => ({ status: 'error', error: compileError })), stdout: '', compileError });
  const unavailable = (why) => ({ ...fail(why), unavailable: true });
  const bad = badSignature(signature);
  if (bad) return fail(bad);
  const misfit = cases.findIndex((c) => !Array.isArray(c.args) || c.args.length !== signature.params.length || !c.args.every((a, i) => fits(a, signature.params[i].type)));
  if (misfit >= 0) return fail(`Test ${misfit + 1} does not match the function signature`);
  const { blocked, compileError, r } = await execute(build(language, code, signature, cases.map((c) => c.args), trace), language, { timeout, sandbox });
  if (blocked) return unavailable(blocked);
  if (compileError) return fail(compileError);

  const parsed = [];
  let steps;
  let traceCut = false;
  let started = false;
  for (const line of r.channel.split('\n').filter(Boolean)) {
    try {
      const o = JSON.parse(line);
      if (o.start) started = true;
      else if (o.trace) [steps, traceCut] = [o.trace, o.cut];
      else parsed.push(o);
    } catch {
      break;
    }
  }
  if (!started && !r.reason && !r.signal && r.code <= 128) return unavailable(`The sandbox could not start: ${r.stderr.trim() || `exit code ${r.code}`}`);
  if (parsed[0]?.load) return { ...fail(parsed[0].load), stdout: r.stdout };
  const stopped = WHY[r.reason] ?? (r.signal === 'SIGXCPU' ? WHY.timeout : r.signal || r.code > 128 ? `Crashed (${r.signal ?? `signal ${r.code - 128}`})` : r.stderr.trim() || `Exited with code ${r.code} before this test finished`);
  const results = cases.map((c, i) => {
    const p = parsed[i];
    if (!p) return i === parsed.length ? { status: stopped === WHY.timeout ? 'timeout' : 'error', error: stopped } : { status: 'skipped', error: 'Not run' };
    if ('error' in p) return { status: 'error', error: p.error };
    if (!fits(p.value, signature.returns)) return { status: 'fail', actual: p.value, ms: p.ms, error: `Expected a value of type ${signature.returns}` };
    return { status: 'expected' in c && !same(p.value, c.expected, compare) ? 'fail' : 'pass', actual: p.value, ms: p.ms };
  });
  return { results, stdout: r.stdout, compileError: null, trace: steps, traceCut };
}

// Code under test can leave folders without permissions behind.
async function discard(dir) {
  await fs.rm(dir, { recursive: true, force: true }).catch(async () => {
    await exec('/bin/chmod', ['-R', 'u+rwx', dir]).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch((e) => console.error(e.message));
  });
}

export async function sweep() {
  const names = await fs.readdir(os.tmpdir());
  const old = Date.now() - 10 * 60 * 1000;
  for (const n of names.filter((x) => x.startsWith(PREFIX))) {
    const p = path.join(os.tmpdir(), n);
    const s = await fs.stat(p).catch(() => null);
    if (s && s.mtimeMs < old) await discard(p);
  }
}

const PROBE = `import os, socket, subprocess
def probe():
    leaks = []
    def check(name, fn):
        try:
            fn(); leaks.append(name)
        except PermissionError:
            pass
        except Exception as e:
            leaks.append(name + " " + type(e).__name__)
    check("home", lambda: os.listdir(HOME))
    check("write", lambda: open("/private/tmp/interview-buddy-probe", "w"))
    check("network", lambda: socket.create_connection(("127.0.0.1", 9), 1))
    check("fork", lambda: subprocess.run(["/usr/bin/true"]))
    check("env", lambda: None if any(k in os.environ for k in ("USER", "SSH_AUTH_SOCK")) else (_ for _ in ()).throw(PermissionError()))
    return leaks
`;

/** Empty list means every escape attempt was refused. */
export async function selfTest() {
  const { results, compileError } = await runCode({
    language: 'python',
    code: PROBE.replace('HOME', JSON.stringify(os.homedir())),
    signature: { name: 'probe', params: [], returns: 'string[]' },
    cases: [{ args: [] }],
  });
  if (compileError || results[0].status !== 'pass') return { ok: false, detail: compileError ?? results[0].error };
  return { ok: results[0].actual.length === 0, detail: results[0].actual.join(', ') };
}
