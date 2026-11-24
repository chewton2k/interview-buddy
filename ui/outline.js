/** Describes a drawing in words, so a model can read the structure as well as see the picture. */
export function outline(elements) {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const labels = new Map();
  for (const e of live) if (e.type === 'text' && e.containerId) labels.set(e.containerId, e.text);
  const name = (id) => {
    const e = byId.get(id);
    return e ? `"${labels.get(id) ?? e.text ?? e.type}"` : 'nothing';
  };
  const lines = [];
  for (const e of live) {
    if (e.type === 'text') {
      if (!byId.has(e.containerId)) lines.push(`text "${e.text}"`);
    } else if (e.type === 'arrow' || e.type === 'line') {
      const label = labels.get(e.id);
      lines.push(`${e.type} from ${name(e.startBinding?.elementId)} to ${name(e.endBinding?.elementId)}${label ? ` labelled "${label}"` : ''}`);
    } else if (e.type === 'freedraw') {
      if (!lines.includes('freehand strokes')) lines.push('freehand strokes');
    } else lines.push(`${e.type} ${name(e.id)}`);
  }
  return lines.join('\n').slice(0, 8000);
}

/** The smallest unlocked box, diamond or ellipse around a point. */
export function shapeAt(elements, { x, y }) {
  const reach = { rectangle: Math.max, diamond: (a, b) => a + b, ellipse: Math.hypot };
  const around = (e) => {
    const [dx, dy] = [x - e.x - e.width / 2, y - e.y - e.height / 2];
    const [cos, sin] = [Math.cos(-e.angle), Math.sin(-e.angle)];
    return reach[e.type]?.(Math.abs(dx * cos - dy * sin) / (e.width / 2), Math.abs(dx * sin + dy * cos) / (e.height / 2)) <= 1;
  };
  return elements.filter((e) => !e.isDeleted && !e.locked && around(e)).sort((a, b) => a.width * a.height - b.width * b.height)[0];
}
