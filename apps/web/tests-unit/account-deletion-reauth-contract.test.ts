import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

const userId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
let bearerClientOptions: unknown;
let applyCalls: Array<{ name: string; args: unknown }> = [];
let serviceRoleRpcCalls = 0;
let bearerRpcResult: { data: unknown; error: unknown } | null = null;

mock.module("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, options: unknown) => {
    bearerClientOptions = options;
    return {
      rpc: async (name: string, args: unknown) => {
        applyCalls.push({ name, args });
        return bearerRpcResult ?? {
          data: [{
            request_id: requestId,
            status: "APPLY_STARTED",
            db_readback_passed: true,
            storage_readback_passed: true,
            session_readback_passed: true,
            auth_readback_passed: true,
          }],
          error: null,
        };
      },
    };
  },
}));

mock.module("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
      getClaims: async () => ({ data: { claims: { sub: userId } }, error: null }),
    },
    rpc: async () => {
      serviceRoleRpcCalls += 1;
      throw new Error("service role must not apply account deletion");
    },
  }),
}));

mock.module("@/lib/privacy/account-deletion-reauth", () => ({
  asSingleRow: (data: unknown) => Array.isArray(data) && data.length === 1 ? data[0] : null,
  parseAccountDeletionPreview: () => null,
}));

async function loadRoute() {
  return import(`../app/api/account/delete/route.ts?cache=${Math.random()}`);
}

const profileSource = () => readFileSync(join(import.meta.dir, "..", "app/mypage/profile/page.tsx"), "utf8");

function deleteRequest() {
  return new NextRequest("http://localhost/api/account/delete", {
    method: "DELETE",
    headers: {
      Origin: "http://localhost",
      Authorization: "Bearer verified-bearer",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId,
      proofId: "33333333-3333-4333-8333-333333333333",
      requestId,
      previewHash: "a".repeat(64),
      confirmationText: "user@example.com",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      sourceManifestHash: "b".repeat(64),
    }),
  });
}
describe("account deletion reauthentication route", () => {
  test("starts exactly one apply through the verified bearer client, never service role", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    bearerClientOptions = undefined;
    bearerRpcResult = null;
    applyCalls = [];
    serviceRoleRpcCalls = 0;
    const route = await loadRoute();
    const response = await route.DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      begin: {
        request_id: requestId,
        status: "APPLY_STARTED",
        db_readback_passed: true,
        storage_readback_passed: true,
        session_readback_passed: true,
        auth_readback_passed: true,
      },
    });
    expect(bearerClientOptions).toEqual({
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: "Bearer verified-bearer" } },
    });
    expect(applyCalls).toEqual([{
      name: "begin_account_deletion_apply_with_reauth",
      args: {
        p_proof_id: "33333333-3333-4333-8333-333333333333",
        p_actor_user_id: userId,
        p_target_user_id: userId,
        p_request_id: requestId,
        p_preview_hash: "a".repeat(64),
        p_confirmation_text: "user@example.com",
        p_idempotency_key: "44444444-4444-4444-8444-444444444444",
        p_source_manifest_hash: "b".repeat(64),
      },
    }]);
    expect(serviceRoleRpcCalls).toBe(0);
  });
  test("returns the stable reauthentication reason code without coupling callers to localized error copy", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    bearerRpcResult = {
      data: null,
      error: { message: "account_deletion_reauth_proof_not_available" },
    };
    const route = await loadRoute();

    const response = await route.DELETE(deleteRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Account deletion reauthentication has expired or was already used.",
      reasonCode: "account_deletion_reauth_proof_not_available",
    });
  });

  test("maps account deletion guidance from reasonCode and rejects localized-message coupling", () => {
    const source = profileSource();

    expect(source).toContain("const reasonCode = (receipt as { reasonCode?: unknown }).reasonCode;");
    expect(source).toContain("accountDeletionFailureMessages[reasonCode] ?? fallback");
    expect(source).not.toContain('accountDeletionFailureMessages[error]');
    expect(source).not.toContain('"Fresh self authentication is required.":');
  });
});
