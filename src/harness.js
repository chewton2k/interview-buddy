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
    'auto bool char double explicit extern float friend goto inline int long mutable namespace operator register short signed sizeof std struct template typedef typename union unsigned using virtual volatile main true false').split(' '),
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

export function starter(language, { name, params, returns }) {
  if (language === 'python') return `def ${name}(${params.map((p) => `${p.name}: ${pyType(p.type)}`).join(', ')}) -> ${pyType(returns)}:\n    pass\n`;
  if (language === 'javascript') {
    const doc = [...params.map((p) => ` * @param {${jsType(p.type)}} ${p.name}`), ` * @returns {${jsType(returns)}}`].join('\n');
    return `/**\n${doc}\n */\nfunction ${name}(${params.map((p) => p.name).join(', ')}) {\n\n}\n`;
  }
  const args = params.map((p) => `${cppType(p.type)}${p.type.endsWith(']') || p.type === 'string' ? '& ' : ' '}${p.name}`).join(', ');
  return `using namespace std;\n\n${cppType(returns)} ${name}(${args}) {\n\n}\n`;
}

const PY_MAIN = `import json, os, sys, time
_out = os.fdopen(3, "w")
_spec = json.load(open("spec.json"))
def _emit(o):
    _out.write(json.dumps(o, allow_nan=False) + "\\n"); _out.flush()
try:
    import solution
    _fn = getattr(solution, _spec["name"])
except BaseException as e:
    _emit({"load": type(e).__name__ + ": " + str(e)}); sys.exit(0)
def _plain(v):
    if isinstance(v, (list, tuple)): return [_plain(x) for x in v]
    if v is None or isinstance(v, (bool, int, float, str)): return v
    raise TypeError("returned a " + type(v).__name__)
for _args in _spec["args"]:
    _t = time.perf_counter()
    try:
        _v = _plain(_fn(*_args))
        _ms = (time.perf_counter() - _t) * 1000
        try: _emit({"value": _v, "ms": _ms})
        except ValueError: _emit({"error": "returned NaN or infinity"})
    except BaseException as e:
        import traceback
        _tb = [f for f in traceback.extract_tb(e.__traceback__) if f.filename.endswith("solution.py")]
        _emit({"error": type(e).__name__ + ": " + str(e) + (f" (line {_tb[-1].lineno})" if _tb else "")})
    sys.stdout.flush()
`;

const JS_MAIN = (name) => `const fs = require('node:fs');
const spec = JSON.parse(fs.readFileSync('spec.json', 'utf8'));
const emit = (o) => fs.writeSync(3, JSON.stringify(o) + '\\n');
let fn;
try {
  fn = new Function(fs.readFileSync('solution.js', 'utf8') + '\\n;return ${name};')();
  if (typeof fn !== 'function') throw new TypeError('${name} is not a function');
} catch (e) { emit({ load: String(e) }); process.exit(0); }
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

const CPP_MAIN = ({ name, params, returns }, cases) => `#include <algorithm>
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
#include "solution.cpp"
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
  ${cases.map((_, i) => `ib::case${i}();`).join('\n  ')}
}
`;

// Files to write, an optional compile step and the run command for one language.
export function build(language, code, signature, cases) {
  const spec = JSON.stringify({ name: signature.name, args: cases });
  if (language === 'python') return { files: { 'solution.py': code, 'main.py': PY_MAIN, 'spec.json': spec }, run: ['python3', '-B', 'main.py'] };
  if (language === 'javascript') return { files: { 'solution.js': code, 'main.cjs': JS_MAIN(signature.name), 'spec.json': spec }, run: ['node', 'main.cjs'] };
  if (language === 'cpp') return { files: { 'solution.cpp': code, 'main.cpp': CPP_MAIN(signature, cases) }, compile: ['clang++', '-std=c++20', '-O1', '-w', 'main.cpp', '-o', 'main'], run: ['./main'] };
  throw new Error(`Unknown language ${language}`);
}
