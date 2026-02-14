import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminInsightWordcloud, getAdminInsightWordcloudVideos } from '@/lib/insight/wordcloud';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const keyword = request.nextUrl.searchParams.get('keyword')?.trim() || '';

    if (keyword) {
      const data = await getAdminInsightWordcloudVideos(keyword, false);
      return NextResponse.json(data);
    }

    const data = await getAdminInsightWordcloud(false);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[admin/insight/wordcloud] failed:', error);
    return NextResponse.json(
      { error: 'Failed to build wordcloud insight.' },
      { status: 500 },
    );
  }
}

