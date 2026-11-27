import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brief, calls, clearCalls, intake, replies, written } from './stub/setup.js';
import { createSet } from '../src/generate.js';
import { buildReport, progressStats, readReport } from '../src/progress.js';
import { readSet, updateProblem } from '../src/store.js';

test('weak spots come from every attempt and link back to the problems', async () => {
  assert.deepEqual(await progressStats(), []);
  assert.equal(await buildReport(), null);
  assert.equal(await readReport(), null);

  replies([{ match: 'Plan a', reply: { problems: [brief({ kind: 'written', subject: 'System design' }), brief({ kind: 'written', title: 'Second' })] } }, { match: 'Write one', reply: written() }]);
  const { id } = await createSet({ ...intake, subjects: ['System design', 'Coding'], count: 2 });
  let set;
  for (;;) {
    set = await readSet(id);
    if (set.problems.length === 2 && set.problems.every((p) => p.status === 'ready')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const [a, b] = set.problems;
  await updateProblem(id, a.id, (p) => Object.assign(p, { progress: 'tried', feedback: { summary: 'Missed caching.', score: 0.5, at: '2026-01-02T00:00:00Z', points: [{ point: 'Is right', mark: 'met', note: '' }, { point: 'Is fast', mark: 'missed', note: 'No cache.' }] } }));
  await updateProblem(id, b.id, (p) => void (p.progress = 'open'));
  assert.equal((await progressStats()).length, 1, 'open problems are not attempts');
  await updateProblem(id, b.id, (p) => void (p.progress = 'solved'));

  assert.deepEqual(await progressStats(), [
    { subject: 'Coding', tried: 1, solved: 1, graded: 0, average: null },
    { subject: 'System design', tried: 1, solved: 0, graded: 1, average: 0.5 },
  ]);

  clearCalls();
  replies([{ match: 'You coach', reply: { overview: 'Good start.', strengths: ['Clear'], plan: ['Practice caching'], areas: [{ name: 'Caching', subject: 'System design', evidence: 'You skipped it.', practice: 'Design a cache, like https://example.com/x', problems: [1, 1, 0.5, 7, -1] }] } }]);
  const report = await buildReport();
  const sent = calls()[0].prompt;
  assert.match(sent, /No cache\./);
  assert.match(sent, /Missed caching\./);
  assert.doesNotMatch(sent, /"Is right"/, 'met points are left out');
  assert.equal(report.count, 2, 'newest first, so the graded one from January is index 1');
  assert.equal(report.areas[0].practice, 'Design a cache, like');
  assert.deepEqual(report.areas[0].problems, [{ setId: id, id: a.id, title: a.title }]);
  assert.deepEqual(await readReport(), report);
});
