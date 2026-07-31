import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BOUNDED_JSON_REQUEST_ERROR,
  BOUNDED_JSON_REQUEST_READ_TIMEOUT_MS,
  readBoundedJsonRequest,
} from '../lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '../lib/security/same-origin-mutation';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

const routeSource = {
  accountDeletion: source('app/api/account/delete/route.ts'),
  privacyIncidents: source('app/api/admin/privacy-incidents/route.ts'),
  marketingCampaigns: source('app/api/admin/marketing-campaigns/route.ts'),
  notifications: source('app/api/admin/notifications/route.ts'),
};
const internalAccountDeletionWorkerSource = source('app/api/internal/account-deletion/route.ts');
const marketingCampaignHelperSource = source('lib/privacy/marketing-campaigns.ts');

function handler(sourceText: string, method: 'POST' | 'PATCH' | 'DELETE') {
  const routeSignature = `export async function ${method}(request: NextRequest)`;
  const deletionSignature = method === 'DELETE'
    && sourceText.includes('export const DELETE = deleteAccount;')
    ? 'const deleteAccount = async (request: NextRequest) =>'
    : null;
  const signature = sourceText.includes(routeSignature)
    ? routeSignature
    : deletionSignature;
  expect(signature).not.toBeNull();
  const start = signature ? sourceText.indexOf(signature) : -1;
  expect(start).toBeGreaterThanOrEqual(0);

  const exportEnd = sourceText.indexOf('export async function ', start + (signature?.length ?? 0));
  const ends = [exportEnd].filter((value) => value >= 0);
  const end = ends.length ? Math.min(...ends) : -1;
  return sourceText.slice(start, end === -1 ? undefined : end);
}

function expectMutationBoundary(
  sourceText: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  firstStatefulOperation: string,
) {
  const routeHandler = handler(sourceText, method);
  const guard = 'if (!isTrustedSameOriginMutation(request))';
  const reader = 'readBoundedJsonRequest(request, MAX_REQUEST_BYTES)';

  expect(routeHandler).toContain(guard);
  expect(routeHandler).toContain(reader);
  expect(routeHandler).toContain(firstStatefulOperation);
  expect(routeHandler.indexOf(guard)).toBeLessThan(routeHandler.indexOf(reader));
  expect(routeHandler.indexOf(reader)).toBeLessThan(routeHandler.indexOf(firstStatefulOperation));
}

function requestFromBody(
  body: ReadableStream<Uint8Array> | null,
  headers: HeadersInit = {},
  signal: AbortSignal = new AbortController().signal,
) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('content-type')) requestHeaders.set('content-type', 'application/json');

  return {
    headers: requestHeaders,
    body,
    signal,
  } as unknown as Request;
}

function requestFromChunks(
  chunks: Uint8Array[],
  headers: HeadersInit = {},
  signal?: AbortSignal,
) {
  return requestFromBody(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), headers, signal);
}

async function resolvesWithin<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('request reader did not settle')), milliseconds);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

describe('privacy mutation request security', () => {
  test('privacy mutations use bounded bodies before privileged work, except the explicit fail-closed deletion gate', () => {
    for (const route of [
      routeSource.privacyIncidents,
      routeSource.marketingCampaigns,
      routeSource.notifications,
    ]) {
      expect(route).toContain('@/lib/security/bounded-json-request');
      expect(route).toContain('@/lib/security/same-origin-mutation');
      expect(route).not.toContain('request.text()');
      expect(route).not.toContain('request.json()');
      expect(route).not.toContain('readBoundedJsonBody');
      expect(route).not.toContain('parseBoundedJsonBody');
      expect(route).toContain('Cache-Control');
    }

    expect(routeSource.accountDeletion).toContain('@/lib/security/same-origin-mutation');
    expect(routeSource.accountDeletion).not.toContain('readBoundedJsonRequest');
    expectMutationBoundary(routeSource.privacyIncidents, 'POST', 'const supabase = createSupabaseServiceRoleClient()');
    expectMutationBoundary(routeSource.privacyIncidents, 'PATCH', 'const supabase = createSupabaseServiceRoleClient()');
    expectMutationBoundary(routeSource.marketingCampaigns, 'POST', 'return handleMarketingCampaignRequest(initialAdmin.userId, bodyResult.value);');
    expect(routeSource.marketingCampaigns).toContain("from '@/lib/privacy/marketing-campaigns'");
    expect(marketingCampaignHelperSource).toContain('export async function handleMarketingCampaignRequest');
    expect(marketingCampaignHelperSource).toContain('export async function resolveMarketingProviderUrl');
    expect(marketingCampaignHelperSource).toContain('export function createMarketingCampaignPost');
    expectMutationBoundary(routeSource.notifications, 'POST', 'const supabase = createSupabaseServiceRoleClient()');
  });
  test('account deletion previews and applies only for the Bearer subject in fail-closed order', () => {
    const accountDeletion = routeSource.accountDeletion;
    const previewStart = accountDeletion.indexOf('const previewAccountDeletion = async');
    const previewGuard = accountDeletion.indexOf('if (!isTrustedSameOriginMutation(request))', previewStart);
    const previewBody = accountDeletion.indexOf('isAccountDeletionPreviewRequest(body)', previewStart);
    const previewBearer = accountDeletion.indexOf('const bearerToken = bearerTokenFromAuthorization', previewStart);
    const previewRpc = accountDeletion.indexOf("rpc('preview_account_deletion'", previewStart);
    const applyStart = accountDeletion.indexOf('const deleteAccount = async');
    const applyGuard = accountDeletion.indexOf('if (!isTrustedSameOriginMutation(request))', applyStart);
    const applyBody = accountDeletion.indexOf('parseAccountDeletionApplyRequest', applyStart);
    const atomicBegin = accountDeletion.indexOf("rpc('begin_account_deletion_apply_with_reauth'", applyStart);

    expect(previewGuard).toBeGreaterThan(previewStart);
    expect(previewBody).toBeGreaterThan(previewGuard);
    expect(previewBearer).toBeGreaterThan(previewBody);
    expect(previewRpc).toBeGreaterThan(previewBearer);
    expect(applyGuard).toBeGreaterThan(applyStart);
    expect(applyBody).toBeGreaterThan(applyGuard);
    expect(atomicBegin).toBeGreaterThan(applyBody);
    expect(accountDeletion).toContain("Object.keys(value).length === 1");
    expect(accountDeletion).toContain("hasOnlyKeys(value, ['targetUserId'])");
    expect(accountDeletion).toContain("p_actor_user_id: user.id");
    expect(accountDeletion).toContain("p_target_user_id: user.id");
    expect(accountDeletion).toContain("p_reauthenticated_at: user.last_sign_in_at");
    expect(accountDeletion).toContain('supabase.auth.getUser(bearerToken)');
    expect(accountDeletion).toContain('supabase.auth.getClaims(bearerToken)');
    expect(accountDeletion).toContain('claims?.claims.sub !== user.id');
    expect(accountDeletion).toContain('Object.keys(value).length !== 7');
    expect(accountDeletion).toContain("begin_account_deletion_apply_with_reauth");
    expect(accountDeletion).not.toContain("begin_account_deletion_apply'");
    expect(accountDeletion).not.toContain('requireAdmin');
    expect(accountDeletion).not.toContain("supabase.rpc('consume_account_deletion_reauth_proof'");
  });
  test('account deletion requires exactly one RPC row and leaves durable work outside the request boundary', () => {
    const accountDeletion = routeSource.accountDeletion;

    expect(accountDeletion).toContain('Array.isArray(value) && value.length === 1');
    expect(accountDeletion).toContain('parseAccountDeletionPreview');
    expect(accountDeletion).not.toContain('runAccountDeletionExternalWorker');
    expect(accountDeletion).not.toContain('auth.admin.deleteUser');
    expect(accountDeletion).not.toContain('.storage.from(');
    expect(accountDeletion).not.toContain('p_attempt_token:');
  });
  test('the internal deletion worker requires a server-only capability and strict bounded JSON before service-role work', () => {
    const worker = internalAccountDeletionWorkerSource;
    const guard = 'if (!serverOnlyRequest(request) || !validWorkerCapability(request))';
    const reader = 'readBoundedJsonRequest(request, MAX_BODY_BYTES)';
    const serviceRole = 'supabase = createSupabaseServiceRoleClient()';
    const workerRun = 'return workerResponse(await runAccountDeletionExternalWorker(';

    expect(worker).toContain('@/lib/security/bounded-json-request');
    expect(worker).toContain(guard);
    expect(worker).toContain(reader);
    expect(worker).toContain(serviceRole);
    expect(worker).toContain(workerRun);
    expect(worker).not.toContain('request.text()');
    expect(worker).not.toContain('request.json()');
    expect(worker.indexOf(guard)).toBeLessThan(worker.indexOf(reader));
    expect(worker.indexOf(reader)).toBeLessThan(worker.indexOf(serviceRole));
    expect(worker.indexOf(serviceRole)).toBeLessThan(worker.indexOf(workerRun));
    expect(worker.slice(worker.indexOf(workerRun))).not.toContain('catch');
    expect(worker).toContain("'account_deletion_worker_unauthorized'");
    expect(worker).toContain("'account_deletion_worker_invalid_request'");
    expect(worker).toContain("'account_deletion_worker_unavailable'");
  });

  test('shared reader rejects strict media types, malformed lengths, overflow, and length mismatches', async () => {
    const encoder = new TextEncoder();
    const validJson = encoder.encode('{"action":"preview"}');

    for (const contentType of ['text/plain', 'application/problem+json', 'application/json; charset=iso-8859-1']) {
      await expect(readBoundedJsonRequest(
        requestFromChunks([validJson], { 'content-type': contentType }),
        128,
      )).resolves.toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType,
      });
    }

    for (const contentLength of ['12.5', '+12', '12, 12']) {
      await expect(readBoundedJsonRequest(
        requestFromChunks([validJson], { 'content-length': contentLength }),
        128,
      )).resolves.toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.invalidContentLength,
      });
    }

    let earlyCancellation = false;
    const oversizedDeclaredLength = requestFromBody(new ReadableStream<Uint8Array>({
      cancel() {
        earlyCancellation = true;
      },
    }), { 'content-length': '129' });
    await expect(readBoundedJsonRequest(oversizedDeclaredLength, 128)).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
    });
    expect(earlyCancellation).toBe(true);

    await expect(readBoundedJsonRequest(
      requestFromChunks([
        encoder.encode('{"action":"'),
        encoder.encode('x'.repeat(64)),
        encoder.encode('"}'),
      ]),
      32,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
    });

    await expect(readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{}')], { 'content-length': '3' }),
      128,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidContentLength,
    });
  });

  test('shared reader bounds hanging cancellation without waiting for it', async () => {
    let cancellationStarted = false;
    const hangingCancellation = requestFromBody(new ReadableStream<Uint8Array>({
      cancel() {
        cancellationStarted = true;
        return new Promise<void>(() => {});
      },
    }), { 'content-type': 'text/plain' });

    await expect(resolvesWithin(
      readBoundedJsonRequest(hangingCancellation, 128),
      BOUNDED_JSON_REQUEST_READ_TIMEOUT_MS,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType,
    });
    expect(cancellationStarted).toBe(true);
  });

  test('shared reader requires a complete body and bounds never-ending and slow-drip streams at a fixed total deadline', async () => {
    const encoder = new TextEncoder();
    let neverEndingCancelled = false;
    const neverEnding = requestFromBody(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{}'));
      },
      cancel() {
        neverEndingCancelled = true;
      },
    }), { 'content-length': '2' });
    await expect(resolvesWithin(
      readBoundedJsonRequest(neverEnding, 128),
      BOUNDED_JSON_REQUEST_READ_TIMEOUT_MS + 250,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    expect(neverEndingCancelled).toBe(true);

    let slowDripCancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const slowDrip = requestFromBody(new ReadableStream<Uint8Array>({
      start(controller) {
        interval = setInterval(() => controller.enqueue(encoder.encode(' ')), 10);
      },
      cancel() {
        slowDripCancelled = true;
        if (interval !== undefined) clearInterval(interval);
      },
    }));
    await expect(resolvesWithin(
      readBoundedJsonRequest(slowDrip, 128),
      BOUNDED_JSON_REQUEST_READ_TIMEOUT_MS + 250,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    expect(slowDripCancelled).toBe(true);
  });

  test('shared reader races request aborts and cancels the body', async () => {
    const abortController = new AbortController();
    let cancelled = false;
    const pendingRequest = requestFromBody(new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }), {}, abortController.signal);

    const result = readBoundedJsonRequest(pendingRequest, 128);
    abortController.abort();

    await expect(resolvesWithin(result, 250)).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    expect(cancelled).toBe(true);
  });

  test('shared reader rejects fatal UTF-8, partial JSON, and duplicate members before parsing', async () => {
    const encoder = new TextEncoder();
    await expect(readBoundedJsonRequest(
      requestFromChunks([new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xc3, 0x28, 0x7d])]),
      128,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    await expect(readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{"action":')]),
      128,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    await expect(readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{"action":"preview","action":"apply"}')]),
      128,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    await expect(readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{"action":"preview","\\u0061":1,"a":2}')]),
      128,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    await expect(readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{"request":{"action":"preview","action":"apply"}}')]),
      128,
    )).resolves.toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
  });

  test('shared reader accepts a complete exact UTF-8 JSON body and same-origin guard preserves bearer-only semantics', async () => {
    const encoder = new TextEncoder();
    const payload = encoder.encode('{"action":"preview","data":{}}');
    await expect(readBoundedJsonRequest(
      requestFromChunks([payload], {
        'content-type': 'application/json; charset=UTF-8',
        'content-length': String(payload.byteLength),
      }),
      128,
    )).resolves.toEqual({ ok: true, value: { action: 'preview', data: {} } });

    const productionEnv = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://www.tzudong.app',
    } as NodeJS.ProcessEnv;
    expect(isTrustedSameOriginMutation(new Request('https://www.tzudong.app/api/admin/notifications', {
      method: 'POST',
      headers: {
        cookie: 'sb-auth-token=session',
        origin: 'https://attacker.example',
      },
    }), productionEnv)).toBe(false);
    expect(isTrustedSameOriginMutation(new Request('https://www.tzudong.app/api/internal/privacy-retention', {
      method: 'POST',
      headers: {
        authorization: 'Bearer service-token',
        origin: 'https://attacker.example',
      },
    }), productionEnv)).toBe(true);
  });
});
