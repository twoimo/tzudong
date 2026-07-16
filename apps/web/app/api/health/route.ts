import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const host = new URL(request.url).hostname;
    const releaseId = process.env.TS7_RELEASE_ID;
    const gitSha = process.env.VERCEL_GIT_COMMIT_SHA;
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
    const projectId = process.env.VERCEL_PROJECT_ID;
    if (!releaseId || !gitSha || !deploymentId || !projectId) {
        return NextResponse.json({ ok: false, service: 'tzudong-web' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json(
        { ok: true, service: 'tzudong-web', releaseId, gitSha, deploymentId, projectId, host },
        { headers: { 'cache-control': 'no-store' } },
    );
}
