import { useEffect, useState } from 'preact/hooks';
import { api, Icon, Line, Problem, useAction, useLoad } from './lib.jsx';

const percent = (n) => (n === null ? 'None yet' : `${Math.round(n * 100)}%`);
const when = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Area({ area }) {
  const make = useAction(async () => {
    const { setId, id } = await api('POST', '/problems', { request: area.practice, subject: area.subject });
    location.hash = `#/sets/${setId}/${id}`;
  });
  return (
    <li class="area stack tight">
      <div class="row between wrap">
        <h3>{area.name}</h3>
        <span class="small second">{area.subject}</span>
      </div>
      <p><Line text={area.evidence} /></p>
      {area.problems.length > 0 && (
        <p class="small second">
          Seen in{' '}
          {area.problems.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <a href={`#/sets/${p.setId}/${p.id}`}>{p.title}</a>
            </span>
          ))}
        </p>
      )}
      <div>
        <button class="btn" disabled={make.busy} onClick={() => make.run()}>
          <Icon name={make.busy ? 'load' : 'plus'} />
          Make a problem for this
        </button>
      </div>
      <Problem>{make.error}</Problem>
    </li>
  );
}

/** How you are doing by subject, and weak spots a model finds across everything you tried. */
export function Progress() {
  const { value, error, load } = useLoad('/progress');
  const [report, setReport] = useState(null);
  const build = useAction(async () => {
    setReport((await api('POST', '/progress')).report);
    await load();
  });
  useEffect(() => void (document.title = 'Progress, Interview Buddy'), []);
  useEffect(() => void (value && setReport(value.report)), [value]);
  const stats = value?.stats ?? [];
  const tried = stats.reduce((n, r) => n + r.tried, 0);
  return (
    <div class="page narrow">
      <h1>Progress</h1>
      <Problem>{error}</Problem>
      {value && !tried && <p class="second">Finish a problem or ask for feedback on one, and how you did shows here.</p>}
      {tried > 0 && (
        <section class="panel" aria-labelledby="subjects">
          <h2 id="subjects">By subject</h2>
          <div class="scores" role="table" aria-labelledby="subjects">
            <div role="row" class="small second">
              <span role="columnheader">Subject</span>
              <span role="columnheader">Tried</span>
              <span role="columnheader">Solved</span>
              <span role="columnheader">Feedback</span>
            </div>
            {stats.map((r) => (
              <div role="row" key={r.subject}>
                <span role="cell">{r.subject}</span>
                <span role="cell">{r.tried}</span>
                <span role="cell">{r.solved}</span>
                <span role="cell">{percent(r.average)}</span>
              </div>
            ))}
          </div>
          <p class="small second">Feedback is the average share of rubric points met, over the problems you asked for feedback on.</p>
        </section>
      )}
      {tried > 0 && (
        <section class="panel" aria-labelledby="weak">
          <div class="row between wrap">
            <h2 id="weak">Weak spots</h2>
            <button class={`btn ${report ? '' : 'primary'}`} disabled={build.busy} onClick={() => build.run()}>
              {build.busy && <Icon name="load" />}
              {build.busy ? 'Reading your attempts' : report ? 'Update' : 'Find my weak spots'}
            </button>
          </div>
          <Problem>{build.error}</Problem>
          {!report && <p class="second">Reads every problem you tried, its result and its feedback, and finds what keeps going wrong.</p>}
          {report && (
            <div class="stack" aria-live="polite">
              <p class="small second">
                From {report.count} {report.count === 1 ? 'problem' : 'problems'} on {when(report.at)}
              </p>
              <p><Line text={report.overview} /></p>
              <ol class="list">
                {report.areas.map((a) => <Area key={a.name} area={a} />)}
              </ol>
              {report.strengths.length > 0 && (
                <div class="stack tight">
                  <h3>Going well</h3>
                  <ul class="bullets">{report.strengths.map((s) => <li key={s}><Line text={s} /></li>)}</ul>
                </div>
              )}
              <div class="stack tight">
                <h3>Next steps</h3>
                <ol class="bullets">{report.plan.map((s) => <li key={s}><Line text={s} /></li>)}</ol>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
