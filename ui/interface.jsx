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
    // The page under test shares the frame, so only a well-formed answer counts.
    const close = open(frame, html, [check], (r) => finish(typeof r?.[0]?.ok === 'boolean' ? { name: check.name, ok: r[0].ok, error: r[0].error && String(r[0].error) } : { name: check.name, ok: false, error: 'The page did not report back' }));
  });
async function runChecks(html, checks) {
  const focused = document.activeElement;
  const results = [];
  for (let i = 0; i < checks.length; i += 3) results.push(...(await Promise.all(checks.slice(i, i + 3).map((c) => runCheck(html, c)))));
  focused?.focus?.();
  return results;
}
/** Good checks pass on the reference and fail on the starting page. A failure is tried once more alone, in case the computer was busy. */
async function goodChecks({ checks, solutionCode, starter }) {
  const [solved, start] = [await runChecks(solutionCode, checks), await runChecks(starter, checks)];
  for (let i = 0; i < checks.length; i++) if (!solved[i].ok) solved[i] = await runCheck(solutionCode, checks[i]);
  return checks.filter((_, i) => solved[i].ok && !start[i].ok);
}

function Preview({ html }) {
  const frame = useRef();
  useEffect(() => open(frame.current, html, [], () => {}), []);
  return <iframe ref={frame} title="Preview" class="preview-frame" sandbox={ALLOW.sandbox} />;
}

/** Build an interface in HTML with a preview and tests that run in the page. */
export function InterfaceWork({ problem, at, work, analyze, Feedback }) {
  const { body, draft } = problem;
  const [html, setHtml] = useState(draft.code?.html ?? body.starter);
  // Nothing runs until asked, so a page that hangs cannot lock anyone out of the problem.
  const [live, setLive] = useState(null);
  const [tests, setTests] = useState(null);
  const [shown, setShown] = useState(null);
  const [feedback, setFeedback] = useState(problem.feedback);
  const [resets, setResets] = useState(0);
  const save = useDebounced((d) => api('PUT', `${at}/draft`, d).catch(() => {}), 600);
  useEffect(() => {
    let gone = false;
    goodChecks(body).then((good) => gone || setTests(good));
    return () => (gone = true);
  }, []);
  const change = (h) => {
    setHtml(h);
    save({ language: 'html', code: { html: h } });
  };
  const show = () => setLive({ html, n: (live?.n ?? 0) + 1 });
  const submit = useAction(async () => {
    show();
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
        <button class="btn" title="Command-Enter" onClick={show}>
          <Icon name="play" />
          Run
        </button>
        <button class="btn primary" disabled={!tests?.length || submit.busy} onClick={() => submit.run()}>Submit</button>
      </div>
      <Editor key={resets} language="html" value={html} onChange={change} onRun={show} />
      <div class="results">
        <div class="stack">
          {live ? <Preview key={live.n} html={live.html} /> : <p class="second">Run to see your page</p>}
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
