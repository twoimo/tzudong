import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { Page } from '@playwright/test';

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

type StorageCookie = {
    name: string;
    value?: string;
};

type StorageState = {
    cookies?: StorageCookie[];
};

const CANDIDATE_AUTH_PATHS = [
    resolvePath(process.cwd(), 'tests', '.auth', 'admin.json'),
    resolvePath(process.cwd(), 'apps', 'web', 'tests', '.auth', 'admin.json'),
    resolvePath(process.cwd(), '..', 'tests', '.auth', 'admin.json'),
] as const;

function resolveAdminSessionCookie(): string | null {
    const envCookie = process.env.INSIGHTS_CHAT_ADMIN_COOKIE?.trim();
    if (envCookie) {
        return envCookie;
    }

    for (const statePath of CANDIDATE_AUTH_PATHS) {
        try {
            if (!existsSync(statePath)) {
                continue;
            }

            const raw = readFileSync(statePath, 'utf8');
            const state = JSON.parse(raw) as StorageState;
            const adminCookies = (state.cookies || []).filter((cookie) => cookie?.name?.startsWith('sb-'));
            if (adminCookies.length === 0) {
                continue;
            }

            const cookieHeader = adminCookies
                .filter((cookie) => Boolean(cookie.name) && typeof cookie.value === 'string')
                .map((cookie) => `${cookie.name}=${cookie.value}`)
                .join('; ');

            if (cookieHeader) {
                return cookieHeader;
            }
        } catch {
            continue;
        }
    }

    return null;
}

const ADMIN_COOKIE = resolveAdminSessionCookie();

export function hasAdminSession(): boolean {
    return Boolean(ADMIN_COOKIE);
}

export function getAdminRequestHeaders(overrides: Record<string, string> = {}): Record<string, string> {
    if (!ADMIN_COOKIE) {
        return { ...overrides };
    }

    return {
        ...overrides,
        Cookie: ADMIN_COOKIE,
    };
}

export function getAdminSessionCookie(): string | null {
    return ADMIN_COOKIE;
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
