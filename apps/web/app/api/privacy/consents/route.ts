import { NextRequest, NextResponse } from "next/server";
import {
  isRecord,
  isUuid,
  normalizeConsentStateRows,
  parseConsentRequest,
  parseCurrentPolicy,
} from "@/lib/privacy/consent-settings";
import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 2_048;

type PrivacyClient = Pick<SupabaseClient<Database>, "auth" | "from" | "rpc">;

function errorResponse(code: string, status: number) {
  return noStoreJson({ code }, { status });
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function getCurrentPolicy(supabase: PrivacyClient) {
  const { data, error } = await supabase.rpc("get_current_privacy_policy_version");
  if (error) return null;
  return parseCurrentPolicy(data);
}

async function readConsentStates(supabase: PrivacyClient, userId: string) {
  const { data, error } = await supabase
    .from("privacy_consent_state")
    .select("user_id, subject_kind, purpose, channel, decision")
    .eq("user_id", userId);
  if (error) return null;
  return normalizeConsentStateRows(data, userId);
}

function samePolicy(
  left: NonNullable<ReturnType<typeof parseCurrentPolicy>>,
  right: NonNullable<ReturnType<typeof parseCurrentPolicy>>,
) {
  return left.policyVersionId === right.policyVersionId && left.contentSha256 === right.contentSha256;
}

function isIdempotencyConflict(error: unknown) {
  return isRecord(error) && error.code === "23505";
}

function isGuardianWorkflowRequired(error: unknown) {
  return isRecord(error) && error.code === "42501";
}

async function authenticate(supabase: PrivacyClient) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || typeof user?.id !== "string" || !isUuid(user.id)) return null;
  return user.id;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const userId = await authenticate(supabase);
    if (!userId) return errorResponse("PRIVACY_AUTH_REQUIRED", 401);

    const policy = await getCurrentPolicy(supabase);
    if (!policy) return errorResponse("PRIVACY_POLICY_UNAVAILABLE", 503);

    const consents = await readConsentStates(supabase, userId);
    if (!consents) return errorResponse("PRIVACY_CONSENT_UNAVAILABLE", 503);

    return noStoreJson({
      policy: {
        policyVersionId: policy.policyVersionId,
        version: policy.version,
        contentSha256: policy.contentSha256,
      },
      consents,
    });
  } catch {
    return errorResponse("PRIVACY_CONSENT_UNAVAILABLE", 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const userId = await authenticate(supabase);
    if (!userId) return errorResponse("PRIVACY_AUTH_REQUIRED", 401);

    if (!isTrustedSameOriginMutation(request)) {
      return errorResponse("PRIVACY_INVALID_REQUEST", 403);
    }

    const parsedBody = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
    if (!parsedBody.ok) {
      return errorResponse(
        "PRIVACY_INVALID_REQUEST",
        parsedBody.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 413 : 400,
      );
    }

    const input = parseConsentRequest(parsedBody.value);
    if (!input) return errorResponse("PRIVACY_INVALID_REQUEST", 400);

    const policy = await getCurrentPolicy(supabase);
    if (!policy) return errorResponse("PRIVACY_POLICY_UNAVAILABLE", 503);
    if (input.policyVersionId !== policy.policyVersionId || input.noticeSha256 !== policy.contentSha256) {
      return errorResponse("PRIVACY_POLICY_STALE", 409);
    }

    const { data: submitResult, error: submitError } = await supabase.rpc("submit_privacy_consent", {
      p_purpose: input.purpose,
      p_channel: input.channel,
      p_decision: input.decision,
      p_policy_version_id: input.policyVersionId,
      p_notice_sha256: input.noticeSha256,
      p_source: "settings",
      p_guardian_verification_id: null,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: input.correlationId,
    });
    if (submitError) {
      if (isIdempotencyConflict(submitError)) return errorResponse("PRIVACY_IDEMPOTENCY_CONFLICT", 409);
      if (isGuardianWorkflowRequired(submitError)) {
        return errorResponse("PRIVACY_CHILD_GUARDIAN_REQUIRED", 403);
      }
      return errorResponse("PRIVACY_CONSENT_UNAVAILABLE", 503);
    }
    if (!isRecord(submitResult) || submitResult.status !== "applied") {
      return errorResponse("PRIVACY_CONSENT_UNAVAILABLE", 503);
    }

    const currentPolicy = await getCurrentPolicy(supabase);
    if (!currentPolicy) return errorResponse("PRIVACY_POLICY_UNAVAILABLE", 503);
    if (!samePolicy(policy, currentPolicy)) return errorResponse("PRIVACY_POLICY_STALE", 409);

    const consents = await readConsentStates(supabase, userId);
    const readbackValue = input.purpose === "night_marketing"
      ? consents?.night[input.channel]
      : consents?.ordinary[input.channel];
    if (readbackValue !== (input.decision === "granted")) {
      return errorResponse("PRIVACY_CONSENT_READBACK_FAILED", 409);
    }

    return noStoreJson({
      receipt: "PRIVACY_CONSENT_RECORDED",
      state: {
        purpose: input.purpose,
        channel: input.channel,
        decision: input.decision,
      },
    });
  } catch {
    return errorResponse("PRIVACY_CONSENT_UNAVAILABLE", 503);
  }
}
