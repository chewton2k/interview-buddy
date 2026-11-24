import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Intake } from './intake.jsx';
import { Icon } from './lib.jsx';
import { ProblemPage } from './problem.jsx';
import { SetPage, Sets } from './sets.jsx';
import { Settings } from './settings.jsx';

const ROUTES = [
  [/^#\/new$/, Intake],
  [/^#\/settings$/, Settings],
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
    return () => removeEventListener('hashchange', go);
  }, []);
  useEffect(() => {
    if (!first.current) main.current.focus();
    first.current = false;
    scrollTo(0, 0);
  }, [hash]);
  const [re, Page] = ROUTES.find(([r]) => r.test(hash));
  const params = hash.match(re).slice(1);
  const settings = Page === Settings;
  return (
    <>
      <header class="top">
        <a class="logo" href="#/">
          Interview <span class="mark">Buddy</span>
        </a>
        <nav aria-label="Main">
          <a href="#/" aria-current={settings || Page === Intake ? undefined : 'page'}>
            Sets
          </a>
          <a href="#/settings" aria-current={settings ? 'page' : undefined}>
            Settings
          </a>
        </nav>
        <a class="btn primary" href="#/new">
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
