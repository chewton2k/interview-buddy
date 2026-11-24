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
fs.copyFileSync('ui/index.html', 'dist/index.html');
