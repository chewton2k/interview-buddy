#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { recoverInterrupted } from '../src/generate.js';
import { killAll } from '../src/providers.js';
import { sweep } from '../src/sandbox.js';
import { createServer } from '../src/server.js';

const help = `Interview Buddy

Usage: interview-buddy [--port 4747] [--no-open]
`;
let values;
try {
  ({ values } = parseArgs({ options: { port: { type: 'string', default: '4747' }, 'no-open': { type: 'boolean' }, help: { type: 'boolean' } } }));
} catch (e) {
  console.error(`${e.message}\n\n${help}`);
  process.exit(1);
}
const port = Number(values.port);
if (values.help || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.log(help);
  process.exit(values.help ? 0 : 1);
}

const openPage = (url) => {
  if (!values['no-open']) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
};
const stop = () => {
  killAll();
  process.exit(0);
};

const server = createServer();
server.on('error', (e) => {
  const url = `http://localhost:${port}`;
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`Port ${port} is already in use. If Interview Buddy is running, it is at ${url}. Otherwise start with --port and another number.`);
  openPage(url);
});
server.listen(port, '127.0.0.1', async () => {
  const url = `http://localhost:${server.address().port}`;
  await recoverInterrupted();
  await sweep();
  console.log(`Interview Buddy is running at ${url}\nPress Control-C to stop.`);
  openPage(url);
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', killAll);
