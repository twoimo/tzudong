import { DEBUG_LOG_EVENT, DEBUG_LOG_REASON_CODE, debugLog } from '@/lib/debug-log';

/**
 * localStorage/sessionStorage는 저장소 차단, 시크릿 모드, 샌드박스 컨텍스트에서
 * 접근 자체가 예외를 던질 수 있습니다. 접근을 이 모듈에 모으고 실패 시 안전한
 * 기본값(null/false)만 돌려주어 화면과 이벤트 핸들러가 죽지 않게 합니다.
 * 저장된 값은 로그로 남기지 않고 고정된 이벤트 코드만 기록합니다.
 */
export type BrowserStorageKind = 'local' | 'session';

const MAX_STORAGE_KEY_LENGTH = 256;

function isSafeStorageKey(key: unknown): key is string {
    return typeof key === 'string' && key.length > 0 && key.length <= MAX_STORAGE_KEY_LENGTH;
}

function reportStorageUnavailable(): void {
    debugLog(DEBUG_LOG_EVENT.BROWSER_STORAGE_UNAVAILABLE, {
        reason: DEBUG_LOG_REASON_CODE.BROWSER_STORAGE_UNAVAILABLE,
    });
}

function resolveBrowserStorage(kind: BrowserStorageKind): Storage | null {
    if (typeof window === 'undefined') return null;

    try {
        const storage = kind === 'local' ? window.localStorage : window.sessionStorage;
        return storage ?? null;
    } catch {
        reportStorageUnavailable();
        return null;
    }
}

export function readBrowserStorageString(kind: BrowserStorageKind, key: string): string | null {
    if (!isSafeStorageKey(key)) return null;

    const storage = resolveBrowserStorage(kind);
    if (!storage) return null;

    try {
        return storage.getItem(key);
    } catch {
        reportStorageUnavailable();
        return null;
    }
}

export function writeBrowserStorageString(
    kind: BrowserStorageKind,
    key: string,
    value: string,
): boolean {
    if (!isSafeStorageKey(key) || typeof value !== 'string') return false;

    const storage = resolveBrowserStorage(kind);
    if (!storage) return false;

    try {
        storage.setItem(key, value);
        return true;
    } catch {
        reportStorageUnavailable();
        return false;
    }
}

export function removeBrowserStorageItem(kind: BrowserStorageKind, key: string): boolean {
    if (!isSafeStorageKey(key)) return false;

    const storage = resolveBrowserStorage(kind);
    if (!storage) return false;

    try {
        storage.removeItem(key);
        return true;
    } catch {
        reportStorageUnavailable();
        return false;
    }
}
