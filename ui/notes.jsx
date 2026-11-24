import { useEffect, useRef, useState } from 'preact/hooks';
import { block, toBlocks, toMarkdown } from './blocks.js';
import { Icon, Prose } from './lib.jsx';

const hasMath = (s) => /\$[^$]+\$|\\\(/.test(s);

function Text({ value, label, focus, onChange, onEquation, onRemove, rows }) {
  const box = useRef();
  useEffect(() => {
    const el = box.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  useEffect(() => void (focus && box.current.focus()), [focus]);
  return (
    <div class="stack tight">
      <textarea
        ref={box}
        class="input"
        rows={rows}
        aria-label={label}
        maxLength={50000}
        value={value}
        onInput={(e) => {
          const t = e.target.value;
          // Typing $$ on its own line starts an equation, the way people write LaTeX.
          if (/(^|\n)\$\$$/.test(t)) onEquation(t.replace(/\n?\$\$$/, ''));
          else onChange(t);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && !value && onRemove) {
            e.preventDefault();
            onRemove();
          }
        }}
      />
      {hasMath(value) && <Prose class="preview" text={value} />}
    </div>
  );
}

function Equation({ value, focus, onChange, onNext, onRemove }) {
  const host = useRef();
  const field = useRef();
  const latest = useRef({});
  latest.current = { onChange, onNext, onRemove };
  useEffect(() => {
    let gone = false;
    import('./mathfield.js').then(({ create }) => {
      if (gone) return;
      const mf = (field.current = create(value));
      mf.setAttribute('aria-label', 'Equation');
      mf.addEventListener('input', () => latest.current.onChange(mf.getValue('latex')));
      mf.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          latest.current.onNext(e.shiftKey);
        }
        if (e.key === 'Backspace' && !mf.getValue('latex')) {
          e.preventDefault();
          latest.current.onRemove();
        }
      });
      host.current.replaceChildren(mf);
      if (focus) mf.focus();
    });
    return () => (gone = true);
  }, []);
  useEffect(() => void (focus && field.current?.focus()), [focus]);
  return (
    <div class="equation">
      <div class="field-host" ref={host} />
      <button type="button" class="btn bare" aria-label="Remove equation" onClick={onRemove}>
        <Icon name="x" />
      </button>
    </div>
  );
}

/** Text with typeset equations between it. `value` is read once, `onChange` gets Markdown. */
export function Notes({ value, label, rows, onChange }) {
  const [blocks, setBlocks] = useState(() => toBlocks(value));
  const [focus, setFocus] = useState(null);
  const commit = (list) => {
    const full = list.length ? list : [block('text')];
    setBlocks(full);
    onChange(toMarkdown(full));
  };
  const edit = (id, text) => commit(blocks.map((b) => (b.id === id ? { ...b, text } : b)));
  const insert = (id, b, text) => {
    const i = blocks.findIndex((x) => x.id === id);
    const list = blocks.map((x) => (x.id === id && text !== undefined ? { ...x, text } : x));
    list.splice(i + 1, 0, b);
    commit(list);
    setFocus(b.id);
  };
  const remove = (id) => {
    const i = blocks.findIndex((x) => x.id === id);
    setFocus(blocks[Math.max(0, i - 1)]?.id ?? null);
    commit(blocks.filter((x) => x.id !== id));
  };
  const add = (type) => insert(blocks.at(-1).id, block(type));
  return (
    <div class="notes-editor" role="group" aria-label={label}>
      {blocks.map((b, i) =>
        b.type === 'text' ? (
          <Text key={b.id} value={b.text} label={label} rows={blocks.length === 1 ? rows : 2} focus={focus === b.id} onChange={(t) => edit(b.id, t)} onEquation={(t) => insert(b.id, block('math'), t)} onRemove={i > 0 ? () => remove(b.id) : null} />
        ) : (
          <Equation key={b.id} value={b.text} focus={focus === b.id} onChange={(t) => edit(b.id, t)} onNext={(leave) => insert(b.id, block(leave ? 'text' : 'math'))} onRemove={() => remove(b.id)} />
        ),
      )}
      <div class="row wrap">
        <button type="button" class="btn" onClick={() => add('math')}>
          <Icon name="plus" />
          Equation
        </button>
        <button type="button" class="btn" onClick={() => add('text')}>
          <Icon name="plus" />
          Text
        </button>
        <span class="small muted">Type $$ for an equation, Enter for the next line, Shift-Enter for text</span>
      </div>
    </div>
  );
}
