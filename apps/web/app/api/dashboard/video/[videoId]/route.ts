import { NextResponse } from 'next/server';
import { getDashboardVideoDetail } from '@/lib/dashboard/summary';

export const runtime = 'nodejs';

type Context = {
    params: Promise<{
        videoId: string;
    }>;
};

export async function GET(_request: Request, context: Context) {
    try {
        const { videoId } = await context.params;
        const safeVideoId = videoId?.trim();

        if (!safeVideoId) {
            return NextResponse.json(
                { error: 'videoId is required.' },
                { status: 400 },
            );
        }

        const data = await getDashboardVideoDetail(safeVideoId);
        if (!data) {
            return NextResponse.json(
                { error: 'Video not found.' },
                { status: 404 },
            );
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('[dashboard/video] failed:', error);
        return NextResponse.json(
            { error: 'Failed to build dashboard video detail.' },
            { status: 500 },
        );
    }
}
