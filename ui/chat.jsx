import { useEffect, useRef, useState } from 'preact/hooks';
import { api, Icon, Problem, Prose, useAction } from './lib.jsx';

export function Chat({ setId, problem, at, work, reload, onClose }) {
  const [text, setText] = useState('');
  const end = useRef();
  const list = problem.chat ?? [];
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [list.length, problem.chatBusy]);
  const send = useAction(async (extra) => {
    await api('POST', `${at}/chat`, { ...(await work.current()), ...extra });
    if (!extra.retry) setText('');
    await reload();
  });
  const busy = send.busy || problem.chatBusy;
  const go = () => text.trim() && !busy && send.run({ message: text });
  return (
    <aside class="chat" aria-label="Ask about this problem">
      <div class="row between">
        <h2>Ask</h2>
        <button class="btn bare" aria-label="Close ask" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div class="talk" aria-live="polite">
        {!list.length && <p class="second small">Ask about the problem, your approach or a hint. It can see your current work. You can also paste a link and ask for a new problem.</p>}
        {list.map((m, i) => (
          <div key={i} class={`said ${m.role}`}>
            <span class="sr">{m.role === 'user' ? 'You' : 'Reply'}</span>
            <Prose text={m.text} />
            {m.problemId && (
              <a class="btn" href={`#/sets/${setId}/${m.problemId}`}>
                Open the new problem
              </a>
            )}
          </div>
        ))}
        {problem.chatBusy && (
          <p class="row second small">
            <Icon name="load" /> Thinking
          </p>
        )}
        {problem.chatError && (
          <div class="note bad stack tight">
            <p>{problem.chatError}</p>
            <div>
              <button class="btn" disabled={busy} onClick={() => send.run({ retry: true })}>Try again</button>
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      <Problem>{send.error}</Problem>
      <form
        class="ask"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <textarea
          class="input"
          aria-label="Your message"
          rows={3}
          maxLength={4000}
          placeholder="Ask anything about this problem"
          value={text}
          onInput={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
            e.preventDefault();
            go();
          }}
        />
        <button class="btn primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </aside>
  );
}
