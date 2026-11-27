/** Line diff by longest common subsequence. `before` null means a new file. Ops: ' ' same, '-' removed, '+' added. */
export function diffLines(before, after) {
  const x = before === null ? [] : before.split('\n');
  const y = after.split('\n');
  const [n, m] = [x.length, y.length];
  // shortcut: whole-file replace above about 1400 x 1400 lines, which codebase problems never reach.
  if (n * m > 2e6) return [...x.map((t) => ({ op: '-', t })), ...y.map((t) => ({ op: '+', t }))];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let [i, j] = [0, 0];
  while (i < n && j < m) {
    if (x[i] === y[j]) (out.push({ op: ' ', t: x[i] }), i++, j++);
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', t: x[i++] });
    else out.push({ op: '+', t: y[j++] });
  }
  while (i < n) out.push({ op: '-', t: x[i++] });
  while (j < m) out.push({ op: '+', t: y[j++] });
  return out;
}

/** Keeps `context` unchanged lines around each change and folds the rest into {skip: count}. */
export function fold(lines, context = 3) {
  const near = lines.map(() => false);
  lines.forEach((l, k) => {
    if (l.op === ' ') return;
    for (let d = Math.max(0, k - context); d <= Math.min(lines.length - 1, k + context); d++) near[d] = true;
  });
  const out = [];
  lines.forEach((l, k) => {
    if (near[k]) out.push(l);
    else if (out.at(-1)?.skip) out.at(-1).skip++;
    else out.push({ skip: 1 });
  });
  return out;
}
