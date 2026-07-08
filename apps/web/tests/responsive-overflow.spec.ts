import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { hidePopupOverlay } from './helpers';

type OverflowIssue = {
    tag: string;
    id: string | null;
    className: string | null;
    scrollWidth: number;
    clientWidth: number;
    rightOverflow: number;
};

const ADMIN_COOKIE_ENV = 'INSIGHTS_CHAT_ADMIN_COOKIE';
const ADMIN_AUTH_FILE = path.resolve(process.cwd(), 'tests', '.auth', 'admin.json');

function decodeBase64Url(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return Buffer.from(padded, 'base64').toString('utf8');
}

function hasUsableSupabaseCookieStorageState(filePath: string): boolean {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as { cookies?: Array<{ name?: string; value?: string }> };
        const cookies = Array.isArray(parsed?.cookies) ? parsed.cookies : [];
        const groupedCookies = new Map<string, Array<{ index: number; value: string }>>();

        for (const cookie of cookies) {
            if (
                typeof cookie?.name !== 'string' ||
                !cookie.name.startsWith('sb-') ||
                typeof cookie?.value !== 'string' ||
                cookie.value.length === 0
            ) {
                continue;
            }

            const chunkMatch = cookie.name.match(/^(.*?)(?:\.(\d+))?$/);
            const baseName = chunkMatch?.[1] ?? cookie.name;
            const chunkIndex = Number.parseInt(chunkMatch?.[2] ?? '0', 10);
            const entries = groupedCookies.get(baseName) ?? [];
            entries.push({
                index: Number.isFinite(chunkIndex) ? chunkIndex : 0,
                value: cookie.value,
            });
            groupedCookies.set(baseName, entries);
        }

        const minimumExpiresAt = Math.floor(Date.now() / 1000) + 300;
        for (const entries of groupedCookies.values()) {
            const cookieValue = entries
                .sort((left, right) => left.index - right.index)
                .map((entry) => entry.value)
                .join('');
            if (!cookieValue.startsWith('base64-')) {
                continue;
            }

            const session = JSON.parse(decodeBase64Url(cookieValue.slice('base64-'.length))) as {
                expires_at?: unknown;
            };
            if (typeof session.expires_at === 'number' && session.expires_at > minimumExpiresAt) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
}

const HAS_ADMIN_AUTH_HINT = Boolean(
    (process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD) ||
    String(process.env[ADMIN_COOKIE_ENV] ?? '').trim() ||
    hasUsableSupabaseCookieStorageState(ADMIN_AUTH_FILE)
);
const parsedNavTimeout = Number.parseInt(process.env.RESPONSIVE_TEST_NAV_TIMEOUT_MS ?? '120000', 10);
const ROUTE_NAV_TIMEOUT_MS = Number.isFinite(parsedNavTimeout) && parsedNavTimeout > 0
    ? parsedNavTimeout
    : 120000;
const parsedCaseTimeout = Number.parseInt(process.env.RESPONSIVE_TEST_CASE_TIMEOUT_MS ?? '300000', 10);
const ROUTE_CASE_TIMEOUT_MS = Number.isFinite(parsedCaseTimeout) && parsedCaseTimeout > 0
    ? parsedCaseTimeout
    : 300000;

async function prepareInteractiveSurface(page: Page) {
    await hidePopupOverlay(page);
    await page.addStyleTag({
        content: `
            div[class*="fixed"][class*="inset-0"][class*="z-50"][class*="bg-black/"] {
                pointer-events: none !important;
            }
        `,
    }).catch(() => {
        // Best effort only
    });
    await page.keyboard.press('Escape').catch(() => {
        // Best effort only
    });
}

async function gotoWithRetry(page: Page, route: string, attempts = 3) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await page.goto(route, { waitUntil: 'domcontentloaded', timeout: ROUTE_NAV_TIMEOUT_MS });
            return;
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            const isRetryable = /ERR_ABORTED|frame was detached/i.test(message);
            if (!isRetryable || attempt === attempts) {
                throw error;
            }

            await page.waitForTimeout(500 * attempt);
        }
    }

    throw lastError instanceof Error ? lastError : new Error(`[responsive-overflow] failed to navigate to ${route}`);
}

async function gotoForOverflowCheck(page: Page, route: string) {
    await gotoWithRetry(page, route);
    await prepareInteractiveSurface(page);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {
        // Some pages keep long polling connections.
    });
    await page.waitForTimeout(500);
}

async function collectOverflowData(page: Page) {
    return page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const pageOverflow = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0) - doc.clientWidth;
        const issues: OverflowIssue[] = [];

        const nodes = Array.from(document.querySelectorAll<HTMLElement>('body *'));
        for (const el of nodes) {
            if (!el.isConnected) continue;

            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            if (el.closest('[data-allow-horizontal-scroll="true"]')) continue;
            if (el.closest('[data-popup-overlay="true"]')) continue;
            if (el.closest('.cluster-marker-container')) continue;
            if (String(el.className ?? '').includes('cluster-marker-container')) continue;

            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;

            const rightOverflow = rect.right - window.innerWidth;
            const widthOverflow = el.scrollWidth - el.clientWidth;

            if (rightOverflow > 1 && widthOverflow > 1) {
                issues.push({
                    tag: el.tagName.toLowerCase(),
                    id: el.id || null,
                    className: el.className ? String(el.className).slice(0, 160) : null,
                    scrollWidth: el.scrollWidth,
                    clientWidth: el.clientWidth,
                    rightOverflow: Number(rightOverflow.toFixed(2)),
                });
            }

            if (issues.length >= 10) break;
        }

        return {
            pageOverflow: Number(pageOverflow.toFixed(2)),
            clientWidth: doc.clientWidth,
            scrollWidth: doc.scrollWidth,
            issues,
        };
    });
}

function expectNoOverflow(route: string, data: Awaited<ReturnType<typeof collectOverflowData>>) {
    expect.soft(
        data.pageOverflow,
        `[${route}] document overflow: ${JSON.stringify(data, null, 2)}`
    ).toBeLessThanOrEqual(1);
    if (data.pageOverflow > 1) {
        expect.soft(
            data.issues.length,
            `[${route}] element overflow issues: ${JSON.stringify(data.issues, null, 2)}`
        ).toBe(0);
    }
}

async function assertNoHorizontalOverflow(page: Page, route: string) {
    await gotoForOverflowCheck(page, route);
    expectNoOverflow(route, await collectOverflowData(page));
}

async function clickIfVisible(page: Page, selector: string) {
    const target = page.locator(selector).first();
    if (!await target.isVisible().catch(() => false)) {
        return;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await target.click({ timeout: 4000 });
            await page.waitForTimeout(250);
            return;
        } catch {
            await prepareInteractiveSurface(page);
            await page.waitForTimeout(200);
        }
    }

    if (await target.isVisible().catch(() => false)) {
        await target.click({ force: true, timeout: 3000 });
        await page.waitForTimeout(250);
    }
}

test.describe('Responsive Overflow Guard', () => {
    test.describe.configure({ timeout: ROUTE_CASE_TIMEOUT_MS });

    test('common routes should not overflow horizontally', async ({ page }) => {
        const routes = ['/', '/feed', '/stamp', '/leaderboard', '/global-map', '/mypage/profile'];
        for (const route of routes) {
            await assertNoHorizontalOverflow(page, route);
        }
    });

    test('admin routes should not overflow horizontally', async ({ page }) => {
        test.skip(
            !HAS_ADMIN_AUTH_HINT,
            'E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD 또는 INSIGHTS_CHAT_ADMIN_COOKIE/tests/.auth/admin.json 관리자 세션이 필요합니다.'
        );

        const adminRoutes = [
            '/admin',
            '/admin?module=restaurants',
            '/admin?module=submissions',
            '/admin?module=reviews',
            '/admin?module=banners',
            '/admin?module=announcements',
            '/admin?module=insights',
            '/admin?module=audit',
            '/admin/evaluations',
            '/admin/submissions',
            '/admin/banners',
            '/insights',
        ];
        for (const route of adminRoutes) {
            await assertNoHorizontalOverflow(page, route);
        }
    });

    test('interactive surfaces should keep overflow-safe layout', async ({ page, isMobile }) => {
        await gotoForOverflowCheck(page, '/');

        if (isMobile) {
            await clickIfVisible(page, 'button:has(svg.lucide-search)');
        }
        await clickIfVisible(page, 'button:has(svg.lucide-filter),button:has(svg.lucide-sliders-horizontal),button:has(svg.lucide-funnel)');
        expectNoOverflow('/ interactive:home', await collectOverflowData(page));

        await gotoForOverflowCheck(page, '/global-map');
        await clickIfVisible(page, 'button[role="combobox"]');
        expectNoOverflow('/ interactive:global-map', await collectOverflowData(page));

        await gotoForOverflowCheck(page, '/stamp');
        await clickIfVisible(page, 'button:has(svg.lucide-filter)');
        expectNoOverflow('/ interactive:stamp', await collectOverflowData(page));
    });
});
