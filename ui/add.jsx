import { useState } from 'preact/hooks';
import { api, Icon, Problem, useAction, useLoad } from './lib.jsx';

function Subjects({ any, subjects, value, onChange }) {
  const { value: options } = useLoad('/options');
  return (
    <select class="input auto" aria-label="Subject" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{any}</option>
      {[...new Set([...Object.values(options?.groups ?? {}).flat(), ...subjects])].map((s) => <option key={s}>{s}</option>)}
    </select>
  );
}

const some = (n) => `${n} more ${n === 1 ? 'problem' : 'problems'}`;

/** Plans more problems from what the set was made from. */
export function AddMore({ set, onAdded }) {
  const [count, setCount] = useState(set.adding?.count ?? 3);
  const [subject, setSubject] = useState(set.adding?.subject ?? '');
  const add = useAction(async () => {
    await api('POST', `/sets/${set.id}/more`, { count, subject });
    await onAdded();
  });
  const planning = set.adding && !set.adding.error;
  return (
    <form
      class="panel add"
      onSubmit={(e) => {
        e.preventDefault();
        add.run();
      }}
    >
      <fieldset class="field">
        <legend>Add more problems for this interview</legend>
        <div class="row wrap">
          <select class="input auto" aria-label="How many" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[...Array(10)].map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
          <Subjects any="Same subjects" subjects={set.intake.subjects} value={subject} onChange={setSubject} />
          <button class="btn" disabled={add.busy || planning}>
            <Icon name={planning ? 'load' : 'plus'} />
            {planning ? `Planning ${some(set.adding.count)}` : `Add ${some(count)}`}
          </button>
        </div>
      </fieldset>
      <Problem>{add.error || set.adding?.error}</Problem>
    </form>
  );
}

/** Turns a link or an idea into one problem, in this set or in My problems. */
export function AddProblem({ setId, subjects = [], onAdded }) {
  const [request, setRequest] = useState('');
  const [subject, setSubject] = useState('');
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
        <Subjects any="Any subject" subjects={subjects} value={subject} onChange={setSubject} />
        <button class="btn" disabled={make.busy}>
          <Icon name="plus" />
          Make problem
        </button>
      </div>
      <Problem>{make.error}</Problem>
    </form>
  );
}
