import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { getDashboardQuality } from '@/lib/dashboard/quality';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const data = await getDashboardQuality(false);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[dashboard/quality] failed:', error);
    return NextResponse.json(
      { error: 'Failed to build dashboard quality.' },
      { status: 500 },
    );
  }
}

