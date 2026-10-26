import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const origin = 'https://edit-submit.invalid';
const actor = '11111111-1111-4111-8111-111111111111';
const restaurant = '22222222-2222-4222-8222-222222222222';
const submission = '33333333-3333-4333-8333-333333333333';
const root = resolve(import.meta.dir, '..');
const approved = new Set([
  'app/api/mypage/submissions/edit/route.ts', 'lib/restaurant-edit-submit-contract.ts',
  'lib/edit-restaurant-request-flow.ts', 'lib/restaurant-submission-submit-contract.ts',
  'lib/youtube-url.ts', 'lib/privacy/sanitize.ts', 'lib/privacy/eligibility.ts',
  'lib/privacy/policy.ts', 'lib/privacy/processing-inventory.ts',
  'lib/security/bounded-json-request.ts', 'lib/security/same-origin-mutation.ts',
  'lib/auth/callback-origin.ts', 'lib/auth/auth-redirect.ts',
]);
const validBody = () => ({ clientRequestKey: 'edit-fixture-request', restaurantId: restaurant, payload: {
  requestKind: 'edit', name: '합성 식당', address: '합성 영업장 주소', phone: '02-123-4567', category: ['분식'],
  youtube_reviews: [{ youtube_link: 'https://youtu.be/AbCdEfGhI12', tzuyang_review: '합성 영상 설명', restaurant_id: restaurant }],
} });
const bodyWithItems = (count: number) => {
  const body = validBody();
  body.payload.category = Array.from({ length: 10 }, (_, index) => `분류 ${index}`);
  body.payload.youtube_reviews = Array.from({ length: count }, (_, index) => ({
    ...body.payload.youtube_reviews[0], tzuyang_review: `합성 영상 설명 ${index}`,
  }));
  return body;
};

// Each case owns an isolated VM. Only Auth/database I/O are doubled; request,
// privacy, origin, bounded JSON, eligibility and payload validators run as source.
function fixture(settings: { guest?: boolean; denyEligibility?: boolean; staleEligibility?: boolean; rpcData?: unknown; rpcError?: boolean; throwRpc?: boolean } = {}) {
  const state = { serviceCalls: 0, rpcCalls: 0, eligibilityCalls: 0, params: null as Record<string, unknown> | null };
  const context = vm.createContext({
    URL, Request, Response, Headers, ReadableStream, TextEncoder, TextDecoder, AbortController,
    Buffer, setTimeout, clearTimeout, crypto: webcrypto,
    process: { env: { NODE_ENV: 'test', NEXT_PUBLIC_SITE_URL: origin } },
  });
  const intoRealm = vm.runInContext('(value) => JSON.parse(value)', context);
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const forbidden = () => { throw new Error('FIXTURE_UNAPPROVED_IO'); };
  const providers: Record<string, unknown> = {
    'next/server': require('next/server'),
    '@/lib/auth/browser-logout': { captureBrowserLogout: forbidden },
    '@/lib/home-auth-events': { dispatchHomeAuthSessionUpdated: forbidden },
    '@/lib/supabase/server': { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: settings.guest ? null : { id: actor } }, error: null }) },
      rpc: async (name: string) => {
        if (name !== 'get_current_privacy_eligibility') return forbidden();
        state.eligibilityCalls++;
        const policy = load('lib/privacy/policy.ts');
        return { error: null, data: intoRealm(JSON.stringify({ schemaVersion: 1,
          eligible: !settings.denyEligibility, reasonCode: settings.denyEligibility ? 'PRIVACY_AGE_ATTESTATION_REQUIRED' : 'PRIVACY_ELIGIBLE',
          policyVersionId: '44444444-4444-4444-8444-444444444444', policyVersion: policy.PRIVACY_POLICY_VERSION,
          contentSha256: settings.staleEligibility ? '0'.repeat(64) : policy.PRIVACY_POLICY_CONTENT_SHA256,
        })) };
      },
    }) },
    '@/lib/supabase/service-role': { createSupabaseServiceRoleClient: () => {
      state.serviceCalls++;
      return { rpc: async (name: string, params: Record<string, unknown>) => {
        if (name !== 'submit_restaurant_edit_request') return forbidden();
        state.rpcCalls++; state.params = params;
        if (settings.throwRpc) throw new Error('SYNTHETIC_PROVIDER_DIAGNOSTIC');
        return { error: settings.rpcError ? { message: 'SYNTHETIC_PROVIDER_DIAGNOSTIC' } : null,
          data: intoRealm(JSON.stringify(settings.rpcData ?? { ok: true, code: 'EDIT_SUBMISSION_SAVED', id: submission, status: 'pending', itemCount: 1 })) };
      } };
    } },
  };
  function load(relative: string): Record<string, unknown> {
    if (!approved.has(relative)) return forbidden();
    const cached = cache.get(relative); if (cached) return cached.exports;
    const loadedModule = { exports: {} }; cache.set(relative, loadedModule);
    const source = readFileSync(resolve(root, relative), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = (name: string) => {
      if (Object.hasOwn(providers, name)) return providers[name];
      const next = name.startsWith('@/') ? `${name.slice(2)}.ts` : name.startsWith('.') ? `${posix.normalize(posix.join(posix.dirname(relative), name))}.ts` : '';
      return load(next);
    };
    new vm.Script(`(function(require,module,exports){${compiled}\n})`, { filename: relative }).runInContext(context)(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const post = load('app/api/mypage/submissions/edit/route.ts').POST as (request: Request) => Promise<Response>;
  const rawRequest = (body: string, headers: Record<string, string> = {}) => new Request(`${origin}/api/mypage/submissions/edit`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-tzudong-actor-id': actor, ...headers }, body,
  });
  const request = (body: unknown = validBody(), headers: Record<string, string> = {}) => rawRequest(JSON.stringify(body), headers);
  const validates = (body: unknown) => (load('lib/restaurant-edit-submit-contract.ts').isRestaurantEditSubmitBody as (value: unknown) => boolean)(intoRealm(JSON.stringify(body)));
  return { state, post, request, rawRequest, validates };
}

test('edit request binds the authenticated actor and complete canonical payload to one RPC', async () => {
  const f = fixture(); const response = await f.post(f.request());
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ ok: true, code: 'EDIT_SUBMISSION_SAVED', id: submission, status: 'pending', itemCount: 1 });
  expect([f.state.serviceCalls, f.state.rpcCalls, f.state.eligibilityCalls]).toEqual([1, 1, 1]);
  expect(f.state.params?.p_user_id).toBe(actor);
  expect(f.state.params?.p_target_restaurant_id).toBe(restaurant);
  expect((f.state.params?.p_payload as ReturnType<typeof validBody>['payload']).youtube_reviews[0].youtube_link).toBe('https://www.youtube.com/watch?v=AbCdEfGhI12');
});

for (const count of [24, 100]) test(`edit accepts ${count} items and ten categories without truncating the payload`, async () => {
  const f = fixture({ rpcData: { ok: true, code: 'EDIT_SUBMISSION_SAVED', id: submission, status: 'pending', itemCount: count } });
  const body = bodyWithItems(count);
  const response = await f.post(f.request(body));
  expect(response.status).toBe(200);
  expect((await response.json()).itemCount).toBe(count);
  expect([f.state.serviceCalls, f.state.rpcCalls, f.state.eligibilityCalls]).toEqual([1, 1, 1]);
  expect(f.state.params?.p_user_id).toBe(actor);
  const payload = f.state.params?.p_payload as ReturnType<typeof validBody>['payload'];
  expect(payload.category).toHaveLength(10);
  expect(payload.youtube_reviews).toHaveLength(count);
  expect(payload.youtube_reviews.map(item => item.tzuyang_review).sort()).toEqual(body.payload.youtube_reviews.map(item => item.tzuyang_review).sort());
  expect(payload.youtube_reviews.every(item => item.youtube_link === 'https://www.youtube.com/watch?v=AbCdEfGhI12' && item.restaurant_id === restaurant)).toBe(true);
});

for (const [label, mutate] of [
  ['101 items', body => { body.payload.youtube_reviews.push({ ...body.payload.youtube_reviews[0] }); }],
  ['eleven categories', body => { body.payload.category.push('초과 분류'); }],
  ['PII in the last review', body => { body.payload.youtube_reviews[99].tzuyang_review = 'fixture@example.invalid'; }],
  // Canonicalization removes this query; the raw-payload assertion must still inspect it.
  ['PII in the last raw URL', body => { body.payload.youtube_reviews[99].youtube_link += '?si=010-1234-5678'; }],
] as Array<[string, (body: ReturnType<typeof validBody>) => void]>) test(`edit rejects ${label} at maximum traversal without privileged work`, async () => {
  const f = fixture(); const body = bodyWithItems(100); mutate(body);
  expect(f.validates(body)).toBe(label.startsWith('PII'));
  const response = await f.post(f.request(body));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ ok: false, code: 'EDIT_SUBMISSION_INVALID' });
  expect([f.state.serviceCalls, f.state.rpcCalls, f.state.eligibilityCalls]).toEqual([0, 0, 0]);
});

for (const reviewLength of [4_000, 4_001]) test(`edit preserves the ${reviewLength}-character review boundary with 100 items`, async () => {
  const f = fixture({ rpcData: { ok: true, code: 'EDIT_SUBMISSION_SAVED', id: submission, status: 'pending', itemCount: 100 } });
  const body = bodyWithItems(100);
  body.payload.name = '가'.repeat(160);
  body.payload.address = '나'.repeat(500);
  body.payload.category = Array.from({ length: 10 }, (_, index) => `${index}${'다'.repeat(49)}`);
  body.payload.youtube_reviews[99].tzuyang_review = '라'.repeat(reviewLength);
  const accepted = reviewLength === 4_000;
  expect(f.validates(body)).toBe(accepted);
  const response = await f.post(f.request(body));
  expect(response.status).toBe(accepted ? 200 : 400);
  expect([f.state.serviceCalls, f.state.rpcCalls, f.state.eligibilityCalls]).toEqual(accepted ? [1, 1, 1] : [0, 0, 0]);
  if (accepted) {
    const payload = f.state.params?.p_payload as ReturnType<typeof validBody>['payload'];
    expect(payload.youtube_reviews.some(item => item.tzuyang_review.length === 4_000)).toBe(true);
  }
});

for (const extraByte of [0, 1]) test(`edit preserves the 64 KiB transport boundary plus ${extraByte} byte`, async () => {
  const f = fixture({ rpcData: { ok: true, code: 'EDIT_SUBMISSION_SAVED', id: submission, status: 'pending', itemCount: 100 } });
  const json = JSON.stringify(bodyWithItems(100));
  // JSON whitespace changes transport size without exceeding any field limit.
  const raw = json + ' '.repeat(64 * 1024 - Buffer.byteLength(json) + extraByte);
  expect(Buffer.byteLength(raw)).toBe(64 * 1024 + extraByte);
  const response = await f.post(f.rawRequest(raw));
  expect(response.status).toBe(extraByte ? 400 : 200);
  expect([f.state.serviceCalls, f.state.rpcCalls, f.state.eligibilityCalls]).toEqual(extraByte ? [0, 0, 0] : [1, 1, 1]);
});

for (const [label, settings, headers, status] of [
  ['cross origin', {}, { origin: 'https://other.invalid' }, 403],
  ['guest', { guest: true }, {}, 401],
  ['changed actor', {}, { 'x-tzudong-actor-id': '55555555-5555-4555-8555-555555555555' }, 409],
  ['missing actor', {}, { 'x-tzudong-actor-id': '' }, 409],
  ['ineligible', { denyEligibility: true }, {}, 403],
  ['stale receipt', { staleEligibility: true }, {}, 403],
] as const) test(`edit rejects ${label} before service access`, async () => {
  const f = fixture(settings); const response = await f.post(f.request(validBody(), headers));
  expect(response.status).toBe(status); expect(f.state.serviceCalls).toBe(0); expect(f.state.rpcCalls).toBe(0);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

for (const [label, mutate] of [
  ['extra actor field', body => { body.userId = actor; }],
  ['oversized body', body => { body.payload.name = '가'.repeat(64 * 1024); }],
  ['empty items', body => { body.payload.youtube_reviews = []; }],
  ['too many items', body => { body.payload.youtube_reviews = Array(101).fill(body.payload.youtube_reviews[0]); }],
  ['unbound target', body => { body.payload.youtube_reviews[0].restaurant_id = actor; }],
  ['external video', body => { body.payload.youtube_reviews[0].youtube_link = 'https://other.invalid/video'; }],
  ['extra item field', body => { body.payload.youtube_reviews[0].user_id = actor; }],
  ['personal phone', body => { body.payload.phone = '010-1234-5678'; }],
  ['private free text', body => { body.payload.youtube_reviews[0].tzuyang_review = 'fixture@example.invalid'; }],
  ['duplicate categories', body => { body.payload.category = ['분식', ' 분식 ']; }],
] as Array<[string, (body: any) => void]>) test(`edit rejects ${label} without privileged work`, async () => {
  const f = fixture(); const body = validBody(); mutate(body);
  const response = await f.post(f.request(body));
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, code: 'EDIT_SUBMISSION_INVALID' });
  expect(f.state.serviceCalls).toBe(0); expect(f.state.rpcCalls).toBe(0);
});

for (const [label, settings, status, code] of [
  ['conflict', { rpcData: { ok: false, code: 'EDIT_SUBMISSION_CONFLICT' } }, 409, 'EDIT_SUBMISSION_CONFLICT'],
  ['RPC error', { rpcError: true }, 500, 'EDIT_SUBMISSION_FAILED'],
  ['thrown provider error', { throwRpc: true }, 500, 'EDIT_SUBMISSION_FAILED'],
  ['partial success', { rpcData: { ok: true } }, 500, 'EDIT_SUBMISSION_FAILED'],
  ['wrong item count', { rpcData: { ok: true, code: 'EDIT_SUBMISSION_SAVED', id: submission, status: 'pending', itemCount: 2 } }, 500, 'EDIT_SUBMISSION_FAILED'],
] as const) test(`edit ${label} returns only a fixed result`, async () => {
  const f = fixture(settings); const response = await f.post(f.request());
  expect(response.status).toBe(status); expect(await response.json()).toEqual({ ok: false, code });
  expect(response.headers.get('cache-control')).toBe('no-store'); expect(f.state.rpcCalls).toBe(1);
});
