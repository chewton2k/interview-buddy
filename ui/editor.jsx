import { indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'preact/hooks';

const MODES = { python, javascript, cpp };
const style = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier], fontWeight: '700' },
  { tag: [t.string, t.special(t.string), t.character], color: 'var(--good)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--focus)' },
  { tag: t.comment, color: 'var(--muted)' },
]);

/** Remount with a new `key` to load different text. */
export function Editor({ language, value, onChange, onRun }) {
  const host = useRef();
  const latest = useRef({});
  latest.current = { onChange, onRun };
  useEffect(() => {
    const run = () => (latest.current.onRun(), true);
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(keymap.of([{ key: 'Mod-Enter', run }])),
          basicSetup,
          keymap.of([indentWithTab]),
          indentUnit.of(language === 'python' ? '    ' : '  '),
          MODES[language](),
          syntaxHighlighting(style),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Code editor. Press Escape then Tab to leave.' }),
          EditorView.updateListener.of((u) => u.docChanged && latest.current.onChange(u.state.doc.toString())),
        ],
      }),
    });
    document.fonts.ready.then(() => view.requestMeasure());
    return () => view.destroy();
  }, []);
  return <div class="editor" ref={host} />;
}
