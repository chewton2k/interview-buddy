import { useEffect, useMemo, useState } from 'preact/hooks';
import { AddProblem } from './add.jsx';
import { api, Icon, Problem, useAction, useLoad, useSet } from './lib.jsx';

const solved = (n, total) => `${n} of ${total} solved`;

export function Sets() {
  const { value, error, load } = useLoad('/sets', ({ sets }) => sets.some((s) => s.busy));
  const remove = useAction(async (s) => {
    if (!confirm(`Delete the ${s.company} set and everything you wrote in it?`)) return;
    await api('DELETE', `/sets/${s.id}`);
    await load();
  });
  useEffect(() => void (document.title = 'Practice sets, Interview Buddy'), []);
  return (
    <div class="page narrow">
      <h1>Practice sets</h1>
      <Problem>{error || remove.error}</Problem>
      {value?.sets.length === 0 && (
        <div class="stack">
          <p class="second">Paste a job posting and get problems that train what it asks for.</p>
          <div>
            <a class="btn primary big" href="#/new">Make your first set</a>
          </div>
        </div>
      )}
      {value?.sets.length > 0 && (
        <ul class="list">
          {value.sets.map((s) => (
            <li class="setrow" key={s.id}>
              <a href={`#/sets/${s.id}`}>
                <h2>{s.company}</h2>
                {s.role && (
                  <span class="second">
                    {s.role}, {s.level.toLowerCase()}
                  </span>
                )}
                {s.quote && (
                  <span class="small clip">
                    <span class="mark">{s.quote}</span>
                  </span>
                )}
              </a>
              <span class="count small second">{s.status === 'planning' ? 'Planning' : s.status === 'failed' ? 'Needs a retry' : solved(s.solved, s.total)}</span>
              <button class="btn bare" aria-label={`Delete ${s.company}`} onClick={() => remove.run(s)}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {value && <AddProblem onAdded={({ setId }) => (location.hash = `#/sets/${setId}`)} />}
    </div>
  );
}

/** Splits text into plain runs and marks. Problems that quote the same words share one mark. */
export function markUp(text, problems) {
  const marks = [];
  problems.forEach((p, i) => {
    const at = p.quote ? text.indexOf(p.quote) : -1;
    if (at < 0) return;
    const end = at + p.quote.length;
    const hit = marks.find((m) => at < m.end && end > m.at);
    if (hit) hit.who.push(i);
    else marks.push({ at, end, who: [i] });
  });
  marks.sort((a, b) => a.at - b.at);
  const parts = [];
  let from = 0;
  for (const m of marks) {
    parts.push(text.slice(from, m.at), { text: text.slice(m.at, m.end), who: m.who });
    from = m.end;
  }
  return [...parts, text.slice(from)];
}

function Marked({ text, set, over, setOver }) {
  const parts = useMemo(() => markUp(text, set.problems), [text, set]);
  return parts.map((p, i) =>
    typeof p === 'string' ? (
      p
    ) : (
      <a key={i} class={`mark ${p.who.includes(over) ? 'on' : ''}`} href={`#/sets/${set.id}/${set.problems[p.who[0]].id}`} onMouseEnter={() => setOver(p.who[0])} onMouseLeave={() => setOver(null)}>
        {p.text}
        <sup>
          <span class="sr">, problem </span>
          {p.who.map((n) => n + 1).join(', ')}
        </sup>
      </a>
    ),
  );
}

const PROGRESS = { open: ['second', null, 'Not started'], tried: ['second', null, 'Tried'], solved: ['good', 'check', 'Solved'] };
function State({ p }) {
  const [tone, icon, label] = p.status === 'ready' ? PROGRESS[p.progress] : p.status === 'failed' ? ['bad', 'alert', 'Failed'] : p.status === 'writing' ? ['second', 'load', p.step] : ['second', null, 'Waiting'];
  return (
    <span class={`state ${tone}`}>
      {icon && <Icon name={icon} />}
      {label}
    </span>
  );
}

export function SetPage({ params: [id] }) {
  const { value, error, load } = useSet(id);
  const [over, setOver] = useState(null);
  const retry = useAction(async (path) => {
    await api('POST', `/sets/${id}${path}/retry`);
    await load();
  });
  const set = value?.set;
  useEffect(() => void (set && (document.title = `${set.intake.company}, Interview Buddy`)), [set]);
  if (!set) return <div class="page"><Problem>{error}</Problem></div>;
  const { company, role, level, posting, rounds, count } = set.intake;
  const sheet = posting || rounds;
  const detail = (p) => [p.subject, p.difficulty.toLowerCase()].filter(Boolean).join(', ') || p.request;
  return (
    <div class={`page ${sheet ? '' : 'narrow'}`}>
      <div class="row between wrap">
        <div>
          <h1>{company}</h1>
          {role && (
            <p class="second">
              {role}, {level.toLowerCase()}
            </p>
          )}
        </div>
        {set.status === 'ready' && <span class="count second">{solved(set.problems.filter((p) => p.progress === 'solved').length, set.problems.length)}</span>}
      </div>
      <Problem>{error || retry.error}</Problem>
      <div class={sheet ? 'desk' : ''}>
        {sheet && (
          <article class="sheet" tabIndex={0} aria-label="Job posting">
            {posting && (
              <>
                <h2>Job posting</h2>
                <Marked text={posting} {...{ set, over, setOver }} />
              </>
            )}
            {rounds && (
              <div class={posting ? 'notes' : ''}>
                <h2>What the interview has</h2>
                <Marked text={rounds} {...{ set, over, setOver }} />
              </div>
            )}
          </article>
        )}
        <div class="stack" aria-live="polite">
          {set.status === 'planning' && (
            <p class="note row">
              <Icon name="load" /> Reading the posting and planning {count} {count === 1 ? 'problem' : 'problems'}
            </p>
          )}
          {set.status === 'failed' && (
            <div class="note bad stack">
              <p>{set.error}</p>
              <div>
                <button class="btn" disabled={retry.busy} onClick={() => retry.run('')}>Try again</button>
              </div>
            </div>
          )}
          {set.problems.length > 0 && (
            <ol class="list">
              {set.problems.map((p, i) => (
                <li key={p.id} class={over === i ? 'over' : ''} onMouseEnter={() => setOver(i)} onMouseLeave={() => setOver(null)}>
                  {p.status === 'ready' ? (
                    <a class="item" href={`#/sets/${id}/${p.id}`} onFocus={() => setOver(i)} onBlur={() => setOver(null)}>
                      <span class="n">{i + 1}</span>
                      <h3>{p.title}</h3>
                      <State p={p} />
                      <span class="sub">{detail(p)}</span>
                    </a>
                  ) : (
                    <div class="item">
                      <span class="n">{i + 1}</span>
                      <h3>{p.title}</h3>
                      <State p={p} />
                      <span class="sub">{detail(p)}</span>
                      {p.status === 'failed' && (
                        <div class="sub stack tight">
                          <p>{p.error}</p>
                          <div>
                            <button class="btn" disabled={retry.busy} onClick={() => retry.run(`/problems/${p.id}`)}>Try again</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {set.status === 'ready' && <AddProblem setId={id} subjects={set.intake.subjects} onAdded={load} />}
        </div>
      </div>
    </div>
  );
}
