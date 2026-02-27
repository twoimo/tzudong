import { Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ADMIN_COOKIE_ENV = 'INSIGHTS_CHAT_ADMIN_COOKIE';
const ADMIN_COOKIE_FILE_ENV = 'INSIGHTS_CHAT_ADMIN_COOKIE_FILE';

type CookieJson = {
    name?: string;
    value?: string;
};

function getEnvironmentCookie(): string | null {
    const rawCookie = process.env[ADMIN_COOKIE_ENV];
    if (typeof rawCookie !== 'string') {
        return null;
    }
    const trimmed = rawCookie.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed;
}

function getAdminCookieFromStorageState(statePath: string): string | null {
    try {
        const raw = readFileSync(statePath, 'utf8');
        const state = JSON.parse(raw) as { cookies?: CookieJson[] };
        const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
        const adminCookies = cookies.filter((cookie) => typeof cookie?.name === 'string' && cookie.name.startsWith('sb-') && typeof cookie?.value === 'string');
        if (adminCookies.length === 0) {
            return null;
        }
        return adminCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    } catch {
        return null;
    }
}

function buildCandidateStatePaths(): string[] {
    const cwd = process.cwd();
    const initCwd = process.env.INIT_CWD;
    const cwdLevel1 = resolve(cwd, '..');
    const cwdLevel2 = resolve(cwdLevel1, '..');

    const baseDirectories = [cwd, cwdLevel1, cwdLevel2];
    if (typeof initCwd === 'string' && initCwd.trim()) {
        baseDirectories.push(initCwd);
    }

    const candidates = new Set<string>();

    const explicitPath = process.env[ADMIN_COOKIE_FILE_ENV]?.trim();
    if (explicitPath) {
        candidates.add(resolve(explicitPath));
    }

    for (const base of baseDirectories) {
        candidates.add(resolve(base, 'tests', '.auth', 'admin.json'));
        candidates.add(resolve(base, 'apps', 'web', 'tests', '.auth', 'admin.json'));
    }

    return [...candidates];
}

function resolveAdminSessionCookie(): string | null {
    const envCookie = getEnvironmentCookie();
    if (envCookie) {
        return envCookie;
    }

    for (const statePath of buildCandidateStatePaths()) {
        if (!existsSync(statePath)) {
            continue;
        }

        const cookie = getAdminCookieFromStorageState(statePath);
        if (cookie) {
            return cookie;
        }
    }

    return null;
}

/**
 * 페이지 로딩 후 popup overlay 및 dev overlay를 숨기는 헬퍼 함수
 * 모든 테스트의 beforeEach에서 호출하여 클릭 차단 문제 해결
 */
export async function hidePopupOverlay(page: Page): Promise<void> {
    await page.addStyleTag({
        content: `
            [data-popup-overlay="true"] { display: none !important; }
            nextjs-portal { display: none !important; }
            [data-nextjs-dev-overlay] { display: none !important; }
        `
    });
}

function getAdminCookieValue() {
    return resolveAdminSessionCookie();
}

export function hasAdminSession(): boolean {
    return Boolean(getAdminCookieValue());
}

export function getAdminRequestHeaders(overrides: Record<string, string> = {}): Record<string, string> {
    const adminCookie = getAdminCookieValue();
    if (!adminCookie) {
        return { ...overrides };
    }

    return {
        ...overrides,
        Cookie: adminCookie,
    };
}

export function getAdminSessionCookie(): string | null {
    return getAdminCookieValue();
}

/**
 * 페이지 로딩 및 popup overlay 숨김 처리를 포함한 goto 래퍼
 */
export async function gotoAndHidePopup(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await hidePopupOverlay(page);
}

/**
 * 모바일 환경에서 필터 버튼이 보이면 확장
 */
export async function expandMobileFilter(page: Page): Promise<void> {
    const filterBtn = page.getByRole('button', { name: /필터/i }).first();
    if (await filterBtn.isVisible()) {
        await filterBtn.click();
        // 애니메이션 대기
        await page.waitForTimeout(300);
    }
}
