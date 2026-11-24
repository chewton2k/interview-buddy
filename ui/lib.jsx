import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked } from 'marked';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, { method, ...(method !== 'GET' && method !== 'DELETE' && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), keepalive: JSON.stringify(body ?? {}).length < 20000 }) });
  } catch {
    throw new Error('Interview Buddy is not running. Start it again in the terminal.');
  }
  const value = await res.json();
  if (!res.ok) throw new Error(value.error);
  return value;
}

/** Runs an async action, tracking whether it is busy and what went wrong. */
export function useAction(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (...args) => {
    setBusy(true);
    setError('');
    try {
      return await fn(...args);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}

export function useLoad(path, again = () => false) {
  const [value, setValue] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const load = useCallback(
    () =>
      api('GET', path)
        .then(
          (v) => (setValue(v), setError('')),
          (e) => setError(e.message),
        )
        .finally(() => setTick((t) => t + 1)),
    [path],
  );
  useEffect(() => {
    setValue(null);
    load();
  }, [load]);
  useEffect(() => {
    if (!value || !again(value)) return;
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  }, [tick]);
  return { value, error, load };
}
export const useSet = (id) => useLoad(`/sets/${id}`, ({ set }) => set.status === 'planning' || set.problems.some((p) => ['queued', 'writing'].includes(p.status) || p.chatBusy || p.visual?.status === 'working'));

export function useTheme() {
  const now = () => document.documentElement.dataset.theme;
  const [theme, setTheme] = useState(now);
  useEffect(() => {
    const change = () => setTheme(now());
    addEventListener('themechange', change);
    return () => removeEventListener('themechange', change);
  }, []);
  return theme;
}

const PATHS = { check: 'M20 6 9 17l-5-5', x: 'M18 6 6 18M6 6l12 12', plus: 'M5 12h14M12 5v14', play: 'M6 4l14 8-14 8z', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', load: 'M12 3a9 9 0 1 0 9 9', back: 'M15 18l-6-6 6-6', chat: 'M5 5h14v11h-8l-4 4v-4H5z', alert: 'M12 8v5M12 16.5v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18' };
export const Icon = ({ name }) => (
  <svg class={`icon ${name === 'load' ? 'spin' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
);
export const Problem = ({ children }) => children ? <p class="note bad" role="alert">{children}</p> : null;

const marked = new Marked({
  extensions: [
    {
      name: 'math',
      level: 'inline',
      start: (s) => s.search(/\$|\\[([]/),
      tokenizer(s) {
        const m = s.match(/^\$\$([\s\S]+?)\$\$/) ?? s.match(/^\\\[([\s\S]+?)\\\]/) ?? s.match(/^\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$(?!\d)/) ?? s.match(/^\\\(([\s\S]+?)\\\)/);
        if (m) return { type: 'math', raw: m[0], text: m[1].trim(), display: /^(\$\$|\\\[)/.test(m[0]) };
      },
      renderer: (t) => katex.renderToString(t.text, { displayMode: t.display, throwOnError: false }),
    },
  ],
});
// KaTeX needs inline sizes. Anything that could move content over the rest of the page is dropped.
const SAFE_STYLE = /^\s*((height|width|min-width|max-width|margin(-\w+)?|padding(-\w+)?|top|left|vertical-align|font-size|border-\w+-width)\s*:\s*-?\d{0,2}(\.\d+)?em|color\s*:\s*[#\w]+)\s*$/i;
DOMPurify.addHook('uponSanitizeAttribute', (_, a) => {
  if (a.attrName === 'style') a.attrValue = a.attrValue.split(';').filter((d) => SAFE_STYLE.test(d)).join(';');
});
const CLEAN = { FORBID_TAGS: ['a', 'img', 'style', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio'], FORBID_ATTR: ['id', 'name'] };
const html = (text, inline) => ({ __html: DOMPurify.sanitize(inline ? marked.parseInline(text) : marked.parse(text), CLEAN) });
export const Prose = ({ text, class: c = '' }) => <div class={`prose ${c}`} dangerouslySetInnerHTML={html(text)} />;
export const Line = ({ text }) => <span class="prose" dangerouslySetInnerHTML={html(text, true)} />;

export function useDebounced(fn, ms) {
  const timer = useRef();
  const last = useRef(null);
  const flush = () => {
    clearTimeout(timer.current);
    if (last.current) fn(last.current);
    last.current = null;
  };
  useEffect(() => {
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
  return (value) => {
    last.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, ms);
  };
}

export const modelName = (choice, status) => {
  const p = status?.providers.find((x) => x.id === choice.provider);
  const label = p?.models.find((m) => m.id === choice.model)?.label ?? choice.model;
  return [p?.label ?? choice.provider, label || 'account default'].join(', ');
};
