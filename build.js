import fs from 'node:fs';
if (!fs.existsSync('ui/main.jsx')) process.exit(0);
const { build } = await import('esbuild');
fs.rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: { app: 'ui/main.jsx', style: 'ui/style.css' },
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'safari17',
  outdir: 'dist',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.woff2': 'file', '.woff': 'empty', '.ttf': 'empty' },
  assetNames: 'fonts/[name]-[hash]',
});
// The analysis frame has no network, so its script, styles and fonts are inlined by the server.
await build({ entryPoints: { stage: 'ui/stage.js' }, bundle: true, minify: true, format: 'iife', target: 'safari17', outdir: 'dist' });
const face = (name) => {
  const file = `node_modules/@fontsource-variable/atkinson-hyperlegible-${name}/files/atkinson-hyperlegible-${name}-latin-wght-normal.woff2`;
  return `@font-face{font-family:"Atkinson Hyperlegible ${name === 'next' ? 'Next' : 'Mono'} Variable";font-weight:200 800;src:url(data:font/woff2;base64,${fs.readFileSync(file, 'base64')}) format("woff2")}`;
};
fs.writeFileSync('dist/stage.css', `${face('next')}${face('mono')}${fs.readFileSync('ui/stage.css', 'utf8')}`);
fs.copyFileSync('ui/index.html', 'dist/index.html');
