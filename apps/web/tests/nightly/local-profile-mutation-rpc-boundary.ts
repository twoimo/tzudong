import {
    hasDuplicateOrInvalidJsonMemberNames,
    hasEncodedOrMalformedPath,
    LOCAL_PROFILE_READ_RPC_CORS_HEADERS,
} from './local-profile-read-rpc-boundary';

export const LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH =
    '/rest/v1/rpc/update_current_profile_nickname';
export const LOCAL_PROFILE_AVATAR_CAS_RPC_PATH =
    '/rest/v1/rpc/compare_and_set_current_profile_avatar';
export const LOCAL_PROFILE_MUTATION_RPC_PATHS = new Set([
    LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH,
    LOCAL_PROFILE_AVATAR_CAS_RPC_PATH,
]);
export const LOCAL_DIRECT_PROFILE_TABLE_PATH = '/rest/v1/profiles';
export const LOCAL_PROFILE_MUTATION_RPC_CORS_HEADERS = LOCAL_PROFILE_READ_RPC_CORS_HEADERS;

const LOCAL_PROFILE_MUTATION_RPC_CORS_HEADER_SET = new Set<string>(
    LOCAL_PROFILE_MUTATION_RPC_CORS_HEADERS,
);
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DELETED_PROFILE_NICKNAME = '탈퇴한 사용자';
const MAX_PROFILE_MUTATION_RPC_BODY_BYTES = 32_768;

function isExactRecord(
    value: unknown,
    expectedKeys: readonly string[],
): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actualKeys = Object.keys(value as Record<string, unknown>).sort();
    const sortedExpectedKeys = [...expectedKeys].sort();
    return actualKeys.length === sortedExpectedKeys.length
        && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function utf8Length(value: string): number {
    try {
        return Buffer.byteLength(value, 'utf8');
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

function isCanonicalNickname(value: unknown): value is string {
    if (
        typeof value !== 'string'
        || value !== value.trim()
        || value.length < 2
        || value.length > 20
        || utf8Length(value) > 80
        || value === DELETED_PROFILE_NICKNAME
    ) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x1f || code === 0x7f) return false;
    }
    return true;
}

function isBoundedRawAvatarReference(value: unknown): value is string | null {
    return value === null
        || (typeof value === 'string' && utf8Length(value) <= 4_096);
}

export function isExactLocalProfileMutationRpcPath(url: URL): boolean {
    return !hasEncodedOrMalformedPath(url)
        && LOCAL_PROFILE_MUTATION_RPC_PATHS.has(url.pathname);
}

export function isExactLocalDirectProfileTablePath(url: URL): boolean {
    return !hasEncodedOrMalformedPath(url)
        && url.pathname === LOCAL_DIRECT_PROFILE_TABLE_PATH;
}

function isAllowedBody(pathname: string, postData: Buffer | null): boolean {
    if (
        !postData
        || postData.byteLength === 0
        || postData.byteLength > MAX_PROFILE_MUTATION_RPC_BODY_BYTES
    ) return false;
    try {
        const rawBody = postData.toString('utf8');
        if (hasDuplicateOrInvalidJsonMemberNames(rawBody)) return false;
        const value = JSON.parse(rawBody) as unknown;
        if (pathname === LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH) {
            return isExactRecord(value, ['p_nickname'])
                && isCanonicalNickname(value.p_nickname);
        }
        if (pathname === LOCAL_PROFILE_AVATAR_CAS_RPC_PATH) {
            return isExactRecord(value, [
                'p_expected_avatar_reference',
                'p_next_avatar_operation_id',
            ])
                && isBoundedRawAvatarReference(value.p_expected_avatar_reference)
                && (
                    value.p_next_avatar_operation_id === null
                    || (
                        typeof value.p_next_avatar_operation_id === 'string'
                        && UUID_PATTERN.test(value.p_next_avatar_operation_id)
                    )
                );
        }
        return false;
    } catch {
        return false;
    }
}

export function isAllowedLocalProfileMutationRpcRequest({
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
        && isExactLocalProfileMutationRpcPath(url)
        && contentType === 'application/json'
        && isAllowedBody(url.pathname, postData);
}

export function isAllowedLocalProfileMutationRpcPreflightRequest({
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
        && isExactLocalProfileMutationRpcPath(url)
        && headers.origin === allowedApplicationOrigin
        && headers['access-control-request-method'] === 'POST'
        && requestedHeaders.length >= 1
        && requestedHeaders.length <= LOCAL_PROFILE_MUTATION_RPC_CORS_HEADERS.length
        && requestedHeaders.includes('content-type')
        && new Set(requestedHeaders).size === requestedHeaders.length
        && requestedHeaders.every((header) => (
            LOCAL_PROFILE_MUTATION_RPC_CORS_HEADER_SET.has(header)
        ));
}
