import { useEffect, useState } from 'preact/hooks';
import { api, modelName, Problem, useAction, useLoad } from './lib.jsx';

const START = { company: '', role: '', posting: '', rounds: '', subjects: [], level: 'New grad', count: 6 };

const kept = () => {
  try {
    return { ...START, ...JSON.parse(sessionStorage.getItem('intake')) };
  } catch {
    return START;
  }
};
const keep = (form) => {
  try {
    sessionStorage.setItem('intake', JSON.stringify(form));
  } catch {}
};

export function Intake() {
  const [form, setForm] = useState(kept);
  const [other, setOther] = useState(null);
  const { value: options } = useLoad('/options');
  const { value: saved } = useLoad('/settings');
  const { value: status } = useLoad('/status');
  const account = saved && status?.providers.find((p) => p.id === saved.settings.write.provider);
  const make = useAction(async () => {
    const extra = (other ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const { id } = await api('POST', '/sets', { ...form, subjects: [...form.subjects, ...extra] });
    keep(START);
    location.hash = `#/sets/${id}`;
  });
  useEffect(() => keep(form), [form]);
  useEffect(() => void (document.title = 'New set, Interview Buddy'), []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggle = (s) => setForm({ ...form, subjects: form.subjects.includes(s) ? form.subjects.filter((x) => x !== s) : [...form.subjects, s] });

  return (
    <div class="page">
      <h1>What are you interviewing for?</h1>
      <form
        class="desk"
        onSubmit={(e) => {
          e.preventDefault();
          make.run();
        }}
      >
        <div class="field">
          <label for="posting">Job posting</label>
          <textarea id="posting" class="sheet" maxLength={30000} placeholder="Paste the posting here. Each problem will quote the line it prepares you for." value={form.posting} onInput={set('posting')} />
        </div>
        <div class="stack">
          <div class="pair">
            <div class="field">
              <label for="company">Company</label>
              <input id="company" class="input" required maxLength={120} autoComplete="off" value={form.company} onInput={set('company')} />
            </div>
            <div class="field">
              <label for="role">Role</label>
              <input id="role" class="input" required maxLength={120} autoComplete="off" value={form.role} onInput={set('role')} />
            </div>
          </div>
          <div class="field">
            <label for="rounds">What the interview has</label>
            <textarea id="rounds" class="input" rows={5} maxLength={6000} placeholder="Rounds, topics the recruiter named, what you feel rusty on" value={form.rounds} onInput={set('rounds')} />
          </div>
          <fieldset class="field">
            <legend>Subjects</legend>
            <div class="chips">
              {options?.subjects.map((s) => (
                <label class="chip" key={s}>
                  <input type="checkbox" checked={form.subjects.includes(s)} onChange={() => toggle(s)} />
                  <span>{s}</span>
                </label>
              ))}
              <label class="chip">
                <input type="checkbox" checked={other !== null} onChange={() => setOther(other === null ? '' : null)} />
                <span>Other</span>
              </label>
            </div>
            {other !== null && <input class="input" aria-label="Other subjects" placeholder="System design, statistics" maxLength={200} value={other} onInput={(e) => setOther(e.target.value)} />}
          </fieldset>
          <div class="pair keep">
            <div class="field">
              <label for="level">Level</label>
              <select id="level" class="input" value={form.level} onChange={set('level')}>
                {options?.levels.map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div class="field">
              <label for="count">Problems</label>
              <select id="count" class="input" value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}>
                {[...Array(10)].map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </div>
          </div>
          {account && !account.signedIn && (
            <p class="note">
              {account.label} is not {account.installed ? 'signed in' : 'installed'} on this computer. Run <code class="mono">{account.signIn}</code> in a terminal or choose another account in <a href="#/settings">Settings</a>.
            </p>
          )}
          <Problem>{make.error}</Problem>
          <div class="row wrap">
            <button class="btn primary big" disabled={make.busy}>
              Make practice set
            </button>
            {saved && <span class="small muted">Written by {modelName(saved.settings.write, status)}</span>}
          </div>
        </div>
      </form>
    </div>
  );
}
