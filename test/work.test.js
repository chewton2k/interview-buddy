import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { brief, calls, clearCalls, intake, replies, written } from './stub/setup.js';
import { createSet, grade } from '../src/generate.js';
import { ask } from '../src/providers.js';
import { checkDrawing, deleteSet, home, readDrawing, readSet, saveDrawing } from '../src/store.js';
import { analyze, chat } from '../src/tutor.js';
import { toBlocks, toMarkdown } from '../ui/blocks.js';
import { outline, shapeAt } from '../ui/outline.js';

const png = fs.readFileSync(new URL('./stub/dot.png', import.meta.url)).toString('base64');
const drawing = { png, outline: 'rectangle "API"' };
async function made() {
  replies([{ match: 'Plan a', reply: { problems: [brief({ kind: 'written' })] } }, { match: 'Write one', reply: written() }]);
  const { id } = await createSet(intake);
  for (;;) {
    const s = await readSet(id);
    if (s.problems[0]?.status === 'ready') return { id, pid: s.problems[0].id };
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('equations and text survive the editor', () => {
  const md = 'First $x$\nline\n\n$$\\frac{a}{b}$$\n\nthen';
  assert.deepEqual(toBlocks(md).map((b) => [b.type, b.text]), [['text', 'First $x$\nline'], ['math', '\\frac{a}{b}'], ['text', 'then']]);
  for (const s of [md, '', 'plain', '$$x$$', '$$a$$\n\n$$b$$', 'costs $5 and $6', 'a\n\nb', 'inline $$b$$ stays', 'row \\\\[2pt] break']) assert.equal(toMarkdown(toBlocks(s)), s, s);
  assert.deepEqual(toBlocks('\\[y^2\\]').map((b) => b.type), ['math']);
  assert.equal(toMarkdown([{ type: 'math', text: ' ' }, { type: 'text', text: '' }]), '');
  assert.equal(new Set(toBlocks('a\n$$b$$\nc').map((b) => b.id)).size, 3);
});

test('a drawing is described by its shapes and connections', () => {
  const els = [
    { id: 'a', type: 'rectangle' },
    { id: 'ta', type: 'text', containerId: 'a', text: 'API' },
    { id: 'b', type: 'ellipse' },
    { id: 'tb', type: 'text', containerId: 'b', text: 'Queue' },
    { id: 'r', type: 'arrow', startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' } },
    { id: 'tr', type: 'text', containerId: 'r', text: 'writes' },
    { id: 'l', type: 'line', startBinding: null, endBinding: { elementId: 'gone' } },
    { id: 'n', type: 'text', containerId: null, text: 'note' },
    { id: 'f', type: 'freedraw' },
    { id: 'f2', type: 'freedraw' },
    { id: 'x', type: 'diamond', isDeleted: true },
  ];
  assert.equal(outline(els), 'rectangle "API"\nellipse "Queue"\narrow from "API" to "Queue" labelled "writes"\nline from nothing to nothing\ntext "note"\nfreehand strokes');
  assert.equal(outline([]), '');
});

test('a click inside a shape finds the smallest one around it', () => {
  const shape = (id, type, x, y, width, height, more) => ({ id, type, x, y, width, height, angle: 0, isDeleted: false, locked: false, ...more });
  const at = (list, x, y) => shapeAt(list, { x, y })?.id;
  const nested = [shape('inner', 'rectangle', 40, 40, 20, 20), shape('outer', 'rectangle', 0, 0, 100, 100)];
  assert.equal(at(nested, 50, 50), 'inner');
  assert.equal(at(nested, 5, 5), 'outer');
  assert.equal(at(nested, 101, 50), undefined);
  assert.equal(at([shape('d', 'diamond', 0, 0, 100, 100)], 10, 10), undefined);
  assert.equal(at([shape('d', 'diamond', 0, 0, 100, 100)], 50, 10), 'd');
  assert.equal(at([shape('e', 'ellipse', 0, 0, 100, 100)], 5, 5), undefined);
  assert.equal(at([shape('e', 'ellipse', 0, 0, 100, 100)], 20, 20), 'e');
  const tall = [shape('r', 'rectangle', 40, 0, 20, 100, { angle: Math.PI / 2 })];
  assert.equal(at(tall, 5, 50), 'r');
  assert.equal(at(tall, 50, 5), undefined);
  assert.equal(at([shape('l', 'rectangle', 0, 0, 9, 9, { locked: true }), shape('x', 'rectangle', 0, 0, 9, 9, { isDeleted: true }), shape('a', 'arrow', 0, 0, 9, 9)], 4, 4), undefined);
});

test('drawings are saved beside the set, checked and deleted with it', async () => {
  const { id, pid } = await made();
  assert.deepEqual(await readDrawing(id, pid), { elements: [] });
  await saveDrawing(id, pid, [{ id: 'a' }]);
  assert.deepEqual(await readDrawing(id, pid), { elements: [{ id: 'a' }] });
  await assert.rejects(saveDrawing(id, pid, 'x'), /too large|save/);
  await assert.rejects(saveDrawing(id, '00000000-0000-4000-8000-00000000abcd', []));
  await assert.rejects(saveDrawing(id, pid, ['x'.repeat(4 << 20)]), /too large/);
  for (const bad of ['../x', '', 'nope']) await assert.rejects(readDrawing(id, bad));
  const folder = path.join(home(), 'drawings', id);
  assert.ok(fs.existsSync(folder));
  await deleteSet(id);
  assert.equal(fs.existsSync(folder), false);
  await assert.rejects(saveDrawing(id, pid, []));
  assert.equal(checkDrawing(undefined), undefined);
  for (const bad of [null, {}, { png: 5, outline: '' }, { png: 'PHN2Zz4=', outline: '' }, { png: `${png}"`, outline: '' }, { png, outline: 'x'.repeat(10001) }, { png: png.padEnd((4 << 20) + 1, 'A'), outline: '' }]) assert.throws(() => checkDrawing(bad));
});

test('both accounts receive the picture', async () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  replies([{ match: 'look here', reply: { ok: true } }]);
  for (const provider of ['claude', 'codex']) {
    clearCalls();
    assert.deepEqual(await ask({ provider, model: '', effort: '', prompt: 'look here', schema, images: [png] }), { ok: true });
    const [c] = calls();
    if (provider === 'codex') assert.ok(c.args.includes('--image=0.png'));
    else {
      const { message } = JSON.parse(c.prompt);
      assert.deepEqual(message.content.map((x) => x.type), ['image', 'text']);
      assert.equal(message.content[0].source.data, png);
      assert.ok(c.args.join(' ').includes('--input-format stream-json --output-format stream-json'));
    }
  }
});

test('grading, chat and analysis see the drawing', async () => {
  const { id, pid } = await made();
  const { problems } = await readSet(id);
  replies([
    { match: 'Grade this', reply: { summary: 's', points: [{ mark: 'met', note: '' }, { mark: 'met', note: '' }] } },
    { match: 'last message in the transcript', reply: { reply: 'r', new_problem: '' } },
    { match: 'interactive picture', reply: { summary: 's', html: '<p>x</p>' } },
  ]);
  clearCalls();
  await grade({ problem: problems[0], answer: '', outcome: '', drawing });
  await chat(id, pid, { message: 'is my design fine?', drawing });
  await analyze(id, pid, { answer: '', working: '', drawing });
  for (let i = 0; calls().length < 3 && i < 200; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls().length, 3);
  for (const c of calls()) {
    assert.ok(c.prompt.includes(png) && c.prompt.includes('rectangle') && c.prompt.includes('attached image'));
  }
  await assert.rejects(chat(id, pid, { message: 'x', drawing: { png: 'bad' } }), /could not be read/);
});

test('line diffs keep shared lines, mark changes and fold distant context', async () => {
  const { diffLines, fold } = await import('../ui/diff.js');
  const ops = (a, b) => diffLines(a, b).map((l) => l.op + l.t).join('|');
  assert.equal(ops('a\nb\nc', 'a\nx\nc'), ' a|-b|+x| c');
  assert.equal(ops(null, 'new'), '+new');
  assert.equal(ops('same', 'same'), ' same');
  const long = Array.from({ length: 20 }, (_, i) => `l${i}`);
  const folded = fold(diffLines(long.join('\n'), [...long.slice(0, 19), 'end'].join('\n')));
  assert.deepEqual(folded[0], { skip: 16 });
  assert.deepEqual(folded.slice(1).map((l) => l.op), [' ', ' ', ' ', '-', '+']);
});

test('replies are read aloud as plain sentences', async () => {
  const { spoken, sentences } = await import('../ui/speak.js');
  assert.equal(spoken('**Good.** Try `two_sum` in $O(n \\log n)$, see [docs](https://x.y).\n```py\nx = 1\n```\n- Then test it'), 'Good. Try two sum in O(n log n), see docs. (see the code in the chat) Then test it');
  assert.equal(spoken('Is $i \\le n$? See https://a.b/c'), 'Is i at most n? See a link');
  assert.deepEqual(sentences('One. Two? Three'), ['One.', 'Two?', 'Three']);
  assert.ok(sentences('word '.repeat(100).trim(), 50).every((s) => s.length <= 50));
});
