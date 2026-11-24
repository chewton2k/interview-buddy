import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EFFORTS, MODEL_ID, PROVIDERS } from './providers.js';

export const home = () => process.env.INTERVIEW_BUDDY_HOME ?? path.join(os.homedir(), '.interview-buddy');
const ID = /^[a-f0-9-]{36}$/;
const setFile = (id) => {
  if (!ID.test(id)) throw new NotFound();
  return path.join(home(), 'sets', `${id}.json`);
};
export class NotFound extends Error {}
export class Invalid extends Error {}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(tmp, file);
}
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new NotFound();
    throw e;
  }
}

const chains = new Map();
function locked(key, fn) {
  const next = (chains.get(key) ?? Promise.resolve()).then(fn);
  const tail = next.catch(() => {});
  chains.set(key, tail);
  tail.then(() => chains.get(key) === tail && chains.delete(key));
  return next;
}

export const readSet = async (id) => readJson(setFile(id));
export const updateSet = (id, change) =>
  locked(id, async () => {
    const set = await readSet(id);
    const result = change(set);
    await writeJson(setFile(id), set);
    return result;
  });
export const updateProblem = (id, pid, change) =>
  updateSet(id, (set) => {
    const problem = set.problems.find((p) => p.id === pid);
    if (!problem) throw new NotFound();
    return change(problem);
  });
export async function createSetFile(intake) {
  const set = { id: randomUUID(), createdAt: new Date().toISOString(), intake, status: 'planning', error: null, problems: [] };
  await writeJson(setFile(set.id), set);
  return set;
}
const drawingFile = (id, pid) => {
  if (!ID.test(id) || !ID.test(pid)) throw new NotFound();
  return path.join(home(), 'drawings', id, `${pid}.json`);
};
export const readDrawing = async (id, pid) => {
  const file = drawingFile(id, pid);
  await readSet(id);
  return readJson(file).catch((e) => (e instanceof NotFound ? { elements: [] } : Promise.reject(e)));
};
export const saveDrawing = async (id, pid, elements) => {
  if (!Array.isArray(elements) || JSON.stringify(elements).length > 3 << 20) throw new Invalid('The drawing is too large to save');
  const file = drawingFile(id, pid);
  await locked(id, async () => {
    const { problems } = await readSet(id);
    if (!problems.some((p) => p.id === pid)) throw new NotFound();
    await writeJson(file, { elements });
  });
};
export function checkDrawing(d) {
  if (d === undefined) return undefined;
  if (typeof d?.png !== 'string' || typeof d.outline !== 'string' || d.outline.length > 10000) throw new Invalid('The drawing could not be read');
  if (d.png.length > 4 << 20 || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(d.png)) throw new Invalid('The drawing must be a PNG under 3 MB');
  return { png: d.png, outline: d.outline };
}

export const ensureSet = (id, make) =>
  locked(id, async () => {
    try {
      return await readSet(id);
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
      const set = { id, createdAt: new Date().toISOString(), error: null, problems: [], ...make };
      await writeJson(setFile(id), set);
      return set;
    }
  });
export const deleteSet = (id) =>
  locked(id, async () => {
    await fs.rm(setFile(id)).catch((e) => Promise.reject(e.code === 'ENOENT' ? new NotFound() : e));
    await fs.rm(path.join(home(), 'drawings', id), { recursive: true, force: true });
  });
export async function listSets() {
  const names = await fs.readdir(path.join(home(), 'sets')).catch(() => []);
  const sets = await Promise.all(names.filter((n) => ID.test(n.replace(/\.json$/, ''))).map((n) => readSet(n.slice(0, -5)).catch(() => null)));
  return sets.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const START = { provider: 'claude', model: 'sonnet', effort: '' };
const DEFAULTS = { write: START, grade: START, tutor: { ...START, effort: 'medium' } };
export async function readSettings() {
  try {
    return checkSettings(await readJson(path.join(home(), 'settings.json')));
  } catch (e) {
    if (e instanceof NotFound || e instanceof Invalid || e instanceof SyntaxError) return DEFAULTS;
    throw e;
  }
}
export function checkChoice(c, name = 'model') {
  if (!c || typeof c !== 'object' || !Object.hasOwn(PROVIDERS, c.provider)) throw new Invalid(`Choose an account for ${name}`);
  if (c.model !== '' && !(typeof c.model === 'string' && MODEL_ID.test(c.model))) throw new Invalid(`The model id for ${name} has characters that are not allowed`);
  if (!EFFORTS.includes(c.effort)) throw new Invalid(`Choose an effort for ${name}`);
  return { provider: c.provider, model: c.model, effort: c.effort };
}
export const checkSettings = (s) => ({ write: checkChoice(s?.write, 'writing problems'), grade: checkChoice(s?.grade, 'grading answers'), tutor: checkChoice(s?.tutor ?? s?.grade, 'chat and analysis') });
export async function saveSettings(s) {
  const clean = checkSettings(s);
  await writeJson(path.join(home(), 'settings.json'), clean);
  return clean;
}
