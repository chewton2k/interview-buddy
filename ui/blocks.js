// Work is stored as Markdown. Display equations become their own blocks in the editor.
let next = 0;
export const block = (type, text = '') => ({ id: ++next, type, text });

export function toBlocks(markdown) {
  const parts = markdown.replace(/^\\\[([\s\S]*?)\\\]$/gm, '$$$$$1$$$$').split(/^\$\$([\s\S]+?)\$\$$/m);
  const list = parts.map((p, i) => (i % 2 ? block('math', p.trim()) : block('text', p.replace(/^\n+|\n+$/g, '')))).filter((b, i, all) => b.type === 'math' || b.text || all.length === 1);
  return list.length ? list : [block('text')];
}
export const toMarkdown = (blocks) =>
  blocks
    .filter((b) => b.text.trim())
    .map((b) => (b.type === 'math' ? `$$${b.text.trim()}$$` : b.text))
    .join('\n\n');
