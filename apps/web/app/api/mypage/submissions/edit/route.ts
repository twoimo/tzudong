import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { Database as GeneratedDatabase } from '@/integrations/supabase/database.types';
import { getCurrentPrivacyEligibility, hasLivePrivacyEligibilityReceipt } from '@/lib/privacy/eligibility';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import {
  MAX_EDIT_SUBMISSION_BYTES, canonicalizeRestaurantEditPayload,
  isRestaurantEditSubmitBody, isSavedRestaurantEdit,
} from '@/lib/restaurant-edit-submit-contract';

export const runtime = 'nodejs';
type EditRpc = GeneratedDatabase['public']['Functions']['submit_restaurant_edit_request'];
type EditRpcClient = {
  rpc(name: 'submit_restaurant_edit_request', args: EditRpc['Args']): Promise<{ data: EditRpc['Returns'] | null; error: unknown }>;
};

function respond(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
function failure(code: string, status: number) {
  return respond({ ok: false, code }, status);
}

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedSameOriginMutation(request)) return failure('EDIT_SUBMISSION_UNAUTHORIZED', 403);
    const body = await readBoundedJsonRequest(request, MAX_EDIT_SUBMISSION_BYTES);
    if (!body.ok || !isRestaurantEditSubmitBody(body.value)) return failure('EDIT_SUBMISSION_INVALID', 400);
    const { clientRequestKey, restaurantId } = body.value;
    const payload = canonicalizeRestaurantEditPayload(body.value.payload);
    // Only the validated business-contact field is handled separately, as in the existing submission route.
    const { phone: _rawPhone, ...rawPublicFields } = body.value.payload;
    const { phone: _phone, ...publicFields } = payload;
    try {
      assertPrivacySafe(rawPublicFields);
      assertPrivacySafe(publicFields, { locationClass: 'business' });
    } catch {
      return failure('EDIT_SUBMISSION_INVALID', 400);
    }
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return failure('EDIT_SUBMISSION_UNAUTHORIZED', 401);
    if (request.headers.get('x-tzudong-actor-id') !== user.id) return failure('EDIT_SUBMISSION_UNAUTHORIZED', 409);
    if (!hasLivePrivacyEligibilityReceipt(await getCurrentPrivacyEligibility(client))) {
      return failure('EDIT_SUBMISSION_UNAUTHORIZED', 403);
    }
    // The curated browser Database omits service-only APIs. Bind this one
    // server call to its actual generated signature without widening clients.
    const service = createSupabaseServiceRoleClient() as unknown as EditRpcClient;
    const { data, error } = await service.rpc('submit_restaurant_edit_request', {
      p_user_id: user.id,
      p_client_request_key: clientRequestKey,
      p_target_restaurant_id: restaurantId.toLowerCase(),
      p_payload: payload,
    });
    if (error) return failure('EDIT_SUBMISSION_FAILED', 500);
    const outcome: unknown = data;
    if (isSavedRestaurantEdit(outcome, payload.youtube_reviews.length)) return respond(outcome, 200);
    if (outcome && typeof outcome === 'object' && 'ok' in outcome && outcome.ok === false && 'code' in outcome) {
      if (outcome.code === 'EDIT_SUBMISSION_CONFLICT') return failure(outcome.code, 409);
      if (outcome.code === 'EDIT_SUBMISSION_INVALID') return failure(outcome.code, 400);
      if (outcome.code === 'EDIT_SUBMISSION_UNAUTHORIZED') return failure(outcome.code, 403);
    }
    return failure('EDIT_SUBMISSION_FAILED', 500);
  } catch {
    return failure('EDIT_SUBMISSION_FAILED', 500);
  }
}
