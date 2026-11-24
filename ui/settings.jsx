import { useEffect, useState } from 'preact/hooks';
import { api, Icon, Problem, useAction, useDebounced, useLoad } from './lib.jsx';

const THEMES = { system: 'Match system', light: 'Light', dark: 'Dark' };

function Account({ name, detail, ok, good, todo }) {
  return (
    <div class="account">
      <h3>{name}</h3>
      <span class="second">{detail}</span>
      <span class={`row ${ok ? 'good' : 'bad'}`}><Icon name={ok ? 'check' : 'x'} />{ok ? good : todo}</span>
    </div>
  );
}

export function Settings() {
  const { value: saved, error } = useLoad('/settings');
  const { value: status, error: statusError } = useLoad('/status');
  const [choice, setChoice] = useState(null);
  const [typing, setTyping] = useState(false);
  const [note, setNote] = useState('');
  const [ok, setOk] = useState(false);
  const [theme, setTheme] = useState(window.theme.choice);
  const put = useAction(async (c) => {
    await api('PUT', '/settings', c);
    setNote('Saved');
  });
  const save = useDebounced((c) => put.run(c), 400);
  const test = useAction(async () => {
    setOk(false);
    await api('POST', '/settings/test', choice);
    setOk(true);
  });
  useEffect(() => void (document.title = 'Settings, Interview Buddy'), []);
  useEffect(() => void (saved && setChoice(saved.settings)), [saved]);
  const change = (next) => {
    setChoice(next);
    setNote('');
    setOk(false);
    save(next);
  };
  const account = choice && status?.providers.find((p) => p.id === choice.provider);
  const models = account?.models ?? [];
  const known = !choice || choice.model === '' || models.some((m) => m.id === choice.model);
  const typed = typing || (status && !known);
  const langs = status?.languages;
  return (
    <div class="page narrow">
      <h1>Settings</h1>
      <Problem>{error || statusError || put.error}</Problem>
      <section class="panel" aria-labelledby="model-title">
        <div class="row between">
          <h2 id="model-title">Model</h2>
          <span class="small second" role="status">{note}</span>
        </div>
        {choice && (
          <>
            <fieldset class="field">
              <legend>Account</legend>
              <div class="chips">
                {[['claude', 'Claude'], ['codex', 'Codex']].map(([id, label]) => (
                  <label class="chip" key={id}>
                    <input
                      type="radio"
                      name="account"
                      checked={choice.provider === id}
                      onChange={() => {
                        setTyping(false);
                        change({ provider: id, model: '' });
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {account && (account.signedIn ? <span class="hint row"><Icon name="check" /> Signed in on this computer, version {account.version}</span> : <span class="hint">{account.installed ? 'Not signed in.' : 'Not installed.'} Run <code class="mono">{account.signIn}</code> in a terminal, then reload</span>)}
            </fieldset>
            <div class="pick">
              <div class="field">
                <label for="model">Model</label>
                <select
                  id="model"
                  class="input"
                  value={typed ? '\0' : choice.model}
                  onChange={(e) => {
                    setTyping(e.target.value === '\0');
                    if (e.target.value !== '\0') change({ ...choice, model: e.target.value });
                  }}
                >
                  <option value="">Account default</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  {!status && !known && <option value={choice.model}>{choice.model}</option>}
                  <option value={'\0'}>Type a model id</option>
                </select>
                {typed && <input class="input mono" aria-label="Model id" autoComplete="off" spellcheck={false} value={choice.model} onInput={(e) => change({ ...choice, model: e.target.value.trim() })} />}
              </div>
              <button class="btn tall" disabled={test.busy} aria-label="Test this model" onClick={() => test.run()}>
                {test.busy ? <Icon name="load" /> : ok ? <Icon name="check" /> : null}
                {ok ? 'Works' : 'Test'}
              </button>
            </div>
            <Problem>{test.error}</Problem>
            <p class="small second">Used for everything: writing problems, the interviewer, feedback and analysis. Interview Buddy uses your sign-in and ignores API keys.</p>
          </>
        )}
      </section>
      <section class="panel" aria-labelledby="look">
        <h2 id="look">Appearance</h2>
        <div class="chips" role="radiogroup" aria-labelledby="look">
          {Object.entries(THEMES).map(([id, label]) => (
            <label class="chip" key={id}>
              <input
                type="radio"
                name="theme"
                checked={theme === id}
                onChange={() => {
                  window.theme.set(id);
                  setTheme(id);
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
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
