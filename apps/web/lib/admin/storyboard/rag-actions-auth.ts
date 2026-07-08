import type { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';

export type StoryboardRagActionAuth =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };
export async function authenticateStoryboardRagAction(request: NextRequest, traceId?: string): Promise<StoryboardRagActionAuth> {
  void request;
  void traceId;

  return requireAdmin({ allowDevAdminBypassCookie: true });
}
