import http from 'node:http';
import { Buffer } from 'node:buffer';

import { fixtureSession, fixtureUser } from '../admin-header-consistency-20261011/fixture-data.mjs';

const NEXT_PORT = 18940;
const SUPABASE_PORT = 18941;
const GATEWAY_PORT = 18942;
const NEXT_ORIGIN = `http://127.0.0.1:${NEXT_PORT}`;
const SUPABASE_ORIGIN = `http://127.0.0.1:${SUPABASE_PORT}`;
const GATEWAY_ORIGIN = `http://127.0.0.1:${GATEWAY_PORT}`;
const syntheticToken = 'privacy-incidents-synthetic-only';

const privacyFixture = Object.freeze({
  ok: true,
  serverNow: '2026-10-12T06:00:00.000Z',
  incidents: [
    {
      id: '00000000-0000-4000-8000-000000000101', status: 'assessed', severity: 'high',
      detectedAt: '2026-10-07T23:30:00.000Z', awarenessAt: '2026-10-08T00:00:00.000Z',
      deadlineAt: '2026-10-11T00:00:00.000Z', deadlineStatus: 'overdue', deadlineRemainingMinutes: -1800,
      affectedCountEstimate: 24, dataCategories: ['account', 'contact'], sensitiveOrUniqueId: false,
      externalIntrusion: true, decisionCode: 'human_assessment_recorded',
      assessmentReadbackAt: '2026-10-08T01:00:00.000Z', updatedAt: '2026-10-12T05:10:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000102', status: 'contained', severity: 'medium',
      detectedAt: '2026-10-09T17:30:00.000Z', awarenessAt: '2026-10-09T18:00:00.000Z',
      deadlineAt: '2026-10-12T18:00:00.000Z', deadlineStatus: 'due_soon', deadlineRemainingMinutes: 720,
      affectedCountEstimate: null, dataCategories: [], sensitiveOrUniqueId: null,
      externalIntrusion: null, decisionCode: null, assessmentReadbackAt: null,
      updatedAt: '2026-10-12T05:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000103', status: 'detected', severity: 'low',
      detectedAt: '2026-10-12T04:00:00.000Z', awarenessAt: null, deadlineAt: null,
      deadlineStatus: 'not_started', deadlineRemainingMinutes: null, affectedCountEstimate: null,
      dataCategories: [], sensitiveOrUniqueId: null, externalIntrusion: null, decisionCode: null,
      assessmentReadbackAt: null, updatedAt: '2026-10-12T04:00:00.000Z',
    },
  ],
  notices: [{
    id: '00000000-0000-4000-8000-000000000201', incidentId: '00000000-0000-4000-8000-000000000101',
    audience: 'data_subjects', status: 'draft', templateVersion: 'ko-v1', contentSha256: 'a'.repeat(64),
    approvedBy: null, approvedAt: null, submittedBy: null, submittedAt: null, externalReceiptRef: null,
  }],
  actions: [{
    id: '00000000-0000-4000-8000-000000000301', incidentId: '00000000-0000-4000-8000-000000000101',
    fromStatus: 'triaged', toStatus: 'contained', actorUserId: fixtureUser.id,
    reasonCode: 'containment_recorded', resultStatus: 'applied', readbackStatus: 'passed',
    auditId: '00000000-0000-4000-8000-000000000401', createdAt: '2026-10-08T00:30:00.000Z',
  }],
});

function requestUrl(req, origin) {
  if (req.headers.host !== new URL(origin).host || typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) {
    throw new Error('FIXTURE_INPUT_INVALID');
  }
  const url = new URL(req.url, origin);
  if (url.origin !== origin || url.username || url.password) throw new Error('FIXTURE_INPUT_INVALID');
  return url;
}

function json(req, res, value, status = 200, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    ...headers,
  });
  return req.method === 'HEAD' ? res.end() : res.end(body);
}

function html(req, res, value) {
  const body = Buffer.from(value);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  });
  return req.method === 'HEAD' ? res.end() : res.end(body);
}

const cors = {
  'Access-Control-Allow-Origin': GATEWAY_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  Vary: 'Origin',
};

const supabase = http.createServer((req, res) => {
  let url;
  try { url = requestUrl(req, SUPABASE_ORIGIN); } catch { return json(req, res, { error: 'FIXTURE_INPUT_INVALID' }, 400); }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (url.pathname === '/auth/v1/user' && ['GET', 'HEAD'].includes(req.method)) return json(req, res, fixtureUser, 200, cors);
  if (url.pathname === '/rest/v1/rpc/get_current_privacy_eligibility' && req.method === 'POST') {
    return json(req, res, {
      schemaVersion: 1, eligible: true, reasonCode: 'PRIVACY_ELIGIBLE',
      policyVersionId: '00000000-0000-4000-8000-000000000001', policyVersion: '2026-08-04.1',
      contentSha256: '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b',
    }, 200, cors);
  }
  if (url.pathname === '/rest/v1/rpc/is_current_auth_session_active' && req.method === 'POST') return json(req, res, true, 200, cors);
  if (url.pathname === '/rest/v1/user_roles' && ['GET', 'HEAD'].includes(req.method)) return json(req, res, [{ role: 'admin' }], 200, cors);
  if (url.pathname === '/rest/v1/user_account_status' && ['GET', 'HEAD'].includes(req.method)) return json(req, res, [{ account_status: 'active' }], 200, cors);
  return json(req, res, { error: 'FIXTURE_ENDPOINT_NOT_FOUND' }, 404, cors);
});

const responseHeaders = new Set([
  'cache-control', 'content-length', 'content-security-policy', 'content-type', 'etag', 'last-modified',
  'link', 'location', 'permissions-policy', 'referrer-policy', 'set-cookie', 'vary', 'x-content-type-options',
  'x-frame-options', 'x-nextjs-cache', 'x-nextjs-prerender', 'x-nextjs-redirect', 'x-nextjs-stale-time',
]);

function forward(req, res) {
  const url = requestUrl(req, GATEWAY_ORIGIN);
  const headers = {
    host: new URL(NEXT_ORIGIN).host,
    'accept-encoding': 'identity',
    'x-e2e-admin-bypass': '1',
    'x-e2e-admin-bypass-token': syntheticToken,
  };
  for (const name of ['accept', 'accept-language', 'cookie', 'if-modified-since', 'if-none-match', 'next-router-prefetch', 'next-router-state-tree', 'next-url', 'rsc']) {
    if (typeof req.headers[name] === 'string' && !/[\r\n\0]/.test(req.headers[name])) headers[name] = req.headers[name];
  }
  const upstream = http.request({
    hostname: '127.0.0.1', port: NEXT_PORT, method: req.method, path: url.pathname + url.search, headers, timeout: 15_000,
  });
  upstream.on('response', (reply) => {
    const safe = {};
    for (const [name, value] of Object.entries(reply.headers)) {
      if (!responseHeaders.has(name) || value === undefined) continue;
      safe[name] = value;
    }
    res.writeHead(reply.statusCode ?? 502, safe);
    reply.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (!res.headersSent) json(req, res, { error: 'FIXTURE_UPSTREAM_UNAVAILABLE' }, 502);
    else res.destroy();
  });
  res.on('close', () => upstream.destroy());
  upstream.end();
}

const gateway = http.createServer((req, res) => {
  let url;
  try { url = requestUrl(req, GATEWAY_ORIGIN); } catch { return json(req, res, { error: 'FIXTURE_INPUT_INVALID' }, 400); }
  if (!['GET', 'HEAD'].includes(req.method)) return json(req, res, { error: 'FIXTURE_METHOD_NOT_ALLOWED' }, 405);
  if (url.pathname === '/__fixture/start') {
    return html(req, res, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>개인정보 사고 화면 합성 검증</title><style>body{min-height:100vh;margin:0;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f7f8fa;color:#111827}main{width:min(28rem,calc(100% - 2rem));padding:2rem;border:1px solid #d7dce3;border-radius:1rem;background:#fff}button{width:100%;min-height:44px;border:0;border-radius:.75rem;background:#be123c;color:#fff;font:inherit;font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid #38bdf8;outline-offset:3px}</style></head><body><main><h1>개인정보 사고 화면 합성 검증</h1><button id="open-verification" type="button">검증 화면 열기</button></main><script>document.getElementById('open-verification').addEventListener('click',function(){localStorage.setItem('tzudong:e2e-admin-shell-bypass','1');location.assign('/__fixture/session')})</script></body></html>`);
  }
  if (url.pathname === '/__fixture/session') {
    const cookie = `base64-${Buffer.from(JSON.stringify(fixtureSession())).toString('base64url')}`;
    res.writeHead(303, {
      'Set-Cookie': `sb-127-auth-token=${cookie}; Path=/; SameSite=Lax; Max-Age=86400`,
      Location: '/admin/privacy-incidents', 'Cache-Control': 'no-store',
    });
    return res.end();
  }
  if (url.pathname === '/api/admin/privacy-incidents') return json(req, res, privacyFixture);
  if (url.pathname === '/__local/naver-maps.js') return html(req, res, '<!doctype html>');
  try { return forward(req, res); } catch { return json(req, res, { error: 'FIXTURE_INPUT_INVALID' }, 400); }
});

for (const server of [supabase, gateway]) server.on('clientError', (_error, socket) => socket.destroy());
supabase.listen(SUPABASE_PORT, '127.0.0.1');
gateway.listen(GATEWAY_PORT, '127.0.0.1', () => {
  process.stdout.write(`privacy_fixture_ready=${GATEWAY_ORIGIN}/__fixture/start\n`);
});

let closing = false;
function close() {
  if (closing) return;
  closing = true;
  let open = 2;
  const done = () => { open -= 1; if (open === 0) process.exit(0); };
  const timer = setTimeout(() => process.exit(1), 3_000);
  timer.unref();
  gateway.close(done);
  supabase.close(done);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, close);
