import http from 'node:http';

const upstreamPorts = new Set([20382, 20402, 20512]);
const previewOrigins = new Set([
  'http://127.0.0.1:20384',
  'http://127.0.0.1:20404',
  'http://127.0.0.1:20514',
]);

// Accept HTTP origin-form only. The request's Host never selects an authority.
export function fixtureRequestUrl(raw, origin) {
  if (!previewOrigins.has(origin) || typeof raw !== 'string' || raw.length > 16384
    || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u0020\u007f#]/.test(raw)
    || /%(?![a-f0-9]{2})/i.test(raw)) {
    throw new Error('FIXTURE_INPUT_INVALID');
  }
  const url = new URL(raw, origin);
  if (url.origin !== origin || url.username || url.password) throw new Error('FIXTURE_INPUT_INVALID');
  return url;
}

export function fixtureRequestBoundary(req, origin, upgrade = false) {
  const url = fixtureRequestUrl(req.url, origin);
  if (req.headers.host !== new URL(origin).host
    || (req.headers.origin !== undefined && req.headers.origin !== origin)) {
    throw new Error('FIXTURE_INPUT_INVALID');
  }
  if (upgrade && (req.method !== 'GET' || url.pathname !== '/_next/webpack-hmr'
    || req.headers.upgrade?.toLowerCase() !== 'websocket')) throw new Error('FIXTURE_INPUT_INVALID');
  return url;
}

function safeHeaders(incoming, port, upgrade) {
  const headers = { host: `127.0.0.1:${port}` };
  const names = upgrade
    ? ['upgrade', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']
    : ['accept', 'accept-language', 'range', 'if-none-match', 'if-modified-since', 'rsc', 'next-router-prefetch', 'next-router-state-tree', 'next-url'];
  for (const name of names) {
    const value = incoming[name];
    if (typeof value === 'string' && value.length <= 16384 && !/[\r\n\u0000]/.test(value)) headers[name] = value;
  }
  if (upgrade) headers.connection = 'Upgrade';
  else {
    headers['accept-encoding'] = 'identity';
    headers['x-e2e-admin-bypass'] = '1';
    headers['x-e2e-admin-bypass-token'] = 'design-fixture-local-only';
  }
  return headers;
}

export function fixtureUpstreamRequest(req, origin, port, upgrade = false) {
  if (!upstreamPorts.has(port) || (!upgrade && !['GET', 'HEAD'].includes(req.method))) {
    throw new Error('FIXTURE_INPUT_INVALID');
  }
  const url = fixtureRequestBoundary(req, origin, upgrade);
  // An HTTP options object fixes the destination independently of the path.
  // No DNS, environment proxy, redirect following, or incoming auth is used.
  return http.request({
    hostname: '127.0.0.1', port, method: upgrade ? 'GET' : req.method,
    path: url.pathname + url.search,
    headers: safeHeaders(req.headers, port, upgrade),
    timeout: 15000,
  });
}

export function forwardFixtureRead(req, res, origin, port) {
  const bridge = fixtureUpstreamRequest(req, origin, port);
  bridge.on('response', reply => {
    const headers = { ...reply.headers };
    // Synthetic sessions belong to the fixture; never copy an upstream cookie.
    delete headers['set-cookie'];
    delete headers.connection;
    delete headers['transfer-encoding'];
    res.writeHead(reply.statusCode ?? 502, headers);
    reply.on('error', () => res.destroy());
    reply.pipe(res);
  });
  bridge.on('timeout', () => bridge.destroy());
  bridge.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'FIXTURE_UPSTREAM_UNAVAILABLE' }));
  });
  res.on('close', () => bridge.destroy());
  bridge.end();
}
