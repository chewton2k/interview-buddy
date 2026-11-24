import { useEffect, useRef, useState } from 'preact/hooks';
import { Draw } from './draw.jsx';
import { InterfaceWork } from './interface.jsx';
import { Notes } from './notes.jsx';
import { Analysis } from './analysis.jsx';
import { Chat } from './chat.jsx';
import { Editor } from './editor.jsx';
import { api, Icon, Line, Problem, Prose, useAction, useDebounced, useSet } from './lib.jsx';

const LANGUAGES = { python: 'Python', javascript: 'JavaScript', cpp: 'C++' };
const CHOICES = { code: LANGUAGES, sql: { sql: 'SQL' } };
const CHECKED = { code: 'Tests checked by two independent solutions', numeric: 'Answer checked by a solver', written: 'Graded on a rubric', sql: 'Tests checked by two independent queries', ui: 'Checks run in your browser' };
const show = (v) => (v === undefined ? 'Nothing' : typeof v === 'string' && v.includes('\n') ? v : Array.isArray(v?.[0]) && typeof v[0][0] === 'string' ? v.map((r) => r.join(', ')).join('\n') : JSON.stringify(v));
const MARKS = { met: ['good', 'Met'], partial: ['second', 'Partial'], missed: ['bad', 'Missed'] };

const Figure = ({ svg }) => svg ? <img class="figure" alt="Figure for this problem" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /> : null;

function Values({ signature, args, children }) {
  return (
    <dl class="kv">
      {signature.params.map((p, i) => [<dt key={p.name}>{p.name}</dt>, <dd key={`${p.name} value`}>{show(args[i])}</dd>])}
      {children}
    </dl>
  );
}

const short = (s) => (s.length > 160 ? `${s.slice(0, 157)}...` : s);
const hostOf = (link) => new URL(link).hostname.replace(/^www\./, '');

function Source({ set, problem }) {
  if (problem.request) {
    return (
      <p class="from">
        <span class="second">From your request</span> <span class="mark on">{short(problem.request)}</span>
        {problem.links.map((l) => (
          <span key={l}>
            {' '}
            <a href={l} target="_blank" rel="noreferrer">{hostOf(l)}</a>
          </span>
        ))}
      </p>
    );
  }
  if (!problem.quote) return null;
  return (
    <p class="from">
      <span class="second">{set.intake.posting.includes(problem.quote) ? 'From the posting' : 'From your notes'}</span> <span class="mark on">{problem.quote}</span>
    </p>
  );
}

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
        {body.cases?.slice(0, body.exampleCount).map((c, i) => (
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
            {body.solutionCode && <pre class="out note">{body.solutionCode}</pre>}
          </details>
        </div>
      </div>
  );
}

function Feedback({ feedback }) {
  if (!feedback) return null;
  return (
    <div class="stack tight">
      <p><Line text={feedback.summary} /></p>
      <ul class="rubric">
        {feedback.points.map((p, i) => (
          <li key={i}>
            <span class={MARKS[p.mark][0]}>{MARKS[p.mark][1]}</span>
            <Line text={p.point} />
            {p.note && <span class="why"><Line text={p.note} /></span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CodeWork({ problem, at, work, analyze }) {
  const { body, draft } = problem;
  const [language, setLanguage] = useState(CHOICES[problem.kind][draft.language] ? draft.language : Object.keys(CHOICES[problem.kind])[0]);
  const [code, setCode] = useState({ ...problem.starters, ...draft.code });
  const [shown, setShown] = useState(null);
  const [pick, setPick] = useState(0);
  const [feedback, setFeedback] = useState(problem.feedback);
  const [resets, setResets] = useState(0);
  const save = useDebounced((d) => api('PUT', `${at}/draft`, d).catch(() => {}), 600);
  const change = (nextLanguage, nextCode) => {
    setLanguage(nextLanguage);
    setCode(nextCode);
    save({ language: nextLanguage, code: nextCode });
  };
  const run = useAction(async (how) => {
    const r = await api('POST', `${at}/${how}`, { language, code: code[language] });
    setShown({ ...r, how, language, code: code[language] });
    setPick(Math.max(0, r.results.findIndex((x) => x.status !== 'pass')));
  });
  const passed = shown?.results.filter((r) => r.status === 'pass').length;
  const ask = useAction(async () => {
    setFeedback((await api('POST', `${at}/feedback`, { answer: code[language], outcome: outcome.outcome })).feedback);
  });
  const result = shown?.results[pick];
  const outcome = { language, code: code[language], outcome: shown?.language === language && shown.code === code[language] ? `${passed} of ${shown.results.length} ${shown.how === 'run' ? 'examples' : 'tests'} pass in ${CHOICES[problem.kind][language]}` : '' };
  work.current = () => outcome;
  const busy = run.busy || ask.busy;
  return (
    <section class="work" aria-label="Your solution">
      <div class="bar">
        <select class="input" aria-label="Language" value={language} onChange={(e) => change(e.target.value, code)}>
          {Object.entries(CHOICES[problem.kind]).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
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
        <span class="grow" />
        <button class="btn" disabled={busy} title="Command-Enter" onClick={() => run.run('run')}>
          <Icon name="play" />
          Run examples
        </button>
        <button class="btn primary" disabled={busy} onClick={() => run.run('submit')}>Submit</button>
      </div>
      <Editor key={`${language} ${resets}`} language={language} value={code[language]} onChange={(text) => change(language, { ...code, [language]: text })} onRun={() => !busy && run.run('run')} />
      <div class="results" aria-live="polite">
        <div class="stack">
          <Problem>{run.error || ask.error}</Problem>
          {run.busy ? (
            <p class="row second"><Icon name="load" /> Running on this computer</p>
          ) : (
            <div class="row between wrap">
              {shown ? (
                <h3 class={passed === shown.results.length ? 'good' : 'bad'}>
                  {passed} of {shown.results.length} {shown.how === 'run' ? 'examples' : 'tests'} pass
                </h3>
              ) : (
                <p class="second">Run the examples, then submit to run all {body.cases.length} tests</p>
              )}
              <span class="row">
                <button class="btn" disabled={busy} onClick={() => ask.run()}>
                  {ask.busy && <Icon name="load" />}
                  Get feedback
                </button>
                <button class="btn" disabled={analyze.busy || problem.visual?.status === 'working'} onClick={() => analyze.run()}>Analyze</button>
              </span>
            </div>
          )}
          {shown && !run.busy && shown.compileError && <pre class="out bad">{shown.compileError}</pre>}
          {shown && !run.busy && !shown.compileError && (
            <>
              <div class="cases">
                {shown.results.map((r, i) => (
                  <button key={i} class="case" aria-pressed={i === pick} onClick={() => setPick(i)}>
                    <span class={r.status === 'pass' ? 'good' : 'bad'}><Icon name={r.status === 'pass' ? 'check' : 'x'} /></span>
                    <span class="sr">{r.status === 'pass' ? 'Passed' : 'Failed'}</span>
                    {shown.how === 'run' ? 'Example' : 'Test'} {i + 1}
                  </button>
                ))}
              </div>
              <Values signature={body.signature} args={body.cases[pick].args}>
                <dt>Expected</dt>
                <dd>{show(body.cases[pick].expected)}</dd>
                <dt>Your answer</dt>
                <dd class={result.status === 'pass' ? 'good' : 'bad'}>{result.error ?? show(result.actual)}</dd>
                {result.ms !== undefined && [<dt key="t">Time</dt>, <dd key="v">{result.ms.toFixed(2)} ms</dd>]}
              </Values>
            </>
          )}
          {shown && !run.busy && shown.stdout && (
            <details>
              <summary>Printed output</summary>
              <pre class="out">{shown.stdout.slice(0, 20000)}</pre>
            </details>
          )}
          <Feedback feedback={feedback} />
        </div>
      </div>
    </section>
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
  const show = (state) => {
    setAsk(state);
    try {
      localStorage.setItem('ask', state);
    } catch {}
  };
  const Work = { code: CodeWork, sql: CodeWork, ui: InterfaceWork }[problem.kind] ?? TextWork;
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
