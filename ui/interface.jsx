import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from './editor.jsx';
import { api, Icon, Problem, useAction, useDebounced } from './lib.jsx';

const ALLOW = { sandbox: 'allow-scripts allow-forms', allow: 'focus-without-user-activation *' };

/** Loads a page in a locked frame. The listener is in place before the frame can speak. */
function open(frame, html, checks, onDone) {
  const listen = (e) => {
    if (e.source !== frame.contentWindow) return;
    if (e.data?.preview === 'hello') frame.contentWindow.postMessage({ html, checks }, '*');
    if (e.data?.preview === 'done') onDone(e.data.results);
  };
  addEventListener('message', listen);
  frame.src = '/preview.html';
  return () => removeEventListener('message', listen);
}

// Every check gets its own fresh page, so one cannot spoil the next.
const runCheck = (html, check) =>
  new Promise((resolve) => {
    const frame = document.createElement('iframe');
    Object.entries(ALLOW).forEach(([k, v]) => frame.setAttribute(k, v));
    Object.assign(frame, { className: 'offstage', tabIndex: -1, title: 'Running a check' });
    frame.setAttribute('aria-hidden', 'true');
    const finish = (result) => {
      clearTimeout(timer);
      close();
      frame.remove();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ name: check.name, ok: false, error: 'The page did not finish loading' }), 8000);
    document.body.append(frame);
    const close = open(frame, html, [check], ([r]) => finish(r));
  });
const runChecks = (html, checks) => Promise.all(checks.map((c) => runCheck(html, c)));

function Preview({ html }) {
  const frame = useRef();
  useEffect(() => open(frame.current, html, [], () => {}), [html]);
  return <iframe ref={frame} title="Preview" class="preview-frame" {...ALLOW} />;
}

/** Build an interface in HTML with a live preview and tests that run in the page. */
export function InterfaceWork({ problem, at, work, analyze, Feedback }) {
  const { body, draft } = problem;
  const [html, setHtml] = useState(draft.code?.html ?? body.starter);
  const [live, setLive] = useState(html);
  const [tests, setTests] = useState(null);
  const [shown, setShown] = useState(null);
  const [feedback, setFeedback] = useState(problem.feedback);
  const [resets, setResets] = useState(0);
  const save = useDebounced((d) => api('PUT', `${at}/draft`, d).catch(() => {}), 600);
  const refresh = useDebounced(setLive, 500);
  // A check that fails on the reference solution is a bad check, so it is never shown.
  useEffect(() => {
    let gone = false;
    runChecks(body.solutionCode, body.checks).then((r) => gone || setTests(body.checks.filter((_, i) => r[i].ok)));
    return () => (gone = true);
  }, []);
  const change = (h) => {
    setHtml(h);
    save({ language: 'html', code: { html: h } });
    refresh(h);
  };
  const submit = useAction(async () => {
    const results = await runChecks(html, tests);
    setShown({ html, results });
    await api('POST', `${at}/checked`, { passed: results.filter((r) => r.ok).length, total: results.length });
  });
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
        <button class="btn primary" disabled={!tests?.length || submit.busy} onClick={() => submit.run()}>Submit</button>
      </div>
      <Editor key={resets} language="html" value={html} onChange={change} onRun={() => tests?.length && !submit.busy && submit.run()} />
      <div class="results">
        <div class="stack">
          <Preview html={live} />
          <Problem>{ask.error || submit.error}</Problem>
          <div class="row between wrap" aria-live="polite">
            {submit.busy ? (
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
