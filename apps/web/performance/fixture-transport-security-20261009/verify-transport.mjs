import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fixtureRequestUrl, fixtureRequestBoundary, fixtureUpstreamRequest } from './loopback-transport.mjs';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = [
  ['graph-cms-followthrough-20261009/fixture-gateway.mjs', 20382, 20384],
  ['graph-cms-followthrough-20261009/title-fixture-gateway.mjs', 20402, 20404],
  ['pr-review-followthrough-20261009/approved-fixture-gateway.mjs', 20512, 20514],
];
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'GET', ...options }, reply => {
      const body = [];
      reply.on('data', chunk => body.push(chunk));
      reply.on('end', () => resolve({ status: reply.statusCode, headers: reply.headers, body: Buffer.concat(body).toString() }));
    });
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('timeout'))); req.end();
  });
}
const trap = http.createServer((req, res) => { trapCalls++; res.end('unexpected'); });
let trapCalls = 0;
await new Promise((resolve, reject) => { trap.once('error', reject); trap.listen(0, '127.0.0.1', resolve); });
const trapUrl = `http://127.0.0.1:${trap.address().port}`;
const cleanup = [];
try {
  for (const [relative, upstreamPort, previewPort] of fixtures) {
    const origin = `http://127.0.0.1:${previewPort}`;
    const calls = []; let upgrades = 0;
    const upstream = http.createServer((req, res) => {
      calls.push({ path: req.url, method: req.method, headers: req.headers });
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: `${trapUrl}/redirect-target`, 'Set-Cookie': 'unexpected-session=1' });
      } else res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end(`sentinel:${req.url}`);
    });
    upstream.on('upgrade', (req, socket) => {
      upgrades++; calls.push({ path: req.url, method: req.method, headers: req.headers });
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    });
    await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(upstreamPort, '127.0.0.1', resolve); });
    const child = spawn(process.env.FIXTURE_BUN ?? '/Users/twoimo/.bun/bin/bun', [`performance/${relative}`], {
      cwd: webRoot, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false, output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('Design preview uses synthetic')) ready = true; });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    try {
      await Promise.race([
        new Promise((resolve, reject) => {
          const timer = setInterval(() => {
            if (ready) { clearInterval(timer); resolve(); }
            else if (child.exitCode !== null) { clearInterval(timer); reject(new Error('fixture startup failed')); }
          }, 20);
          setTimeout(() => { clearInterval(timer); if (!ready) reject(new Error('fixture startup timeout')); }, 5000).unref();
        }), once(child, 'error').then(([error]) => { throw error; }),
      ]);
      for (const path of ['/admin?module=pipeline', '/_next/static/example.js?x=1', '/%2f%2fexample.test/path', '/%5cexample.test/path']) {
        const reply = await request(previewPort, path, { headers: {
          authorization: 'Bearer synthetic-must-not-forward',
          cookie: 'synthetic=must-not-forward', 'proxy-authorization': 'synthetic',
          'x-forwarded-host': 'untrusted.example', accept: 'text/plain',
        } });
        check(`${relative}: fixed destination ${path}`, reply.status === 200 && reply.body.startsWith('sentinel:'));
        const headers = calls.at(-1).headers;
        check(`${relative}: stripped auth and proxy headers ${path}`,
          headers.host === `127.0.0.1:${upstreamPort}` && !headers.authorization && !headers.cookie
          && !headers['proxy-authorization'] && !headers['x-forwarded-host']);
      }
      const count = calls.length;
      for (const path of [`${trapUrl}/absolute`, `//127.0.0.1:${trap.address().port}/authority`, '/\\untrusted.example/path']) {
        const reply = await request(previewPort, path);
        check(`${relative}: rejected authority ${path.split('/').at(-1)}`, reply.status === 400);
      }
      check(`${relative}: rejected targets caused zero upstream requests`, calls.length === count);
      for (const headers of [{ host: 'untrusted.example' }, { origin: 'https://untrusted.example' }]) {
        check(`${relative}: rebinding/cross-origin request rejected`,
          (await request(previewPort, '/admin', { headers })).status === 400 && calls.length === count);
      }
      check(`${relative}: mutation cannot reach upstream`, (await request(previewPort, '/admin', { method: 'POST' })).status === 400 && calls.length === count);
      check(`${relative}: API mutation remains disabled`, (await request(previewPort, '/api/admin/pipeline', { method: 'POST' })).status === 405 && calls.length === count);
      const redirect = await request(previewPort, '/redirect');
      check(`${relative}: redirect not followed and cookie not copied`, redirect.status === 302 && !redirect.headers['set-cookie'] && trapCalls === 0);
      const mock = await request(previewPort, '/api/admin/pipeline');
      check(`${relative}: synthetic API preserved`, mock.status === 200 && JSON.parse(mock.body).source === 'github_actions');
      const malformedMock = await request(upstreamPort + 1, 'http://[invalid/');
      check(`${relative}: malformed mock URL returns bounded error`, malformedMock.status === 400
        && JSON.parse(malformedMock.body).error === 'FIXTURE_INPUT_INVALID');
      const mockUser = await request(upstreamPort + 1, '/auth/v1/user', { headers: { origin } });
      check(`${relative}: synthetic mock remains available after malformed target`, mockUser.status === 200
        && JSON.parse(mockUser.body).id === '00000000-0000-4000-9000-000000000001');
      await new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: previewPort, path: '/_next/webpack-hmr', headers: {
          Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'synthetic-key',
          'Sec-WebSocket-Version': '13', authorization: 'synthetic', cookie: 'synthetic=1',
        } });
        req.on('upgrade', (reply, socket) => { socket.destroy(); resolve(); });
        req.on('response', () => reject(new Error('upgrade denied')));
        req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('upgrade timeout'))); req.end();
      });
      check(`${relative}: HMR preserved without auth forwarding`, upgrades === 1
        && !calls.at(-1).headers.authorization && !calls.at(-1).headers.cookie);
      for (const path of ['', '//example.test', 'https://example.test', '/\\example.test', '/bad\nvalue', '/bad value', '/x#fragment', '/bad%url']) {
        assert.throws(() => fixtureRequestUrl(path, origin));
      }
      check(`${relative}: invalid target forms rejected`, true);
      for (const [url, method, headers] of [
        ['/other', 'GET', { host: new URL(origin).host, upgrade: 'websocket' }],
        ['/_next/webpack-hmr', 'POST', { host: new URL(origin).host, upgrade: 'websocket' }],
        ['/_next/webpack-hmr', 'GET', { host: new URL(origin).host, upgrade: 'other' }],
        ['/_next/webpack-hmr', 'GET', { host: new URL(origin).host, upgrade: 'websocket', origin: 'https://untrusted.example' }],
      ]) assert.throws(() => fixtureRequestBoundary({ url, method, headers }, origin, true));
      check(`${relative}: upgrade path, method, protocol and origin constrained`, true);
      assert.throws(() => fixtureUpstreamRequest({ method: 'GET', url: '/admin', headers: { host: new URL(origin).host } }, origin, 443));
      check(`${relative}: port outside allowlist rejected`, true);
    } finally {
      if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
      await new Promise(resolve => upstream.close(resolve));
      cleanup.push({ fixture: relative, childExited: child.exitCode !== null, upstreamClosed: !upstream.listening });
    }
  }
  check('external trap received zero requests', trapCalls === 0);
} finally { await new Promise(resolve => trap.close(resolve)); }
const files = ['loopback-transport.mjs', 'verify-transport.mjs'].map(name => `performance/fixture-transport-security-20261009/${name}`)
  .concat(fixtures.map(([relative]) => `performance/${relative}`));
const sources = [];
for (const path of files) {
  const bytes = await readFile(new URL(`../../${path}`, import.meta.url));
  sources.push({ path: `apps/web/${path}`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
const receipt = { measuredAt: new Date().toISOString(), runtime: process.version, environment: 'Three actual Bun fixture gateways and Node HTTP sentinels on loopback. No Next, provider, hosted DB or production traffic.',
  checks, total: checks.length, passed: checks.length, trapCalls, cleanup, sources, fullGoalComplete: false };
await writeFile(new URL('./transport-verification.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify({ passed: checks.length, trapCalls, cleanup }) + '\n');
