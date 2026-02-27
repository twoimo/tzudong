import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_COOKIE_ENV = 'INSIGHTS_CHAT_ADMIN_COOKIE';
const ADMIN_COOKIE_FILE_ENV = 'INSIGHTS_CHAT_ADMIN_COOKIE_FILE';

const SCRIPT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));

/**
 * StorageState(Playwright)에서 Supabase 세션 쿠키 헤더를 추출합니다.
 */
function getAdminCookieFromStorageState(statePath) {
    try {
        const raw = readFileSync(statePath, 'utf8');
        const state = JSON.parse(raw);
        const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
        const adminCookies = cookies.filter((cookie) => typeof cookie?.name === 'string' && cookie.name.startsWith('sb-') && typeof cookie?.value === 'string');
        if (adminCookies.length === 0) {
            return null;
        }

        const header = adminCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
        return header || null;
    } catch {
        return null;
    }
}

function getEnvironmentCookie() {
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

function buildCandidateStatePaths() {
    const cwd = process.cwd();
    const initCwd = process.env.INIT_CWD;
    const cwdLevel1 = resolve(cwd, '..');
    const cwdLevel2 = resolve(cwdLevel1, '..');

    const baseDirectories = [cwd, cwdLevel1, cwdLevel2];
    if (typeof initCwd === 'string' && initCwd) {
        baseDirectories.push(initCwd);
    }

    // scripts/ 디렉터리 기준으로도 검색 (Playwright/qa 실행 위치가 다를 때 대응)
    baseDirectories.push(resolve(SCRIPT_DIR, '..'));

    const paths = new Set();

    if (typeof process.env[ADMIN_COOKIE_FILE_ENV] === 'string' && process.env[ADMIN_COOKIE_FILE_ENV].trim()) {
        paths.add(resolve(process.env[ADMIN_COOKIE_FILE_ENV].trim()));
    }

    for (const base of baseDirectories) {
        paths.add(resolve(base, 'tests', '.auth', 'admin.json'));
        paths.add(resolve(base, 'apps', 'web', 'tests', '.auth', 'admin.json'));
    }

    return [...paths];
}

/**
 * 환경변수 또는 tests/.auth/admin.json에서 관리자 쿠키를 해석합니다.
 *
 * 우선순위:
 * 1) INSIGHTS_CHAT_ADMIN_COOKIE
 * 2) Playwright storageState 후보 경로들
 */
export function resolveAdminSessionCookie() {
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
