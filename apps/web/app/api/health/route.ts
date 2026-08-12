import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const REQUIRED_ENVIRONMENT_VARIABLES = [
    'TS7_RELEASE_ID',
    'VERCEL_GIT_COMMIT_SHA',
    'VERCEL_DEPLOYMENT_ID',
    'VERCEL_PROJECT_ID',
] as const;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const noStoreHeaders = { 'cache-control': 'no-store' };

const unavailable = () => NextResponse.json(
    { ok: false, service: 'tzudong-web' },
    { status: 503, headers: noStoreHeaders },
);

const HEALTH_TOKEN_HEADER = 'x-nightly-health-token';
const HEALTH_DIGEST_HEADER = 'x-nightly-env-provenance-sha256';

const hasMatchingSecret = (expected: string | undefined, actual: string | null | undefined): boolean => {
    if (!expected || !actual || !/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(actual)) {
        return false;
    }
    const expectedBytes = Buffer.from(expected, 'utf8');
    const actualBytes = Buffer.from(actual, 'utf8');
    return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
};

export async function GET(request: Request) {
    let host: string;
    try {
        host = new URL(request.url).hostname.toLowerCase();
    } catch {
        return unavailable();
    }

    const localMarker = process.env.NIGHTLY_LOCAL_ENV_ONLY === '1';
    const localDigest = process.env.NIGHTLY_ENV_PROVENANCE_SHA256;
    const localNonce = process.env.NIGHTLY_HEALTH_NONCE;
    const localToken = process.env.NIGHTLY_HEALTH_TOKEN;
    const expectedToken = localDigest && localNonce
        ? createHash('sha256').update(`${localDigest}:${localNonce}`).digest('hex')
        : undefined;
    const localBrowserRuntimeGate = process.env.NIGHTLY_BROWSER_RUNTIME === '1';
    const localTestGate = localMarker
        && process.env.NIGHTLY_MODE === 'local'
        && (process.env.NODE_ENV === 'test' || localBrowserRuntimeGate)
        && LOOPBACK_HOSTS.has(host);
    const localBoundHealthGate = hasMatchingSecret(localDigest, request.headers.get(HEALTH_DIGEST_HEADER))
        && hasMatchingSecret(expectedToken, localToken)
        && hasMatchingSecret(localToken, request.headers.get(HEALTH_TOKEN_HEADER));
    if (localTestGate) {
        if (!localBoundHealthGate) {
            console.error('Health check rejected unbound local nightly request');
            return unavailable();
        }
        return NextResponse.json(
            { ok: true, service: 'tzudong-web', mode: 'local' },
            { headers: noStoreHeaders },
        );
    }

    // A local marker is never valid outside the bound test-only loopback gate.
    // Deployment identity values cannot turn an incorrectly routed local app green.
    if (localMarker) {
        console.error('Health check rejected local nightly request outside loopback gate');
        return unavailable();
    }

    const localDevelopmentGate = process.env.TZUDONG_LOCAL_SUPABASE_DEV === '1'
        && process.env.NODE_ENV === 'development'
        && LOOPBACK_HOSTS.has(host);
    if (localDevelopmentGate) {
        return NextResponse.json(
            { ok: true, service: 'tzudong-web', mode: 'local-development' },
            { headers: noStoreHeaders },
        );
    }

    const releaseId = process.env.TS7_RELEASE_ID;
    const gitSha = process.env.VERCEL_GIT_COMMIT_SHA;
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
    const projectId = process.env.VERCEL_PROJECT_ID;
    const missingRequiredEnvironmentVariables = REQUIRED_ENVIRONMENT_VARIABLES.filter((name) => !process.env[name]);
    if (missingRequiredEnvironmentVariables.length > 0) {
        console.error('Health check missing required environment variables', missingRequiredEnvironmentVariables);
        return unavailable();
    }
    return NextResponse.json(
        { ok: true, service: 'tzudong-web', releaseId, gitSha, deploymentId, projectId, host },
        { headers: noStoreHeaders },
    );
}
