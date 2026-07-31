import { NextResponse } from 'next/server';
import { getDashboardSummary } from '@/lib/dashboard/summary';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const data = await getDashboardSummary(false);
        const freshness = data.freshness;
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'private, max-age=60, stale-while-revalidate=240',
                ...(freshness
                    ? {
                        'X-Dashboard-Summary-Source': freshness.source,
                        'X-Dashboard-Summary-Generated-At': freshness.generatedAt,
                        'X-Dashboard-Summary-Checksum': freshness.checksum,
                        'X-Dashboard-Summary-Cache-Status': freshness.cacheStatus,
                        'X-Dashboard-Summary-Video-Limit': String(freshness.videoLimit),
                    }
                    : {}),
            },
        });
    } catch (error) {
        console.error('[dashboard/summary] failed:');
        return NextResponse.json(
            { error: 'Failed to build dashboard summary.' },
            { status: 500 },
        );
    }
}
