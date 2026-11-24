import fs from 'node:fs';
if (!fs.existsSync('ui/main.jsx')) process.exit(0);
const { build } = await import('esbuild');
// The canvas lists a font CDN as a second source. The page policy blocks it anyway, so it is dropped to keep the console clean.
const localFonts = {
  name: 'local-fonts',
  setup: (b) =>
    b.onLoad({ filter: /@excalidraw\/excalidraw\/dist\/prod\/.*\.js$/ }, ({ path }) => ({
      contents: fs.readFileSync(path, 'utf8').replace(/return (\w+)\.push\(new URL\(\w+,\w+\.ASSETS_FALLBACK_URL\)\),\1\}/, 'return $1}'),
      loader: 'js',
    })),
};
fs.rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: { app: 'ui/main.jsx', style: 'ui/style.css', canvas: 'node_modules/@excalidraw/excalidraw/dist/prod/index.css' },
  bundle: true,
  minify: true,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' },
  conditions: ['production'],
  target: 'safari17',
  plugins: [localFonts],
  outdir: 'dist',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.woff2': 'file', '.woff': 'empty', '.ttf': 'empty' },
  logOverride: { 'empty-import-meta': 'silent' },
  assetNames: 'fonts/[name]-[hash]',
});
// The analysis frame has no network, so its script, styles and fonts are inlined by the server.
await build({ entryPoints: { stage: 'ui/stage.js' }, bundle: true, minify: true, format: 'iife', target: 'safari17', outdir: 'dist' });
const face = (name) => {
  const file = `node_modules/@fontsource-variable/atkinson-hyperlegible-${name}/files/atkinson-hyperlegible-${name}-latin-wght-normal.woff2`;
  return `@font-face{font-family:"Atkinson Hyperlegible ${name === 'next' ? 'Next' : 'Mono'} Variable";font-weight:200 800;src:url(data:font/woff2;base64,${fs.readFileSync(file, 'base64')}) format("woff2")}`;
};
fs.writeFileSync('dist/stage.css', `${face('next')}${face('mono')}${fs.readFileSync('ui/stage.css', 'utf8')}`);
for (const page of ['index.html', 'preview.html']) fs.copyFileSync(`ui/${page}`, `dist/${page}`);
// The canvas and the equation editor load their own fonts. The 12 MB Chinese handwriting font is left out.
fs.cpSync('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'dist/fonts', { recursive: true, filter: (f) => !f.includes('Xiaolai') });
fs.cpSync('node_modules/mathlive/fonts', 'dist/fonts/math', { recursive: true });
