import { randomUUID } from 'node:crypto';
import { addProblem, data, obj, partCount, partTimes, PROJECT_LIMIT, said, str, tracked } from './generate.js';
import { dropLinks, findLinks } from './link.js';
import { ask, ProviderError } from './providers.js';
import { LANGUAGES, plainPath, runCode } from './sandbox.js';
import { checkDrawing, Invalid, readSet, chosen, updateProblem } from './store.js';

const RUNS = ['code', 'sql'];
const HTML_LIMIT = 200000;
const need = (v, name, max) => {
  if (v === undefined) return '';
  if (typeof v !== 'string' || v.length > max) throw new Invalid(`${name} must be text of at most ${max.toLocaleString('en-US')} characters`);
  return v;
};
const work = (b) => ({ language: need(b.language, 'Language', 20), code: need(b.code, 'Code', 200000), answer: need(b.answer, 'Answer', 1000), working: need(b.working, 'Your working', 100000), outcome: need(b.outcome, 'Outcome', 6000), drawing: checkDrawing(b.drawing) });
const seen = (drawing) => (drawing ? '\nThe attached image is the candidate\'s drawing, which is part of their work.' : '');
const worded = ({ drawing, ...rest }) => ({ ...rest, drawing: drawing?.outline });
const ready = (p) => {
  if (p.status !== 'ready') throw new Invalid('This problem is not ready yet');
};
const known = ({ statement, rubric, solutionText, solutionCode, answer, unit, signature }) => ({ statement, rubric, reference_solution: solutionCode ?? solutionText, correct_answer: answer === undefined ? undefined : `${answer} ${unit}`, signature });
const find = async (setId, pid) => {
  const set = await readSet(setId);
  return { set, problem: set.problems.find((p) => p.id === pid) };
};

const picked = (s) => {
  if (s === undefined || s === null) return null;
  if (!plainPath(s.path) || !Number.isInteger(s.from) || !Number.isInteger(s.to) || s.from < 1 || s.to < s.from) throw new Invalid('The selection could not be read');
  return { path: s.path, from: s.from, to: s.to, text: need(s.text, 'Selected code', 20000) };
};

const PARTNER = `You are the candidate's interview partner for one practice problem. Answer their last message in the transcript.
Be direct and concrete, refer to what they actually wrote, and keep to what was asked. Nudge rather than hand over the full solution unless they ask for it.`;
const INTERVIEWER = `You are the interviewer in a live technical interview in a shared coding pad. You see the candidate's code and what their last run printed. Answer their last message in the transcript.
Behave like a good human interviewer. Keep replies under 90 words. Ask at most one question at a time. Answer clarifying questions about the problem plainly. When they describe an approach, probe its edge cases and its time and space cost before they build it. When they are stuck or ask for help, give the smallest useful nudge. When their code works, ask for tests they would add, then a follow-up that changes a constraint. Never write the solution, name the full algorithm outright or fix their code for them. If they ask for the solution, say it opens when they finish the interview.`;
const PROJECT_INTERVIEWER = `You are the interviewer in a live AI-native coding interview. The candidate works in a multi-file codebase in a shared IDE with an AI assistant they are expected to use, and you see their files, what their last run printed and their recent messages to the assistant. Answer their last message in the transcript.
Behave like a good human interviewer. Keep replies under 90 words. Ask at most one question at a time. Answer clarifying questions about the task plainly. Ask them to explain existing code and any code the assistant wrote before they rely on it, how they verified a change, which tests or edge cases they would add, and the runtime or trade-offs of their approach. They see the statement only up to current_part. Never describe a later part. When the current part works and they have explained it, tell them to press Next part. When they select code, selected_code is what they mean. If they paste or accept assistant output without reading or running it, ask how they know it is right. Never write the solution, point at the exact bug or fix their code for them. If they ask for the solution, say it opens when they finish the interview.`;
const ASSISTANT = `You are the AI coding assistant built into the candidate's IDE. You see every file in their project and what their last run printed. Answer their last message in the transcript like a capable coding assistant: explain code, trace bugs, propose changes, and write code or tests when asked. Be concise. Say when you are unsure, and never claim you ran anything.`;
const chatSchema = obj({ reply: str, new_problem: str });
const list = (items) => ({ type: 'array', items });
const MODES = {
  ask: 'Ask mode: you cannot change files. When you suggest code, give the file path and the whole changed function or block in fenced code.',
  edit: 'Edit mode: you can change files. Put each file you change or create in edits, with its path as it appears in the project and its complete new text, never a fragment. Leave edits empty when no change is asked for. The candidate sees a diff per file and accepts or rejects it. In reply, say briefly what you changed and why, without repeating the code.',
};
const assistantSchema = { ask: obj({ reply: str }), edit: obj({ reply: str, edits: list(obj({ path: str, content: str })) }) };

/** Stores the question and answers it in the background, so leaving the page loses nothing. */
export async function chat(setId, pid, body) {
  const now = work(body);
  const message = need(body.message, 'Your message', 4000).trim();
  // The assistant is its own transcript, so the interviewer and the grader can see how it was used.
  const channel = body.channel === 'assistant' ? 'assistant' : 'chat';
  const mode = body.mode === 'edit' ? 'edit' : 'ask';
  const selection = picked(body.selection);
  const [busy, error] = [`${channel}Busy`, `${channel}Error`];
  const question = await updateProblem(setId, pid, (p) => {
    ready(p);
    if (channel === 'assistant' && p.kind !== 'project') throw new Invalid('This problem has no AI assistant');
    if (p[busy]) throw new Invalid('Wait for the reply first');
    p[channel] ??= [];
    const last = p[channel].at(-1);
    if (body.retry) {
      if (last?.role !== 'user') throw new Invalid('There is nothing to send again');
    } else {
      if (!message) throw new Invalid('Write a message first');
      p[channel] = [...p[channel], { role: 'user', text: message, ...(selection && { selection: { path: selection.path, from: selection.from, to: selection.to } }) }].slice(-100);
    }
    Object.assign(p, { [busy]: true, [error]: '' });
    return p[channel].at(-1).text;
  });
  tracked(setId, async (job) => {
    try {
      const { problem } = await find(setId, pid);
      const tutor = await chosen();
      const transcript = problem[channel].slice(-20).map(said);
      const live = !problem.session?.endedAt;
      const r =
        channel === 'assistant'
          ? await ask({ ...tutor, prompt: `${ASSISTANT} ${MODES[mode]} Use Markdown.\n${data({ project: now.code, last_run: now.outcome, selected_code: selection ?? undefined, transcript })}`, schema: assistantSchema[mode], signal: job.signal })
          : await ask({
              ...tutor,
              prompt: `${problem.kind === 'project' && live ? PROJECT_INTERVIEWER : RUNS.includes(problem.kind) && live ? INTERVIEWER : PARTNER} Use Markdown, with $...$ for math and fenced code where it helps. Never write a dollar sign for money.
new_problem is an empty string unless the candidate asks you to make a new practice problem, for example from a link, an idea or as a variation of this one. Then describe the problem to write in a few self-contained sentences, with no links, and say in reply that it is being made. The app opens links the candidate pasted.
${data({ problem: { title: problem.title, subject: problem.subject, ...known(problem.body) }, candidate_work: worded(now), selected_code: selection ?? undefined, clock: problem.session ?? undefined, ...(problem.kind === 'project' && partCount(problem.body.statement) && { current_part: `${problem.reveal?.shown ?? 1} of ${partCount(problem.body.statement)}`, parts_opened: partTimes(problem) }), ai_assistant_transcript: problem.assistant?.slice(-10).map(said), transcript })}${seen(now.drawing)}`,
              images: now.drawing ? [now.drawing.png] : [],
              schema: chatSchema,
              signal: job.signal,
            });
      // Links come from the candidate's own words only. A page or a reply must not be able to choose what gets opened.
      const problemId = r.new_problem?.trim() ? await addProblem(setId, { request: question, guidance: dropLinks(r.new_problem), subject: '', links: findLinks(question) }) : undefined;
      // Edits only become files when the candidate accepts them, and only plain paths outside the hidden tests get that far.
      const edits = (r.edits ?? []).filter((e) => plainPath(e.path) && !e.path.startsWith('hidden/') && typeof e.content === 'string' && e.content.length <= PROJECT_LIMIT).slice(0, 12).map((e) => ({ id: randomUUID(), path: e.path, content: e.content, status: 'pending' }));
      await updateProblem(setId, pid, (p) => void Object.assign(p, { [channel]: [...p[channel], { role: 'assistant', text: r.reply, problemId, ...(edits.length && { edits }) }], [busy]: false }));
    } catch (e) {
      if (job.signal.aborted) return;
      await updateProblem(setId, pid, (p) => void Object.assign(p, { [busy]: false, [error]: e.message }));
    }
  });
}

const size = (c) => JSON.stringify(c.args).length;
async function codeEvidence({ body }, { language, code }) {
  const { signature, compare, cases, exampleCount } = body;
  const all = await runCode({ language, code, signature, cases, compare });
  const order = cases.map((c, i) => ({ c, i, ok: all.results[i].status === 'pass' }));
  const failing = order.filter((x) => !x.ok).sort((a, b) => size(a.c) - size(b.c));
  const examples = order.slice(0, exampleCount).sort((a, b) => size(b.c) - size(a.c));
  const { c, i } = failing[0] ?? examples.find((x) => size(x.c) <= 300) ?? examples.at(-1);
  const base = { language, code, input: Object.fromEntries(signature.params.map((p, k) => [p.name, c.args[k]])), expected: c.expected, actual: all.results[i].actual, error: all.compileError ?? all.results[i].error, passed: order.length - failing.length, total: order.length };
  if (language !== 'python' || all.compileError) return { ...base, trace: [] };
  const one = await runCode({ language, code, signature, cases: [c], compare, trace: true });
  return { ...base, trace: one.trace ?? [], trace_cut: one.traceCut ? 'The recording stops at 400 events, before the run ended. Say so and do not draw the end of the run as if it was recorded.' : undefined };
}

const visualSchema = obj({ summary: str, html: str });
const KIT = `html is a fragment placed in <div id="stage">, at most 60,000 characters, quality over brevity: an optional <style>, markup, then one <script>. It runs in a locked frame with no network, storage, links, forms, dialogs or external files. Anything else fails. The frame is 340 to 1300px wide and follows the light or dark theme.
Available on window.Stage (call them after your markup):
Stage.data {language, code, input, expected, actual, error, trace, answer, working, correct}. Only the fields that apply exist.
Stage.trace list of {event:"line"|"return"|"exception", line, function, vars, value?}. A "line" event shows the variables just before that line runs. Sets appear as {"set":[...]} and deques as {"deque":[...]}.
Stage.player(root, {count, draw(i, previous), caption(i) -> string, interval}) adds play, step and scrub controls below whatever you drew in root.
Stage.cells(root, {values, marks:[index], dim:[index], pointers:{name:index}, label}) -> {update(sameOptions)} an animated row of boxes.
Stage.code(root) -> {line(n)} shows the candidate's code and highlights one line.
Stage.slider(root, {label, min, max, step, value, unit, oninput(v)}) -> {value, set(v)}. oninput runs once at creation, so create plots first.
Stage.plot(root, {x:[a,b], y:[a,b], xLabel, yLabel, series:[{fn|points, label, color, area, dashed, bars}], marks:[{x,y,label}], bands:[{from,to,color}]}) -> {update(allOptionsAgain)}. x and y are optional when points are given.
Stage.math(root, tex, display) renders TeX. Stage.math(null, tex) returns an element.
Stage.svg(tag, attrs, ...children), Stage.el(tag, attrs, ...children), Stage.tween(from, to, ms, step), Stage.num(v), Stage.colors.{text, second, muted, line, card, raised, mark, markSoft, blue, green, red, orange, teal}. Attributes named onclick and so on take functions.
root is an element or a selector.`;
const STYLE = `Start by choosing the picture: the physical or spatial thing a great teacher would draw so the idea is seen rather than read. If covering the drawing leaves the explanation intact, choose another picture. One large drawing fills most of the frame, at least 280px tall and the full width, made of many real marks (hundreds of dies, branches, samples, cells, charges, bonds or field lines when the subject has them) rather than boxes with text and formulas in them. Formulas and numbers are small labels attached to the parts of the drawing they describe.
It moves for a reason. Use Stage.player when there is an order of events, sliders when there are quantities, or both. Every change animates from the old state to the new one through Stage.tween, CSS transitions on transform and opacity, or keyed elements that move. Dragging a slider redraws the picture itself, not only numbers. Hovering or focusing a mark may reveal its value.
Use one scale function per axis for the ticks, the marks and the labels, so a line labelled 12 sits at 12 on the axis. Size bars and curves so they fill the space they are given from the first step.
Finish: precise geometry, aligned edges, generous space, thin even strokes, labels that never overlap lines, marks or each other. SVG text that must sit over the drawing gets class "halo". Every color or shape that carries meaning is named by a direct label or a small key, and differs in shape as well as color. Colors only from Stage.colors or the CSS variables --text, --second, --muted, --line, --card, --raised, --mark, --mark-soft, --blue, --green, --red, --orange, --teal. Yellow marks only the one thing that matters at this moment, and text on it is #171717. Do not set font-family. Text is 14px or larger, sentence case, and at most 60 words are visible at once outside the code. No gradients, shadows, emoji, exclamation marks, uppercase labels, outer card, page title or closing summary. Everything fits the width without sideways scrolling, at 340px too. Controls have labels and work from the keyboard.`;
const IDEAS = `Examples of the level expected. Yield: the round wafer with every die drawn, defects landing one by one, good dies filling a tray that prices them. Expected value: thousands of seeded games dropping into a growing histogram while the running average settles on the line. Two pointers: bars whose heights are the values, pointers sliding beneath, the discarded region fading. Recursion: the call tree growing and returning values up its branches. A differential equation: the slope field with the solution being traced and the sample instant marked. Diffusion: dopant dots spreading into the wafer beside the profile they form. Equilibrium: particles in a vessel beside the species curve. A compensated amplifier: the schematic with signal swinging at each node beside the Bode plot, its poles draggable. System design: requests travelling between services and queues filling when one slows. Choose what fits this exact problem and this exact solution.`;

function visualPrompt(problem, evidence, fix) {
  const rules =
    problem.kind === 'code' || problem.kind === 'sql'
      ? evidence.trace.length
        ? 'Step through Stage.trace, which was recorded from the real run. Never invent values. Show the code with Stage.code next to the picture and keep both in step. Group consecutive trace events into meaningful steps when there are more than 40. If the run is wrong or fails, make the exact step where it goes wrong unmistakable and show what was expected.'
        : 'No line by line recording exists for this run, so work the real input through the code by hand, stay faithful to what the code does, and end at the real result. If it does not compile or is unfinished, show the idea it is missing on the real input.'
      : problem.kind === 'ui'
        ? 'Show how their interface behaves: its states, what each user action changes, the path of events, and the layout boxes that matter. Make the first failing check or missing state unmistakable. Rebuild their interface in the picture rather than describing it.'
        : 'Show the reasoning in the working, in order, and make the first place it departs from a correct argument unmistakable. Let the candidate vary the givens with sliders that start at the values in the statement, recompute from the real relations, and mark both their answer and the correct one. If they drew something, redraw it cleanly as the base of the picture. If they wrote and drew nothing yet, show the setup and how the quantities relate without stating the final answer.';
  return `Build one interactive picture that explains this candidate's own solution to them. ${IDEAS}
${rules}
${STYLE}
${KIT}
summary is two or three plain sentences: what their solution does, whether it holds up and why, and for code its time and space cost. Use $...$ for math.
${data({ problem: { title: problem.title, subject: problem.subject, ...known(problem.body) }, candidate: evidence })}
${fix ? `The previous version failed in the frame with the error below. Return the whole corrected version.\n${data({ error: fix.error, previous_html: fix.html })}` : ''}`;
}

// The prompt gets a shortened trace. The frame gets all of it.
const brief = (e) => {
  if (!e.trace?.length) return e;
  const trace = [...e.trace];
  while (JSON.stringify(trace).length > 30000) trace.splice(Math.floor(trace.length / 2), Math.ceil(trace.length / 10));
  return { ...e, trace, trace_events: e.trace.length, trace_shortened: trace.length < e.trace.length };
};

function draw(setId, pid, evidenceOf, fix, drawing) {
  const put = (patch) => updateProblem(setId, pid, (p) => void Object.assign(p.visual, patch));
  return tracked(setId, async (job) => {
    try {
      const { problem } = await find(setId, pid);
      const evidence = await evidenceOf(problem);
      await put({ step: fix ? 'Fixing the drawing' : 'Drawing' });
      const tutor = await chosen();
      const r = await ask({ ...tutor, prompt: visualPrompt(problem, brief(evidence), fix) + seen(drawing), images: drawing ? [drawing.png] : [], schema: visualSchema, signal: job.signal });
      if (!r.html.trim()) throw new ProviderError('badjson', 'The model did not return a drawing. Try again.');
      if (r.html.length > HTML_LIMIT) throw new ProviderError('badjson', 'The drawing was too large. Try again.');
      await put({ status: 'ready', step: null, error: '', data: evidence, summary: r.summary, html: r.html, recorded: evidence.trace?.length ? (evidence.trace_cut ? 'start' : 'all') : '', repaired: Boolean(fix), version: Date.now() });
    } catch (e) {
      if (job.signal.aborted) return;
      await updateProblem(setId, pid, (p) => void Object.assign(p.visual, { status: p.visual.html ? 'ready' : 'failed', step: null, error: e.message, ...(fix && { repaired: true }) }));
    }
  });
}

/** Runs the candidate's work, then draws it in the background. */
export async function analyze(setId, pid, body) {
  const now = work(body);
  await updateProblem(setId, pid, (p) => {
    ready(p);
    if (p.visual?.status === 'working') throw new Invalid('The drawing is already being made');
    if (p.kind === 'sql') now.language = 'sql';
    if (p.kind === 'code' && !LANGUAGES.includes(now.language)) throw new Invalid('Choose a language');
    if (p.kind === 'project') throw new Invalid('Analysis is not available for codebase problems');
    p.visual = { ...p.visual, status: 'working', step: RUNS.includes(p.kind) ? 'Running your code' : 'Reading your work', error: '' };
  });
  draw(setId, pid, (p) => (RUNS.includes(p.kind) ? codeEvidence(p, now) : p.kind === 'ui' ? { language: 'html', code: now.code, outcome: now.outcome } : { answer: now.answer, working: now.working, outcome: now.outcome, drawing: now.drawing?.outline, correct: p.body.answer, unit: p.body.unit }), null, now.drawing);
}

/** One automatic second try when the frame reports an error. */
export async function repair(setId, pid, body) {
  const error = need(body.error, 'Error', 1000);
  const { html, evidence } = await updateProblem(setId, pid, (p) => {
    if (p.visual?.status !== 'ready') throw new Invalid('There is no drawing to fix');
    if (p.visual.repaired) throw new Invalid('The drawing still has an error. Draw it again.');
    Object.assign(p.visual, { status: 'working', step: 'Fixing the drawing' });
    return { html: p.visual.html, evidence: p.visual.data };
  });
  draw(setId, pid, () => evidence, { html, error });
}

export async function visualOf(setId, pid) {
  const { problem } = await find(setId, pid);
  return problem?.visual?.status === 'ready' ? problem.visual : null;
}
