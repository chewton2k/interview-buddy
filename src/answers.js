import { close } from './harness.js';

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
/** Accepts 12, -0.5, 1.2e-3, 3/8, 37.5%. Returns null when the text is not a number. */
export function parseNumber(text) {
  const t = String(text).trim().replace(/[\u2212\u2013]/g, '-').replace(/(\d),(?=\d{3}(\D|$))/g, '$1').replace(/\s*([/%])\s*/g, '$1');
  const percent = t.endsWith('%');
  const parts = (percent ? t.slice(0, -1) : t).split('/');
  if (parts.length > 2 || !parts.every((p) => NUMBER.test(p))) return null;
  const n = (parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(parts[0])) / (percent ? 100 : 1);
  return Number.isFinite(n) ? n : null;
}

export const isPercentUnit = (unit) => /^(%|percent)$/i.test(unit.trim());

/** The answer is read in the problem's unit. A typed % sign is dropped when that unit is already percent. */
export function checkNumber(text, { answer, tolerance, unit }) {
  const n = parseNumber(isPercentUnit(unit) ? String(text).replace(/%\s*$/, '') : text);
  return n === null ? null : close(n, answer, tolerance, 1e-12);
}

/** Finds a quote in the text ignoring case and line wrapping, and returns the words exactly as they appear. */
export function findQuote(text, quote) {
  const words = String(quote).trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 25) return null;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return text.match(new RegExp(pattern, 'i'))?.[0] ?? null;
}
