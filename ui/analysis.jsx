import { useEffect, useRef, useState } from 'preact/hooks';
import { api, Icon, Problem, Prose, useAction } from './lib.jsx';

export function Analysis({ problem, at, analyze, reload }) {
  const { visual } = problem;
  const frame = useRef();
  const [broken, setBroken] = useState('');
  const repair = useAction(async (error) => {
    await api('POST', `${at}/analyze/repair`, { error });
    await reload();
  });
  const ready = visual?.status === 'ready';
  useEffect(() => {
    setBroken('');
    if (!ready) return;
    let seen = false;
    let sizes = 0;
    const listen = (e) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.stage === 'height' && sizes++ < 60) frame.current.style.height = `${Math.min(2400, Math.max(360, Number(e.data.message) || 0))}px`;
      if (e.data?.stage !== 'error' || seen) return;
      seen = true;
      if (visual.repaired) setBroken('Part of this drawing does not work. Draw it again for a new one.');
      else repair.run(String(e.data.message));
    };
    addEventListener('message', listen);
    return () => removeEventListener('message', listen);
  }, [ready, visual?.version]);

  const again = (
    <button class="btn" disabled={analyze.busy || visual?.status === 'working'} onClick={() => analyze.run()}>
      {visual ? 'Draw again' : 'Analyze'}
    </button>
  );
  return (
    <div class="analysis stack">
      <Problem>{analyze.error || repair.error || broken}</Problem>
      {!visual && (
        <>
          <p class="second">See your own solution drawn and explained, step by step, with the values it really produced.</p>
          <div>{again}</div>
        </>
      )}
      {visual?.status === 'working' && (
        <p class="row second">
          <Icon name="load" /> {visual.step}. This can take a few minutes, and you can keep working.
        </p>
      )}
      {visual?.status === 'failed' && (
        <div class="note bad stack">
          <p>{visual.error}</p>
          <div>{again}</div>
        </div>
      )}
      {ready && (
        <>
          <Problem>{visual.error}</Problem>
          <Prose text={visual.summary} />
          <iframe key={visual.version} ref={frame} title="Drawing of your solution" sandbox="allow-scripts" src={`/api${at}/visual?v=${visual.version}`} />
          <div class="row wrap between">
            <span class="small second">{{ all: 'Recorded from your run', start: 'First 400 steps recorded from your run' }[visual.recorded] ?? 'Drawn from your work'}</span>
            <span class="row">
              <button class="btn" onClick={() => frame.current.requestFullscreen?.()}>Full screen</button>
              {again}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
