import { NextRequest, NextResponse } from 'next/server';

import {
    getInsightTreemapData,
    parseTreemapMetricMode,
    parseTreemapPeriod,
    type InsightTreemapPeriod,
} from '@/lib/insight/treemap';

export const runtime = 'nodejs';
const TREEMAP_API_CACHE_SECONDS = 60;

function normalizePeriod(value: string | null): InsightTreemapPeriod {
    return parseTreemapPeriod(value);
}

export async function GET(request: NextRequest) {
    try {
        const period = normalizePeriod(request.nextUrl.searchParams.get('period'));
        const viewMode = request.nextUrl.searchParams.get('viewMode');
        const filterByPeriod = viewMode !== 'change';
        const metricMode = parseTreemapMetricMode(request.nextUrl.searchParams.get('metricMode'));
        const data = await getInsightTreemapData(period, { filterByPeriod, metricMode });
        const headers = { 'Cache-Control': `public, max-age=${TREEMAP_API_CACHE_SECONDS}, stale-while-revalidate=${TREEMAP_API_CACHE_SECONDS * 5}, must-revalidate` };
        return NextResponse.json(data, { headers });
    } catch (error) {
        console.error('[insights/treemap] failed:', error);
        return NextResponse.json(
            { error: 'Failed to build insights treemap.' },
            { status: 500 },
        );
    }
}

