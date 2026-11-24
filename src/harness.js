const SCALARS = ['int', 'float', 'string', 'bool'];
const MAX_INT = Number.MAX_SAFE_INTEGER;

export const isType = (t) => typeof t === 'string' && SCALARS.includes(t.replace(/(\[\]){0,3}$/, ''));
export const isIdent = (s) => typeof s === 'string' && /^[a-z][a-zA-Z0-9_]{0,39}$/.test(s);

export function fits(value, type) {
  if (type.endsWith('[]')) return Array.isArray(value) && value.every((v) => fits(v, type.slice(0, -2)));
  if (type === 'int') return Number.isInteger(value) && Math.abs(value) <= MAX_INT;
  if (type === 'float') return Number.isFinite(value);
  if (type === 'bool') return typeof value === 'boolean';
  return typeof value === 'string';
}

export const close = (a, b, rtol = 1e-6, atol = 1e-9) => Math.abs(a - b) <= Math.max(rtol * Math.max(Math.abs(a), Math.abs(b)), atol);

export function same(a, b, compare = 'exact') {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (compare === 'unordered') {
      const left = [...b];
      return a.every((x) => {
        const i = left.findIndex((y) => same(x, y));
        if (i >= 0) left.splice(i, 1);
        return i >= 0;
      });
    }
    return a.every((x, i) => same(x, b[i]));
  }
  if (typeof a === 'number' && typeof b === 'number') return Number.isInteger(a) && Number.isInteger(b) ? a === b : close(a, b);
  return a === b;
}

const KEYWORDS = new Set(
  ('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield ' +
    'arguments case catch const debugger default delete do enum eval export extends function implements instanceof interface let new null package private protected public static super switch this throw typeof undefined var void ' +
    'auto bool char double explicit extern float friend goto inline int long mutable namespace operator register short signed sizeof std struct template typedef typename union unsigned using virtual volatile main true false ' +
    'alignas alignof and_eq asm bitand bitor char8_t char16_t char32_t compl concept consteval constexpr constinit const_cast co_await co_return co_yield decltype dynamic_cast mutable noexcept not_eq nullptr or_eq reinterpret_cast requires static_assert static_cast thread_local typeid wchar_t xor xor_eq unix linux').split(' '),
);

export function badSignature({ name, params, returns } = {}) {
  if (!isIdent(name)) return `function name "${name}" must be a lowercase-first identifier`;
  if (!Array.isArray(params)) return 'params must be a list';
  const names = [name, ...params.map((p) => p.name)];
  const bad = names.find((n) => !isIdent(n) || KEYWORDS.has(n));
  if (bad !== undefined) return `"${bad}" is not usable as a name in Python, JavaScript and C++`;
  if (new Set(names).size !== names.length) return 'function and parameter names must differ';
  const t = [...params.map((p) => p.type), returns].find((x) => !isType(x));
  if (t !== undefined) return `type "${t}" is not supported`;
  return null;
}

const CPP = { int: 'long long', float: 'double', string: 'string', bool: 'bool' };
const cppType = (t) => (t.endsWith('[]') ? `vector<${cppType(t.slice(0, -2))}>` : CPP[t]);
const PY = { int: 'int', float: 'float', string: 'str', bool: 'bool' };
const pyType = (t) => (t.endsWith('[]') ? `list[${pyType(t.slice(0, -2))}]` : PY[t]);
const JSD = { int: 'number', float: 'number', string: 'string', bool: 'boolean' };
const jsType = (t) => JSD[t.replace(/(\[\])+$/, '')] + (t.match(/\[\]/g) ?? []).join('');

function cppString(s) {
  const bytes = Buffer.from(s, 'utf8');
  const body = [...bytes].map((b) => (b >= 32 && b < 127 && b !== 34 && b !== 92 && b !== 63 ? String.fromCharCode(b) : `\\${b.toString(8).padStart(3, '0')}`)).join('');
  return `string("${body}", ${bytes.length})`;
}
function cppLiteral(v, t) {
  if (t.endsWith('[]')) return `${cppType(t)}{${v.map((x) => cppLiteral(x, t.slice(0, -2))).join(',')}}`;
  if (t === 'string') return cppString(v);
  if (t === 'int') return `${v}LL`;
  if (t === 'float') return `double(${v})`;
  return String(v);
}

const pyLiteral = (v) => (Array.isArray(v) ? `[${v.map(pyLiteral).join(', ')}]` : typeof v === 'boolean' ? (v ? 'True' : 'False') : JSON.stringify(v));
const jsLiteral = (v) => (Array.isArray(v) ? `[${v.map(jsLiteral).join(', ')}]` : JSON.stringify(v));
const cppPlain = (v) => (Array.isArray(v) ? `{${v.map(cppPlain).join(', ')}}` : JSON.stringify(v));
const LONG = 300;

function cppPrint(type) {
  if (type.endsWith('[][]')) return '    for (const auto& row : result) {\n        for (const auto& x : row) cout << x << " ";\n        cout << endl;\n    }\n';
  if (type.endsWith('[]')) return '    for (const auto& x : result) cout << x << " ";\n    cout << endl;\n';
  return '    cout << boolalpha << result << endl;\n';
}

/** Starting file for the pad. It calls the function on the first example, so Run shows something straight away. */
export function starter(language, { name, params, returns }, example) {
  if (language === 'sql') return 'SELECT\n';
  const args = example && JSON.stringify(example).length <= LONG ? example : null;
  if (language === 'python') {
    const main = args ? `\n\nif __name__ == "__main__":\n    print(${name}(${args.map(pyLiteral).join(', ')}))\n` : '';
    return `def ${name}(${params.map((p) => `${p.name}: ${pyType(p.type)}`).join(', ')}) -> ${pyType(returns)}:\n    pass\n${main}`;
  }
  if (language === 'javascript') {
    const doc = [...params.map((p) => ` * @param {${jsType(p.type)}} ${p.name}`), ` * @returns {${jsType(returns)}}`].join('\n');
    const main = args ? `\nif (require.main === module) {\n  console.log(${name}(${args.map(jsLiteral).join(', ')}));\n}\n` : '';
    return `/**\n${doc}\n */\nfunction ${name}(${params.map((p) => p.name).join(', ')}) {\n\n}\n${main}`;
  }
  const list = params.map((p) => `${cppType(p.type)}${p.type.endsWith(']') || p.type === 'string' ? '& ' : ' '}${p.name}`).join(', ');
  const depth = (returns.match(/\[\]/g) ?? []).length;
  const main = args && depth < 3 ? `\nint main() {\n${params.map((p, i) => `    ${cppType(p.type)} ${p.name} = ${cppPlain(args[i])};\n`).join('')}    auto result = ${name}(${params.map((p) => p.name).join(', ')});\n${cppPrint(returns)}}\n` : '';
  return `#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n\n${cppType(returns)} ${name}(${list}) {\n\n    return {};\n}\n${main}`;
}

const PY_MAIN = `import json, os, sys, time
_out = os.fdopen(3, "w")
_spec = json.load(open("spec.json"))
def _emit(o):
    _out.write(json.dumps(o, allow_nan=False) + "\\n"); _out.flush()
_emit({"start": 1})
# A pad file also holds the writer's own calls and asserts. They run, but only a missing function stops the tests.
_ns = {"__name__": "solution"}
_why = None
try:
    exec(compile(open("solution.py").read(), "solution.py", "exec"), _ns)
except BaseException as e:
    _why = type(e).__name__ + ": " + str(e)
_fn = _ns.get(_spec["name"])
if not callable(_fn):
    _emit({"load": _why or "NameError: " + _spec["name"] + " is not defined"}); sys.exit(0)
_steps = []
def _snap(v, depth=0):
    if isinstance(v, bool) or v is None or isinstance(v, int): return v
    if isinstance(v, float): return v if v == v and abs(v) != float("inf") else repr(v)
    if isinstance(v, str): return v[:120]
    if depth < 3 and isinstance(v, (list, tuple)): return [_snap(x, depth + 1) for x in v[:40]]
    if depth < 3 and isinstance(v, dict): return {str(k)[:60]: _snap(x, depth + 1) for k, x in list(v.items())[:40]}
    if depth < 3 and isinstance(v, (set, frozenset)): return {"set": [_snap(x, depth + 1) for x in list(v)[:40]]}
    if type(v).__name__ == "deque": return {"deque": [_snap(x, depth + 1) for x in list(v)[:40]]}
    try: return repr(v)[:120]
    except BaseException: return type(v).__name__
def _tracer(frame, event, arg):
    if not frame.f_code.co_filename.endswith("solution.py"): return None
    if len(_steps) >= 400:
        sys.settrace(None); return None
    if event in ("line", "return", "exception"):
        o = {"event": event, "line": frame.f_lineno, "function": frame.f_code.co_name, "vars": {k: _snap(v) for k, v in list(frame.f_locals.items())[:20] if not callable(v) and not k.startswith((".", "_"))}}
        if event == "return": o["value"] = _snap(arg)
        _steps.append(o)
    return _tracer
def _plain(v):
    if isinstance(v, (list, tuple)): return [_plain(x) for x in v]
    if v is None or isinstance(v, (bool, int, float, str)): return v
    raise TypeError("returned a " + type(v).__name__)
for _args in _spec["args"]:
    _t = time.perf_counter()
    try:
        if _spec["trace"]: sys.settrace(_tracer)
        try: _raw = _fn(*_args)
        finally: sys.settrace(None)
        _v = _plain(_raw)
        _ms = (time.perf_counter() - _t) * 1000
        try: _emit({"value": _v, "ms": _ms})
        except ValueError: _emit({"error": "returned NaN or infinity"})
    except BaseException as e:
        import traceback
        _tb = [f for f in traceback.extract_tb(e.__traceback__) if f.filename.endswith("solution.py")]
        _emit({"error": type(e).__name__ + ": " + str(e) + (f" (line {_tb[-1].lineno})" if _tb else "")})
    if _spec["trace"]: _emit({"trace": _steps, "cut": len(_steps) >= 400})
    sys.stdout.flush()
`;

const JS_MAIN = (name) => `const fs = require('node:fs');
const spec = JSON.parse(fs.readFileSync('spec.json', 'utf8'));
const emit = (o) => fs.writeSync(3, JSON.stringify(o) + '\\n');
emit({ start: 1 });
const vm = require('node:vm');
Object.assign(globalThis, { require: (name) => require(name), module: {}, exports: {} });
let fn;
let why;
try { vm.runInThisContext(fs.readFileSync('solution.js', 'utf8'), { filename: 'solution.js' }); } catch (e) { why = String(e); }
try { fn = vm.runInThisContext('${name}'); } catch (e) { why ??= String(e); }
if (typeof fn !== 'function') { emit({ load: why ?? '${name} is not a function' }); process.exit(0); }
const finite = (v) => Array.isArray(v) ? v.every(finite) : typeof v !== 'number' || Number.isFinite(v);
for (const args of spec.args) {
  const t = performance.now();
  try {
    const value = fn(...args);
    const ms = performance.now() - t;
    emit(value === undefined ? { error: 'returned undefined' } : finite(value) ? { value, ms } : { error: 'returned NaN or infinity' });
  } catch (e) { emit({ error: String(e) }); }
}
`;

const CPP_HEADERS = `#include <algorithm>
#include <array>
#include <bitset>
#include <chrono>
#include <climits>
#include <cmath>
#include <cstdio>
#include <deque>
#include <exception>
#include <functional>
#include <iostream>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <stdexcept>
#include <string>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
#include <unistd.h>
`;
const CPP_MAIN = ({ name, params, returns }, cases) => `${CPP_HEADERS}#define main ib_user_main
#include "solution.cpp"
#undef main
namespace ib {
using std::string; using std::vector;
string show(long long v) { return std::to_string(v); }
string show(bool v) { return v ? "true" : "false"; }
string show(double v) { if (!std::isfinite(v)) throw std::runtime_error("returned NaN or infinity"); char b[40]; snprintf(b, sizeof b, "%.17g", v); return b; }
string show(const string& s) { string o = "\\""; char b[8]; for (unsigned char c : s) { if (c == '"' || c == '\\\\') { o += '\\\\'; o += c; } else if (c < 32) { snprintf(b, sizeof b, "\\\\u%04x", c); o += b; } else o += c; } return o + "\\""; }
template <class T> string show(const vector<T>& v) { string o = "["; for (size_t i = 0; i < v.size(); i++) { if (i) o += ","; o += show(static_cast<T>(v[i])); } return o + "]"; }
void emit(const string& s) { string l = s + "\\n"; size_t at = 0; while (at < l.size()) { ssize_t n = write(3, l.data() + at, l.size() - at); if (n <= 0) return; at += n; } }
template <class F> void once(F f) {
  try {
    auto t = std::chrono::steady_clock::now();
    ${cppType(returns).replace(/\b(vector|string)\b/g, 'std::$1')} v = f();
    double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t).count();
    emit("{\\"value\\":" + show(v) + ",\\"ms\\":" + std::to_string(ms) + "}");
  } catch (const std::exception& e) { emit("{\\"error\\":" + show(string(e.what())) + "}"); }
  catch (...) { emit("{\\"error\\":\\"threw an exception\\"}"); }
  std::cout.flush();
}
${cases
  .map(
    (args, i) => `void case${i}() {
  ${params.map((p, j) => `${cppType(p.type)} a${j} = ${cppLiteral(args[j], p.type)};`).join('\n  ')}
  once([&] { return ::${name}(${params.map((_, j) => `a${j}`).join(', ')}); });
}`,
  )
  .join('\n')}
}
int main() {
  ib::emit("{\\"start\\":1}");
  ${cases.map((_, i) => `ib::case${i}();`).join('\n  ')}
}
`;

const SQL_WRAP = (sql) => `import base64, sqlite3
SQL = base64.b64decode("${Buffer.from(sql).toString('base64')}").decode()
def _text(v):
    if v is None: return "NULL"
    if isinstance(v, float): return str(int(v)) if v == int(v) else format(v, ".6g")
    return str(v)
def query(data):
    db = sqlite3.connect(":memory:")
    db.executescript(data)
    return [[_text(v) for v in row] for row in db.execute(SQL).fetchall()]
`;

// Files to write, an optional compile step and the run command for one language.
export function build(language, code, signature, cases, trace = false) {
  const spec = JSON.stringify({ name: signature.name, args: cases, trace });
  if (language === 'python') return { files: { 'solution.py': code, 'main.py': PY_MAIN, 'spec.json': spec }, run: ['python3', '-B', 'main.py'] };
  if (language === 'sql') return build('python', SQL_WRAP(code), signature, cases);
  if (language === 'javascript') return { files: { 'solution.js': code, 'main.cjs': JS_MAIN(signature.name), 'spec.json': spec }, run: ['node', 'main.cjs'] };
  if (language === 'cpp') return { files: { 'solution.cpp': code, 'main.cpp': CPP_MAIN(signature, cases) }, compile: ['clang++', '-std=c++20', '-O1', '-w', 'main.cpp', '-o', 'main'], run: ['./main'] };
  throw new Error(`Unknown language ${language}`);
}

const SQL_PRINT = (sql, data) => `${SQL_WRAP(sql)}
db = sqlite3.connect(":memory:"); db.executescript(base64.b64decode("${Buffer.from(data).toString('base64')}").decode())
cur = db.execute(SQL)
if cur.description is None:
    print("The query returned no table")
else:
    rows = [[d[0] for d in cur.description]] + [[_text(v) for v in r] for r in cur.fetchall()]
    width = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    line = lambda r: "  ".join(c.ljust(w) for c, w in zip(r, width)).rstrip()
    print(line(rows[0])); print("  ".join("-" * w for w in width))
    for r in rows[1:]: print(line(r))
    print("\\n" + str(len(rows) - 1) + (" row" if len(rows) == 2 else " rows"))
`;

/** The file as written, run the way a terminal would run it. */
export function program(language, code, data) {
  if (language === 'python') return { files: { 'main.py': code }, run: ['python3', '-B', '-u', 'main.py'] };
  if (language === 'javascript') return { files: { 'main.cjs': code }, run: ['node', 'main.cjs'] };
  if (language === 'sql') return { files: { 'main.py': SQL_PRINT(code, data) }, run: ['python3', '-B', 'main.py'] };
  return { files: { 'main.cpp': `${CPP_HEADERS}#line 1 "main.cpp"\n${code}` }, compile: ['clang++', '-std=c++20', '-O1', '-w', 'main.cpp', '-o', 'main'], run: ['./main'] };
}
