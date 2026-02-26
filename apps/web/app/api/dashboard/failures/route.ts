import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getDashboardFailures } from '@/lib/dashboard/evaluation';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const data = await getDashboardFailures(false);
        return NextResponse.json(data);
    } catch (error) {
        console.error('[dashboard/failures] failed:', error);
        return NextResponse.json(
            { error: 'Failed to build dashboard failures.' },
            { status: 500 },
        );
    }
}
