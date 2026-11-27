import { useEffect, useRef, useState } from 'preact/hooks';
import { Analysis } from './analysis.jsx';
import { Chat } from './chat.jsx';
import { Editor } from './editor.jsx';
import { api, Icon, Line, Problem, Prose, useAction, useDebounced } from './lib.jsx';
import { Feedback, Figure, show, Source, Values } from './parts.jsx';

const LANGUAGES = { code: { python: 'Python', javascript: 'JavaScript', cpp: 'C++' }, sql: { sql: 'SQL' } };
const FILES = { python: 'solution.py', javascript: 'solution.js', cpp: 'solution.cpp', sql: 'query.sql' };
const INTRO = "I'm your interviewer. Read the instructions, ask me about anything unclear, and talk me through your approach before you write code.";

export function Splitter({ name, side, width, onWidth }) {
  const [min, max] = [220, 760];
  const set = (w) => onWidth(Math.round(Math.min(max, Math.max(min, w))));
  const drag = (e) => {
    e.preventDefault();
    const from = e.clientX;
    const move = (m) => set(width + (side === 'left' ? m.clientX - from : from - m.clientX));
    const stop = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', stop);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', stop);
  };
  const key = (e) => {
    const step = { ArrowLeft: -24, ArrowRight: 24 }[e.key];
    if (!step) return;
    e.preventDefault();
    set(width + (side === 'left' ? step : -step));
  };
  return <div class="splitter" role="separator" aria-orientation="vertical" aria-label={`Resize ${name}`} aria-valuenow={width} aria-valuemin={min} aria-valuemax={max} tabIndex={0} onPointerDown={drag} onKeyDown={key} />;
}

const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
const span = (ms) => `${pad2(ms / 60000)}:${pad2((ms / 1000) % 60)}`;

export function Clock({ session, act, busy, start = 45 }) {
  const [minutes, setMinutes] = useState(start);
  const [now, setNow] = useState(Date.now());
  const running = session?.startedAt && !session.endedAt;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (running) {
    const left = session.minutes * 60000 - (Math.max(now, Date.now()) - Date.parse(session.startedAt));
    return (
      <span class="clock" role="timer">
        <b class={left < 300000 ? 'mark on' : ''}>{left < 0 ? `${span(-left)} over` : span(left)}</b>
        <button class="btn bare" disabled={busy} onClick={() => act('clear')}>Stop clock</button>
      </span>
    );
  }
  return (
    <span class="clock">
      {session?.endedAt && session.startedAt && <span class="second">Took {span(Date.parse(session.endedAt) - Date.parse(session.startedAt))}</span>}
      <select class="input" aria-label="Interview length" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
        {[30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
      </select>
      <button class="btn" disabled={busy} onClick={() => act('start', minutes)}>{session?.endedAt ? 'Start again' : 'Start interview'}</button>
    </span>
  );
}

function Instructions({ set, problem }) {
  const { body } = problem;
  return (
    <div class="stack">
      <h1>{problem.title}</h1>
      <Source set={set} problem={problem} />
      <Prose text={body.statement} />
      {body.cases.slice(0, body.exampleCount).map((c, i) => (
        <div class="stack tight" key={i}>
          <h3>Example {i + 1}</h3>
          <div class="example">
            <Values signature={body.signature} args={c.args}>
              <dt>Returns</dt>
              <dd>{show(c.expected)}</dd>
            </Values>
            {c.explanation && <p class="small second"><Line text={c.explanation} /></p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export const OLDER = 'From an earlier version of your code';
export function Console({ out, busy, note, older }) {
  if (busy) return <p class="row second"><Icon name="load" /> Running on this computer</p>;
  if (!out) return <p class="second">{note}</p>;
  return (
    <div class="console">
      {older && <p class="small second">{OLDER}</p>}
      {out.stdout && <pre>{out.stdout.slice(0, 60000)}</pre>}
      {out.stderr && <pre class="bad">{out.stderr}</pre>}
      {!out.stdout && !out.stderr && <p class="muted">Nothing was printed</p>}
      <p class={`small ${out.failed ? 'bad' : 'muted'}`}>{out.note}</p>
    </div>
  );
}

function Result({ signature, test, result }) {
  return (
    <Values signature={signature} args={test.args}>
      <dt>Expected</dt>
      <dd>{show(test.expected)}</dd>
      <dt>Returned</dt>
      <dd class={result.status === 'pass' ? 'good' : 'bad'}>{result.error ?? show(result.actual)}</dd>
      {result.ms !== undefined && [<dt key="t">Time</dt>, <dd key="v">{result.ms.toFixed(2)} ms</dd>]}
    </Values>
  );
}

function Results({ signature, shown }) {
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(Math.max(0, shown.results.findIndex((r) => r.status !== 'pass'))), [shown]);
  if (shown.compileError) return <pre class="out bad">{shown.compileError}</pre>;
  const at = Math.min(pick, shown.results.length - 1);
  return (
    <>
      <div class="cases">
        {shown.results.map((r, i) => (
          <button key={i} class="case" aria-pressed={i === at} onClick={() => setPick(i)}>
            <span class={r.status === 'pass' ? 'good' : 'bad'}><Icon name={r.status === 'pass' ? 'check' : 'x'} /></span>
            <span class="sr">{r.status === 'pass' ? 'Passed' : 'Failed'}</span>
            {shown.tests[i].label}
          </button>
        ))}
      </div>
      <Result signature={signature} test={shown.tests[at]} result={shown.results[at]} />
    </>
  );
}

const PLACEHOLDER = { int: '5', float: '0.5', string: 'text', bool: 'true' };
const example = (type) => (type === 'string[]' ? '["text"]' : type.endsWith('[]') ? `[${example(type.slice(0, -2))}]` : PLACEHOLDER[type]);

function OwnTests({ problem, at, reload }) {
  const { signature } = problem.body;
  const sql = problem.kind === 'sql';
  const blank = () => (sql ? [problem.body.cases[0].args[0]] : signature.params.map(() => ''));
  const [args, setArgs] = useState(blank);
  const [expected, setExpected] = useState('');
  const add = useAction(async () => {
    await api('POST', `${at}/tests`, { args, expected });
    setArgs(blank());
    setExpected('');
    await reload();
  });
  const remove = useAction(async (id) => {
    await api('DELETE', `${at}/tests/${id}`);
    await reload();
  });
  return (
    <div class="stack">
      {problem.tests?.map((t, i) => (
        <div class="own" key={t.id}>
          <div class="row between">
            <h3>Your test {i + 1}</h3>
            <button class="btn bare" aria-label={`Delete your test ${i + 1}`} disabled={remove.busy} onClick={() => remove.run(t.id)}>
              <Icon name="trash" />
            </button>
          </div>
          <Values signature={signature} args={t.args}>
            <dt>Expected</dt>
            <dd>{show(t.expected)}</dd>
            {t.reference !== undefined && [<dt key="r">Reference</dt>, <dd key="v" class="bad">{show(t.reference)}</dd>]}
          </Values>
          {t.reference !== undefined && <p class="small second">The reference solution returns something else here. Check your expected value, or whether the input is allowed.</p>}
        </div>
      ))}
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          add.run();
        }}
      >
        <h3>Add a test</h3>
        {signature.params.map((p, i) => (
          <div class="field" key={p.name}>
            <label for={`arg-${p.name}`}>{sql ? 'Tables and rows' : `${p.name}, ${p.type}`}</label>
            <textarea id={`arg-${p.name}`} class="input mono" rows={sql ? 8 : 1} required={!p.type.startsWith('string') || sql} maxLength={20000} spellcheck={false} placeholder={example(p.type)} value={args[i]} onInput={(e) => setArgs(args.map((a, j) => (j === i ? e.target.value : a)))} />
          </div>
        ))}
        <div class="field">
          <label for="expected">Expected, {signature.returns}</label>
          <textarea id="expected" class="input mono" rows={1} maxLength={20000} spellcheck={false} placeholder="Leave empty to use the reference answer" value={expected} onInput={(e) => setExpected(e.target.value)} />
        </div>
        <Problem>{add.error || remove.error}</Problem>
        <div>
          <button class="btn" disabled={add.busy}>
            {add.busy ? <Icon name="load" /> : <Icon name="plus" />}
            Add test
          </button>
        </div>
      </form>
    </div>
  );
}

export const width = (key, start) => {
  try {
    return Number(localStorage.getItem(key)) || start;
  } catch {
    return start;
  }
};
export const remember = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

/** A shared coding pad: your file, its console, your tests and an interviewer. */
export function Pad({ set, problem, at, load }) {
  const { body, draft } = problem;
  const languages = LANGUAGES[problem.kind];
  const [language, setLanguage] = useState(languages[draft.language] ? draft.language : Object.keys(languages)[0]);
  const [code, setCode] = useState({ ...problem.starters, ...draft.code });
  const [resets, setResets] = useState(0);
  const [left, setLeft] = useState('instructions');
  const [right, setRight] = useState(problem.session?.endedAt ? 'review' : 'output');
  const [leftWidth, setLeftWidth] = useState(() => width('pad-left', 380));
  const [rightWidth, setRightWidth] = useState(() => width('pad-right', 400));
  const [out, setOut] = useState(null);
  const [tested, setTested] = useState(null);
  const [review, setReview] = useState(null);
  const [feedback, setFeedback] = useState(problem.feedback);
  const work = useRef(() => ({}));
  const now = code[language];
  const ended = Boolean(problem.session?.endedAt);
  const save = useDebounced((d) => api('PUT', `${at}/draft`, d).catch(() => {}), 600);
  const change = (nextLanguage, nextCode) => {
    setLanguage(nextLanguage);
    setCode(nextCode);
    save({ language: nextLanguage, code: nextCode });
  };
  const count = (r) => `${r.results.filter((x) => x.status === 'pass').length} of ${r.results.length} tests pass`;
  // Only results from exactly this code are reported, so nobody is graded on an older version.
  const same = (r) => r && r.language === language && r.code === now;
  const summary = () => [same(review) && `All tests: ${count(review)}`, same(tested) && `Last test run: ${count(tested)}`, same(out) && `Console of the last run:\n${`${out.stdout}${out.stderr}`.slice(-1500)}\n${out.note}`].filter(Boolean).join('\n');
  work.current = () => ({ language, code: now, outcome: summary() });

  const run = useAction(async () => {
    setRight('output');
    setOut({ ...(await api('POST', `${at}/program`, { language, code: now })), language, code: now });
  });
  const test = useAction(async () => {
    setRight('tests');
    setTested({ ...(await api('POST', `${at}/run`, { language, code: now })), language, code: now });
  });
  const clock = useAction(async (action, minutes) => {
    await api('POST', `${at}/session`, { action, minutes });
    await load();
  });
  const finish = useAction(async () => {
    setRight('review');
    const r = { ...(await api('POST', `${at}/submit`, { language, code: now })), language, code: now };
    setReview(r);
    await api('POST', `${at}/session`, { action: 'end' });
    await load();
    setFeedback((await api('POST', `${at}/feedback`, { answer: now, outcome: `All tests: ${count(r)}\n${summary()}` })).feedback);
    await load();
  });
  const analyze = useAction(async () => {
    setLeft('analysis');
    await api('POST', `${at}/analyze`, work.current());
    await load();
  });
  const busy = run.busy || test.busy || finish.busy;
  const tabs = { output: 'Output', tests: 'Tests', review: 'Review' };
  const passed = review && review.results.every((r) => r.status === 'pass');

  return (
    <div class={`pad ${left}`} style={{ '--left': `${left === 'analysis' ? Math.max(leftWidth, 560) : leftWidth}px`, '--right': `${rightWidth}px` }}>
      <div class="padbar">
        <a class="row small second back" href={`#/sets/${set.id}`}>
          <Icon name="back" />
          {set.intake.company}
        </a>
        <Clock session={problem.session} act={clock.run} busy={clock.busy || busy} />
        <button class="btn stop" disabled={busy} onClick={() => finish.run()}>{ended ? 'Review again' : 'Finish interview'}</button>
      </div>

      <section class="padside" aria-label="Instructions">
        <div class="cases" role="group" aria-label="Show">
          <button class="case" aria-pressed={left === 'instructions'} onClick={() => setLeft('instructions')}>Instructions</button>
          <button class="case" aria-pressed={left === 'analysis'} onClick={() => setLeft('analysis')}>Analysis</button>
        </div>
        {left === 'instructions' ? <Instructions set={set} problem={problem} /> : <Analysis problem={problem} at={at} analyze={analyze} reload={load} />}
      </section>
      <Splitter name="instructions" side="left" width={leftWidth} onWidth={(w) => (setLeftWidth(w), remember('pad-left', w))} />
      <section class="padedit" aria-label="Your code">
        <div class="padtabs">
          <span class="mono">{FILES[language]}</span>
          <span class="grow" />
          {Object.keys(languages).length > 1 && (
            <select class="input" aria-label="Language" value={language} onChange={(e) => change(e.target.value, code)}>
              {Object.entries(languages).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          )}
          <button
            class="btn bare"
            onClick={() => {
              if (!confirm('Replace your code with the starting code?')) return;
              change(language, { ...code, [language]: problem.starters[language] });
              setResets(resets + 1);
            }}
          >
            Reset
          </button>
          <button class="btn run" disabled={busy} title="Command-Enter" onClick={() => run.run()}>
            <Icon name="play" />
            Run
          </button>
        </div>
        <Editor key={`${language} ${resets}`} language={language} value={now} onChange={(text) => change(language, { ...code, [language]: text })} onRun={() => !busy && run.run()} />
      </section>
      <Splitter name="output" side="right" width={rightWidth} onWidth={(w) => (setRightWidth(w), remember('pad-right', w))} />

      <div class="padright">
        <section class="padpanel" aria-label="Output and tests">
          <div class="row between wrap">
            <div class="cases" role="group" aria-label="Show">
              {Object.entries(tabs).map(([k, label]) => (
                <button key={k} class="case" aria-pressed={right === k} onClick={() => setRight(k)}>{label}</button>
              ))}
            </div>
            {right === 'tests' && <button class="btn" disabled={busy} onClick={() => test.run()}>Run tests</button>}
          </div>
          <div class="stack" aria-live="polite">
            <Problem>{run.error || test.error || clock.error || finish.error}</Problem>
            {right === 'output' && <Console out={out} older={out && !same(out)} busy={run.busy} note={problem.kind === 'sql' ? 'Run shows what your query returns on the example tables' : 'Run executes your file and prints here, so call your function and print what you want to see'} />}
            {right === 'tests' && (
              <>
                {test.busy ? <p class="row second"><Icon name="load" /> Running on this computer</p> : tested && <><h3 class={tested.results.every((r) => r.status === 'pass') ? 'good' : 'bad'}>{count(tested)}</h3>{!same(tested) && <p class="small second">{OLDER}</p>}<Results signature={body.signature} shown={tested} /></>}
                <OwnTests problem={problem} at={at} reload={load} />
              </>
            )}
            {right === 'review' && (
              <>
                {!review && !ended && !finish.busy && <p class="second">Finish the interview to run every hidden test and get feedback. Hints and the solution open here then.</p>}
                {finish.busy && <p class="row second"><Icon name="load" /> {review ? 'Writing your feedback' : 'Running every test'}</p>}
                {review && <><h3 class={passed ? 'good' : 'bad'}>{count(review)}</h3>{!same(review) && <p class="small second">{OLDER}</p>}<Results signature={body.signature} shown={review} /></>}
                <Feedback feedback={feedback} />
                {(ended || review) && (
                  <>
                    <div>
                      <button class="btn" disabled={analyze.busy || problem.visual?.status === 'working'} onClick={() => analyze.run()}>Analyze my solution</button>
                    </div>
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
                          <Editor readOnly language={problem.kind === 'sql' ? 'sql' : 'python'} value={body.solutionCode} onChange={() => {}} onRun={() => {}} />
                        </div>
                      </details>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </section>
        <Chat presence title="Interviewer" intro={INTRO} placeholder="Talk to your interviewer" setId={set.id} problem={problem} at={at} work={work} reload={load} />
      </div>
    </div>
  );
}
