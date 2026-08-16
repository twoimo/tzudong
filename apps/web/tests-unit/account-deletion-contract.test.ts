import { describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

import {
  ACCOUNT_DELETION_CONFIRMATION_TEXT,
  MAX_ACCOUNT_DELETION_STORAGE_RECEIPT_REFS,
  isAccountDeletionConfirmation,
  isAccountDeletionPreviewFresh,
  parseAccountDeletionPreview,
  parseAccountDeletionReceipt,
  parseAccountDeletionStatus,
  type AccountDeletionPreview,
} from '../lib/privacy/account-deletion';

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const g010Migration = () => readFileSync(
  join(import.meta.dir, '..', '..', '..', 'backend', 'supabase', 'migrations', '20260712000300_g010_account_deletion.sql'),
  'utf8',
);
const g014Migration = () => readFileSync(
  join(import.meta.dir, '..', '..', '..', 'backend', 'supabase', 'migrations', '20260713002300_g014_account_deletion_state_machine.sql'),
  'utf8',
);
const g014ReceiptParityMigration = () => readFileSync(
  join(import.meta.dir, '..', '..', '..', 'backend', 'supabase', 'migrations', '20260713002600_g014_account_deletion_receipt_parity.sql'),
  'utf8',
);
const route = () => source('app/api/account/delete/route.ts');
const generatedTypes = () => source('integrations/supabase/types.ts');
const profilePage = () => source('app/mypage/profile/page.tsx');
const workerWorkflow = () => readFileSync(
  join(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'account-deletion-worker.yml'),
  'utf8',
);

const ACCOUNT_DELETION_OWNER_ID = '1f2c9d1a-74f8-4e12-9ba7-cd8d3d04ec16';
const ACCOUNT_DELETION_ADMIN_TARGET_ID = '2f2c9d1a-74f8-4e12-9ba7-cd8d3d04ec16';
const ACCOUNT_DELETION_PREVIEW_HASH = 'a'.repeat(64);
const ACCOUNT_DELETION_MANIFEST_HASH = 'b'.repeat(64);
const OBJECT_LOCATOR_HASH = 'c'.repeat(64);
const OBJECT_VERSION_HASH = 'd'.repeat(64);
const PROVIDER_RECEIPT_HASH = 'e'.repeat(64);
const AUTH_RECEIPT_REF = 'external-auth-receipt-0001';

let authenticatedActorCalls = 0;
let rpcCalls: Array<{ name: string; args: unknown }> = [];
let rpcResult: (name: string, args: unknown) => unknown = () => {
  throw new Error('unexpected RPC');
};
let serviceRoleRpcCalls = 0;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
let bearerClientOptions: unknown = null;
mock.module('@supabase/supabase-js', () => ({
  createClient: (_url: string, _anonKey: string, options: unknown) => {
    bearerClientOptions = options;
    return {
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return rpcResult(name, args);
      },
    };
  },
}));

mock.module('@/lib/supabase/server', () => ({
  getSupabaseServerConfig: () => ({
    url: 'https://example.supabase.co',
    anonKey: 'test-anon-key',
  }),
  createClient: async () => ({
    auth: {
      getUser: async () => {
        authenticatedActorCalls += 1;
        return {
          data: {
            user: {
              id: ACCOUNT_DELETION_OWNER_ID,
              last_sign_in_at: '2026-07-13T00:00:00.000Z',
            },
          },
          error: null,
        };
      },
      getClaims: async () => ({
        data: { claims: { sub: ACCOUNT_DELETION_OWNER_ID } },
        error: null,
      }),
    },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return rpcResult(name, args);
    },
  }),
}));
mock.module('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => ({
    auth: {
      getUser: async (bearerToken: string) => {
        authenticatedActorCalls += 1;
        expect(bearerToken).toBe('test-bearer-token');
        return {
          data: {
            user: {
              id: ACCOUNT_DELETION_OWNER_ID,
              last_sign_in_at: '2026-07-13T00:00:00.000Z',
            },
          },
          error: null,
        };
      },
      getClaims: async (bearerToken: string) => {
        expect(bearerToken).toBe('test-bearer-token');
        return {
          data: { claims: { sub: ACCOUNT_DELETION_OWNER_ID } },
          error: null,
        };
      },
    },
    rpc: async (name: string, args: unknown) => {
      serviceRoleRpcCalls += 1;
      rpcCalls.push({ name, args });
      return rpcResult(name, args);
    },
  }),
}));

const accountDeletionRoute = await import('../app/api/account/delete/route.ts?g028-comprehensive-account-deletion-contract');
const accountDeletionPost = accountDeletionRoute.POST as (request: NextRequest) => Promise<Response>;
const accountDeletionDelete = accountDeletionRoute.DELETE as (request: NextRequest) => Promise<Response>;
const accountDeletionGet = accountDeletionRoute.GET as (request: NextRequest) => Promise<Response>;
mock.restore();

function resetAccountDeletionRouteSpies() {
  authenticatedActorCalls = 0;
  rpcCalls = [];
  serviceRoleRpcCalls = 0;
  bearerClientOptions = null;
  rpcResult = () => {
    throw new Error('unexpected RPC');
  };
}

function accountDeletionRequest(
  method: 'POST' | 'DELETE',
  body: string,
  includeOrigin = true,
) {
  return new NextRequest('http://localhost:3000/api/account/delete', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: includeOrigin ? 'http://localhost:3000' : 'https://evil.example',
      Authorization: 'Bearer test-bearer-token',
      ...(includeOrigin ? {} : { Cookie: 'session=test' }),
    },
    body,
  });
}
function accountDeletionStatusRequest(query: string) {
  return new NextRequest(`http://localhost:3000/api/account/delete?${query}`, {
    method: 'GET',
  });
}

const validApplyRequest = () => ({
  userId: ACCOUNT_DELETION_OWNER_ID,
  proofId: '3f2c9d1a-74f8-4e12-9ba7-cd8d3d04ec16',
  requestId: ACCOUNT_DELETION_OWNER_ID,
  previewHash: ACCOUNT_DELETION_PREVIEW_HASH,
  confirmationText: ACCOUNT_DELETION_CONFIRMATION_TEXT,
  idempotencyKey: 'deletion-key-0001',
  sourceManifestHash: ACCOUNT_DELETION_MANIFEST_HASH,
});
const idempotencyKeyBinding = (key = validApplyRequest().idempotencyKey) =>
  createHash('sha256')
    .update(`g038-account-deletion-idempotency-binding:v1\n${key}`, 'utf8')
    .digest('hex');

const counts = {
  delete: 1,
  anonymize: 1,
  separate: 0,
  retain: 0,
};
const rowCounts = {
  delete_count: counts.delete,
  anonymize_count: counts.anonymize,
  separate_count: counts.separate,
  retain_count: counts.retain,
};

const preview = (expiresAt: string): AccountDeletionPreview => ({
  requestId: ACCOUNT_DELETION_OWNER_ID,
  previewHash: ACCOUNT_DELETION_PREVIEW_HASH,
  expiresAt,
  policyVersion: 'g014-account-deletion-v1',
  sourceManifestHash: ACCOUNT_DELETION_MANIFEST_HASH,
  counts,
});
const previewRow = (expiresAt: string) => ({
  request_id: ACCOUNT_DELETION_OWNER_ID,
  preview_hash: ACCOUNT_DELETION_PREVIEW_HASH,
  preview_expires_at: expiresAt,
  policy_version: 'g014-account-deletion-v1',
  status: 'previewed',
  reason_code: 'PREVIEW_READY',
  ...rowCounts,
  source_manifest_hash: ACCOUNT_DELETION_MANIFEST_HASH,
});

const storageReceiptRefs = (length = 1) => Array.from({ length }, (_, index) => ({
  object_locator_hash: index === 0
    ? OBJECT_LOCATOR_HASH
    : (index + 12).toString(16).padStart(64, '0'),
  object_version_hash: index === 0
    ? OBJECT_VERSION_HASH
    : (index + 112).toString(16).padStart(64, '0'),
  provider_receipt_ref: index === 0
    ? 'provider-receipt-0001'
    : `provider-receipt-${String(index + 1).padStart(4, '0')}`,
  provider_receipt_hash: index === 0
    ? PROVIDER_RECEIPT_HASH
    : (index + 212).toString(16).padStart(64, '0'),
}));

const appliedRow = (
  sourceManifestHash = ACCOUNT_DELETION_MANIFEST_HASH,
  receiptRefCount = 1,
) => ({
  request_id: ACCOUNT_DELETION_OWNER_ID,
  status: 'applied',
  reason_code: 'APPLIED',
  ...rowCounts,
  db_readback_passed: true,
  storage_readback_passed: true,
  session_readback_passed: true,
  auth_readback_passed: true,
  storage_receipt_refs: storageReceiptRefs(receiptRefCount),
  auth_receipt_ref: AUTH_RECEIPT_REF,
  source_manifest_hash: sourceManifestHash,
  idempotency_key_binding_sha256: idempotencyKeyBinding(),
});

const applyingRow = (overrides: Record<string, unknown> = {}) => ({
  request_id: ACCOUNT_DELETION_OWNER_ID,
  status: 'applying',
  reason_code: 'APPLY_STARTED',
  ...rowCounts,
  db_readback_passed: false,
  storage_readback_passed: false,
  session_readback_passed: false,
  auth_readback_passed: false,
  storage_receipt_refs: null,
  auth_receipt_ref: null,
  source_manifest_hash: ACCOUNT_DELETION_MANIFEST_HASH,
  idempotency_key_binding_sha256: idempotencyKeyBinding(),
  ...overrides,
});

const databaseRow = () => ({
  request_id: ACCOUNT_DELETION_OWNER_ID,
  status: 'applying',
  reason_code: 'DB_READBACK_PASSED',
  db_readback_passed: true,
  session_readback_passed: false,
  source_manifest_hash: ACCOUNT_DELETION_MANIFEST_HASH,
});
const ownerStatusAppliedRow = () => appliedRow();
const ownerStatusApplyingRow = () => applyingRow();

const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

describe('G014 durable account deletion contract', () => {
  test('parses every exact account-deletion status envelope', () => {
    const receipt = parseAccountDeletionReceipt({
      requestId: ACCOUNT_DELETION_OWNER_ID,
      status: 'applied',
      reasonCode: 'APPLIED',
      sourceManifestHash: ACCOUNT_DELETION_MANIFEST_HASH,
      counts,
      readback: { database: true, storage: true, sessions: true, auth: true },
      storageReceiptRefs: [],
      authReceiptRef: AUTH_RECEIPT_REF,
    });
    if (!receipt) throw new Error('valid durable receipt did not parse');

    expect(parseAccountDeletionStatus({ status: 'in_progress' })).toEqual({ status: 'in_progress' });
    expect(parseAccountDeletionStatus({
      status: 'applied', reasonCode: 'APPLIED', counts, receipt,
    })).not.toBeNull();
    expect(parseAccountDeletionStatus({
      status: 'partial', reasonCode: 'STORAGE_CLEANUP_FAILED', counts,
    })).not.toBeNull();
    expect(parseAccountDeletionStatus({
      status: 'failed', reasonCode: 'DB_CLEANUP_FAILED', counts,
    })).not.toBeNull();
    expect(parseAccountDeletionStatus({ status: 'in_progress', reasonCode: 'APPLY_STARTED' })).toBeNull();
    expect(parseAccountDeletionStatus({ error: 'failure', reasonCode: 'DB_CLEANUP_FAILED' })).toBeNull();
  });
  test('preserves exact confirmation and requires a fresh source-manifest-bound preview', () => {
    expect(ACCOUNT_DELETION_CONFIRMATION_TEXT).toBe('계정 삭제');
    expect(isAccountDeletionConfirmation('계정 삭제')).toBe(true);
    expect(isAccountDeletionConfirmation('계정 삭제 ')).toBe(false);
    expect(isAccountDeletionPreviewFresh(
      preview('2026-07-13T00:01:00.000Z'),
      new Date('2026-07-13T00:00:00.000Z'),
    )).toBe(true);
    expect(isAccountDeletionPreviewFresh(
      preview('2026-07-12T23:59:59.999Z'),
      new Date('2026-07-13T00:00:00.000Z'),
    )).toBe(false);
    expect(parseAccountDeletionPreview({
      ...preview('2026-07-13T00:01:00.000Z'),
      sourceManifestHash: undefined,
    })).toBeNull();

    const sql = g010Migration();
    expect(sql).toContain("'REPLAYED_PREVIEW'");
    expect(sql).toContain('p_confirmation_text IS DISTINCT FROM v_policy.confirmation_text');
  });

  test('accepts only a complete durable applied readback as the browser-cleanup receipt', () => {
    const receipt = parseAccountDeletionReceipt({
      requestId: ACCOUNT_DELETION_OWNER_ID,
      status: 'applied',
      reasonCode: 'APPLIED',
      sourceManifestHash: ACCOUNT_DELETION_MANIFEST_HASH,
      counts,
      readback: { database: true, storage: true, sessions: true, auth: true },
      storageReceiptRefs: [{
        objectLocatorHash: OBJECT_LOCATOR_HASH,
        objectVersionHash: OBJECT_VERSION_HASH,
        providerReceiptRef: 'provider-receipt-0001',
        providerReceiptHash: PROVIDER_RECEIPT_HASH,
      }],
      authReceiptRef: AUTH_RECEIPT_REF,
    });
    expect(receipt).not.toBeNull();
    if (!receipt) throw new Error('valid durable receipt did not parse');
    expect(parseAccountDeletionReceipt({
      ...receipt,
      readback: { database: true, storage: true, sessions: true, auth: false },
    })).toBeNull();
  });

  test('orders same-origin and strict parsing before bearer authentication, then atomically begins self deletion with reauthentication', async () => {
    resetAccountDeletionRouteSpies();
    const crossOriginResponse = await accountDeletionDelete(
      accountDeletionRequest('DELETE', JSON.stringify(validApplyRequest()), false),
    );

    expect(crossOriginResponse.status).toBe(403);
    expect(await crossOriginResponse.json()).toMatchObject({ reasonCode: 'INVALID_APPLY_REQUEST' });
    expect(authenticatedActorCalls).toBe(0);
    expect(rpcCalls).toEqual([]);

    const api = route();
    const deleteHandler = api.slice(
      api.indexOf('const deleteAccount = async'),
      api.indexOf('export const DELETE = deleteAccount;'),
    );
    const sameOrigin = deleteHandler.indexOf('if (!isTrustedSameOriginMutation(request))');
    const parse = deleteHandler.indexOf('const body = parseAccountDeletionApplyRequest(await request.json().catch(() => null));');
    const bearer = deleteHandler.indexOf('const bearerToken = bearerTokenFromAuthorization');
    const authentication = deleteHandler.indexOf('supabaseAdmin.auth.getUser(bearerToken)');
    const atomicBegin = deleteHandler.indexOf("const result = await supabase.rpc('begin_account_deletion_apply_with_reauth'");
    const selfOnly = deleteHandler.indexOf('if (body.userId !== user.id)');

    expect(sameOrigin).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(sameOrigin);
    expect(bearer).toBeGreaterThan(parse);
    expect(authentication).toBeGreaterThan(bearer);
    expect(selfOnly).toBeGreaterThan(authentication);
    expect(atomicBegin).toBeGreaterThan(selfOnly);
    expect(deleteHandler).toContain('supabaseAdmin.auth.getClaims(bearerToken)');
    expect(deleteHandler).toContain('claims?.claims.sub !== user.id');
    expect(deleteHandler).toContain('parseAccountDeletionApplyRequest');
    expect(api).toContain('hasOnlyKeys(value, [');
    expect(api).toContain('Object.keys(value).length !== 7');
    expect(deleteHandler).not.toContain('consume_account_deletion_reauth_proof');
    expect(deleteHandler).toContain('const cleanupResult = await supabaseAdmin.rpc(\'apply_account_deletion_database_cleanup\'');
    expect(deleteHandler).toContain('const readbackResult = await supabase.rpc(\'read_current_account_deletion_status\'');
    expect(deleteHandler).toContain('!readback.db_readback_passed');
    expect(deleteHandler).not.toContain('getAuthenticatedActor');
    expect(deleteHandler).not.toContain('reauthProofUnavailableResponse');
  });
  test('hands off begin to exact-bound database cleanup, then returns only the owner db readback', async () => {
    resetAccountDeletionRouteSpies();
    let statusReadbacks = 0;
    rpcResult = (name, args) => {
      if (name === 'begin_account_deletion_apply_with_reauth') {
        expect(args).toEqual({
          p_proof_id: validApplyRequest().proofId,
          p_actor_user_id: ACCOUNT_DELETION_OWNER_ID,
          p_target_user_id: ACCOUNT_DELETION_OWNER_ID,
          p_request_id: ACCOUNT_DELETION_OWNER_ID,
          p_preview_hash: ACCOUNT_DELETION_PREVIEW_HASH,
          p_confirmation_text: ACCOUNT_DELETION_CONFIRMATION_TEXT,
          p_idempotency_key: 'deletion-key-0001',
          p_source_manifest_hash: ACCOUNT_DELETION_MANIFEST_HASH,
        });
        return { data: [applyingRow()], error: null };
      }
      if (name === 'apply_account_deletion_database_cleanup') {
        expect(args).toEqual({
          p_actor_user_id: ACCOUNT_DELETION_OWNER_ID,
          p_target_user_id: ACCOUNT_DELETION_OWNER_ID,
          p_request_id: ACCOUNT_DELETION_OWNER_ID,
          p_preview_hash: ACCOUNT_DELETION_PREVIEW_HASH,
          p_idempotency_key: 'deletion-key-0001',
          p_source_manifest_hash: ACCOUNT_DELETION_MANIFEST_HASH,
        });
        return { data: [databaseRow()], error: null };
      }
      if (name === 'read_current_account_deletion_status') {
        statusReadbacks += 1;
        return statusReadbacks === 1
          ? { data: [], error: null }
          : { data: [applyingRow({
            reason_code: 'DB_READBACK_PASSED',
            db_readback_passed: true,
          })], error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    };

    const response = await accountDeletionDelete(
      accountDeletionRequest('DELETE', JSON.stringify(validApplyRequest())),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      status: 'accepted',
      begin: { status: 'in_progress', reasonCode: 'DB_READBACK_PASSED', counts },
    });
    expect(bearerClientOptions).toEqual({
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer test-bearer-token' } },
    });
    expect(rpcCalls.map(({ name }) => name)).toEqual([
      'read_current_account_deletion_status',
      'begin_account_deletion_apply_with_reauth',
      'apply_account_deletion_database_cleanup',
      'read_current_account_deletion_status',
    ]);
    expect(serviceRoleRpcCalls).toBe(1);
  });
  test('resumes only a same-key database-cleanup replay without consuming another proof', async () => {
    resetAccountDeletionRouteSpies();
    rpcResult = (name) => {
      expect(name).toBe('read_current_account_deletion_status');
      return { data: [applyingRow({
        reason_code: 'DB_READBACK_PASSED',
        db_readback_passed: true,
      })], error: null };
    };

    const response = await accountDeletionDelete(
      accountDeletionRequest('DELETE', JSON.stringify(validApplyRequest())),
    );

    expect(response.status).toBe(202);
    expect(rpcCalls.map(({ name }) => name)).toEqual(['read_current_account_deletion_status']);
  });
  test('fails closed for different-key, later-phase, or malformed progressed replay readback', async () => {
    for (const replayRow of [
      applyingRow({
        reason_code: 'DB_READBACK_PASSED',
        db_readback_passed: true,
        idempotency_key_binding_sha256: idempotencyKeyBinding('different-key-0001'),
      }),
      applyingRow({
        reason_code: 'DB_READBACK_PASSED',
        db_readback_passed: true,
        session_readback_passed: true,
      }),
      { ...applyingRow({ reason_code: 'DB_READBACK_PASSED', db_readback_passed: true }), unexpected: true },
    ]) {
      resetAccountDeletionRouteSpies();
      rpcResult = (name) => {
        expect(name).toBe('read_current_account_deletion_status');
        return { data: [replayRow], error: null };
      };

      const response = await accountDeletionDelete(
        accountDeletionRequest('DELETE', JSON.stringify(validApplyRequest())),
      );

      expect(response.status).toBe(500);
      expect(rpcCalls.map(({ name }) => name)).toEqual(['read_current_account_deletion_status']);
    }
  });
  test('does not accept deletion when database cleanup fails or returns a malformed receipt', async () => {
    for (const cleanupResult of [
      { data: null, error: { message: 'raw database error' } },
      { data: [{ ...databaseRow(), db_readback_passed: false }], error: null },
    ]) {
      resetAccountDeletionRouteSpies();
      rpcResult = (name) => {
        if (name === 'read_current_account_deletion_status') return { data: [], error: null };
        if (name === 'begin_account_deletion_apply_with_reauth') {
          return { data: [applyingRow()], error: null };
        }
        if (name === 'apply_account_deletion_database_cleanup') return cleanupResult;
        throw new Error(`unexpected RPC ${name}`);
      };

      const response = await accountDeletionDelete(
        accountDeletionRequest('DELETE', JSON.stringify(validApplyRequest())),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: '계정 데이터 또는 세션 정리를 확인하지 못했습니다. 계정 삭제가 완료되지 않았습니다.',
        reasonCode: 'DB_OR_SESSION_CLEANUP_FAILED',
      });
      expect(rpcCalls.map(({ name }) => name)).toEqual([
        'read_current_account_deletion_status',
        'begin_account_deletion_apply_with_reauth',
        'apply_account_deletion_database_cleanup',
      ]);
    }
  });
  test('does not accept deletion before the final owner readback proves database cleanup', async () => {
    resetAccountDeletionRouteSpies();
    let statusReadbacks = 0;
    rpcResult = (name) => {
      if (name === 'begin_account_deletion_apply_with_reauth') {
        return { data: [applyingRow()], error: null };
      }
      if (name === 'apply_account_deletion_database_cleanup') {
        return { data: [databaseRow()], error: null };
      }
      if (name === 'read_current_account_deletion_status') {
        statusReadbacks += 1;
        return statusReadbacks === 1
          ? { data: [], error: null }
          : { data: [applyingRow({ reason_code: 'DB_READBACK_PASSED' })], error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    };

    const response = await accountDeletionDelete(
      accountDeletionRequest('DELETE', JSON.stringify(validApplyRequest())),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: '계정 데이터 또는 세션 정리를 확인하지 못했습니다. 계정 삭제가 완료되지 않았습니다.',
      reasonCode: 'DB_OR_SESSION_CLEANUP_FAILED',
    });
    expect(rpcCalls.map(({ name }) => name)).toEqual([
      'read_current_account_deletion_status',
      'begin_account_deletion_apply_with_reauth',
      'apply_account_deletion_database_cleanup',
      'read_current_account_deletion_status',
    ]);
  });
  test('accepts a self-only service-role preview with bearer-bound identity', async () => {
    resetAccountDeletionRouteSpies();
    rpcResult = (name, args) => {
      expect(name).toBe('preview_account_deletion');
      expect(args).toEqual({
        p_actor_user_id: ACCOUNT_DELETION_OWNER_ID,
        p_target_user_id: ACCOUNT_DELETION_OWNER_ID,
        p_reauthenticated_at: '2026-07-13T00:00:00.000Z',
      });
      return { data: [previewRow('2026-07-13T00:01:00.000Z')], error: null };
    };

    const response = await accountDeletionPost(accountDeletionRequest(
      'POST',
      JSON.stringify({ targetUserId: ACCOUNT_DELETION_OWNER_ID }),
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      preview: preview('2026-07-13T00:01:00.000Z'),
    });
    expect(authenticatedActorCalls).toBe(1);
    expect(rpcCalls).toHaveLength(1);

    const api = route();
    const previewHandler = api.slice(
      api.indexOf('const previewAccountDeletion = async'),
      api.indexOf('const deleteAccount = async'),
    );
    expect(previewHandler).toContain('createSupabaseServiceRoleClient()');
    expect(previewHandler).toContain('supabase.auth.getUser(bearerToken)');
    expect(previewHandler).toContain('supabase.auth.getClaims(bearerToken)');
    expect(previewHandler).toContain('body.targetUserId !== user.id');
    expect(previewHandler).toContain("supabase.rpc('preview_account_deletion'");
  });
  test('reads only the exact authenticated owner status with no-store and no private worker binding', async () => {
    resetAccountDeletionRouteSpies();
    rpcResult = (name) => {
      expect(name).toBe('read_current_account_deletion_status');
      return { data: [ownerStatusAppliedRow()], error: null };
    };

    const query = new URLSearchParams({
      requestId: ACCOUNT_DELETION_OWNER_ID,
      previewHash: ACCOUNT_DELETION_PREVIEW_HASH,
      sourceManifestHash: ACCOUNT_DELETION_MANIFEST_HASH,
    });
    const response = await accountDeletionGet(accountDeletionStatusRequest(query.toString()));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'applied',
      reasonCode: 'APPLIED',
      counts,
      receipt: {
        requestId: ACCOUNT_DELETION_OWNER_ID,
        status: 'applied',
        reasonCode: 'APPLIED',
        sourceManifestHash: ACCOUNT_DELETION_MANIFEST_HASH,
        counts,
        readback: { database: true, storage: true, sessions: true, auth: true },
        storageReceiptRefs: [{
          objectLocatorHash: OBJECT_LOCATOR_HASH,
          objectVersionHash: OBJECT_VERSION_HASH,
          providerReceiptRef: 'provider-receipt-0001',
          providerReceiptHash: PROVIDER_RECEIPT_HASH,
        }],
        authReceiptRef: AUTH_RECEIPT_REF,
      },
    });
    expect(authenticatedActorCalls).toBe(0);
    expect(rpcCalls).toEqual([{
      name: 'read_current_account_deletion_status',
      args: {
        p_request_id: ACCOUNT_DELETION_OWNER_ID,
        p_preview_hash: ACCOUNT_DELETION_PREVIEW_HASH,
        p_source_manifest_hash: ACCOUNT_DELETION_MANIFEST_HASH,
      },
    }]);
    resetAccountDeletionRouteSpies();
    rpcResult = (name) => {
      expect(name).toBe('read_current_account_deletion_status');
      return { data: [ownerStatusApplyingRow()], error: null };
    };
    const pendingResponse = await accountDeletionGet(accountDeletionStatusRequest(query.toString()));
    expect(pendingResponse.status).toBe(202);
    expect(pendingResponse.headers.get('Cache-Control')).toBe('no-store');
    expect(await pendingResponse.json()).toEqual({
      status: 'in_progress',
      reasonCode: 'APPLY_STARTED',
      counts,
    });


    resetAccountDeletionRouteSpies();
    const malformed = await accountDeletionGet(accountDeletionStatusRequest(
      `${query.toString()}&targetUserId=${ACCOUNT_DELETION_ADMIN_TARGET_ID}`,
    ));
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get('Cache-Control')).toBe('no-store');
    expect(rpcCalls).toEqual([]);

    const sql = g014ReceiptParityMigration();
    expect(sql).toContain('v_owner_id uuid := auth.uid()');
    expect(sql).toContain('request_row.actor_user_id = v_owner_id');
    expect(sql).toContain('request_row.target_user_id = v_owner_id');
    expect(sql).toContain('request_row.preview_hash = p_preview_hash');
    expect(sql).toContain('request_row.source_manifest_hash = p_source_manifest_hash');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.read_current_account_deletion_status(uuid, text, text)');
    expect(sql).toContain("TO authenticated;");
    expect(g014Migration()).toContain("OR pg_catalog.has_function_privilege('service_role', v_status_rpc, 'EXECUTE')");
    expect(sql).toContain("'public.read_current_account_deletion_status(uuid,text,text)'");
    const ownerStatusFunction = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.read_current_account_deletion_status'),
      sql.indexOf('ALTER FUNCTION public.read_current_account_deletion_status'),
    );
    expect(ownerStatusFunction).toContain('storage_receipt_refs jsonb');
    expect(ownerStatusFunction).toContain('g014_account_deletion_storage_receipt_refs(request_row.id)');
    expect(sql).toContain('v_storage_object_count > 100');
    expect(sql).toContain('account_deletion_storage_receipt_limit_exceeded');
    expect(ownerStatusFunction).not.toContain('attempt_token');
    expect(ownerStatusFunction).not.toContain('object_name');

    const api = route();
    expect(api).toContain('hasEmptyGetBody');
    expect(api).toContain("Cache-Control', 'no-store");
    expect(api).toContain('read_current_account_deletion_status');
    expect(api).toContain('const sessionClient = await createServerClient();');
    expect(api).toContain("sessionClient.rpc('read_current_account_deletion_status'");
    expect(api).not.toContain('as unknown as');
    expect(api).not.toContain('p_attempt_token');
  });

  test('keeps GET status readback available without starting deletion work', async () => {
    resetAccountDeletionRouteSpies();
    rpcResult = (name) => {
      expect(name).toBe('read_current_account_deletion_status');
      return { data: [ownerStatusApplyingRow()], error: null };
    };

    const query = new URLSearchParams({
      requestId: ACCOUNT_DELETION_OWNER_ID,
      previewHash: ACCOUNT_DELETION_PREVIEW_HASH,
      sourceManifestHash: ACCOUNT_DELETION_MANIFEST_HASH,
    });
    const response = await accountDeletionGet(accountDeletionStatusRequest(query.toString()));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      status: 'in_progress',
      reasonCode: 'APPLY_STARTED',
      counts,
    });
    expect(rpcCalls.map(({ name }) => name)).toEqual([
      'read_current_account_deletion_status',
    ]);
  });

  test('uses only the durable service-worker RPC contract and keeps egress, lease tokens, and provider work out of the public route', () => {
    const api = route();
    const types = generatedTypes();
    const sql = g014Migration();

    for (const rpcName of [
      'claim_account_deletion_external_job',
      'prepare_account_deletion_external_egress',
      'read_account_deletion_external_job',
      'run_account_deletion_session_family_cleanup',
      'get_account_deletion_storage_work',
      'record_account_deletion_external_provider_proof',
      'reconcile_account_deletion_storage_job',
      'reconcile_account_deletion_auth_job',
    ]) {
      expect(types).toContain(rpcName);
      expect(sql).toContain(rpcName);
    }

    for (const legacyName of [
      'claim_account_deletion_external_phase',
      'list_account_deletion_storage_objects',
      'finalize_account_deletion_storage',
      'finalize_account_deletion_auth',
      'fail_account_deletion_external_phase',
    ]) {
      expect(api).not.toContain(legacyName);
      expect(types).not.toContain(legacyName);
    }

    expect(types).toContain("p_phase: 'session' | 'storage' | 'auth'");
    expect(types).toContain('p_attempt_token: string');
    expect(types).toContain('attempt_token: string | null');
    expect(types).toContain('provider_idempotency_key: string');
    expect(types).toContain('authoritative_absent: boolean');
    expect(types).toContain('storage_receipts_hash: string | null');
    expect(types).toContain('auth_receipt_ref: string | null');
    expect(sql).toContain("ARRAY['session', 'storage', 'auth']");
    expect(sql).toContain("SET state = 'egress_unknown'");
    expect(sql).toContain('g014_account_deletion_reconcile_expired_attempt');
    expect(sql).toContain("v_auth_receipt_ref := 'auth:' || pg_catalog.encode(");
    expect(sql).toContain("auth_receipt_ref = v_auth_receipt_ref");
    expect(sql).toContain("'authoritative_absent'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION');

    expect(api).toContain("rpc('begin_account_deletion_apply_with_reauth'");
    expect(api).toContain('p_proof_id: body.proofId');
    expect(api).toContain('p_actor_user_id: user.id');
    expect(api).toContain('createBearerClient(bearerToken)');
    expect(api).not.toContain("rpc('consume_account_deletion_reauth_proof'");
    expect(api).toContain("rpc('preview_account_deletion'");
    expect(api).not.toContain('runAccountDeletionExternalWorker');
    expect(api).not.toContain('auth.admin.deleteUser');
    expect(api).not.toContain('.storage.from(');
    expect(api).not.toContain('p_attempt_token:');
    expect(api).not.toContain('console.');
  });
  test('polls a 202 response with fixed backoff and only clears browser state after exact applied readback', () => {
    const page = profilePage();

    expect(page).toContain('const ACCOUNT_DELETION_POLL_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000] as const');
    expect(page).toContain('const ACCOUNT_DELETION_POLL_DEADLINE_MS = 30_000');
    expect(page).toContain('new AbortController()');
    expect(page).toContain('pollAccountDeletionReadback(deletionSession.preview, pollController.signal)');
    expect(page).toContain('method: "GET"');
    expect(page).toContain('cache: "no-store"');
    expect(page).toContain('response.status === 202');
    expect(page).toContain('if (readback.kind !== "applied")');
    expect(page).toContain('clearAccountDeletionBrowserStores(user.id, receipt)');
    expect(page).toContain('계정 삭제 완료 확인 중입니다. 이 창을 닫지 마세요.');
    expect(page).toContain('계정 삭제 완료를 확인하지 못했습니다. 브라우저 데이터는 유지됩니다.');
  });

  test('runs the durable worker with pinned, least-privilege scheduled automation', () => {
    const workflow = workerWorkflow();
    const secretNames = [...workflow.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)]
      .map((match) => match[1]);

    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('group: account-deletion-worker-production');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('timeout-minutes: 5');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).not.toContain('environment:');
    expect(workflow).not.toContain('production-account-deletion-worker');
    expect(workflow).toContain('uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd');
    expect(workflow).toContain('uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e');
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('node scripts/run-account-deletion-worker.mjs --limit 10 --deadline-ms 10000');
    expect(secretNames).toEqual([
      'ACCOUNT_DELETION_WORKER_URL',
      'ACCOUNT_DELETION_WORKER_CAPABILITY',
    ]);
    expect(workflow).not.toContain('SERVICE_ROLE');
    expect(workflow).not.toContain('SUPABASE_');
    expect(workflow).not.toContain('PROVIDER_');
  });
  test('uses a bearer-bound self-only atomic proof with no admin or direct begin path', () => {
    const api = route();
    const deleteHandler = api.slice(
      api.indexOf('const deleteAccount = async'),
      api.indexOf('export const DELETE = deleteAccount;'),
    );

    expect(deleteHandler).toContain('supabaseAdmin.auth.getUser(bearerToken)');
    expect(deleteHandler).toContain('supabaseAdmin.auth.getClaims(bearerToken)');
    expect(deleteHandler).toContain('claims?.claims.sub !== user.id');
    expect(deleteHandler).toContain('body.userId !== user.id');
    expect(deleteHandler).toContain('createBearerClient(bearerToken)');
    expect(deleteHandler).toContain("supabase.rpc('begin_account_deletion_apply_with_reauth'");
    expect(deleteHandler).not.toContain('requireAdmin');
    expect(deleteHandler).not.toContain('consume_account_deletion_reauth_proof');
    expect(deleteHandler).not.toContain('console.');
    expect(deleteHandler).not.toContain('auth.admin.deleteUser');
  });
  test('permits the Node fetch CORS marker but blocks browser and near-miss fetch metadata before the worker capability gate', async () => {
    const before = process.env.ACCOUNT_DELETION_WORKER_CAPABILITY;
    process.env.ACCOUNT_DELETION_WORKER_CAPABILITY = 'x'.repeat(32);
    try {
      const { POST: workerPost } = await import('../app/api/internal/account-deletion/route.ts?node-fetch-capability-gate');
      const request = (headers: HeadersInit) => new NextRequest('http://internal.test/api/internal/account-deletion', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-account-deletion-worker-capability': 'x'.repeat(32),
          ...headers,
        },
        body: '{"phase":"session"}',
      });

      expect((await workerPost(request({ 'sec-fetch-mode': 'cors' }))).status).toBe(400);
      expect((await workerPost(request({ 'x-account-deletion-worker-capability': 'y'.repeat(32), 'sec-fetch-mode': 'cors' }))).status).toBe(401);
      for (const headers of [
        { cookie: 'session=browser', 'sec-fetch-mode': 'cors' },
        { 'sec-fetch-mode': 'navigate' },
        { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' },
        { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' },
        { 'sec-fetch-user': '?1', 'sec-fetch-mode': 'cors' },
      ]) {
        expect((await workerPost(request(headers))).status).toBe(401);
      }
    } finally {
      if (before === undefined) delete process.env.ACCOUNT_DELETION_WORKER_CAPABILITY;
      else process.env.ACCOUNT_DELETION_WORKER_CAPABILITY = before;
    }
  });
});
