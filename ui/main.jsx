import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Intake } from './intake.jsx';
import { Icon } from './lib.jsx';
import { ProblemPage } from './problem.jsx';
import { Progress } from './progress.jsx';
import { SetPage, Sets } from './sets.jsx';
import { Settings } from './settings.jsx';

// The canvas reads this as it loads, and would otherwise fetch fonts from another site.
window.EXCALIDRAW_ASSET_PATH = '/';

const ROUTES = [
  [/^#\/new$/, Intake],
  [/^#\/settings$/, Settings],
  [/^#\/progress$/, Progress],
  [/^#\/sets\/([^/]+)\/([^/]+)$/, ProblemPage],
  [/^#\/sets\/([^/]+)$/, SetPage],
  [/^/, Sets],
];

function App() {
  const [hash, setHash] = useState(location.hash);
  const main = useRef();
  const first = useRef(true);
  useEffect(() => {
    const go = () => setHash(location.hash);
    addEventListener('hashchange', go);
    go();
    return () => removeEventListener('hashchange', go);
  }, []);
  useEffect(() => {
    if (!first.current) main.current.focus();
    first.current = false;
    scrollTo(0, 0);
  }, [hash]);
  const [re, Page] = ROUTES.find(([r]) => r.test(hash));
  const params = hash.match(re).slice(1);
  const current = (page) => ((Page === Intake ? null : [Settings, Progress].includes(Page) ? Page : Sets) === page ? 'page' : undefined);
  return (
    <>
      <header class="top">
        <a class="logo" href="#/">
          Interview <span class="mark">Buddy</span>
        </a>
        <nav aria-label="Main">
          <a href="#/" aria-current={current(Sets)}>
            Sets
          </a>
          <a href="#/progress" aria-current={current(Progress)}>
            Progress
          </a>
          <a href="#/settings" aria-current={current(Settings)}>
            Settings
          </a>
        </nav>
        <a class="btn primary" href="#/new" aria-label="New set">
          <Icon name="plus" />
          <span>
            New<span class="long"> set</span>
          </span>
        </a>
      </header>
      <main ref={main} tabIndex={-1}>
        <Page key={hash} params={params} />
      </main>
    </>
  );
}

render(<App />, document.getElementById('app'));
