import { useEffect, useRef, useState } from 'preact/hooks';
import { Draw } from './draw.jsx';
import { InterfaceWork } from './interface.jsx';
import { Notes } from './notes.jsx';
import { Analysis } from './analysis.jsx';
import { Chat } from './chat.jsx';
import { Editor } from './editor.jsx';
import { api, Icon, Line, Problem, Prose, useAction, useDebounced, useSet } from './lib.jsx';
import { Pad } from './pad.jsx';
import { Feedback, Figure, Source } from './parts.jsx';

const CHECKED = { numeric: 'Answer checked by a solver', written: 'Graded on a rubric', ui: 'Checks run in your browser' };
function Brief({ set, problem }) {
  const { body } = problem;
  return (
      <div class="stack">
        <h1>{problem.title}</h1>
        <div class="meta">
          <span>{problem.subject}</span>
          <span>{problem.difficulty}</span>
          <span>{CHECKED[problem.kind]}</span>
        </div>
        <Source set={set} problem={problem} />
        <Prose text={body.statement} />
        <Figure svg={body.figure} />
        <div>
          {body.hints.map((h, i) => (
            <details key={i}>
              <summary>Hint {i + 1}</summary>
              <Prose class="second" text={h} />
            </details>
          ))}
          <details>
            <summary>Solution</summary>
            <Prose text={body.solutionText} />
            {body.answer !== undefined && <p>Answer: {Number(body.answer.toPrecision(6))} {body.unit}</p>}
            {body.solutionCode && <Editor readOnly language="html" value={body.solutionCode} onChange={() => {}} onRun={() => {}} />}
          </details>
        </div>
      </div>
  );
}

function TextWork({ problem, at, work, analyze }) {
  const { body, draft, kind } = problem;
  const [answer, setAnswer] = useState(draft.answer ?? '');
  const [working, setWorking] = useState(draft.working ?? '');
  const [verdict, setVerdict] = useState(null);
  const [feedback, setFeedback] = useState(problem.feedback);
  const [mode, setMode] = useState('write');
  const [elements, setElements] = useState(null);
  const save = useDebounced((d) => api('PUT', `${at}/draft`, d).catch(() => {}), 600);
  const keep = useDebounced((list) => api('PUT', `${at}/drawing`, { elements: list }).catch(() => {}), 800);
  const drawn = useAction(async () => setElements((await api('GET', `${at}/drawing`)).elements));
  useEffect(() => void drawn.run(), []);
  const edit = (a, w) => {
    setAnswer(a);
    setWorking(w);
    if (a !== answer) setVerdict(null);
    save({ answer: a, working: w });
  };
  const check = useAction(async () => {
    setVerdict(null);
    setVerdict({ answer, ...(await api('POST', `${at}/check`, { answer })) });
  });
  const ask = useAction(async () => {
    const said = kind === 'numeric' ? `Answer: ${answer} ${body.unit}\n\n${working}` : working;
    if (!answer.trim() && !working.trim() && !elements?.length) throw new Error('Write or draw an answer first');
    setFeedback((await api('POST', `${at}/feedback`, { answer: said, outcome, ...(await sketch()) })).feedback);
  });
  const numeric = kind === 'numeric';
  const outcome = verdict ? (verdict.correct ? 'The number is correct' : 'The number is not correct') : '';
  const sketch = async () => (elements?.length ? { drawing: await (await import('./canvas.jsx')).snapshot(elements) } : {});
  work.current = async () => ({ answer, working, outcome, ...(await sketch()) });
  return (
    <section class="work plain" aria-label="Your answer">
      <div class="stack">
        {numeric && (
          <form
            id="number"
            class="field"
            onSubmit={(e) => {
              e.preventDefault();
              check.run();
            }}
          >
            <label for="answer">Your answer</label>
            <div class="answer">
              <input id="answer" class="input" required autoComplete="off" maxLength={100} value={answer} onInput={(e) => edit(e.target.value, working)} aria-describedby="formats" />
              <Line text={body.unit} />
            </div>
            <span class="hint" id="formats">Decimals, 1.2e-3, fractions and percent all work</span>
          </form>
        )}
        <div class="field">
          <div class="row between wrap">
            <h3>{numeric ? 'Your working' : 'Your answer'}</h3>
            <span class="cases" role="group" aria-label="Answer with">
              {[['write', 'Write'], ['draw', 'Draw']].map(([k, label]) => (
                <button key={k} type="button" class="case" aria-pressed={mode === k} onClick={() => setMode(k)}>{label}</button>
              ))}
            </span>
          </div>
          <div hidden={mode !== 'write'}>
            <Notes value={working} label={numeric ? 'Your working' : 'Your answer'} rows={numeric ? 6 : 12} onChange={(t) => edit(answer, t)} />
          </div>
          {mode === 'draw' && elements && (
            <Draw
              elements={elements}
              onChange={(list) => {
                setElements(list);
                keep(list);
              }}
            />
          )}
          {mode === 'draw' && <Problem>{drawn.error}</Problem>}
          {mode === 'write' && elements?.length > 0 && <span class="hint">Your drawing is included too</span>}
        </div>
        <div class="row wrap">
          {numeric && <button form="number" class="btn primary" disabled={check.busy}>Check answer</button>}
          <button type="button" class={`btn ${numeric ? '' : 'primary'}`} disabled={ask.busy} onClick={() => ask.run()}>
            {ask.busy && <Icon name="load" />}
            {numeric ? 'Get feedback' : 'Grade answer'}
          </button>
          <button type="button" class="btn" disabled={analyze.busy || problem.visual?.status === 'working'} onClick={() => analyze.run()}>Analyze</button>
        </div>
        <div aria-live="polite" class="stack">
          <Problem>{check.error || ask.error}</Problem>
          {(verdict || feedback) && (
            <div class="results free stack">
              {verdict && (
                <h3 class={`row ${verdict.correct ? 'good' : 'bad'}`}>
                  <Icon name={verdict.correct ? 'check' : 'x'} />
                  {verdict.answer} {verdict.correct ? 'is correct' : 'is not the answer'}
                </h3>
              )}
              <Feedback feedback={feedback} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const remembered = () => {
  try {
    return localStorage.getItem('ask') ?? (innerWidth >= 1280 ? 'open' : 'closed');
  } catch {
    return 'closed';
  }
};

export function ProblemPage({ params: [id, pid] }) {
  const { value, error, load } = useSet(id);
  const [tab, setTab] = useState('problem');
  const [ask, setAsk] = useState(remembered);
  const work = useRef({});
  const at = `/sets/${id}/problems/${pid}`;
  const analyze = useAction(async () => {
    setTab('analysis');
    await api('POST', `${at}/analyze`, await work.current());
    await load();
  });
  const set = value?.set;
  const problem = set?.problems.find((p) => p.id === pid);
  useEffect(() => void (problem && (document.title = `${problem.title}, Interview Buddy`)), [problem?.title]);
  if (!problem || problem.status !== 'ready') {
    return (
      <div class="page narrow">
        {problem && <h1>{problem.title}</h1>}
        <Problem>{error || problem?.error}</Problem>
        {['queued', 'writing'].includes(problem?.status) && (
          <p class="row second" role="status">
            <Icon name="load" /> {problem.step ?? 'Waiting'}
          </p>
        )}
        {set && (
          <p>
            <a href={`#/sets/${id}`}>Back to {set.intake.company}</a>
          </p>
        )}
      </div>
    );
  }
  if (problem.kind === 'code' || problem.kind === 'sql') return <Pad set={set} problem={problem} at={at} load={load} />;
  const show = (state) => {
    setAsk(state);
    try {
      localStorage.setItem('ask', state);
    } catch {}
  };
  const Work = problem.kind === 'ui' ? InterfaceWork : TextWork;
  const tabs = { problem: 'Problem', analysis: 'Analysis' };
  return (
    <div class={`bench ${ask === 'open' ? 'asking' : ''} ${tab}`}>
      <section class="brief" aria-label="Problem">
        <div class="stack">
          <div class="row between wrap">
            <a class="row small second back" href={`#/sets/${id}`}>
              <Icon name="back" />
              {set.intake.company}
            </a>
            <span class="row">
              <span class="cases" role="group" aria-label="Show">
                {Object.entries(tabs).map(([k, label]) => (
                  <button key={k} class="case" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
                ))}
              </span>
              {ask !== 'open' && (
                <button class="btn" onClick={() => show('open')}>
                  <Icon name="chat" />
                  Ask
                </button>
              )}
            </span>
          </div>
          {tab === 'problem' ? <Brief set={set} problem={problem} /> : <Analysis problem={problem} at={at} analyze={analyze} reload={load} />}
        </div>
      </section>
      <Work problem={problem} at={at} work={work} analyze={analyze} Feedback={Feedback} />
      {ask === 'open' && <Chat setId={id} problem={problem} at={at} work={work} reload={load} onClose={() => show('closed')} />}
    </div>
  );
}
