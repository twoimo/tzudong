import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { syncArenaLeaderboardSnapshot } from '@/lib/admin/ai-leaderboard';

export const runtime = 'nodejs';

async function authorizeAdminOrCron(request: Request): Promise<{ ok: true; userId: string | null } | { ok: false; response: NextResponse }> {
  const cronSecret = process.env.AI_SETTINGS_CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization');
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, userId: null };
  }

  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  return { ok: true, userId: auth.userId };
}

export async function POST(request: Request) {
  const auth = await authorizeAdminOrCron(request);
  if (!auth.ok) return auth.response;

  try {
    const snapshot = await syncArenaLeaderboardSnapshot({ adminUserId: auth.userId });
    return NextResponse.json({ snapshot }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Arena.ai 스냅샷 동기화에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
