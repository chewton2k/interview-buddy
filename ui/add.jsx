import { useState } from 'preact/hooks';
import { api, Icon, Problem, useAction, useLoad } from './lib.jsx';

/** Turns a link or an idea into one problem, in this set or in My problems. */
export function AddProblem({ setId, subjects = [], onAdded }) {
  const [request, setRequest] = useState('');
  const [subject, setSubject] = useState('');
  const { value: options } = useLoad('/options');
  const make = useAction(async () => {
    const made = await api('POST', setId ? `/sets/${setId}/problems` : '/problems', { request, subject });
    setRequest('');
    onAdded(made);
  });
  return (
    <form
      class="panel add"
      onSubmit={(e) => {
        e.preventDefault();
        make.run();
      }}
    >
      <div class="field">
        <label for="request">Make a problem from a link or an idea</label>
        <textarea id="request" class="input" rows={2} required maxLength={6000} placeholder="https://... make this into a quant problem" value={request} onInput={(e) => setRequest(e.target.value)} />
      </div>
      <div class="row wrap">
        <select class="input auto" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">Any subject</option>
          {[...new Set([...Object.values(options?.groups ?? {}).flat(), ...subjects])].map((s) => <option key={s}>{s}</option>)}
        </select>
        <button class="btn" disabled={make.busy}>
          <Icon name="plus" />
          Make problem
        </button>
      </div>
      <Problem>{make.error}</Problem>
    </form>
  );
}
