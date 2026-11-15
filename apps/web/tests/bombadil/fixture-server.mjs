import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { CAPABILITY, CAPABILITY_PATH, CSP, isAllowedRequest } from './policy.mjs';

const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tzudong component QA fixture</title><link rel="stylesheet" href="/bundle.css"><script defer src="/environment.js"></script><script defer src="/bundle.js"></script></head><body><div id="root"></div></body></html>';
const environment = 'globalThis.process = { env: { NODE_ENV: "development" } };';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function startFixtureServer(directory, port = 0) {
  const [javascript, css, noise] = await Promise.all([
    readFile(path.join(directory, 'bundle.js')), readFile(path.join(directory, 'bundle.css')),
    readFile(new URL('../../public/images/ui-noise.png', import.meta.url)),
  ]);
  if (javascript.length > 16 * 1024 * 1024 || css.length > 4 * 1024 * 1024) throw new Error('QA_ASSET_LIMIT');
  const assets = new Map([
    ['/fixture', ['text/html; charset=utf-8', html]],
    ['/environment.js', ['text/javascript; charset=utf-8', environment]],
    ['/bundle.js', ['text/javascript; charset=utf-8', javascript]],
    ['/bundle.css', ['text/css; charset=utf-8', css]],
    ['/images/ui-noise.png', ['image/png', noise]],
    ['/favicon.ico', ['image/x-icon', '']],
    [CAPABILITY_PATH, ['application/json; charset=utf-8', JSON.stringify(CAPABILITY)]],
  ]);
  const counts = { allowed: 0, denied: 0, capabilityReads: 0 };
  let origin;
  const server = createServer((request, response) => {
    const target = `${origin}${request.url}`;
    const allowed = request.headers.host === new URL(origin).host
      && isAllowedRequest({ url: target, method: request.method }, origin);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Tzudong-Fixture', 'synthetic-components-only');
    if (!allowed) {
      counts.denied += 1;
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('FIXTURE_REQUEST_DENIED');
      return;
    }
    counts.allowed += 1;
    if (request.url === CAPABILITY_PATH) counts.capabilityReads += 1;
    const [contentType, bytes] = assets.get(request.url);
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, counts,
    assets: { javascriptSha256: sha256(javascript), cssSha256: sha256(css), noiseSha256: sha256(noise) },
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
