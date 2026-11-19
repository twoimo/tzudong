const MAX_IDENTIFIER_LENGTH = 128;
const MAX_FUTURE_SAVED_AT_MS = 5 * 60 * 1000;

export function isBoundedIdentifier(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= MAX_IDENTIFIER_LENGTH
        && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

export function readNonNegativeSafeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function containsMediaReference(value: string): boolean {
    return /(?:data|blob):|\bbase64\b/i.test(value);
}

export function isWithinRecordBytes(value: unknown, maxBytes: number): boolean {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxBytes;
    } catch {
        return false;
    }
}

function isKnownProxy(value: object): boolean {
    try {
        const runtime = globalThis as typeof globalThis & {
            process?: {
                getBuiltinModule?: (name: string) => unknown;
            };
        };
        const getBuiltinModule = runtime.process?.getBuiltinModule;
        if (typeof getBuiltinModule !== 'function') return false;

        const util = getBuiltinModule('node:util') as {
            types?: {
                isProxy?: (candidate: object) => boolean;
            };
        } | undefined;

        return util?.types?.isProxy?.(value) === true;
    } catch {
        return true;
    }
}

// Browsers have no trap-free Proxy identity API. Without Node/Bun's detector, descriptor
// inspection rejects observable exotic shapes but cannot synchronously identify a transparent Proxy.
export function readPlainDataRecord(value: unknown, allowedFields: ReadonlySet<string>): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || isKnownProxy(value) || Array.isArray(value)) return null;

    try {
        if (Object.getPrototypeOf(value) !== Object.prototype) return null;

        const keys = Reflect.ownKeys(value);
        if (keys.length > allowedFields.size || keys.some((key) => typeof key !== 'string' || !allowedFields.has(key))) {
            return null;
        }

        const descriptors = Object.getOwnPropertyDescriptors(value);
        const snapshot: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = descriptors[key as string];
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            snapshot[key as string] = descriptor.value;
        }
        return snapshot;
    } catch {
        return null;
    }
}

export function readPlainDataArray(value: unknown): unknown[] | null {
    if (!value || typeof value !== 'object' || isKnownProxy(value) || !Array.isArray(value)) return null;

    try {
        if (Object.getPrototypeOf(value) !== Array.prototype) return null;

        const keys = Reflect.ownKeys(value);
        if (keys.some((key) => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)))) {
            return null;
        }

        const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
        const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
            ? readNonNegativeSafeInteger(lengthDescriptor.value)
            : null;
        if (length === null) return null;
        if (keys.length !== length + 1) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);

        const snapshot: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            snapshot.push(descriptor.value);
        }
        return snapshot;
    } catch {
        return null;
    }
}

export function normalizeText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string' || value.length > maxLength || containsMediaReference(value)) return null;
    return value.trim();
}

export function normalizeStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] | null {
    const values = readPlainDataArray(value);
    if (!values || values.length > maxItems) return null;

    const normalized: string[] = [];
    for (const item of values) {
        const text = normalizeText(item, maxItemLength);
        if (!text || normalized.includes(text)) return null;
        normalized.push(text);
    }
    return normalized;
}

export function normalizeDraftPhone(value: unknown, maxLength: number): string | null {
    const phone = normalizeText(value, maxLength);
    if (phone === null) return null;
    if (!phone) return '';
    if (!/^\+?[\d\s().-]*$/.test(phone)) return null;

    const canonical = phone.replace(/[^\d+]/g, '');
    const digits = canonical.replace(/\+/g, '');
    if (digits.length > 20) return null;
    // A draft may contain a prefix; final submission validates business numbers.
    return digits.length < 7 ? phone : canonical;
}

export type OptionalChoice<T> = { valid: true; value: T | null } | { valid: false };

export function readOptionalChoice<T>(value: unknown, choices: readonly T[], allowStoredFields: boolean): OptionalChoice<T> {
    if (choices.includes(value as T)) return { valid: true, value: value as T };
    const unset = allowStoredFields ? null : undefined;
    return value === unset ? { valid: true, value: null } : { valid: false };
}

export function readDraftLifetime(
    record: Record<string, unknown>,
    allowStoredFields: boolean,
    now: number,
    ttlMs: number,
): { savedAt: string; expiresAt: number } | null {
    const savedAt = allowStoredFields ? normalizeText(record.savedAt, 32) : new Date(now).toISOString();
    const savedAtMs = savedAt ? Date.parse(savedAt) : Number.NaN;
    const expiresAt = allowStoredFields ? record.expiresAt : now + ttlMs;
    if (savedAt === null
        || !Number.isFinite(savedAtMs)
        || typeof expiresAt !== 'number'
        || !Number.isSafeInteger(expiresAt)
        || expiresAt !== savedAtMs + ttlMs
        || savedAtMs > now + MAX_FUTURE_SAVED_AT_MS
        || (allowStoredFields && expiresAt <= now)) {
        return null;
    }
    return { savedAt, expiresAt };
}
