import { NextResponse } from 'next/server';
import { classifyDashboardVideoId } from '@/lib/dashboard/helpers';
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
        const classified = classifyDashboardVideoId(videoId);

        if (classified.status === 'required') {
            return NextResponse.json(
                { error: 'videoId is required.' },
                { status: 400 },
            );
        }

        if (classified.status === 'invalid') {
            return NextResponse.json(
                { error: 'Video not found.' },
                { status: 404 },
            );
        }

        const safeVideoId = classified.videoId;
        const data = await getDashboardVideoDetail(safeVideoId);
        if (!data) {
            return NextResponse.json(
                { error: 'Video not found.' },
                { status: 404 },
            );
        }

        return NextResponse.json(data);
    } catch {
        console.error('DASHBOARD_VIDEO_FAILED');
        return NextResponse.json(
            { error: 'Failed to build dashboard video detail.' },
            { status: 500 },
        );
    }
}
