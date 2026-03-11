import { test as setup, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { hidePopupOverlay } from '../helpers';

const authFile = path.join(__dirname, '..', '.auth', 'admin.json');
const ADMIN_COOKIE_ENV = 'INSIGHTS_CHAT_ADMIN_COOKIE';
const SUPABASE_URL_ENV = 'NEXT_PUBLIC_SUPABASE_URL';
const SUPABASE_ANON_KEY_ENV = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';
const MAX_COOKIE_CHUNK_SIZE = 3180;
const envFileCache = new Map<string, string>();

function readEnvFromLocalFile(key: string): string {
    if (envFileCache.has(key)) {
        return envFileCache.get(key) ?? '';
    }

    const envPath = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) {
        envFileCache.set(key, '');
        return '';
    }

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    const parsed = new Map<string, string>();
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separator = trimmed.indexOf('=');
        if (separator <= 0) {
            continue;
        }

        const parsedKey = trimmed.slice(0, separator).trim();
        const parsedValue = trimmed.slice(separator + 1).trim();
        const normalizedValue =
            (parsedValue.startsWith('"') && parsedValue.endsWith('"')) ||
            (parsedValue.startsWith("'") && parsedValue.endsWith("'"))
                ? parsedValue.slice(1, -1)
                : parsedValue;
        parsed.set(parsedKey, normalizedValue);
    }

    const value = parsed.get(key) ?? '';
    envFileCache.set(key, value);
    return value;
}

function readEnvWithFallback(key: string): string {
    const fromProcess = String(process.env[key] ?? '').trim();
    if (fromProcess) {
        return fromProcess;
    }
    return readEnvFromLocalFile(key);
}

function hasSupabaseCookieStorageState(filePath: string): boolean {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as { cookies?: Array<{ name?: string; value?: string }> };
        const cookies = Array.isArray(parsed?.cookies) ? parsed.cookies : [];
        return cookies.some(
            (cookie) =>
                typeof cookie?.name === 'string' &&
                cookie.name.startsWith('sb-') &&
                typeof cookie?.value === 'string' &&
                cookie.value.length > 0
        );
    } catch {
        return false;
    }
}

function writeStorageStateFromCookieHeader(filePath: string, rawCookieHeader: string) {
    const parsedCookies = rawCookieHeader
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const separator = entry.indexOf('=');
            if (separator <= 0) {
                return null;
            }

            const name = entry.slice(0, separator).trim();
            const value = entry.slice(separator + 1).trim();
            if (!name.startsWith('sb-') || !value) {
                return null;
            }

            return {
                name,
                value,
                domain: 'localhost',
                path: '/',
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: 'Lax' as const,
            };
        })
        .filter((entry): entry is {
            name: string;
            value: string;
            domain: string;
            path: string;
            expires: number;
            httpOnly: boolean;
            secure: boolean;
            sameSite: 'Lax';
        } => Boolean(entry));

    if (parsedCookies.length === 0) {
        return false;
    }

    fs.writeFileSync(filePath, JSON.stringify({ cookies: parsedCookies, origins: [] }, null, 2), 'utf8');
    return true;
}

function toBase64Url(value: string): string {
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function createCookieChunks(key: string, value: string): Array<{ name: string; value: string }> {
    const encodedValue = encodeURIComponent(value);
    if (encodedValue.length <= MAX_COOKIE_CHUNK_SIZE) {
        return [{ name: key, value }];
    }

    const chunks: string[] = [];
    let remaining = encodedValue;
    while (remaining.length > 0) {
        let encodedChunkHead = remaining.slice(0, MAX_COOKIE_CHUNK_SIZE);
        const lastEscapePos = encodedChunkHead.lastIndexOf('%');
        if (lastEscapePos > MAX_COOKIE_CHUNK_SIZE - 3) {
            encodedChunkHead = encodedChunkHead.slice(0, lastEscapePos);
        }

        let decodedChunk = '';
        while (encodedChunkHead.length > 0) {
            try {
                decodedChunk = decodeURIComponent(encodedChunkHead);
                break;
            } catch (error) {
                if (error instanceof URIError && encodedChunkHead.at(-3) === '%' && encodedChunkHead.length > 3) {
                    encodedChunkHead = encodedChunkHead.slice(0, encodedChunkHead.length - 3);
                } else {
                    throw error;
                }
            }
        }

        chunks.push(decodedChunk);
        remaining = remaining.slice(encodedChunkHead.length);
    }

    return chunks.map((chunkValue, index) => ({
        name: `${key}.${index}`,
        value: chunkValue,
    }));
}

function writeStorageStateFromCookieEntries(filePath: string, cookies: Array<{ name: string; value: string }>): boolean {
    const normalized = cookies
        .filter((entry) => entry.name.startsWith('sb-') && entry.value.length > 0)
        .map((entry) => ({
            ...entry,
            domain: 'localhost',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax' as const,
        }));

    if (normalized.length === 0) {
        return false;
    }

    fs.writeFileSync(filePath, JSON.stringify({ cookies: normalized, origins: [] }, null, 2), 'utf8');
    return true;
}

function getSupabaseStorageKey(supabaseUrl: string): string {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    return `sb-${projectRef}-auth-token`;
}

async function writeStorageStateViaSupabasePassword(
    filePath: string,
    email: string,
    password: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const supabaseUrl = readEnvWithFallback(SUPABASE_URL_ENV).replace(/\/+$/, '');
    const supabaseAnonKey = readEnvWithFallback(SUPABASE_ANON_KEY_ENV);
    if (!supabaseUrl || !supabaseAnonKey) {
        return { ok: false, reason: `${SUPABASE_URL_ENV}/${SUPABASE_ANON_KEY_ENV} missing` };
    }

    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
            let apiErrorDetail = '';
            try {
                const errorPayload = await response.json() as { msg?: string; error?: string };
                apiErrorDetail = String(errorPayload.msg ?? errorPayload.error ?? '').trim();
            } catch {
                // ignore json parse failure
            }
            return {
                ok: false,
                reason: `auth api status ${response.status}${apiErrorDetail ? ` (${apiErrorDetail})` : ''}`,
            };
        }

        const payload = await response.json() as Record<string, unknown>;
        const accessToken = payload['access_token'];
        const refreshToken = payload['refresh_token'];
        const expiresIn = payload['expires_in'];
        if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
            return { ok: false, reason: 'auth api session payload missing access/refresh token' };
        }

        const session = { ...payload };
        if (typeof session['expires_at'] !== 'number' && typeof expiresIn === 'number') {
            session['expires_at'] = Math.floor(Date.now() / 1000) + expiresIn;
        }

        const storageKey = getSupabaseStorageKey(supabaseUrl);
        const cookieValue = `base64-${toBase64Url(JSON.stringify(session))}`;
        const chunkedCookies = createCookieChunks(storageKey, cookieValue);
        if (!writeStorageStateFromCookieEntries(filePath, chunkedCookies)) {
            return { ok: false, reason: 'failed to write chunked supabase cookie storage state' };
        }

        return { ok: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `auth api request failed: ${message}` };
    }
}

async function gotoRootWithRetry(page: Page, attempts = 3): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            return;
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                await page.waitForTimeout(1500 * attempt);
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to navigate to "/"');
}

async function dumpDebugState(page: Page, logs: string[]) {
    const buttonTexts = (await page.getByRole('button').allTextContents().catch(() => []))
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 20);
    const bodyText = (await page.locator('body').innerText().catch(() => ''))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
    const url = page.url();
    const title = await page.title().catch(() => '');

    logs.push(
        `[admin-setup] debug url=${url} title=${title} buttons=${JSON.stringify(buttonTexts)} body=${JSON.stringify(bodyText)}`
    );
}

setup.setTimeout(180000);

setup('authenticate admin', async ({ page }) => {
    const email = process.env.E2E_ADMIN_EMAIL;
    const password = process.env.E2E_ADMIN_PASSWORD;
    const cookieHeader = String(process.env[ADMIN_COOKIE_ENV] ?? '').trim();
    const debugLogs: string[] = [];
    page.on('console', (message) => {
        debugLogs.push(`[browser:${message.type()}] ${message.text()}`);
    });
    page.on('pageerror', (error) => {
        debugLogs.push(`[pageerror] ${error.message}`);
    });

    const authDir = path.dirname(authFile);
    fs.mkdirSync(authDir, { recursive: true });

    if (!email || !password) {
        if (cookieHeader && writeStorageStateFromCookieHeader(authFile, cookieHeader)) {
            return;
        }

        if (hasSupabaseCookieStorageState(authFile)) {
            return;
        }

        await page.context().storageState({ path: authFile });
        return;
    }

    const apiAuthResult = await writeStorageStateViaSupabasePassword(authFile, email, password);
    if (apiAuthResult.ok) {
        return;
    }
    if (apiAuthResult.reason.includes('Invalid login credentials')) {
        throw new Error(
            `[admin-setup] 제공된 E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD로 Supabase 비밀번호 인증 실패: ${apiAuthResult.reason}`
        );
    }
    debugLogs.push(`[admin-setup] api auth fallback reason=${apiAuthResult.reason}`);

    await gotoRootWithRetry(page);
    await hidePopupOverlay(page);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
        // 일부 페이지는 long-polling으로 networkidle이 유지되지 않을 수 있음
    });

    const accountMenuButton = page.getByRole('button', { name: /내 계정 메뉴|로그아웃/i }).first();
    if (await accountMenuButton.isVisible().catch(() => false)) {
        await page.context().storageState({ path: authFile });
        return;
    }

    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    if (!await emailInput.isVisible().catch(() => false)) {
        const loginButton = page.getByRole('button', { name: /^로그인$/i }).first();
        const labeledLoginButton = page.locator('button[aria-label="로그인"]').first();

        if (await loginButton.isVisible().catch(() => false)) {
            await loginButton.click();
        } else if (await labeledLoginButton.isVisible().catch(() => false)) {
            await labeledLoginButton.click();
        } else {
            await dumpDebugState(page, debugLogs);
            throw new Error(
                `[admin-setup] 로그인 진입 버튼을 찾지 못했습니다.\n${debugLogs.slice(-30).join('\n')}`
            );
        }
    }

    await expect(emailInput).toBeVisible({ timeout: 20000 });
    await expect(passwordInput).toBeVisible({ timeout: 20000 });
    await emailInput.fill(email);
    await passwordInput.fill(password);

    await page.getByRole('button', { name: /로그인|login/i }).first().click();

    await expect(page.getByRole('button', { name: /로그인/i })).toHaveCount(0, { timeout: 15000 });
    await page.context().storageState({ path: authFile });
});
