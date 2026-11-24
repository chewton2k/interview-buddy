// Runs inside the locked frame that shows a model-written analysis. Everything here is on window.Stage.
import katex from 'katex';

const tell = (kind, message) => parent.postMessage({ stage: kind, message: String(message ?? '').slice(0, 1000) }, '*');
addEventListener('error', (e) => tell('error', e.message || 'A script failed to load'));
addEventListener('unhandledrejection', (e) => tell('error', e.reason?.message ?? e.reason));
addEventListener('securitypolicyviolation', (e) => tell('error', `Blocked ${e.effectiveDirective}: ${e.blockedURI}`));

const NS = 'http://www.w3.org/2000/svg';
const at = (root) => {
  const el = typeof root === 'string' ? document.querySelector(root) : root;
  if (!el) throw new Error(`Stage could not find ${root}`);
  return el;
};
function fill(node, attrs, children) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}
const el = (tag, attrs, ...children) => fill(document.createElement(tag), attrs, children);
const svg = (tag, attrs, ...children) => fill(document.createElementNS(NS, tag), attrs, children);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const colors = Object.fromEntries(['text', 'second', 'muted', 'line', 'card', 'raised', 'mark', 'mark-soft', 'blue', 'green', 'red', 'orange', 'teal'].map((c) => [c.replace('-s', 'S'), `var(--${c})`]));
// Canvas does not understand var(), so theme colors are resolved on the way in.
for (const key of ['fillStyle', 'strokeStyle']) {
  const own = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, key);
  Object.defineProperty(CanvasRenderingContext2D.prototype, key, {
    ...own,
    set(v) {
      own.set.call(this, typeof v === 'string' ? v.replace(/var\((--[\w-]+)\)/g, (_, name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()) : v);
    },
  });
}
const num = (v) => (typeof v !== 'number' ? String(v) : Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(2) : String(Number(v.toPrecision(4))));

function math(root, tex, display = false) {
  const node = root ? at(root) : el('span');
  node.innerHTML = katex.renderToString(tex, { output: 'mathml', displayMode: display, throwOnError: false });
  return node;
}

function tween(from, to, ms, step) {
  if (still || ms <= 0) return step(to, 1);
  const start = performance.now();
  const go = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const k = 1 - (1 - t) ** 3;
    step(from + (to - from) * k, t);
    if (t < 1) requestAnimationFrame(go);
  };
  requestAnimationFrame(go);
}

function player(root, { count, draw, caption, interval = 1100 }) {
  if (!(count > 0)) throw new Error('Stage.player needs at least one step');
  let i = 0;
  let timer = null;
  const text = el('p', { class: 'stage-caption', 'aria-live': 'polite' });
  const range = el('input', { type: 'range', min: 0, max: count - 1, value: 0, 'aria-label': 'Step', oninput: () => (pause(), show(Number(range.value))) });
  const where = el('span', { class: 'stage-count' });
  const play = el('button', { class: 'stage-button primary', type: 'button', onclick: () => (timer ? pause() : start()) }, 'Play');
  const back = el('button', { class: 'stage-button', type: 'button', onclick: () => (pause(), show(i - 1)) }, 'Back');
  const next = el('button', { class: 'stage-button', type: 'button', onclick: () => (pause(), show(i + 1)) }, 'Next');
  function pause() {
    clearInterval(timer);
    timer = null;
    play.textContent = 'Play';
  }
  function start() {
    if (i === count - 1) show(0);
    play.textContent = 'Pause';
    timer = setInterval(() => (i < count - 1 ? show(i + 1) : pause()), interval);
  }
  function show(n) {
    const before = i;
    i = Math.max(0, Math.min(count - 1, n));
    range.value = i;
    where.textContent = `${i + 1} of ${count}`;
    back.disabled = i === 0;
    next.disabled = i === count - 1;
    text.textContent = caption ? caption(i) : '';
    draw(i, before);
  }
  at(root).append(text, el('div', { class: 'stage-player' }, back, play, next, range, where));
  addEventListener('keydown', (e) => {
    if (e.target.matches('input,select,textarea')) return;
    if (e.key === 'ArrowRight') pause(), show(i + 1);
    if (e.key === 'ArrowLeft') pause(), show(i - 1);
  });
  show(0);
  return { show, pause, get step() { return i; } };
}

function slider(root, { label, min, max, step = 'any', value, unit = '', oninput }) {
  const out = el('output', { class: 'stage-value' });
  const input = el('input', { type: 'range', min, max, step, value });
  const change = () => {
    const v = Number(input.value);
    out.textContent = `${num(v)}${unit ? ` ${unit}` : ''}`;
    oninput?.(v);
  };
  input.addEventListener('input', change);
  at(root).append(el('label', { class: 'stage-slider' }, el('span', {}, label), out, input));
  change();
  return { get value() { return Number(input.value); }, set(v) { input.value = v; change(); } };
}

function ticks(lo, hi, want = 5) {
  const raw = (hi - lo) / want;
  const p = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].find((m) => m * p >= raw) * p;
  const list = [];
  for (let k = Math.ceil(lo / unit); k * unit <= hi + unit * 1e-9; k++) list.push(Number((k * unit).toPrecision(12)));
  return list;
}

function plot(root, first) {
  const host = el('div', { class: 'stage-plot' });
  at(root).append(host);
  const W = 640;
  const H = 320;
  const [L, R, T, B] = [56, 24, 24, 48];
  const id = `clip${Math.random().toString(36).slice(2)}`;
  const palette = [colors.blue, colors.orange, colors.teal, colors.red];
  function update(o) {
    const series = (o.series ?? []).map((s) => ({ ...s, points: s.points ?? Array.from({ length: 241 }, (_, k) => [o.x[0] + ((o.x[1] - o.x[0]) * k) / 240, s.fn(o.x[0] + ((o.x[1] - o.x[0]) * k) / 240)]) }));
    const good = series.flatMap((s) => s.points).filter((p) => p.every(Number.isFinite));
    const span = (k, given) => {
      if (given) return given;
      const v = good.map((p) => p[k]);
      const [a, b] = [Math.min(...v), Math.max(...v)];
      return a === b ? [a - 1, b + 1] : k === 1 ? [a - (b - a) * 0.06, b + (b - a) * 0.06] : [a, b];
    };
    const [x0, x1] = span(0, o.x);
    const [y0, y1] = span(1, o.y);
    const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
    const Y = (v) => H - B - ((v - y0) / (y1 - y0)) * (H - T - B);
    const label = (x, y, anchor, s, extra) => svg('text', { x, y, 'text-anchor': anchor, 'font-size': 13, fill: colors.second, ...extra }, s);
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label ?? `${o.yLabel ?? 'y'} against ${o.xLabel ?? 'x'}` }, svg('clipPath', { id }, svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B })));
    for (const t of ticks(x0, x1)) g.append(svg('line', { x1: X(t), x2: X(t), y1: T, y2: H - B, stroke: colors.line }), label(X(t), H - B + 18, 'middle', num(t)));
    for (const t of ticks(y0, y1, 4)) g.append(svg('line', { x1: L, x2: W - R, y1: Y(t), y2: Y(t), stroke: colors.line }), label(L - 8, Y(t) + 4, 'end', num(t)));
    if (o.xLabel) g.append(label((L + W - R) / 2, H - 8, 'middle', o.xLabel));
    if (o.yLabel) g.append(label(L, 14, 'start', o.yLabel));
    const inner = svg('g', { 'clip-path': `url(#${id})` });
    for (const b of o.bands ?? []) inner.append(svg('rect', { x: X(b.from), width: Math.max(0, X(b.to) - X(b.from)), y: T, height: H - T - B, fill: b.color ?? colors.markSoft, opacity: 0.7 }));
    series.forEach((s, k) => {
      const color = s.color ?? palette[k % palette.length];
      const pts = s.points.filter((p) => p.every(Number.isFinite));
      if (s.bars) {
        const w = ((W - L - R) / Math.max(1, pts.length)) * 0.8;
        for (const [x, y] of pts) inner.append(svg('rect', { x: X(x) - w / 2, width: w, y: Math.min(Y(y), Y(0)), height: Math.abs(Y(y) - Y(0)), rx: 3, fill: color }));
        return;
      }
      const d = pts.map(([x, y], n) => `${n ? 'L' : 'M'}${X(x).toFixed(2)} ${Y(y).toFixed(2)}`).join('');
      if (s.area && pts.length) inner.append(svg('path', { d: `${d}L${X(pts.at(-1)[0])} ${Y(Math.max(y0, 0))}L${X(pts[0][0])} ${Y(Math.max(y0, 0))}Z`, fill: color, opacity: 0.15 }));
      inner.append(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-dasharray': s.dashed ? '6 5' : null, 'stroke-linejoin': 'round' }));
    });
    g.append(inner);
    for (const m of o.marks ?? []) {
      const right = X(m.x) > W * 0.7;
      g.append(svg('circle', { cx: X(m.x), cy: Y(m.y), r: 6, fill: m.color ?? colors.mark, stroke: colors.text, 'stroke-width': 1.5 }), label(X(m.x) + (right ? -12 : 12), Math.max(T + 12, Y(m.y) - 10), right ? 'end' : 'start', m.label ?? '', { fill: colors.text, 'font-weight': 600 }));
    }
    const legend = series.filter((s) => s.label).map((s) => el('span', { class: 'stage-key' }, el('i', { style: { background: s.color ?? palette[series.indexOf(s) % palette.length] } }), s.label));
    host.replaceChildren(g, ...(legend.length ? [el('div', { class: 'stage-keys' }, legend)] : []));
  }
  update(first);
  return { update };
}

// A row of boxes whose values and pointers move between updates.
function cells(root, first) {
  const host = el('div', { class: 'stage-cells' });
  at(root).append(host);
  function update({ values, marks = [], dim = [], pointers = {}, label }) {
    host.setAttribute('aria-label', `${label ?? 'Values'}: ${values.map(num).join(', ')}`);
    while (host.children.length > values.length) host.lastChild.remove();
    values.forEach((v, i) => {
      const c = host.children[i] ?? host.appendChild(el('div', { class: 'stage-cell' }, el('b'), el('small'), el('em')));
      const [b, small, em] = c.children;
      const text = Array.isArray(v) ? v.map(num).join(', ') : num(v);
      if (b.textContent !== text) {
        b.textContent = text;
        if (!still) b.animate([{ transform: 'translateY(6px)', opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
      }
      small.textContent = i;
      em.textContent = Object.entries(pointers).filter(([, at]) => at === i).map(([name]) => name).join(', ');
      c.classList.toggle('on', marks.includes(i));
      c.classList.toggle('dim', dim.includes(i));
    });
  }
  update(first);
  return { update };
}

function code(root) {
  const host = el('ol', { class: 'stage-code' });
  const lines = (Stage.data.code ?? '').split('\n').map((l) => el('li', {}, el('code', {}, l || ' ')));
  host.append(...lines);
  at(root).append(host);
  return {
    line(n) {
      lines.forEach((l, i) => l.classList.toggle('on', i + 1 === n));
      const l = lines[n - 1];
      if (l) host.scrollTop = l.offsetTop - host.offsetTop - host.clientHeight / 2;
    },
  };
}

const data = JSON.parse(document.getElementById('stage-data').textContent);
window.Stage = { data, trace: data.trace ?? [], colors, el, svg, math, tween, player, slider, plot, cells, code, num };
addEventListener('load', () => {
  const box = document.getElementById('stage');
  new ResizeObserver(() => tell('height', Math.ceil(box.getBoundingClientRect().height) + 40)).observe(box);
});
addEventListener('load', () =>
  setTimeout(() => {
    const body = document.getElementById('stage');
    if (!body.innerText.trim() && !body.querySelector('svg,canvas')) tell('error', 'The page drew nothing');
    else tell('ready');
  }, 400),
);
