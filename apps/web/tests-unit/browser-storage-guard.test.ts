import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    readBrowserStorageString,
    removeBrowserStorageItem,
    writeBrowserStorageString,
} from '../lib/browser-storage';

const source = (relativePath: string) =>
    readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

class MemoryStorage implements Storage {
    readonly calls: string[] = [];
    private values = new Map<string, string>();

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key: string) {
        this.calls.push(`get:${key}`);
        return this.values.get(key) ?? null;
    }

    key(index: number) {
        return Array.from(this.values.keys())[index] ?? null;
    }

    removeItem(key: string) {
        this.calls.push(`remove:${key}`);
        this.values.delete(key);
    }

    setItem(key: string, value: string) {
        this.calls.push(`set:${key}`);
        this.values.set(key, value);
    }
}

const priorWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

const installWindow = (value: unknown) => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value });
};

const installMemoryStorages = () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    installWindow({ localStorage: local, sessionStorage: session });
    return { local, session };
};

afterEach(() => {
    if (priorWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', priorWindowDescriptor);
        return;
    }
    Reflect.deleteProperty(globalThis, 'window');
});

describe('browser storage guard', () => {
    test('writes and reads through the requested storage only', () => {
        const { local, session } = installMemoryStorages();

        expect(writeBrowserStorageString('local', 'k', 'v')).toBe(true);
        expect(writeBrowserStorageString('session', 'k', 'sv')).toBe(true);
        expect(readBrowserStorageString('local', 'k')).toBe('v');
        expect(readBrowserStorageString('session', 'k')).toBe('sv');
        expect(readBrowserStorageString('local', 'missing')).toBeNull();
        expect(removeBrowserStorageItem('local', 'k')).toBe(true);
        expect(readBrowserStorageString('local', 'k')).toBeNull();
        expect(session.getItem('k')).toBe('sv');
        expect(local.length).toBe(0);
    });

    test('returns safe defaults instead of throwing when window is absent', () => {
        Reflect.deleteProperty(globalThis, 'window');

        expect(readBrowserStorageString('local', 'k')).toBeNull();
        expect(writeBrowserStorageString('local', 'k', 'v')).toBe(false);
        expect(removeBrowserStorageItem('session', 'k')).toBe(false);
    });

    test('returns safe defaults when the storage property itself throws', () => {
        installWindow(
            Object.defineProperty({}, 'localStorage', {
                configurable: true,
                get() {
                    throw new Error('storage blocked');
                },
            }),
        );

        expect(readBrowserStorageString('local', 'k')).toBeNull();
        expect(writeBrowserStorageString('local', 'k', 'v')).toBe(false);
        expect(removeBrowserStorageItem('local', 'k')).toBe(false);
    });

    test('returns safe defaults when storage methods throw', () => {
        installWindow({
            localStorage: {
                getItem() {
                    throw new Error('getItem blocked');
                },
                setItem() {
                    throw new Error('setItem blocked');
                },
                removeItem() {
                    throw new Error('removeItem blocked');
                },
            },
        });

        expect(readBrowserStorageString('local', 'k')).toBeNull();
        expect(writeBrowserStorageString('local', 'k', 'v')).toBe(false);
        expect(removeBrowserStorageItem('local', 'k')).toBe(false);
    });

    test('rejects unusable keys and values before touching storage', () => {
        const { local } = installMemoryStorages();

        expect(readBrowserStorageString('local', '')).toBeNull();
        expect(writeBrowserStorageString('local', '', 'v')).toBe(false);
        expect(removeBrowserStorageItem('local', '')).toBe(false);
        expect(readBrowserStorageString('local', 'x'.repeat(257))).toBeNull();
        expect(writeBrowserStorageString('local', 'x'.repeat(257), 'v')).toBe(false);
        expect(writeBrowserStorageString('local', 'k', undefined as unknown as string)).toBe(false);
        expect(local.calls).toEqual([]);
    });
});

describe('browser storage guard adoption', () => {
    const fullyGuardedFiles = [
        'components/recommendation/DailyRecommendationPopup.tsx',
        'components/layout/CombinedPopup.tsx',
        'components/layout/Header.tsx',
    ];

    test('popup and header call sites no longer touch storage directly', () => {
        for (const file of fullyGuardedFiles) {
            const fileSource = source(file);
            expect(fileSource, file).toContain('browser-storage');
            expect(fileSource, file).not.toMatch(/\blocalStorage\.(?:getItem|setItem|removeItem)\(/);
            expect(fileSource, file).not.toMatch(/\bsessionStorage\.(?:getItem|setItem|removeItem)\(/);
        }
    });

    test('each call site routes its own storage key through the guard', () => {
        expect(source('components/recommendation/DailyRecommendationPopup.tsx'))
            .toContain("readBrowserStorageString('local', POPUP_STORAGE_KEY)");
        expect(source('components/recommendation/DailyRecommendationPopup.tsx'))
            .toContain("writeBrowserStorageString('session', 'selectedRestaurant'");
        expect(source('components/layout/CombinedPopup.tsx'))
            .toContain("readBrowserStorageString('local', DISMISSED_DATE_KEY)");
        expect(source('components/layout/CombinedPopup.tsx'))
            .toContain("writeBrowserStorageString('local', DISMISSED_DATE_KEY, getTodayString())");
        expect(source('components/layout/Header.tsx'))
            .toContain("readBrowserStorageString('session', 'announcementBannerDismissed')");
        expect(source('components/admin/AdminConsoleOverview.tsx'))
            .toContain('readBrowserStorageString("local", ADMIN_THEME_STORAGE_KEY)');
        expect(source('components/admin/AdminConsoleOverview.tsx'))
            .toContain('writeBrowserStorageString("local", ADMIN_THEME_STORAGE_KEY, nextTheme)');
    });

    test('storage failures are reported with a fixed sanitized code only', () => {
        const guardSource = source('lib/browser-storage.ts');
        const debugLogSource = source('lib/debug-log.ts');

        expect(debugLogSource).toContain("BROWSER_STORAGE_UNAVAILABLE: 'BROWSER_STORAGE_UNAVAILABLE'");
        expect(guardSource).toContain('debugLog(DEBUG_LOG_EVENT.BROWSER_STORAGE_UNAVAILABLE, {');
        expect(guardSource).toContain('reason: DEBUG_LOG_REASON_CODE.BROWSER_STORAGE_UNAVAILABLE,');
        expect(guardSource).not.toContain('console.log');
        expect(guardSource).not.toContain('console.error');
    });
});
