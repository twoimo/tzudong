import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { reserveAdminProviderBudget } from '@/lib/security/admin-provider-budget';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

const MAX_QUERY_LENGTH = 200;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const NAVER_GEOCODE_TIMEOUT_MS = 5_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const COORDINATE = /^-?\d{1,3}(?:\.\d{1,15})?$/;
const MAX_NAVER_GEOCODE_REQUEST_BYTES = 1024;

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


function getSupabaseFunctionUrl(value: string) {
    const url = new URL(value);
    const localDevelopment = process.env.NODE_ENV !== 'production'
        && url.protocol === 'http:'
        && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    if (!localDevelopment && (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co'))) {
        throw new Error('SUPABASE_FUNCTION_ORIGIN_INVALID');
    }
    return new URL('/functions/v1/naver-geocode', url.origin);
}

async function readBoundedProviderJson(response: Response) {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error('NAVER_GEOCODE_RESPONSE_TOO_LARGE');
    }
    if (!response.body) throw new Error('NAVER_GEOCODE_RESPONSE_MISSING');

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
                throw new Error('NAVER_GEOCODE_RESPONSE_TOO_LARGE');
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

function normalizeAddressElement(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const types = Array.isArray(record.types)
        ? record.types.slice(0, 8).filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 32))
        : [];
    return {
        types,
        longName: boundedString(record.longName, 128),
        shortName: boundedString(record.shortName, 128),
        code: boundedString(record.code, 32),
    };
}

function normalizeNaverGeocodePayload(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('NAVER_GEOCODE_RESPONSE_INVALID');
    }
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.addresses)) throw new Error('NAVER_GEOCODE_RESPONSE_INVALID');

    return {
        addresses: record.addresses.slice(0, 3).map((address) => {
            if (!address || typeof address !== 'object' || Array.isArray(address)) {
                throw new Error('NAVER_GEOCODE_ADDRESS_INVALID');
            }
            const candidate = address as Record<string, unknown>;
            const x = boundedString(candidate.x, 32);
            const y = boundedString(candidate.y, 32);
            if (!COORDINATE.test(x) || !COORDINATE.test(y)) {
                throw new Error('NAVER_GEOCODE_COORDINATE_INVALID');
            }
            return {
                roadAddress: boundedString(candidate.roadAddress, 256),
                jibunAddress: boundedString(candidate.jibunAddress, 256),
                englishAddress: boundedString(candidate.englishAddress, 256),
                addressElements: Array.isArray(candidate.addressElements)
                    ? candidate.addressElements.slice(0, 20).map(normalizeAddressElement).filter(Boolean)
                    : [],
                x,
                y,
            };
        }),
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

    const requestBody = await readBoundedJsonRequest(request, MAX_NAVER_GEOCODE_REQUEST_BYTES);
    if (!requestBody.ok) {
        return noStoreJson(
            { error: 'Invalid geocode request' },
            { status: requestBody.code === 'BODY_TOO_LARGE' ? 413 : 400 },
        );
    }

    const body = requestBody.value;
    if (!hasExactKeys(body, ['query']) || typeof body.query !== 'string') {
        return noStoreJson({ error: 'Invalid geocode request' }, { status: 400 });
    }

    const query = body.query.trim();
    if (!query || query.length > MAX_QUERY_LENGTH || CONTROL_CHARACTERS.test(query)) {
        return noStoreJson({ error: 'Invalid query parameter' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
        return noStoreJson({ error: 'Supabase credentials not configured' }, { status: 503 });
    }

    let budget;
    try {
        budget = await reserveAdminProviderBudget({
            actorUserId: auth.userId,
            provider: 'naver_geocode',
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

    try {
        const response = await fetch(getSupabaseFunctionUrl(supabaseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${supabaseAnonKey}`,
                apikey: supabaseAnonKey,
            },
            body: JSON.stringify({ query, count: 3 }),
            redirect: 'error',
            signal: AbortSignal.timeout(NAVER_GEOCODE_TIMEOUT_MS),
        });

        if (!response.ok) {
            await response.body?.cancel();
            return noStoreJson({ error: 'Failed to geocode address' }, { status: 502 });
        }

        return noStoreJson(normalizeNaverGeocodePayload(await readBoundedProviderJson(response)));
    } catch {
        return noStoreJson({ error: 'Failed to geocode address' }, { status: 502 });
    }
}
