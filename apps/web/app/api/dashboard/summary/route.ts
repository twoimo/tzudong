import { NextResponse } from 'next/server';
import { getDashboardSummary } from '@/lib/dashboard/summary';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const data = await getDashboardSummary(false);
        return NextResponse.json(data);
    } catch (error) {
        console.error('[dashboard/summary] failed:', error);
        return NextResponse.json(
            { error: 'Failed to build dashboard summary.' },
            { status: 500 },
        );
    }
}
