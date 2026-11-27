import { useRef, useState } from 'preact/hooks';
import { Chat } from './chat.jsx';
import { Editor } from './editor.jsx';
import { api, Icon, Problem, Prose, useAction, useDebounced } from './lib.jsx';
import { diffLines, fold } from './diff.js';
import { Clock, Console, OLDER, remember, Splitter, width } from './pad.jsx';
import { Feedback, Source } from './parts.jsx';

const INTRO = "I'm your interviewer. Look around the codebase, ask me about anything unclear, and use the AI assistant whenever it helps. Talk me through what you find.";
const HELPER = {
  ask: 'Ask mode: I see every file and your last run, and I answer, explain and suggest code. I cannot change your files.',
  edit: 'Edit mode: I see every file and your last run, and I can change files. You get a diff for each file to accept or reject.',
};
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

function FileDiff({ path, before, after, lines: show = true, children }) {
  const lines = diffLines(before, after);
  const [added, removed] = ['+', '-'].map((op) => lines.filter((l) => l.op === op).length);
  return (
    <div class="change">
      <div class="row between wrap">
        <span class="mono small">{path}{before === null && <span class="second"> new file</span>}</span>
        <span class="small"><span class="good">+{added}</span> <span class="bad">-{removed}</span></span>
      </div>
      {show && (
        <pre class="diff" aria-label={`Changes to ${path}`}>
          {fold(lines).map((l, k) => (l.skip ? <span key={k} class="skip">{l.skip} unchanged {l.skip === 1 ? 'line' : 'lines'}</span> : <span key={k} class={l.op === '+' ? 'add' : l.op === '-' ? 'del' : ''}><i aria-hidden="true">{l.op}</i><span class="sr">{l.op === '+' ? 'Added: ' : l.op === '-' ? 'Removed: ' : ''}</span>{l.t || ' '}</span>))}
        </pre>
      )}
      {children}
    </div>
  );
}

function Edit({ edit, files, onPick, busy }) {
  // Once chosen, the file has moved on, so the diff against it would no longer mean anything.
  return (
    <FileDiff path={edit.path} before={edit.path in files ? files[edit.path] : null} after={edit.content} lines={edit.status === 'pending'}>
      {edit.status === 'pending' ? (
        <div class="row">
          <button class="btn" disabled={busy} onClick={() => onPick(edit, 'accepted')}><Icon name="check" />Accept</button>
          <button class="btn bare" disabled={busy} onClick={() => onPick(edit, 'rejected')}>Reject</button>
        </div>
      ) : (
        <p class={`small ${edit.status === 'accepted' ? 'good' : 'second'}`}>{edit.status === 'accepted' ? 'Accepted' : 'Rejected'}</p>
      )}
    </FileDiff>
  );
}

const PART = /(?=\*\*Part \d+[:.]?\*\*)/;
function Statement({ statement, shown, onNext, busy }) {
  const [intro, ...parts] = statement.trimStart().startsWith('**Part') ? ['', ...statement.split(PART)] : statement.split(PART);
  return (
    <>
      {intro && <Prose text={intro} />}
      {parts.slice(0, shown).map((p, i) => <Prose key={i} text={p} />)}
      {shown < parts.length && (
        <div class="stack tight">
          <p class="small second">Part {shown + 1} of {parts.length} opens when you are ready, usually when your interviewer moves you on.</p>
          <div>
            <button class="btn" disabled={busy} onClick={onNext}>Next part</button>
          </div>
        </div>
      )}
    </>
  );
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
  const [selection, setSelection] = useState(null);
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('assistant-mode') === 'ask' ? 'ask' : 'edit';
    } catch {
      return 'edit';
    }
  });
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
  const decide = useAction(async (edit, status) => {
    if (status === 'accepted') {
      if (Object.keys(files).some((f) => f.startsWith(`${edit.path}/`) || edit.path.startsWith(`${f}/`))) return alert(`${edit.path} clashes with a file or folder that is already there.`);
      change({ ...files, [edit.path]: edit.content }, edit.path);
      setResets((r) => r + 1);
      setSelection(null);
    }
    await api('POST', `${at}/edits`, { id: edit.id, status });
    await load();
  });
  const pickMode = (m) => {
    setMode(m);
    remember('assistant-mode', m);
  };
  const next = useAction(async () => {
    await api('POST', `${at}/part`, {});
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
    setSelection(null);
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
    setSelection(null);
  };
  const pick = (p) => {
    setSelection(null);
    setOpen(p);
    save({ files, open: p });
  };

  const head = (
    <div class="cases" role="group" aria-label="Talk to">
      <button class="case" aria-pressed={talk === 'chat'} onClick={() => setTalk('chat')}>Interviewer</button>
      <button class="case" aria-pressed={talk === 'assistant'} onClick={() => setTalk('assistant')}>AI assistant</button>
    </div>
  );
  const modes = (
    <div class="cases" role="group" aria-label="Assistant mode">
      <button class="case" aria-pressed={mode === 'ask'} onClick={() => pickMode('ask')}>Ask</button>
      <button class="case" aria-pressed={mode === 'edit'} onClick={() => pickMode('edit')}>Edit</button>
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
            <Statement statement={body.statement} shown={ended ? Infinity : problem.reveal?.shown ?? 1} onNext={() => next.run()} busy={next.busy} />
            <Problem>{next.error}</Problem>
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
        <Editor key={`${open} ${resets}`} language={modeOf(open)} value={files[open] ?? ''} onChange={(text) => change({ ...files, [open]: text })} onRun={() => !busy && exec.run('main')} onSelect={(s) => setSelection(s && { ...s, path: open })} />
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
            <Problem>{exec.error || clock.error || finish.error || decide.error}</Problem>
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
                  <details>
                    <summary>Your changes</summary>
                    <div class="stack tight">
                      {Object.keys(files).filter(changed).length ? Object.keys(files).filter(changed).map((p) => <FileDiff key={p} path={p} before={p in body.files ? body.files[p] : null} after={files[p]} />) : <p class="second">You did not change any files.</p>}
                    </div>
                  </details>
                )}
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
        <Chat key={talk} presence={talk === 'chat'} head={talk === 'chat' ? head : <>{head}{modes}</>} channel={talk} fields={{ mode, selection: selection ?? undefined }} note={selection && (
          <p class="selnote small">
            <span><span class="mono">{selection.path} lines {selection.from}-{selection.to}</span> is selected and goes with your message</span>
            <button class="btn bare" aria-label="Do not send the selection" onClick={() => setSelection(null)}><Icon name="x" /></button>
          </p>
        )} extra={(m) => m.edits?.map((e) => <Edit key={e.id} edit={e} files={files} onPick={decide.run} busy={decide.busy} />)} title={talk === 'chat' ? 'Interviewer' : 'AI assistant'} intro={talk === 'chat' ? INTRO : HELPER[mode]} placeholder={talk === 'chat' ? 'Talk to your interviewer' : mode === 'edit' ? 'Ask the assistant to change code' : 'Ask the AI assistant'} setId={set.id} problem={problem} at={at} work={work} reload={load} />
      </div>
    </div>
  );
}
