import { NextRequest, NextResponse } from 'next/server';

import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';

export type StoryboardRagActionAuth =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

function authFailure(error: string, status: number, traceId?: string) {
  return { ok: false as const, response: NextResponse.json({ error, ...(traceId ? { traceId } : {}) }, { status }) };
}

function bearerTokenFromRequest(request: NextRequest) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function authenticateStoryboardRagAction(request: NextRequest, traceId?: string): Promise<StoryboardRagActionAuth> {
  const bearerToken = bearerTokenFromRequest(request);
  if (bearerToken) {
    try {
      const supabase = createSupabaseServiceRoleClient();
      const { data, error } = await supabase.auth.getUser(bearerToken);
      if (error || !data.user) {
        return authFailure('invalid_oauth_bearer', 401, traceId);
      }
      return { ok: true, userId: data.user.id };
    } catch {
      return authFailure('oauth_user_mapping_failed', 503, traceId);
    }
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return authFailure('unauthorized', 401, traceId);
    }
    return { ok: true, userId: data.user.id };
  } catch {
    return authFailure('session_user_mapping_failed', 503, traceId);
  }
}
