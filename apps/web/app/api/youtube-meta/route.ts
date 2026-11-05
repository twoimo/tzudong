import { NextRequest, NextResponse } from 'next/server';
import { analyzeDisclosure } from '@/lib/sponsorship-disclosure';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
    BOUNDED_JSON_REQUEST_ERROR,
    readBoundedJsonRequest,
} from '@/lib/security/bounded-json-request';
import { reserveAdminProviderBudget } from '@/lib/security/admin-provider-budget';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

const YOUTUBE_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_FETCH_TIMEOUT_MS = 10_000;
const MAX_REQUEST_BYTES = 2 * 1024;
const MAX_PROVIDER_BYTES = 512 * 1024;

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const noStoreJson = (body: unknown, init?: ResponseInit) =>
    NextResponse.json(body, {
        ...init,
        headers: { ...init?.headers, 'Cache-Control': 'no-store' },
    });

class BoundedJsonError extends Error {
    constructor(readonly reason: 'invalid' | 'too_large') {
        super('BOUNDED_JSON_INVALID');
        this.name = 'BoundedJsonError';
    }
}

function extractVideoId(value: string): string | null {
    if (value.length > 512) return null;

    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || /^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(url.href) || url.port) return null;
        const hostname = url.hostname.toLowerCase();
        let videoId: string | null = null;

        if (hostname === 'youtu.be' || hostname === 'www.youtu.be') {
            const segments = url.pathname.split('/').filter(Boolean);
            if (segments.length === 1) videoId = segments[0] ?? null;
        } else if (hostname === 'youtube.com' || hostname === 'www.youtube.com' || hostname === 'm.youtube.com') {
            if (url.pathname === '/watch') {
                videoId = url.searchParams.get('v');
            } else {
                const match = url.pathname.match(/^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})\/?$/);
                videoId = match?.[1] ?? null;
            }
        }

        return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
    } catch {
        return null;
    }
}

function parseDuration(duration: string): number | null {
    const match = duration.match(/^PT(?:(\d{1,3})H)?(?:(\d{1,3})M)?(?:(\d{1,3})S)?$/);
    if (!match) return null;
    const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
    const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
    const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;
    if (minutes > 59 || seconds > 59) return null;
    const total = hours * 3_600 + minutes * 60 + seconds;
    return Number.isSafeInteger(total) ? total : null;
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        throw new BoundedJsonError('too_large');
    }
    if (!response.body) throw new BoundedJsonError('invalid');

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maximumBytes) {
                await reader.cancel();
                throw new BoundedJsonError('too_large');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
        throw new BoundedJsonError('invalid');
    }
}

function normalizeYoutubeVideo(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const root = value as Record<string, unknown>;
    if (!Array.isArray(root.items) || root.items.length !== 1) return null;
    const item = root.items[0];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const itemRecord = item as Record<string, unknown>;
    const snippet = itemRecord.snippet;
    const contentDetails = itemRecord.contentDetails;
    if (!snippet || typeof snippet !== 'object' || Array.isArray(snippet)) return null;
    if (!contentDetails || typeof contentDetails !== 'object' || Array.isArray(contentDetails)) return null;

    const snippetRecord = snippet as Record<string, unknown>;
    const contentRecord = contentDetails as Record<string, unknown>;
    if (typeof snippetRecord.title !== 'string' || snippetRecord.title.length > 300) return null;
    if (typeof snippetRecord.publishedAt !== 'string' || snippetRecord.publishedAt.length > 64) return null;
    if (typeof contentRecord.duration !== 'string' || contentRecord.duration.length > 64) return null;
    const duration = parseDuration(contentRecord.duration);
    if (duration === null) return null;

    return {
        title: snippetRecord.title,
        publishedAt: snippetRecord.publishedAt,
        description: typeof snippetRecord.description === 'string'
            ? snippetRecord.description
            : '',
        duration,
    };
}

export async function POST(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) {
        auth.response.headers.set('Cache-Control', 'no-store');
        return auth.response;
    }
    if (!isTrustedSameOriginMutation(request)) {
        return noStoreJson({ error: 'Forbidden' }, { status: 403 });
    }
    try {
        const bodyResult = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
        if (!bodyResult.ok) {
            if (bodyResult.code === BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType) {
                return noStoreJson({ error: 'Content-Type must be application/json' }, { status: 415 });
            }
            if (bodyResult.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge) {
                return noStoreJson({ error: 'Request body too large' }, { status: 413 });
            }
            return noStoreJson({ error: 'Invalid request body' }, { status: 400 });
        }

        const body = bodyResult.value;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return noStoreJson({ error: 'Invalid request body' }, { status: 400 });
        }
        const bodyRecord = body as Record<string, unknown>;
        if (Object.keys(bodyRecord).length !== 1 || typeof bodyRecord.youtube_link !== 'string') {
            return noStoreJson({ error: 'Invalid request body' }, { status: 400 });
        }

        const videoId = extractVideoId(bodyRecord.youtube_link.trim());
        if (!videoId) {
            return noStoreJson({ error: 'Invalid YouTube URL' }, { status: 400 });
        }

        const youtubeApiKey = process.env.YOUTUBE_API_KEY;
        if (!youtubeApiKey) {
            return noStoreJson({ error: 'YouTube API key not configured' }, { status: 503 });
        }

        let budget;
        try {
            budget = await reserveAdminProviderBudget({
                actorUserId: auth.userId,
                provider: 'youtube_metadata',
            });
        } catch {
            return noStoreJson({ error: 'Provider budget unavailable' }, { status: 503 });
        }
        if (!budget.allowed) {
            return noStoreJson(
                { error: 'Provider request limit exceeded' },
                { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } },
            );
        }

        const youtubeUrl = new URL(YOUTUBE_VIDEOS_ENDPOINT);
        youtubeUrl.searchParams.set('part', 'snippet,contentDetails,status');
        youtubeUrl.searchParams.set('id', videoId);
        youtubeUrl.searchParams.set(
            'fields',
            'items(snippet/title,snippet/publishedAt,snippet/description,contentDetails/duration,status/privacyStatus)',
        );

        const ytResponse = await fetch(youtubeUrl, {
            headers: {
                Accept: 'application/json',
                'X-Goog-Api-Key': youtubeApiKey,
            },
            redirect: 'error',
            signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
        });

        if (!ytResponse.ok) {
            await ytResponse.body?.cancel();
            return noStoreJson({ error: 'Failed to fetch YouTube metadata' }, { status: 502 });
        }

        const videoData = normalizeYoutubeVideo(await readBoundedJson(ytResponse, MAX_PROVIDER_BYTES));
        if (!videoData) {
            return noStoreJson({ error: 'Video not found' }, { status: 404 });
        }

        return noStoreJson({
            title: videoData.title,
            publishedAt: videoData.publishedAt,
            duration: videoData.duration,
            is_shorts: videoData.duration <= 180,
            ads_info: analyzeDisclosure(videoData.description),
        });
    } catch {
        return noStoreJson({ error: 'Failed to fetch YouTube metadata' }, { status: 502 });
    }
}
