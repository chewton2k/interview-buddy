import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, test } from 'node:test';
import zlib from 'node:zlib';
import { dropLinks, fetchPage, findLinks, htmlToText, isBlocked } from '../src/link.js';

const body = `<html><head><title>T</title></head><script>evil()</script><p>${'A dice game pays &pound; or &lt;2x&#62; each turn. '.repeat(6)}</p></html>`;
const pages = {
  '/ok': (res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body),
  '/gzip': (res) => res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(zlib.gzipSync(body)),
  '/plain': (res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('<b>'.repeat(100)),
  '/bomb': (res) => res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(zlib.gzipSync(Buffer.alloc(8 << 20, 97))),
  '/big': (res) => res.writeHead(200, { 'content-type': 'text/html' }).end('a'.repeat((2 << 20) + 1)),
  '/badgzip': (res) => res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end('not gzip'),
  '/zstd': (res) => res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'zstd' }).end('x'),
  '/pdf': (res) => res.writeHead(200, { 'content-type': 'application/pdf' }).end('x'),
  '/empty': (res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<div id=root></div>'),
  '/gone': (res) => res.writeHead(404).end(),
  '/hang': () => {},
  '/hop': (res) => res.writeHead(302, { location: '/ok' }).end(),
  '/loop': (res) => res.writeHead(302, { location: '/loop' }).end(),
  '/file': (res) => res.writeHead(302, { location: 'file:///etc/passwd' }).end(),
};
const server = http.createServer((req, res) => pages[req.url](res));
let at;
before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((at = `http://127.0.0.1:${server.address().port}`), r()))));
after(() => (server.closeAllConnections(), server.close()));
const open = new net.BlockList();

test('reads pages, follows redirects and decodes', async () => {
  for (const p of ['/ok', '/gzip', '/hop']) {
    const t = await fetchPage(at + p, { block: open });
    assert.match(t, /^A dice game pays &pound; or <2x> each turn/);
    assert.ok(!t.includes('evil'));
  }
  assert.match(await fetchPage(`${at}/plain`, { block: open }), /^<b>/);
  assert.match(await fetchPage(at.replace('127.0.0.1', 'localhost') + '/ok', { block: open }), /dice/);
});

test('failures say what to do', async () => {
  const want = { '/bomb': /2 MB/, '/big': /2 MB/, '/badgzip': /could not be opened/, '/zstd': /encoding/, '/pdf': /application\/pdf/, '/empty': /Paste the text/, '/gone': /404/, '/hang': /too long/, '/loop': /too many/, '/file': /http and https/ };
  for (const [p, re] of Object.entries(want)) await assert.rejects(fetchPage(at + p, { block: open, timeout: 600 }), re, p);
  await assert.rejects(fetchPage('nonsense'), /not a link/);
  await assert.rejects(fetchPage('http://user:pw@example.com/'), /plain http/);
  await assert.rejects(fetchPage('http://127.0.0.1:1/', { block: open }), /could not be opened/);
});

test('never reaches this computer or its network', async () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::']) assert.ok(isBlocked(a), a);
  for (const a of ['1.1.1.1', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) assert.ok(!isBlocked(a), a);
  for (const u of [`${at}/ok`, at.replace('127.0.0.1', 'localhost') + '/ok', at.replace('127.0.0.1', '[::ffff:127.0.0.1]') + '/ok', at.replace('127.0.0.1', '2130706433') + '/ok']) await assert.rejects(fetchPage(u), /inside this computer/, u);
});

test('a redirect to a blocked address is refused', async () => {
  const onlyFirst = new net.BlockList();
  onlyFirst.addAddress('::1', 'ipv6');
  onlyFirst.addAddress('127.0.0.2');
  pages['/in'] = (res) => res.writeHead(302, { location: 'http://127.0.0.2/' }).end();
  await assert.rejects(fetchPage(`${at}/in`, { block: onlyFirst }), /inside this computer/);
});

test('links are found, capped and removed', () => {
  assert.deepEqual(findLinks('see https://a.com/x?y=1, (http://b.org/z) and https://a.com/x?y=1. Also https://c.io https://d.io'), ['https://a.com/x?y=1', 'http://b.org/z', 'https://c.io']);
  assert.equal(dropLinks('make https://evil.com/?d=1 harder www.x.com'), 'make  harder');
  assert.equal(htmlToText('a&#x41;&#0;&bogus;<br>b'), 'aA&#0;&bogus;\nb');
});
