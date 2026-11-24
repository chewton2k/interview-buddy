// Stands in for `claude` and `codex`. Replies come from STUB_DIR/replies.json: [{match, reply | raw | exit | error | hang}].
import fs from 'node:fs';
import path from 'node:path';

const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const dir = process.env.STUB_DIR;
if (args[0] === '--version') {
  console.log(name === 'codex' ? 'codex-cli 0.0.1' : '0.0.2 (Claude Code)');
} else if (args.join(' ') === 'auth status') {
  console.log(JSON.stringify({ loggedIn: !process.env.STUB_SIGNED_OUT }));
} else if (args.join(' ') === 'login status') {
  process.exitCode = process.env.STUB_SIGNED_OUT ? 1 : 0;
} else if (args.join(' ') === 'debug models') {
  console.log(JSON.stringify({ models: [{ slug: 'gpt-x', display_name: 'GPT X', visibility: 'list' }, { slug: 'hidden', display_name: 'H', visibility: 'hide' }] }));
} else {
  const prompt = fs.readFileSync(0, 'utf8');
  fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ name, args, prompt, keys: Object.keys(process.env) }) + '\n');
  const replies = JSON.parse(fs.readFileSync(path.join(dir, 'replies.json'), 'utf8'));
  const i = replies.findIndex((r) => prompt.includes(r.match));
  const r = i < 0 ? { exit: 'no stub reply' } : replies[i];
  if (i >= 0 && r.once) {
    replies.splice(i, 1);
    fs.writeFileSync(path.join(dir, 'replies.json'), JSON.stringify(replies));
  }
  if (r.hang) setInterval(() => {}, 1000);
  else if (r.exit) {
    if (name === 'codex') console.log(JSON.stringify({ type: 'error', message: r.exit }));
    else console.error(r.exit);
    process.exitCode = 1;
  } else if (name === 'codex') fs.writeFileSync('out.json', r.raw ?? JSON.stringify(r.reply));
  else console.log(r.raw ?? JSON.stringify(r.error ? { is_error: true, result: r.error } : { is_error: false, structured_output: r.reply }));
}
