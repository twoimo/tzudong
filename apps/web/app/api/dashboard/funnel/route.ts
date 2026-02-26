import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getDashboardFunnel } from '@/lib/dashboard/evaluation';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const data = await getDashboardFunnel(false);
        return NextResponse.json(data);
    } catch (error) {
        console.error('[dashboard/funnel] failed:', error);
        return NextResponse.json(
            { error: 'Failed to build dashboard funnel.' },
            { status: 500 },
        );
    }
}
