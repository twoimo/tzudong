import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { RECORD_ACTION_ENDPOINT } from '@/lib/admin/record-action-contract';

export const runtime = 'nodejs';

// Retired: this endpoint had no stable operation UUID or preview CAS boundary.
// Never translate/replay the old body as a new action, including after an uncertain ACK.
export async function POST(request: Request) {
  const respond = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const auth = await requireAdmin();
    if (!auth.ok) { auth.response.headers.set('Cache-Control', 'no-store'); return auth.response; }
    if (!isTrustedSameOriginMutation(request)) return respond({ success: false, code: 'RECORD_ACTION_FORBIDDEN' }, 403);
    return respond({ success: false, code: 'RECORD_ACTION_ENDPOINT_RETIRED', replacement: RECORD_ACTION_ENDPOINT }, 410);
  } catch {
    return respond({ success: false, code: 'RECORD_ACTION_UNAVAILABLE' }, 503);
  }
}
