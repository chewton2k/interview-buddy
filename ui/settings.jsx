import { useEffect, useState } from 'preact/hooks';
import { api, Icon, Problem, useAction, useDebounced, useLoad } from './lib.jsx';

const JOBS = { write: 'Write problems', grade: 'Grade answers' };
const EFFORTS = { '': 'Default', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' };

function Job({ id, choice, providers, onChange }) {
  const models = providers?.find((p) => p.id === choice.provider)?.models ?? [];
  const [typing, setTyping] = useState(false);
  const known = choice.model === '' || models.some((m) => m.id === choice.model);
  const typed = typing || (providers && !known);
  const [ok, setOk] = useState(false);
  const test = useAction(async () => {
    setOk(false);
    await api('POST', '/settings/test', choice);
    setOk(true);
  });
  const change = (patch) => {
    setOk(false);
    onChange({ ...choice, ...patch });
  };
  return (
    <div class="stack tight">
      <h3>{JOBS[id]}</h3>
      <div class="trio">
        <div class="field">
          <label for={`${id}-account`}>Account</label>
          <select
            id={`${id}-account`}
            class="input"
            value={choice.provider}
            onChange={(e) => {
              setTyping(false);
              change({ provider: e.target.value, model: '' });
            }}
          >
            {providers?.map((p) => <option key={p.id} value={p.id}>{p.label}</option>) ?? <option value={choice.provider}>{choice.provider}</option>}
          </select>
        </div>
        <div class="field">
          <label for={`${id}-model`}>Model</label>
          <select
            id={`${id}-model`}
            class="input"
            value={typed ? '\0' : choice.model}
            onChange={(e) => {
              setTyping(e.target.value === '\0');
              if (e.target.value !== '\0') change({ model: e.target.value });
            }}
          >
            <option value="">Account default</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            {!providers && !known && <option value={choice.model}>{choice.model}</option>}
            <option value={'\0'}>Type a model id</option>
          </select>
          {typed && <input class="input mono" aria-label="Model id" autoComplete="off" spellcheck={false} value={choice.model} onInput={(e) => change({ model: e.target.value.trim() })} />}
        </div>
        <div class="field">
          <label for={`${id}-effort`}>Effort</label>
          <select id={`${id}-effort`} class="input" value={choice.effort} onChange={(e) => change({ effort: e.target.value })}>
            {Object.entries(EFFORTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <button class="btn tall" disabled={test.busy} aria-label={`Test ${JOBS[id].toLowerCase()}`} onClick={() => test.run()}>
          {test.busy ? <Icon name="load" /> : ok ? <Icon name="check" /> : null}
          {ok ? 'Works' : 'Test'}
        </button>
      </div>
      <Problem>{test.error}</Problem>
    </div>
  );
}

function Account({ name, detail, ok, good, todo }) {
  return (
    <div class="account">
      <h3>{name}</h3>
      <span class="second">{detail}</span>
      {ok === undefined ? <span /> : <span class={`row ${ok ? 'good' : 'bad'}`}><Icon name={ok ? 'check' : 'x'} />{ok ? good : todo}</span>}
    </div>
  );
}

export function Settings() {
  const { value: saved, error } = useLoad('/settings');
  const { value: status, error: statusError } = useLoad('/status');
  const [settings, setSettings] = useState(null);
  const [note, setNote] = useState('');
  const put = useAction(async (s) => {
    await api('PUT', '/settings', s);
    setNote('Saved');
  });
  const save = useDebounced((s) => put.run(s), 400);
  useEffect(() => void (document.title = 'Settings, Interview Buddy'), []);
  useEffect(() => void (saved && setSettings(saved.settings)), [saved]);
  const change = (id) => (choice) => {
    const next = { ...settings, [id]: choice };
    setSettings(next);
    setNote('');
    save(next);
  };
  const langs = status?.languages;
  return (
    <div class="page narrow">
      <h1>Settings</h1>
      <Problem>{error || statusError || put.error}</Problem>
      <section class="panel" aria-labelledby="models">
        <div class="row between">
          <h2 id="models">Models</h2>
          <span class="small second" role="status">{note}</span>
        </div>
        {settings && Object.keys(JOBS).map((id) => <Job key={id} id={id} choice={settings[id]} providers={status?.providers} onChange={change(id)} />)}
      </section>
      <section class="panel" aria-labelledby="accounts">
        <h2 id="accounts">Accounts on this computer</h2>
        <div>
          {!status && <p class="row second"><Icon name="load" /> Checking</p>}
          {status?.providers.map((p) => (
            <Account key={p.id} name={p.label} ok={p.signedIn} good="Signed in" todo={p.installed ? 'Not signed in' : 'Not installed'} detail={p.signedIn ? `${p.id} ${p.version}` : <>Run <code class="mono">{p.signIn}</code> in a terminal, then reload</>} />
          ))}
        </div>
        <p class="small second">Interview Buddy uses these sign-ins and ignores API keys.</p>
      </section>
      <section class="panel" aria-labelledby="runner">
        <h2 id="runner">Code runner</h2>
        <div>
          {!status && <p class="row second"><Icon name="load" /> Checking</p>}
          {status && <Account name="Sandbox" ok={status.sandbox.ok} good="Working" todo="Not working" detail={status.sandbox.ok ? 'No network and no access to your files' : status.sandbox.detail} />}
          {langs && <Account name="Python" ok={Boolean(langs.python)} good="Ready" todo="Not found" detail={langs.python ?? 'Install Python 3'} />}
          {langs && <Account name="JavaScript" ok good="Ready" detail={`Node ${langs.javascript}`} />}
          {langs && <Account name="C++" ok={Boolean(langs.cpp)} good="Ready" todo="Not found" detail={langs.cpp ? `clang ${langs.cpp}` : <>Run <code class="mono">xcode-select --install</code></>} />}
        </div>
      </section>
    </div>
  );
}
