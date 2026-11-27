import { useRef, useState } from 'preact/hooks';
import { Chat } from './chat.jsx';
import { Editor } from './editor.jsx';
import { api, Icon, Problem, Prose, useAction, useDebounced } from './lib.jsx';
import { Clock, Console, OLDER, remember, Splitter, width } from './pad.jsx';
import { Feedback, Source } from './parts.jsx';

const INTRO = "I'm your interviewer. Look around the codebase, ask me about anything unclear, and use the AI assistant whenever it helps. Talk me through what you find.";
const HELPER = 'I can see every file in your project and your last run. Ask me to explain code, find a bug, or write code or tests. Check what I give you before you use it.';
const PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*){0,4}$/;
const MODE = { py: 'python', js: 'javascript', ts: 'javascript', html: 'html', sql: 'sql' };
const COMMAND = { main: 'python3 main.py', tests: 'python3 -m unittest discover tests -v', submit: 'Original and hidden tests' };

const modeOf = (p) => MODE[p.split('.').pop()] ?? 'plain';
// Folders first at every level, then names, like an IDE.
const sortKey = (p) => p.split('/').map((s, i, a) => (i < a.length - 1 ? '0' : '1') + s).join('/');
export const listing = (files) => Object.keys(files).sort().map((p) => `### ${p}\n\`\`\`\n${files[p]}\n\`\`\``).join('\n\n');

function Tree({ files, open, onOpen, changed }) {
  const rows = [];
  const seen = new Set();
  for (const p of Object.keys(files).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
    const parts = p.split('/');
    parts.slice(0, -1).forEach((name, i) => {
      const dir = parts.slice(0, i + 1).join('/');
      if (seen.has(dir)) return;
      seen.add(dir);
      rows.push(<li key={`${dir}/`} class="dir" style={{ '--depth': i }}><Icon name="folder" />{name}</li>);
    });
    rows.push(
      <li key={p} style={{ '--depth': parts.length - 1 }}>
        <button aria-current={p === open ? 'true' : undefined} onClick={() => onOpen(p)}>
          {parts.at(-1)}
          {changed(p) && <span class="edited" title="Changed"><span class="sr">, changed</span></span>}
        </button>
      </li>,
    );
  }
  return <ul class="tree" aria-label="Files">{rows}</ul>;
}

function Tests({ tests }) {
  return (
    <ul class="testlist">
      {tests.map((t) => (
        <li key={t.id} class={t.status === 'pass' ? 'good' : 'bad'}>
          <Icon name={t.status === 'pass' ? 'check' : 'x'} />
          <span class="sr">{t.status === 'pass' ? 'Passed' : 'Failed'}</span>
          <span class="mono">{t.id}</span>
        </li>
      ))}
    </ul>
  );
}

/** A multi-file pad for AI-native rounds: a file tree, a terminal, an interviewer and an AI assistant. */
export function Project({ set, problem, at, load }) {
  const { body, draft } = problem;
  const [files, setFiles] = useState(() => draft.files ?? body.files);
  const [open, setOpen] = useState(() => [draft.open, 'README.md', 'main.py'].find((p) => p && p in (draft.files ?? body.files)) ?? Object.keys(body.files)[0]);
  const [resets, setResets] = useState(0);
  const [left, setLeft] = useState(draft.files ? 'files' : 'instructions');
  const [right, setRight] = useState(problem.session?.endedAt ? 'review' : 'terminal');
  const [talk, setTalk] = useState('chat');
  const [leftWidth, setLeftWidth] = useState(() => width('pad-left', 320));
  const [rightWidth, setRightWidth] = useState(() => width('pad-right', 420));
  const [out, setOut] = useState(null);
  const [review, setReview] = useState(null);
  const [feedback, setFeedback] = useState(problem.feedback);
  const work = useRef(() => ({}));
  const ended = Boolean(problem.session?.endedAt);
  const save = useDebounced((d) => api('PUT', `${at}/draft`, d).catch(() => {}), 600);
  const change = (next, nextOpen = open) => {
    setFiles(next);
    setOpen(nextOpen);
    save({ files: next, open: nextOpen });
  };
  const changed = (p) => files[p] !== body.files[p];
  const edits = () => Object.fromEntries(Object.keys(files).filter(changed).map((p) => [p, files[p]]));
  const count = (r) => `${r.passed} of ${r.tests.length} tests pass`;
  const fresh = (r) => r && r.files === files;
  const summary = () => {
    const last = fresh(out) && `Last run: ${COMMAND[out.mode]}${out.tests.length ? `, ${count(out)}` : ''}\n${`${out.stdout}${out.stderr}`.slice(-1500)}\n${out.note}`;
    return [`Open file: ${open}`, fresh(review) && `All tests: ${count(review)}`, last].filter(Boolean).join('\n');
  };
  work.current = () => ({ language: 'python', code: listing(files), outcome: summary() });

  const exec = useAction(async (mode) => {
    setRight('terminal');
    setOut({ ...(await api('POST', `${at}/project/${mode}`, { files })), mode, files });
  });
  const clock = useAction(async (action, minutes) => {
    await api('POST', `${at}/session`, { action, minutes });
    await load();
  });
  const finish = useAction(async () => {
    setRight('review');
    const r = { ...(await api('POST', `${at}/project/submit`, { files })), files };
    setReview(r);
    await api('POST', `${at}/session`, { action: 'end' });
    await load();
    const changes = edits();
    setFeedback((await api('POST', `${at}/feedback`, { answer: Object.keys(changes).length ? listing(changes) : 'The candidate changed no files.', outcome: `All tests: ${count(r)}\n${summary()}` })).feedback);
    await load();
  });
  const busy = exec.busy || finish.busy;

  const create = () => {
    const p = prompt('New file path, such as tests/test_extra.py')?.trim();
    if (!p) return;
    if (!PATH.test(p) || p.length > 120) return alert('Use a plain relative path made of letters, digits, dots, dashes and slashes.');
    if (Object.keys(files).some((f) => f.startsWith(`${p}/`) || p.startsWith(`${f}/`))) return alert(`${p} clashes with a file or folder that is already there.`);
    change(p in files ? files : { ...files, [p]: '' }, p);
    setResets(resets + 1);
    setLeft('files');
  };
  const reset = () => {
    const added = !(open in body.files);
    if (!confirm(added ? `Delete ${open}?` : `Replace ${open} with the starting version?`)) return;
    if (added) {
      const { [open]: _, ...rest } = files;
      change(rest, 'main.py' in rest ? 'main.py' : Object.keys(rest)[0]);
    } else change({ ...files, [open]: body.files[open] });
    setResets(resets + 1);
  };
  const pick = (p) => {
    setOpen(p);
    save({ files, open: p });
  };

  const head = (
    <div class="cases" role="group" aria-label="Talk to">
      <button class="case" aria-pressed={talk === 'chat'} onClick={() => setTalk('chat')}>Interviewer</button>
      <button class="case" aria-pressed={talk === 'assistant'} onClick={() => setTalk('assistant')}>AI assistant</button>
    </div>
  );
  return (
    <div class="pad project" style={{ '--left': `${leftWidth}px`, '--right': `${rightWidth}px` }}>
      <div class="padbar">
        <a class="row small second back" href={`#/sets/${set.id}`}>
          <Icon name="back" />
          {set.intake.company}
        </a>
        <Clock session={problem.session} act={clock.run} busy={clock.busy || busy} start={60} />
        <button class="btn stop" disabled={busy} onClick={() => finish.run()}>{ended ? 'Review again' : 'Finish interview'}</button>
      </div>

      <section class="padside" aria-label="Instructions and files">
        <div class="row between">
          <div class="cases" role="group" aria-label="Show">
            <button class="case" aria-pressed={left === 'instructions'} onClick={() => setLeft('instructions')}>Instructions</button>
            <button class="case" aria-pressed={left === 'files'} onClick={() => setLeft('files')}>Files</button>
          </div>
          {left === 'files' && (
            <button class="btn bare" aria-label="New file" title="New file" onClick={create}>
              <Icon name="plus" />
            </button>
          )}
        </div>
        {left === 'instructions' ? (
          <div class="stack">
            <h1>{problem.title}</h1>
            <Source set={set} problem={problem} />
            <Prose text={body.statement} />
            <p class="small second">Python 3 with the standard library. Run main runs main.py, Run tests runs everything in tests/. Hidden tests run when you finish.</p>
          </div>
        ) : (
          <Tree files={files} open={open} onOpen={pick} changed={changed} />
        )}
      </section>
      <Splitter name="files" side="left" width={leftWidth} onWidth={(w) => (setLeftWidth(w), remember('pad-left', w))} />
      <section class="padedit" aria-label="Code">
        <div class="padtabs">
          <span class="mono" title={open}>
            {open.includes('/') && <span class="dirpart">{open.slice(0, open.lastIndexOf('/') + 1)}</span>}
            {open.split('/').pop()}
          </span>
          <span class="grow" />
          <button class="btn bare" onClick={reset}>{open in body.files ? 'Reset' : 'Delete'}</button>
          <button class="btn" disabled={busy} onClick={() => exec.run('tests')}>Run tests</button>
          <button class="btn run" disabled={busy} title="Command-Enter" onClick={() => exec.run('main')}>
            <Icon name="play" />
            Run main
          </button>
        </div>
        <Editor key={`${open} ${resets}`} language={modeOf(open)} value={files[open] ?? ''} onChange={(text) => change({ ...files, [open]: text })} onRun={() => !busy && exec.run('main')} />
      </section>
      <Splitter name="terminal" side="right" width={rightWidth} onWidth={(w) => (setRightWidth(w), remember('pad-right', w))} />

      <div class="padright">
        <section class="padpanel" aria-label="Terminal and review">
          <div class="row between wrap">
            <div class="cases" role="group" aria-label="Show">
              <button class="case" aria-pressed={right === 'terminal'} onClick={() => setRight('terminal')}>Terminal</button>
              <button class="case" aria-pressed={right === 'review'} onClick={() => setRight('review')}>Review</button>
            </div>
          </div>
          <div class="stack" aria-live="polite">
            <Problem>{exec.error || clock.error || finish.error}</Problem>
            {right === 'terminal' && (
              <>
                {out && !exec.busy && <p class="mono small muted">$ {COMMAND[out.mode]}</p>}
                {out?.mode === 'tests' && !exec.busy && <h3 class={out.tests.length && out.passed === out.tests.length ? 'good' : 'bad'}>{count(out)}</h3>}
                {/* unittest reports on stderr, so a test run reads as one plain stream like a terminal. */}
                <Console out={out?.mode === 'tests' ? { ...out, stdout: out.stdout + out.stderr, stderr: '' } : out} older={out && !fresh(out)} busy={exec.busy} note="Run main or Run tests and the output shows here" />
              </>
            )}
            {right === 'review' && (
              <>
                {!review && !ended && !finish.busy && <p class="second">Finish the interview to run your code against the original and hidden tests and get feedback on all five areas. Hints and the solution open here then.</p>}
                {finish.busy && <p class="row second"><Icon name="load" /> {review ? 'Writing your feedback' : 'Running every test'}</p>}
                {review && (
                  <>
                    <h3 class={review.solved ? 'good' : 'bad'}>{count(review)}</h3>
                    {!fresh(review) && <p class="small second">{OLDER}</p>}
                    <Tests tests={review.tests} />
                    {review.stderr && !review.tests.length && <pre class="out bad">{review.stderr}</pre>}
                  </>
                )}
                <Feedback feedback={feedback} />
                {(ended || review) && (
                  <div>
                    {body.hints.map((h, i) => (
                      <details key={i}>
                        <summary>Hint {i + 1}</summary>
                        <Prose class="second" text={h} />
                      </details>
                    ))}
                    <details>
                      <summary>Solution</summary>
                      <div class="stack">
                        <Prose text={body.solutionText} />
                        {Object.entries(body.solutionFiles).map(([p, text]) => (
                          <div class="stack tight" key={p}>
                            <h3 class="mono">{p}</h3>
                            <Editor readOnly language={modeOf(p)} value={text} onChange={() => {}} onRun={() => {}} />
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
        <Chat key={talk} presence={talk === 'chat'} head={head} channel={talk} title={talk === 'chat' ? 'Interviewer' : 'AI assistant'} intro={talk === 'chat' ? INTRO : HELPER} placeholder={talk === 'chat' ? 'Talk to your interviewer' : 'Ask the AI assistant'} setId={set.id} problem={problem} at={at} work={work} reload={load} />
      </div>
    </div>
  );
}
