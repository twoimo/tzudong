import { NextRequest, NextResponse } from 'next/server';
import { getDashboardRestaurants } from '@/lib/dashboard/summary';

export const runtime = 'nodejs';

function toNumber(value: string | null, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: string | null, fallback: boolean) {
    if (value == null) return fallback;
    if (value === '1' || value.toLowerCase() === 'true') return true;
    if (value === '0' || value.toLowerCase() === 'false') return false;
    return fallback;
}

export async function GET(request: NextRequest) {
    try {
        const params = request.nextUrl.searchParams;
        const q = params.get('q') || undefined;
        const category = params.get('category') || undefined;
        const sourceType = params.get('sourceType') || undefined;
        const status = params.get('status') || undefined;
        const limit = toNumber(params.get('limit'), 100);
        const offset = toNumber(params.get('offset'), 0);
        const onlyWithCoordinates = toBoolean(params.get('onlyWithCoordinates'), true);

        const data = await getDashboardRestaurants({
            q,
            category,
            sourceType,
            status,
            limit,
            offset,
            onlyWithCoordinates,
        });

        return NextResponse.json(data);
    } catch (error) {
        console.error('[dashboard/restaurants] failed:', error);
        return NextResponse.json(
            { error: 'Failed to build dashboard restaurants.' },
            { status: 500 },
        );
    }
}
