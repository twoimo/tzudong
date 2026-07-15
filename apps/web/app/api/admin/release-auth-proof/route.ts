import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

function noStore(response: NextResponse) {
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) response.headers.set(name, value);
  return response;
}

function sha256(domain: string, value: string) {
  return createHash('sha256').update(domain, 'utf8').update(value, 'utf8').digest('hex');
}
function isChallenge(value: string) {
  if (!CHALLENGE.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value;
}



export async function POST(request: NextRequest) {
  const challenge = request.headers.get('x-tzudong-release-auth-challenge');
  if (!challenge || !isChallenge(challenge) || request.nextUrl.search || request.nextUrl.hash) {
    return noStore(NextResponse.json({ error: 'Bad request' }, { status: 400 }));
  }

  const admin = await requireAdmin();
  if (!admin.ok) {
    noStore(admin.response);
    return admin.response;
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    const { data: sessionId, error: sessionIdError } = await supabase
      .rpc('get_current_auth_session_id' as never)
      .single()
      .overrideTypes<string | null, { merge: false }>();

    if (userError || sessionError || sessionIdError || !user || user.id !== admin.userId || !UUID.test(user.id) || !session || session.user.id !== user.id || !sessionId || !UUID.test(sessionId)) {
      return noStore(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const { data: activeSession, error: activeSessionError } = await supabase
      .rpc('is_current_auth_session_active' as never)
      .single()
      .overrideTypes<boolean, { merge: false }>();
    if (activeSessionError || activeSession !== true) {
      return noStore(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const identitySha256 = sha256('tzudong:release-auth-proof:identity:v1\n', `${user.id}\n${sessionId}`);
    const challengeSha256 = sha256('tzudong:release-auth-proof:challenge:v1\n', challenge);
    const bindingSha256 = sha256('tzudong:release-auth-proof:binding:v1\n', `${challengeSha256}\n${identitySha256}`);

    return noStore(NextResponse.json({ schemaVersion: 1, challengeSha256, identitySha256, bindingSha256 }));
  } catch {
    return noStore(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }
}
