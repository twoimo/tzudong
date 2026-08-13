export const LOCAL_PROFILE_SUMMARIES_RPC_PATH = '/rest/v1/rpc/read_public_profile_summaries';
export const LOCAL_PROFILE_LEADERBOARD_RPC_PATH = '/rest/v1/rpc/read_public_profile_leaderboard';
export const LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH = '/rest/v1/rpc/read_public_profile_leaderboard_page';
export const LOCAL_PROFILE_READ_RPC_PATHS = new Set([
    LOCAL_PROFILE_SUMMARIES_RPC_PATH,
    LOCAL_PROFILE_LEADERBOARD_RPC_PATH,
    LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH,
]);
export const LOCAL_PROFILE_READ_RPC_CORS_HEADERS = [
    'apikey',
    'authorization',
    'content-profile',
    'content-type',
    'prefer',
    'range',
    'x-client-info',
    'x-retry-count',
] as const;
const LOCAL_PROFILE_READ_RPC_CORS_HEADER_SET = new Set<string>(
    LOCAL_PROFILE_READ_RPC_CORS_HEADERS,
);

const LOCAL_PROFILE_READ_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hasEncodedOrMalformedPath(url: URL): boolean {
    return url.pathname.includes('%');
}

export function isExactLocalProfileReadRpcPath(url: URL): boolean {
    return !hasEncodedOrMalformedPath(url)
        && LOCAL_PROFILE_READ_RPC_PATHS.has(url.pathname);
}

export function hasDuplicateOrInvalidJsonMemberNames(rawBody: string): boolean {
    let index = 0;

    const skipWhitespace = () => {
        while (index < rawBody.length && /\s/.test(rawBody[index]!)) index += 1;
    };
    const parseString = (): string => {
        const start = index;
        if (rawBody[index] !== '"') throw new SyntaxError();
        index += 1;
        while (index < rawBody.length) {
            const character = rawBody[index];
            if (character === '\\') {
                index += 2;
                continue;
            }
            index += 1;
            if (character === '"') {
                return JSON.parse(rawBody.slice(start, index)) as string;
            }
        }
        throw new SyntaxError();
    };
    const parseValue = (): void => {
        skipWhitespace();
        if (rawBody[index] === '{') {
            index += 1;
            skipWhitespace();
            const keys = new Set<string>();
            if (rawBody[index] === '}') {
                index += 1;
                return;
            }
            for (;;) {
                skipWhitespace();
                const key = parseString();
                if (keys.has(key)) throw new SyntaxError();
                keys.add(key);
                skipWhitespace();
                if (rawBody[index] !== ':') throw new SyntaxError();
                index += 1;
                parseValue();
                skipWhitespace();
                if (rawBody[index] === '}') {
                    index += 1;
                    return;
                }
                if (rawBody[index] !== ',') throw new SyntaxError();
                index += 1;
            }
        }
        if (rawBody[index] === '[') {
            index += 1;
            skipWhitespace();
            if (rawBody[index] === ']') {
                index += 1;
                return;
            }
            for (;;) {
                parseValue();
                skipWhitespace();
                if (rawBody[index] === ']') {
                    index += 1;
                    return;
                }
                if (rawBody[index] !== ',') throw new SyntaxError();
                index += 1;
            }
        }
        if (rawBody[index] === '"') {
            parseString();
            return;
        }
        const start = index;
        while (index < rawBody.length && !/[\s,\]}]/.test(rawBody[index]!)) index += 1;
        if (start === index) throw new SyntaxError();
        const primitive = JSON.parse(rawBody.slice(start, index)) as unknown;
        if (primitive !== null && typeof primitive === 'object') throw new SyntaxError();
    };

    try {
        parseValue();
        skipWhitespace();
        return index !== rawBody.length;
    } catch {
        return true;
    }
}

function isExactRecord(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actualKeys = Object.keys(value as Record<string, unknown>).sort();
    const sortedExpectedKeys = [...expectedKeys].sort();
    return actualKeys.length === sortedExpectedKeys.length
        && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function isAllowedBody(pathname: string, postData: Buffer | null): boolean {
    if (!postData || postData.byteLength === 0 || postData.byteLength > 4_096) return false;
    try {
        const rawBody = postData.toString('utf8');
        if (hasDuplicateOrInvalidJsonMemberNames(rawBody)) return false;
        const value = JSON.parse(rawBody) as unknown;
        if (pathname === LOCAL_PROFILE_SUMMARIES_RPC_PATH) {
            if (!isExactRecord(value, ['p_user_ids']) || !Array.isArray(value.p_user_ids)) return false;
            if (value.p_user_ids.length < 1 || value.p_user_ids.length > 100) return false;
            const normalizedIds = value.p_user_ids.map((userId) => (
                typeof userId === 'string' ? userId.toLowerCase() : ''
            ));
            return normalizedIds.every((userId) => LOCAL_PROFILE_READ_UUID.test(userId))
                && new Set(normalizedIds).size === normalizedIds.length;
        }
        if (pathname === LOCAL_PROFILE_LEADERBOARD_RPC_PATH) {
            return isExactRecord(value, ['p_period', 'p_limit'])
                && (value.p_period === 'all' || value.p_period === 'monthly')
                && Number.isInteger(value.p_limit)
                && Number(value.p_limit) >= 1
                && Number(value.p_limit) <= 100;
        }
        if (pathname === LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH) {
            if (!isExactRecord(value, [
                'p_period',
                'p_limit',
                'p_after_quality_score',
                'p_after_user_id',
            ])) return false;
            if (
                (value.p_period !== 'all' && value.p_period !== 'monthly')
                || !Number.isInteger(value.p_limit)
                || Number(value.p_limit) < 1
                || Number(value.p_limit) > 100
            ) return false;
            const cursorIsNull = value.p_after_quality_score === null
                && value.p_after_user_id === null;
            const cursorIsValid = typeof value.p_after_quality_score === 'number'
                && Number.isFinite(value.p_after_quality_score)
                && value.p_after_quality_score >= 0
                && typeof value.p_after_user_id === 'string'
                && LOCAL_PROFILE_READ_UUID.test(value.p_after_user_id);
            return cursorIsNull || cursorIsValid;
        }
        return false;
    } catch {
        return false;
    }
}

export function isAllowedLocalProfileReadRpcRequest({
    allowedOrigin,
    url,
    method,
    postData,
    contentType,
}: Readonly<{
    allowedOrigin: string | undefined;
    url: URL;
    method: string;
    postData: Buffer | null;
    contentType: string | undefined;
}>): boolean {
    return Boolean(allowedOrigin)
        && url.origin === allowedOrigin
        && method === 'POST'
        && !url.search
        && isExactLocalProfileReadRpcPath(url)
        && contentType === 'application/json'
        && isAllowedBody(url.pathname, postData);
}

export function isAllowedLocalProfileReadRpcPreflightRequest({
    allowedOrigin,
    allowedApplicationOrigin,
    url,
    method,
    postData,
    headers,
}: Readonly<{
    allowedOrigin: string | undefined;
    allowedApplicationOrigin: string | undefined;
    url: URL;
    method: string;
    postData: Buffer | null;
    headers: Readonly<Record<string, string>>;
}>): boolean {
    const requestedHeaders = (headers['access-control-request-headers'] ?? '')
        .split(',')
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
    return Boolean(allowedOrigin)
        && Boolean(allowedApplicationOrigin)
        && url.origin === allowedOrigin
        && method === 'OPTIONS'
        && postData === null
        && !url.search
        && isExactLocalProfileReadRpcPath(url)
        && headers.origin === allowedApplicationOrigin
        && headers['access-control-request-method'] === 'POST'
        && requestedHeaders.length >= 1
        && requestedHeaders.length <= LOCAL_PROFILE_READ_RPC_CORS_HEADERS.length
        && requestedHeaders.includes('content-type')
        && new Set(requestedHeaders).size === requestedHeaders.length
        && requestedHeaders.every((header) => LOCAL_PROFILE_READ_RPC_CORS_HEADER_SET.has(header));
}
