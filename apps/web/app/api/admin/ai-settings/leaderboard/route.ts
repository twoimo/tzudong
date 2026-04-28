import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getLatestAiLeaderboardSnapshot } from '@/lib/admin/ai-leaderboard';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const snapshot = await getLatestAiLeaderboardSnapshot();
    return NextResponse.json({ snapshot }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Arena.ai 스냅샷을 불러오지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
