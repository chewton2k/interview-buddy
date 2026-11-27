import { data, obj, str } from './generate.js';
import { dropLinks } from './link.js';
import { ask, ProviderError } from './providers.js';
import { chosen, listSets, readProgress, saveProgress } from './store.js';

const MOST = 80;
const list = (items) => ({ type: 'array', items });
const cut = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);

/** Every problem you tried or had graded, newest first. */
async function attempts() {
  const found = [];
  for (const s of await listSets()) {
    for (const p of s.problems) {
      if (p.status !== 'ready' || (!['tried', 'solved'].includes(p.progress) && !p.feedback)) continue;
      const at = [p.feedback?.at, p.triedAt].filter(Boolean).sort().at(-1) ?? s.createdAt;
      found.push({ set: s, p, at });
    }
  }
  return found.sort((a, b) => b.at.localeCompare(a.at));
}

/** Counts per subject, with no model call. */
export async function progressStats() {
  const bySubject = new Map();
  for (const { p } of await attempts()) {
    const row = bySubject.get(p.subject) ?? { subject: p.subject, tried: 0, solved: 0, graded: 0, score: 0 };
    row.tried++;
    if (p.progress === 'solved') row.solved++;
    if (p.feedback) (row.graded++, (row.score += p.feedback.score));
    bySubject.set(p.subject, row);
  }
  return [...bySubject.values()].map(({ score, ...r }) => ({ ...r, average: r.graded ? score / r.graded : null })).sort((a, b) => b.tried - a.tried || a.subject.localeCompare(b.subject));
}

export const readReport = () => readProgress();

/** Asks the model for weak spots across all attempts. Problems are cited by index so the page can link to them. */
export async function buildReport(signal) {
  const found = (await attempts()).slice(0, MOST);
  if (!found.length) return null;
  const subjects = [...new Set(found.map(({ p }) => p.subject))];
  const entries = found.map(({ set, p }, i) => ({
    index: i,
    interview: set.intake.personal ? undefined : `${set.intake.company}, ${set.intake.role}, ${set.intake.level}`,
    subject: p.subject,
    kind: p.kind,
    difficulty: p.difficulty,
    title: p.title,
    topic: cut(p.topic ?? '', 400),
    result: p.progress ?? 'graded only',
    feedback: p.feedback && {
      score: p.feedback.score,
      summary: cut(p.feedback.summary, 600),
      not_met: p.feedback.points.filter((x) => x.mark !== 'met').map((x) => ({ point: cut(x.point, 300), mark: x.mark, note: cut(x.note, 400) })),
    },
  }));
  const schema = obj({
    overview: str,
    strengths: list(str),
    areas: list(obj({ name: str, subject: { type: 'string', enum: subjects }, evidence: str, practice: str, problems: list({ type: 'number' }) })),
    plan: list(str),
  });
  const prompt = `You coach a candidate preparing for technical interviews. Below is every practice problem they tried, newest first, with the result and any graded feedback. Find their weak spots: patterns that repeat across problems, such as a topic they miss, skipping edge cases, weak testing, slow pacing through parts, or accepting AI assistant output without checking it. Prefer patterns seen in two or more problems. Ignore subjects with too little evidence.
overview is two or three sentences. strengths has up to three short items. areas has one to five weak spots, worst first. name is at most 6 words. evidence is one or two sentences addressed to the candidate that say what went wrong and where. problems lists the index of each problem that shows it. practice asks for one new practice problem that trains exactly this weak spot, in one or two sentences, with no links. plan has three to five concrete next steps in order. Use $...$ for math.
${data({ problems: entries })}`;
  const r = await ask({ ...(await chosen()), prompt, schema, signal });
  if (!r.areas.length) throw new ProviderError('badjson', 'The model found no weak spots. Try again.');
  const report = {
    at: new Date().toISOString(),
    count: found.length,
    overview: r.overview,
    strengths: r.strengths.slice(0, 3),
    plan: r.plan.slice(0, 5),
    areas: r.areas.slice(0, 5).map((a) => ({
      name: a.name,
      subject: a.subject,
      evidence: a.evidence,
      // A practice request is posted back as a new problem, which opens links it contains.
      practice: dropLinks(a.practice) || a.name,
      problems: [...new Set(a.problems)].filter((i) => Number.isInteger(i) && found[i]).slice(0, 6).map((i) => ({ setId: found[i].set.id, id: found[i].p.id, title: found[i].p.title })),
    })),
  };
  await saveProgress(report);
  return report;
}
