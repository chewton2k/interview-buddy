import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, Problem, useTheme } from './lib.jsx';

/** The canvas is rebuilt with the current drawing when the theme changes. */
export function Draw(props) {
  const theme = useTheme();
  return <Canvas key={theme} theme={theme} {...props} />;
}

function Canvas({ theme, elements, onChange }) {
  const host = useRef();
  const [state, setState] = useState('loading');
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    let unmount;
    let gone = false;
    import('./canvas.jsx').then(
      async ({ mount }) => {
        if (gone) return;
        unmount = await mount(host.current, { elements, dark: theme === 'dark', onChange: (list) => latest.current(list) });
        if (gone) return unmount();
        setState('ready');
      },
      () => setState('failed'),
    );
    return () => {
      gone = true;
      unmount?.();
    };
  }, []);
  return (
    <div class="draw">
      {state === 'loading' && <p class="row second"><Icon name="load" /> Opening the canvas</p>}
      {state === 'failed' && <Problem>The canvas could not be opened. Reload the page.</Problem>}
      <div class="canvas" ref={host} role="group" aria-label="Drawing canvas" />
    </div>
  );
}
