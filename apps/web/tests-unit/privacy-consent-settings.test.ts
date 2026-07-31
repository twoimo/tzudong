import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeConsentStateRows,
  parseConsentRequest,
} from "../lib/privacy/consent-settings";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

const POLICY_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";
const NOTICE_HASH = "a".repeat(64);

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    purpose: "email_marketing",
    channel: "email",
    decision: "granted",
    policyVersionId: POLICY_ID,
    noticeSha256: NOTICE_HASH,
    idempotencyKey: "privacy-consent-replay-0001",
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

describe("privacy consent settings request and state contracts", () => {
  test("allows exactly one matching ordinary or night channel decision with bounded identifiers", () => {
    expect(parseConsentRequest(validRequest())).toMatchObject({
      purpose: "email_marketing",
      channel: "email",
      decision: "granted",
    });
    expect(parseConsentRequest(validRequest({
      purpose: "night_marketing",
      channel: "push",
      decision: "withdrawn",
    }))).toMatchObject({ purpose: "night_marketing", channel: "push", decision: "withdrawn" });

    expect(parseConsentRequest(validRequest({ purpose: "email_marketing", channel: "sms" }))).toBeNull();
    expect(parseConsentRequest(validRequest({ purpose: "marketing" }))).toBeNull();
    expect(parseConsentRequest(validRequest({ decision: "unknown" }))).toBeNull();
    expect(parseConsentRequest(validRequest({ idempotencyKey: "short" }))).toBeNull();
    expect(parseConsentRequest({ ...validRequest(), contact: "not-accepted" })).toBeNull();
  });

  test("reads only the owner and keeps ordinary and night channel state independent with denied defaults", () => {
    expect(normalizeConsentStateRows([], USER_ID)).toEqual({
      ordinary: { email: false, sms: false, push: false },
      night: { email: false, sms: false, push: false },
    });
    expect(normalizeConsentStateRows([
      {
        user_id: USER_ID,
        subject_kind: "self",
        purpose: "email_marketing",
        channel: "email",
        decision: "granted",
      },
      {
        user_id: USER_ID,
        subject_kind: "self",
        purpose: "night_marketing",
        channel: "email",
        decision: "withdrawn",
      },
      {
        user_id: USER_ID,
        subject_kind: "self",
        purpose: "night_marketing",
        channel: "push",
        decision: "granted",
      },
    ], USER_ID)).toEqual({
      ordinary: { email: true, sms: false, push: false },
      night: { email: false, sms: false, push: true },
    });
    expect(normalizeConsentStateRows([{
      user_id: "44444444-4444-4444-8444-444444444444",
      subject_kind: "self",
      purpose: "email_marketing",
      channel: "email",
      decision: "granted",
    }], USER_ID)).toBeNull();
  });
});

describe("privacy consent settings route", () => {
  const route = source("app/api/privacy/consents/route.ts");
  const validation = source("lib/privacy/consent-settings.ts");

  test("authenticates with the session client and owner-scopes the privacy view without service role", () => {
    expect(route).toContain('import { createClient } from "@/lib/supabase/server";');
    expect(route).toContain("supabase.auth.getUser()");
    expect(route).toContain('.from("privacy_consent_state")');
    expect(route).toContain('.eq("user_id", userId)');
    expect(route).toContain('"user_id, subject_kind, purpose, channel, decision"');
    expect(route).not.toContain("createSupabaseServiceRoleClient");
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  test("requires the current policy and performs an authenticated RPC followed by an independent readback", () => {
    const policyIndex = route.indexOf('rpc("get_current_privacy_policy_version")');
    const submitIndex = route.indexOf('rpc("submit_privacy_consent"');
    const readbackIndex = route.indexOf("const consents = await readConsentStates", submitIndex);

    expect(policyIndex).toBeGreaterThanOrEqual(0);
    expect(submitIndex).toBeGreaterThan(policyIndex);
    expect(readbackIndex).toBeGreaterThan(submitIndex);
    expect(route).toContain('input.policyVersionId !== policy.policyVersionId || input.noticeSha256 !== policy.contentSha256');
    expect(route).toContain('p_source: "settings"');
    expect(route).toContain("p_guardian_verification_id: null");
    expect(route).toContain('p_idempotency_key: input.idempotencyKey');
    expect(route).toContain('p_correlation_id: input.correlationId');
    expect(route).toContain('PRIVACY_CONSENT_READBACK_FAILED');
    expect(route).toContain('receipt: "PRIVACY_CONSENT_RECORDED"');
  });

  test("fails closed for stale policy and idempotency mismatch with fixed errors only", () => {
    expect(route).toContain('PRIVACY_POLICY_STALE');
    expect(route).toContain('PRIVACY_IDEMPOTENCY_CONFLICT');
    expect(route).toContain('isIdempotencyConflict(submitError)');
    expect(route).toContain('p_idempotency_key: input.idempotencyKey');
    expect(route).toContain('MAX_REQUEST_BYTES = 2_048');
    expect(validation).toContain('IDEMPOTENCY_KEY_PATTERN');
    expect(validation).toContain('SHA256_PATTERN');
    expect(route).not.toContain('export function parseConsentRequest');
    expect(route).not.toContain('export function normalizeConsentStateRows');
    expect(route).not.toContain("error.message");
    expect(route).not.toContain("console.");
  });
  test("authenticates before same-origin and bounded JSON checks, then returns a non-enumerating guardian denial", () => {
    const postIndex = route.indexOf("export async function POST");
    const authenticateIndex = route.indexOf("const userId = await authenticate(supabase)", postIndex);
    const originIndex = route.indexOf("isTrustedSameOriginMutation(request)", postIndex);
    const boundedBodyIndex = route.indexOf("readBoundedJsonRequest(request, MAX_REQUEST_BYTES)", postIndex);
    const parseIndex = route.indexOf("parseConsentRequest(parsedBody.value)", postIndex);

    expect(authenticateIndex).toBeGreaterThanOrEqual(0);
    expect(originIndex).toBeGreaterThan(authenticateIndex);
    expect(boundedBodyIndex).toBeGreaterThan(originIndex);
    expect(parseIndex).toBeGreaterThan(boundedBodyIndex);
    expect(route).toContain('import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";');
    expect(route).toContain('import {');
    expect(route).toContain('readBoundedJsonRequest,');
    expect(route).toContain("BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 413 : 400");
    expect(route).toContain("PRIVACY_CHILD_GUARDIAN_REQUIRED");
    expect(route).toContain('response.headers.set("Cache-Control", "no-store")');
    expect(route).not.toContain("request.text()");
    expect(route).not.toContain("JSON.parse(");
    expect(route).not.toContain("new TextEncoder()");
  });
});

describe("profile consent controls", () => {
  const profile = source("app/mypage/profile/page.tsx");

  test("keeps optional settings unknown until readback, separates ordinary and night controls, and leaves failures retryable", () => {
    expect(profile).toContain('useState<ConsentSettings | null>(null)');
    expect(profile).toContain('data-privacy-consent-group="ordinary"');
    expect(profile).toContain('data-privacy-consent-group="night"');
    expect(profile).toContain("야간 마케팅 수신");
    expect(profile).toContain('data-privacy-consent-retry="true"');
    expect(profile).toContain("const replayRequest = retryRequest !== null");
    expect(profile).toContain("setFailedConsentRequest(request)");
    expect(profile).toContain("수신 동의 변경을 저장하지 못했습니다. 다시 시도해 주세요.");
    expect(profile).toContain('disabled={unknown || consentLoading || consentSaving !== null}');
  });

  test("updates a withdrawal only after the constant readback receipt and does not persist consent in local storage", () => {
    const receiptIndex = profile.indexOf("hasConsentReadback(payload, action)");
    const updateIndex = profile.indexOf("setConsentSettings((current) =>", receiptIndex);

    expect(receiptIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(receiptIndex);
    expect(profile).not.toContain("localStorage.setItem");
    expect(profile).not.toContain("sessionStorage.setItem");
  });

  test("preserves the account deletion control surface", () => {
    expect(profile).toContain('data-mypage-danger-zone="true"');
    expect(profile).toContain("계정 완전 삭제");
    expect(profile).toContain("handleAccountPermanentDelete");
  });
});
