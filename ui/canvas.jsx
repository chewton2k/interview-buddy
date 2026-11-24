/** @jsxImportSource react */
// Loaded only when someone draws. The canvas is React, the rest of the page is Preact, so it gets its own root.
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import { createRoot } from 'react-dom/client';
import { outline, shapeAt } from './outline.js';

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

export async function mount(host, { elements, onChange }) {
  await styled;
  const root = createRoot(host);
  let canvas;
  // A shape without a fill can only be picked by its edge, so a click inside it picks it here, after the canvas has handled the click.
  const pickInside = (tool, { origin, drag }, { shiftKey }) => {
    if (tool.type !== 'selection' || drag.hasOccurred || shiftKey) return;
    setTimeout(() => {
      const { selectedElementIds, editingTextElement, editingGroupId } = canvas.getAppState();
      const shape = !editingTextElement && !editingGroupId && !Object.keys(selectedElementIds).length && shapeAt(canvas.getSceneElements(), origin);
      if (!shape) return;
      const group = shape.groupIds.at(-1);
      const picked = group ? canvas.getSceneElements().filter((e) => e.groupIds.includes(group)) : [shape];
      canvas.updateScene({ appState: { selectedElementIds: Object.fromEntries(picked.map((e) => [e.id, true])), selectedGroupIds: group ? { [group]: true } : {} } });
    });
  };
  root.render(
    <Excalidraw
      initialData={{ elements, scrollToContent: true, appState: { viewBackgroundColor: '#f7f7f4', currentItemFontFamily: 2, currentItemRoughness: 0 } }}
      theme="light"
      excalidrawAPI={(api) => {
        canvas = api;
        api.onPointerUp(pickInside);
      }}
      autoFocus={false}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false }, tools: { image: false } }}
      onChange={(list) => onChange(list.filter((e) => !e.isDeleted))}
    />,
  );
  return () => root.unmount();
}
