import { sanitizePrivacyValue } from '@/lib/privacy/sanitize';

export const isDevelopment = process.env.NODE_ENV === 'development';

export const DEBUG_LOG_EVENT = {
    AUTH_CLIENT_LOAD_FAILED: 'AUTH_CLIENT_LOAD_FAILED',
    AUTH_PROFILE_LOOKUP_FAILED: 'AUTH_PROFILE_LOOKUP_FAILED',
    AUTH_SESSION_LOAD_FAILED: 'AUTH_SESSION_LOAD_FAILED',
    AUTH_SESSION_REFRESH_FAILED: 'AUTH_SESSION_REFRESH_FAILED',
    AUTH_USER_STATE_LOAD_FAILED: 'AUTH_USER_STATE_LOAD_FAILED',
    PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED: 'PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED',
    PASSWORD_RECOVERY_SESSION_CHECK_FAILED: 'PASSWORD_RECOVERY_SESSION_CHECK_FAILED',
    PASSWORD_UPDATE_FAILED: 'PASSWORD_UPDATE_FAILED',
    DEBUG_EVENT_REJECTED: 'DEBUG_EVENT_REJECTED',
} as const;

export type DebugLogEvent = typeof DEBUG_LOG_EVENT[keyof typeof DEBUG_LOG_EVENT];

export const DEBUG_LOG_REASON_CODE = {
    AUTH_CLIENT_LOAD_FAILED: 'AUTH_CLIENT_LOAD_FAILED',
    AUTH_PROFILE_LOOKUP_FAILED: 'AUTH_PROFILE_LOOKUP_FAILED',
    AUTH_SESSION_LOAD_FAILED: 'AUTH_SESSION_LOAD_FAILED',
    AUTH_SESSION_REFRESH_FAILED: 'AUTH_SESSION_REFRESH_FAILED',
    AUTH_USER_STATE_LOAD_FAILED: 'AUTH_USER_STATE_LOAD_FAILED',
    PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED: 'PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED',
    PASSWORD_RECOVERY_SESSION_CHECK_FAILED: 'PASSWORD_RECOVERY_SESSION_CHECK_FAILED',
    PASSWORD_UPDATE_FAILED: 'PASSWORD_UPDATE_FAILED',
} as const;

type DebugLogReasonCode =
    typeof DEBUG_LOG_REASON_CODE[keyof typeof DEBUG_LOG_REASON_CODE];

type DebugLogMetadata = Readonly<{
    reason: DebugLogReasonCode;
}>;

const DEBUG_LOG_EVENTS = new Set<string>(Object.values(DEBUG_LOG_EVENT));
const DEBUG_LOG_REASON_CODES = new Set<string>(Object.values(DEBUG_LOG_REASON_CODE));

const sanitizeDebugMetadata = (metadata: unknown): DebugLogMetadata | undefined => {
    const { value } = sanitizePrivacyValue(metadata, {
        maxDepth: 2,
        maxEntries: 4,
        maxStringLength: 64,
    });

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }

    const reason = (value as Record<string, unknown>).reason;
    if (typeof reason !== 'string' || !DEBUG_LOG_REASON_CODES.has(reason)) {
        return undefined;
    }

    return { reason: reason as DebugLogReasonCode };
};

export function debugLog(
    event: DebugLogEvent | string,
    metadata?: unknown,
    ...discardedValues: readonly unknown[]
): void {
    void discardedValues;

    if (!isDevelopment) return;

    const safeEvent = DEBUG_LOG_EVENTS.has(event)
        ? event
        : DEBUG_LOG_EVENT.DEBUG_EVENT_REJECTED;
    const safeMetadata = sanitizeDebugMetadata(metadata);

    console.log(safeEvent, safeMetadata);
}
