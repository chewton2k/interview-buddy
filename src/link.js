import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { pipeline } from 'node:stream';
import zlib from 'node:zlib';

const LIMIT = 2 << 20;
const TEXT_LIMIT = 20000;

// Pages are fetched from the user's own machine, so a link must never reach services inside it or its network.
export const PRIVATE = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) PRIVATE.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::', 96], ['64:ff9b::', 96], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) PRIVATE.addSubnet(a, n, 'ipv6');

export function isBlocked(address, block = PRIVATE) {
  const mapped = address.match(/^::ffff:(.+)$/i)?.[1];
  if (mapped) {
    if (net.isIPv4(mapped)) return isBlocked(mapped, block);
    const [hi, lo] = mapped.split(':').map((h) => parseInt(h, 16));
    return isBlocked([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'), block);
  }
  return block.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

export class LinkError extends Error {}
const refuse = () => new LinkError('That link points inside this computer or its network, so it was not opened');

const guarded = (block) => (host, options, done) =>
  dns.lookup(host, { ...options, all: true }, (e, found) => {
    if (e) return done(e);
    if (found.some((f) => isBlocked(f.address, block))) return done(refuse());
    return options.all ? done(null, found) : done(null, found[0].address, found[0].family);
  });

const DECODE = { gzip: zlib.createGunzip, 'x-gzip': zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress };

function get(url, { block, signal }) {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isBlocked(host, block)) return reject(refuse());
    const headers = { 'user-agent': 'Mozilla/5.0', accept: 'text/html,text/plain,text/markdown,application/json', 'accept-encoding': 'gzip, br, deflate' };
    const req = (url.protocol === 'https:' ? https : http).get(url, { headers, signal, lookup: guarded(block), agent: false }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.destroy();
        return resolve({ next: res.headers.location });
      }
      const fail = (message) => {
        res.destroy();
        reject(new LinkError(message));
      };
      if (res.statusCode !== 200) return fail(`${url.hostname} answered with status ${res.statusCode}. Paste the text instead.`);
      const type = (res.headers['content-type'] ?? 'text/html').split(';')[0].trim().toLowerCase();
      if (!/^(text\/(html|plain|markdown|x-markdown)|application\/(json|xhtml\+xml))$/.test(type)) return fail(`${url.hostname} sent a ${type} file, which cannot be read. Paste the text instead.`);
      const encoding = (res.headers['content-encoding'] ?? 'identity').toLowerCase();
      if (encoding !== 'identity' && !DECODE[encoding]) return fail(`${url.hostname} used an encoding that cannot be read. Paste the text instead.`);
      const chunks = [];
      let size = 0;
      const body = encoding === 'identity' ? res : pipeline(res, DECODE[encoding](), () => {});
      body.on('data', (c) => {
        size += c.length;
        if (size <= LIMIT) return chunks.push(c);
        body.destroy();
        fail(`${url.hostname} sent more than 2 MB. Paste the part you need instead.`);
      });
      body.on('error', reject);
      body.on('end', () => resolve({ type, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', times: '×', minus: '-', le: '≤', ge: '≥' };
export function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|nav|footer|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/pre)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|\w+);/gi, (m, e) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n\s*/g, '\n')
    .trim();
}

export const findLinks = (text) => [...new Set((text.match(/\bhttps?:\/\/[^\s<>"'`\])}]+/gi) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))].slice(0, 3);
export const dropLinks = (text) => text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').trim();

/** Returns the readable text of a public page. Throws LinkError with a message for the user. */
export async function fetchPage(link, { block = PRIVATE, timeout = 15000, signal } = {}) {
  const limit = AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]);
  let url;
  try {
    url = new URL(link);
    for (let hop = 0; hop <= 5; hop++) {
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new LinkError('Only plain http and https links can be opened');
      const page = await get(url, { block, signal: limit });
      if (page.next) {
        url = new URL(page.next, url);
        continue;
      }
      const text = (/html/.test(page.type) ? htmlToText(page.text) : page.text.trim()).slice(0, TEXT_LIMIT);
      if (text.length < 80) throw new LinkError(`${url.hostname} has no text that can be read without a browser. Paste the text instead.`);
      return text;
    }
    throw new LinkError('That link redirects too many times');
  } catch (e) {
    if (e instanceof LinkError || signal?.aborted) throw e;
    if (limit.aborted) throw new LinkError(`${url.hostname} took too long to answer. Paste the text instead.`);
    throw new LinkError(url ? `${url.hostname} could not be opened (${e.code ?? e.message}). Paste the text instead.` : 'That is not a link');
  }
}
