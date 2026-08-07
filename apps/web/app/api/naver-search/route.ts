import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { reserveAdminProviderBudget } from '@/lib/security/admin-provider-budget';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

const NAVER_CLIENT_ID = process.env.NEXT_NAVER_CLIENT_ID_BYEON || process.env.NEXT_NAVER_CLIENT_ID || process.env.NEXT_PUBLIC_NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NEXT_NAVER_CLIENT_SECRET_BYEON || process.env.NEXT_NAVER_CLIENT_SECRET;
const NAVER_SEARCH_ENDPOINT = 'https://openapi.naver.com/v1/search/local.json';
const NAVER_SEARCH_TIMEOUT_MS = 5_000;
const MAX_QUERY_LENGTH = 100;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_NAVER_SEARCH_REQUEST_BYTES = 1024;
const DISPLAY_VALUE = /^[1-5]$/;

const noStoreJson = (body: unknown, init?: ResponseInit) =>
    NextResponse.json(body, {
        ...init,
        headers: { ...init?.headers, 'Cache-Control': 'no-store' },
    });

const boundedString = (value: unknown, maximum: number) =>
    typeof value === 'string' ? value.slice(0, maximum) : '';
function hasExactKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype
    ) {
        return false;
    }

    const keys = Object.keys(value);
    return keys.length === expectedKeys.length && keys.every((key) => expectedKeys.includes(key));
}


function normalizeNaverPayload(value: unknown, display: number) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('NAVER_SEARCH_RESPONSE_INVALID');
    }

    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.items)) {
        throw new Error('NAVER_SEARCH_RESPONSE_INVALID');
    }

    const items = record.items.slice(0, display).map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error('NAVER_SEARCH_ITEM_INVALID');
        }
        const candidate = item as Record<string, unknown>;
        return {
            title: boundedString(candidate.title, 256),
            link: boundedString(candidate.link, 512),
            category: boundedString(candidate.category, 256),
            description: boundedString(candidate.description, 512),
            telephone: boundedString(candidate.telephone, 64),
            address: boundedString(candidate.address, 256),
            roadAddress: boundedString(candidate.roadAddress, 256),
            mapx: boundedString(candidate.mapx, 32),
            mapy: boundedString(candidate.mapy, 32),
        };
    });

    return {
        lastBuildDate: boundedString(record.lastBuildDate, 64),
        total: Number.isSafeInteger(record.total) && Number(record.total) >= 0 ? Number(record.total) : 0,
        start: Number.isSafeInteger(record.start) && Number(record.start) >= 0 ? Number(record.start) : 0,
        display: items.length,
        items,
    };
}

async function readBoundedProviderJson(response: Response) {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error('NAVER_SEARCH_RESPONSE_TOO_LARGE');
    }
    if (!response.body) throw new Error('NAVER_SEARCH_RESPONSE_MISSING');

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
                await reader.cancel();
                throw new Error('NAVER_SEARCH_RESPONSE_TOO_LARGE');
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
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

export async function POST(request: Request) {
    const auth = await requireAdmin();
    if (!auth.ok) {
        auth.response.headers.set('Cache-Control', 'no-store');
        return auth.response;
    }
    if (!isTrustedSameOriginMutation(request)) {
        return noStoreJson({ error: 'Forbidden' }, { status: 403 });
    }

    const requestBody = await readBoundedJsonRequest(request, MAX_NAVER_SEARCH_REQUEST_BYTES);
    if (!requestBody.ok) {
        return noStoreJson(
            { error: 'Invalid search request' },
            { status: requestBody.code === 'BODY_TOO_LARGE' ? 413 : 400 },
        );
    }

    const body = requestBody.value;
    if (
        !hasExactKeys(body, ['query', 'display'])
        || typeof body.query !== 'string'
        || typeof body.display !== 'number'
        || !Number.isSafeInteger(body.display)
        || !DISPLAY_VALUE.test(String(body.display))
    ) {
        return noStoreJson({ error: 'Invalid search request' }, { status: 400 });
    }

    const query = body.query.trim();
    const display = body.display;
    if (!query || query.length > MAX_QUERY_LENGTH || CONTROL_CHARACTERS.test(query)) {
        return noStoreJson({ error: 'Invalid query parameter' }, { status: 400 });
    }
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        return noStoreJson({ error: 'Naver API credentials not configured' }, { status: 503 });
    }

    let budget;
    try {
        budget = await reserveAdminProviderBudget({
            actorUserId: auth.userId,
            provider: 'naver_local_search',
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

    const apiUrl = new URL(NAVER_SEARCH_ENDPOINT);
    apiUrl.searchParams.set('query', query);
    apiUrl.searchParams.set('display', String(display));

    try {
        const response = await fetch(apiUrl, {
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
            },
            redirect: 'error',
            signal: AbortSignal.timeout(NAVER_SEARCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            await response.body?.cancel();
            return noStoreJson({ error: 'Naver API request failed' }, { status: 502 });
        }

        const data = normalizeNaverPayload(await readBoundedProviderJson(response), display);
        return noStoreJson(data);
    } catch {
        return noStoreJson({ error: 'Naver API request failed' }, { status: 502 });
    }
}
