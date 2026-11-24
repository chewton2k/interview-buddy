import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from './editor.jsx';
import { api, Icon, Problem, useAction, useDebounced } from './lib.jsx';

function Frame({ run, hidden, onDone }) {
  const frame = useRef();
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const listen = (e) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.preview === 'hello') frame.current.contentWindow.postMessage({ html: run.html, checks: run.checks }, '*');
      if (e.data?.preview === 'done') done.current(e.data);
    };
    addEventListener('message', listen);
    return () => removeEventListener('message', listen);
  }, []);
  return <iframe ref={frame} title={hidden ? 'Checking the tests' : 'Preview'} class={hidden ? 'sr' : 'preview-frame'} aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : 0} sandbox="allow-scripts allow-forms" src="/preview.html" />;
}

/** Build an interface in HTML with a live preview and tests that run in the page. */
export function InterfaceWork({ problem, at, work, analyze, Feedback }) {
  const { body, draft } = problem;
  const [html, setHtml] = useState(draft.code?.html ?? body.starter);
  const [run, setRun] = useState({ n: 0, html, checks: [] });
  const [tests, setTests] = useState(null);
  const [shown, setShown] = useState(null);
  const [feedback, setFeedback] = useState(problem.feedback);
  const [resets, setResets] = useState(0);
  const save = useDebounced((d) => api('PUT', `${at}/draft`, d).catch(() => {}), 600);
  const refresh = useDebounced((h) => setRun((r) => ({ n: r.n + 1, html: h, checks: [] })), 500);
  const change = (h) => {
    setHtml(h);
    save({ language: 'html', code: { html: h } });
    refresh(h);
  };
  const submit = () => {
    setShown('running');
    setRun({ n: run.n + 1, html, checks: tests });
  };
  const record = useAction((r) => api('POST', `${at}/checked`, { passed: r.filter((x) => x.ok).length, total: r.length }));
  const done = ({ results }) => {
    if (!run.checks.length) return;
    setShown({ html, results });
    record.run(results);
  };
  const passed = shown?.results?.filter((r) => r.ok).length;
  const outcome = shown?.results && shown.html === html ? `${passed} of ${shown.results.length} checks pass` : '';
  work.current = () => ({ language: 'html', code: html, outcome });
  const ask = useAction(async () => setFeedback((await api('POST', `${at}/feedback`, { answer: html, outcome })).feedback));
  return (
    <section class="work interface" aria-label="Your solution">
      <div class="bar">
        <span class="small second">HTML, CSS and JavaScript</span>
        <button
          class="btn bare"
          onClick={() => {
            if (!confirm('Replace your code with the starting code?')) return;
            change(body.starter);
            setResets(resets + 1);
          }}
        >
          Reset
        </button>
        <span class="grow" />
        <button class="btn primary" disabled={!tests?.length || shown === 'running'} onClick={submit}>Submit</button>
      </div>
      <Editor key={resets} language="html" value={html} onChange={change} onRun={submit} />
      <div class="results">
        <div class="stack">
          <Frame key={run.n} run={run} onDone={done} />
          {!tests && <Frame hidden run={{ html: body.solutionCode, checks: body.checks }} onDone={({ results }) => setTests(body.checks.filter((_, i) => results[i]?.ok))} />}
          <Problem>{ask.error || record.error}</Problem>
          <div class="row between wrap" aria-live="polite">
            {shown === 'running' ? (
              <p class="row second"><Icon name="load" /> Running the checks</p>
            ) : shown ? (
              <h3 class={passed === shown.results.length ? 'good' : 'bad'}>{passed} of {shown.results.length} checks pass</h3>
            ) : (
              <p class="second">{!tests ? 'Getting the checks ready' : tests.length ? `Submit to run ${tests.length} checks` : 'This one is graded by feedback'}</p>
            )}
            <span class="row">
              <button class="btn" disabled={ask.busy} onClick={() => ask.run()}>
                {ask.busy && <Icon name="load" />}
                Get feedback
              </button>
              <button class="btn" disabled={analyze.busy || problem.visual?.status === 'working'} onClick={() => analyze.run()}>Analyze</button>
            </span>
          </div>
          {shown?.results && (
            <ul class="rubric">
              {shown.results.map((r, i) => (
                <li key={i}>
                  <span class={`row ${r.ok ? 'good' : 'bad'}`}><Icon name={r.ok ? 'check' : 'x'} />{r.ok ? 'Passed' : 'Failed'}</span>
                  <span>{r.name}</span>
                  {r.error && <span class="why">{r.error}</span>}
                </li>
              ))}
            </ul>
          )}
          <Feedback feedback={feedback} />
        </div>
      </div>
    </section>
  );
}
