import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calls, clearCalls, emptyPath, intake, brief, replies } from './stub/setup.js';
import { ask, ping, PROVIDERS, providerStatus } from '../src/providers.js';
import { planSchema, problemSchema, SUBJECTS, writeProblem } from '../src/generate.js';
import { checkSettings } from '../src/store.js';

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const go = (provider, extra) => ask({ provider, model: 'm-1', effort: 'low', prompt: 'hello', schema, ...extra });

for (const provider of ['claude', 'codex']) {
  test(`${provider} sends prompt on stdin, passes the choice and drops keys and session variables`, async () => {
    replies([{ match: 'hello', reply: { ok: true } }]);
    clearCalls();
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID']) process.env[k] = 'x';
    assert.deepEqual(await go(provider), { ok: true });
    const [c] = calls();
    assert.equal(c.name, provider);
    assert.match(c.prompt, /hello/);
    assert.equal(c.args[c.args.indexOf('--model') + 1], 'm-1');
    assert.ok(c.args.join(' ').includes(provider === 'claude' ? '--effort low' : 'model_reasoning_effort=low'));
    assert.ok(!c.args.join(' ').includes('hello'));
    assert.deepEqual(c.keys.filter((k) => /^(ANTHROPIC|OPENAI|CODEX_API|CLAUDECODE|CLAUDE_CODE)/.test(k)), []);
    clearCalls();
    await go(provider, { model: '', effort: '' });
    assert.ok(!calls()[0].args.some((a) => a === '--model' || a === '--effort' || a.startsWith('model_reasoning')));
  });
  test(`${provider} failures keep their kind`, async () => {
    const kinds = { 'You have hit your usage limit': 'rate', 'Not logged in. Please run login': 'auth', "The 'm-1' model is not supported": 'exit' };
    for (const [message, kind] of Object.entries(kinds)) {
      replies([{ match: 'hello', exit: message }]);
      await assert.rejects(go(provider), (e) => e.kind === kind && e.message.includes(message));
    }
    replies([{ match: 'hello', raw: 'nonsense' }]);
    await assert.rejects(go(provider), { kind: 'badjson' });
    replies([{ match: 'hello', hang: true }]);
    await assert.rejects(go(provider, { timeout: 400 }), { kind: 'timeout' });
    const c = new AbortController();
    setTimeout(() => c.abort(), 200);
    await assert.rejects(go(provider, { signal: c.signal }), { kind: 'aborted' });
    await assert.rejects(go(provider, { signal: c.signal }), { kind: 'aborted' });
  });
}

test('claude error results with exit code 0 are failures', async () => {
  replies([{ match: 'hello', error: 'Claude usage limit reached' }]);
  await assert.rejects(go('claude'), { kind: 'rate' });
  replies([{ match: 'hello', raw: JSON.stringify({ is_error: false, result: '{"ok":true}' }) }]);
  assert.deepEqual(await go('claude'), { ok: true });
});

test('status reports sign-in, version, models and a missing command', async () => {
  let s = await providerStatus();
  assert.deepEqual(s.map((p) => [p.id, p.installed, p.signedIn, p.version]), [['codex', true, true, '0.0.1'], ['claude', true, true, '0.0.2']]);
  assert.deepEqual(s[0].models, [{ id: 'gpt-x', label: 'GPT X' }]);
  process.env.STUB_SIGNED_OUT = '1';
  s = await providerStatus();
  assert.ok(s.every((p) => p.installed && !p.signedIn));
  delete process.env.STUB_SIGNED_OUT;
  const saved = process.env.PATH;
  process.env.PATH = '/nonexistent';
  s = await providerStatus();
  assert.ok(s.every((p) => !p.installed));
  await assert.rejects(go('claude'), { kind: 'missing' });
  process.env.PATH = saved;
  assert.ok(saved.startsWith(emptyPath));
});

test('settings refuse unknown accounts and flag-like models', () => {
  const ok = { provider: 'codex', model: 'gpt-x' };
  assert.deepEqual(checkSettings({ ...ok, effort: 'max' }), ok);
  assert.deepEqual(checkSettings({ ...ok, model: '' }), { provider: 'codex', model: '' });
  for (const bad of [{ ...ok, provider: 'toString' }, { ...ok, model: '--dangerous' }, { ...ok, model: 'a b' }, { ...ok, model: 5 }, null, 'x']) assert.throws(() => checkSettings(bad));
});

test('schemas are strict enough for codex', () => {
  const walk = (s) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual(s.required, Object.keys(s.properties));
      Object.values(s.properties).forEach(walk);
    }
    if (s.items) walk(s.items);
  };
  [planSchema(SUBJECTS), ...Object.values(problemSchema)].forEach(walk);
});

const live = process.env.INTERVIEW_BUDDY_LIVE;
for (const provider of Object.keys(PROVIDERS)) {
  test(`live ${provider} writes a problem that passes local checks`, { skip: !live && 'set INTERVIEW_BUDDY_LIVE=1' }, async () => {
    process.env.PATH = process.env.PATH.replace(`${emptyPath}:`, '');
    const choice = { provider, model: process.env[`LIVE_${provider.toUpperCase()}_MODEL`] ?? '', effort: 'low' };
    assert.deepEqual(await ping(choice), { ok: true });
    const body = await writeProblem({ intake, brief: brief(), choice });
    console.log(provider, body.signature, `${body.cases.length} cases`);
    assert.ok(body.cases.length >= 6);
  });
}
