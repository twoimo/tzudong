export const MARKER_IMAGE_FALLBACK = '/images/maker-images/chicken.png';

const MAX_MARKER_IMAGE_URL_LENGTH = 2048;
const MAX_PERCENT_DECODE_PASSES = 4;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;
const ROOT_URL = 'https://marker.invalid';

function decodeForMarkerImageSafety(value: string): string | null {
    let decodedValue = value;

    for (let pass = 0; pass < MAX_PERCENT_DECODE_PASSES; pass += 1) {
        if (CONTROL_CHARACTER_PATTERN.test(decodedValue) || decodedValue.includes('\\')) {
            return null;
        }

        if (!decodedValue.includes('%')) {
            return decodedValue;
        }

        try {
            const nextValue = decodeURIComponent(decodedValue);
            if (nextValue === decodedValue) {
                return decodedValue;
            }
            decodedValue = nextValue;
        } catch {
            return null;
        }
    }

    return null;
}
function hasUnsafeDecodedMarkerPath(value: string): boolean {
    const decodedPath = decodeForMarkerImageSafety(value);

    return (
        decodedPath === null ||
        decodedPath.includes('//') ||
        decodedPath.split('/').some((segment) => segment === '.' || segment === '..')
    );
}


function isCanonicalRootRelativeMarkerPath(value: string): boolean {
    if (
        !value.startsWith('/') ||
        value.startsWith('//') ||
        value.includes('?') ||
        value.includes('#')
    ) {
        return false;
    }

    if (hasUnsafeDecodedMarkerPath(value)) {
        return false;
    }


    try {
        const url = new URL(value, ROOT_URL);
        return (
            url.origin === ROOT_URL &&
            url.pathname === value &&
            url.search === '' &&
            url.hash === ''
        );
    } catch {
        return false;
    }
}

function isCanonicalHttpsMarkerUrl(value: string): boolean {
    if (decodeForMarkerImageSafety(value) === null) {
        return false;
    }


    try {
        const url = new URL(value);

        return (
            url.protocol === 'https:' &&
            url.username === '' &&
            url.password === '' &&
            url.hostname !== '' &&
            url.href === value &&
            !hasUnsafeDecodedMarkerPath(url.pathname)
        );
    } catch {
        return false;
    }
}

export function sanitizeMarkerImageUrl(value: unknown): string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > MAX_MARKER_IMAGE_URL_LENGTH ||
        CONTROL_CHARACTER_PATTERN.test(value) ||
        value.includes('\\')
    ) {
        return MARKER_IMAGE_FALLBACK;
    }

    if (isCanonicalRootRelativeMarkerPath(value) || isCanonicalHttpsMarkerUrl(value)) {
        return value;
    }

    return MARKER_IMAGE_FALLBACK;
}

export function escapeHtmlAttribute(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return char;
        }
    });
}
export function stripUnsafeMarkup(value: string): string {
    return String(value ?? "")
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/[<>]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function decodeBasicHtmlEntities(value: string): string {
    return String(value ?? "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "")
        .replace(/&gt;/g, "")
        .replace(/&amp;/g, "&");
}

export function hostnameOf(value: string): string | null {
    try {
        return new URL(value).hostname.toLowerCase();
    } catch {
        return null;
    }
}
