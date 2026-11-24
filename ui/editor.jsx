import { indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { SQLite, sql } from '@codemirror/lang-sql';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'preact/hooks';

const MODES = { python, javascript, cpp, html, sql: () => sql({ dialect: SQLite }) };
const style = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier, t.self], color: 'var(--code-keyword)', fontWeight: '600' },
  { tag: [t.function(t.variableName), t.function(t.definition(t.variableName)), t.function(t.propertyName), t.function(t.definition(t.propertyName)), t.macroName], color: 'var(--code-function)' },
  { tag: [t.variableName, t.definition(t.variableName), t.local(t.variableName)], color: 'var(--code-variable)' },
  { tag: [t.typeName, t.className, t.definition(t.className), t.namespace, t.standard(t.typeName), t.tagName, t.standard(t.name)], color: 'var(--code-type)' },
  { tag: [t.string, t.special(t.string), t.character, t.regexp, t.attributeValue, t.docString], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.color], color: 'var(--code-number)' },
  { tag: [t.propertyName, t.definition(t.propertyName), t.attributeName, t.labelName], color: 'var(--code-property)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)', fontStyle: 'normal' },
  { tag: [t.operator, t.punctuation, t.bracket, t.derefOperator, t.processingInstruction, t.meta], color: 'var(--code-operator)' },
]);

/** Remount with a new `key` to load different text. */
export function Editor({ language, value, onChange, onRun, readOnly }) {
  const host = useRef();
  const latest = useRef({});
  latest.current = { onChange, onRun };
  useEffect(() => {
    const run = () => (latest.current.onRun(), true);
    let view;
    let gone = false;
    const open = () => {
      if (gone) return;
      view = new EditorView({
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
          readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': readOnly ? 'Solution code' : 'Code editor. Press Escape then Tab to leave.' }),
          EditorView.updateListener.of((u) => u.docChanged && latest.current.onChange(u.state.doc.toString())),
        ],
      }),
    });
    };
    // Line heights are measured once, so the code font has to be there first.
    document.fonts.load('14px "Atkinson Hyperlegible Mono Variable"').then(open, open);
    return () => {
      gone = true;
      view?.destroy();
    };
  }, []);
  return <div class={`editor ${readOnly ? 'still' : ''}`} ref={host} />;
}
