/** @jsxImportSource react */
// Loaded only when someone draws. The canvas is React, the rest of the page is Preact, so it gets its own root.
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import { createRoot } from 'react-dom/client';
import { outline } from './outline.js';

const sheet = document.createElement('link');
Object.assign(sheet, { rel: 'stylesheet', href: '/canvas.css' });
const styled = new Promise((done) => (sheet.onload = sheet.onerror = done));
document.head.append(sheet);

const base64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.slice(r.result.indexOf(',') + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** A picture and a description of the drawing, ready to send. */
export async function snapshot(elements) {
  const blob = await exportToBlob({ elements, files: null, mimeType: 'image/png', maxWidthOrHeight: 1400, appState: { exportBackground: true, viewBackgroundColor: '#ffffff' } });
  return { png: await base64(blob), outline: outline(elements) };
}

export async function mount(host, { elements, dark, onChange }) {
  await styled;
  const root = createRoot(host);
  root.render(
    <Excalidraw
      initialData={{ elements, scrollToContent: true, appState: { currentItemFontFamily: 2, currentItemRoughness: 0 } }}
      theme={dark ? 'dark' : 'light'}
      autoFocus={false}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false }, tools: { image: false } }}
      onChange={(list) => onChange(list.filter((e) => !e.isDeleted))}
    />,
  );
  return () => root.unmount();
}
