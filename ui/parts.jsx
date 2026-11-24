import { Line } from './lib.jsx';

export const show = (v) => (v === undefined ? 'Nothing' : typeof v === 'string' && v.includes('\n') ? v : Array.isArray(v?.[0]) && typeof v[0][0] === 'string' ? v.map((r) => r.join(', ')).join('\n') : JSON.stringify(v));
const MARKS = { met: ['good', 'Met'], partial: ['second', 'Partial'], missed: ['bad', 'Missed'] };

export const Figure = ({ svg }) => svg ? <img class="figure" alt="Figure for this problem" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /> : null;

export function Values({ signature, args, children }) {
  return (
    <dl class="kv">
      {signature.params.map((p, i) => [<dt key={p.name}>{p.name}</dt>, <dd key={`${p.name} value`}>{show(args[i])}</dd>])}
      {children}
    </dl>
  );
}

const short = (s) => (s.length > 160 ? `${s.slice(0, 157)}...` : s);
const hostOf = (link) => new URL(link).hostname.replace(/^www\./, '');

export function Source({ set, problem }) {
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

export function Feedback({ feedback }) {
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
