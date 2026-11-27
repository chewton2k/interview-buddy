import { useEffect, useRef, useState } from 'preact/hooks';
import { api, Icon, Problem, Prose, useAction } from './lib.jsx';
import { canSpeak, hush, say } from './speak.js';

const SPEAK = 'speak-interviewer';
const stored = () => {
  try {
    return localStorage.getItem(SPEAK) === 'on';
  } catch {
    return false;
  }
};

export function Chat({ setId, problem, at, work, reload, onClose, presence, head, channel = 'chat', fields, extra, note, title = 'Ask', intro = 'Ask about the problem, your approach or a hint. It can see your current work. You can also paste a link and ask for a new problem.', placeholder = 'Ask anything about this problem' }) {
  const [text, setText] = useState('');
  const end = useRef();
  const list = problem[channel] ?? [];
  const [waiting, failed] = [problem[`${channel}Busy`], problem[`${channel}Error`]];
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [list.length, waiting]);
  // Only the interviewer speaks, and only replies that arrive while this is open, so old ones never replay.
  const voiced = presence && canSpeak();
  const [speak, setSpeak] = useState(stored);
  const heard = useRef(list.length);
  useEffect(() => {
    if (voiced && speak) for (const m of list.slice(heard.current)) if (m.role !== 'user') say(m.text);
    heard.current = list.length;
  }, [list.length]);
  useEffect(() => hush, []);
  const toggle = () => {
    hush();
    setSpeak(!speak);
    try {
      localStorage.setItem(SPEAK, speak ? 'off' : 'on');
    } catch {}
  };
  const send = useAction(async (extra) => {
    hush();
    await api('POST', `${at}/chat`, { ...(await work.current()), ...fields, ...extra, channel });
    if (!extra.retry) setText('');
    await reload();
  });
  const busy = send.busy || waiting;
  const go = () => text.trim() && !busy && send.run({ message: text });
  return (
    <aside class="chat" aria-label={title}>
      <div class="row between">
        {head ?? <h2>{title}</h2>}
        {presence && <span class={`presence ${waiting ? 'typing' : ''}`}><i />{waiting ? 'Typing' : 'Listening'}</span>}
        {voiced && (
          <button class="btn bare" aria-pressed={speak} aria-label="Read replies aloud" title={speak ? 'Replies are read aloud' : 'Read replies aloud'} onClick={toggle}>
            <Icon name={speak ? 'sound' : 'mute'} />
          </button>
        )}
        {onClose && (
          <button class="btn bare" aria-label="Close ask" onClick={onClose}>
            <Icon name="x" />
          </button>
        )}
      </div>
      <div class="talk" aria-live="polite">
        {!list.length && <p class="second small">{intro}</p>}
        {list.map((m, i) => (
          <div key={i} class={`said ${m.role}`}>
            <span class="sr">{m.role === 'user' ? 'You' : 'Reply'}</span>
            {m.selection && <span class="small second mono">{m.selection.path} lines {m.selection.from}-{m.selection.to}</span>}
            <Prose text={m.text} />
            {extra?.(m)}
            {m.problemId && (
              <a class="btn" href={`#/sets/${setId}/${m.problemId}`}>
                Open the new problem
              </a>
            )}
          </div>
        ))}
        {waiting && (
          <p class="row second small">
            <Icon name="load" /> Thinking
          </p>
        )}
        {failed && (
          <div class="note bad stack tight">
            <p>{failed}</p>
            <div>
              <button class="btn" disabled={busy} onClick={() => send.run({ retry: true })}>Try again</button>
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      <Problem>{send.error}</Problem>
      {note}
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
          rows={2}
          maxLength={4000}
          placeholder={placeholder}
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
