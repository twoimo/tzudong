import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const STRICT_ENV = ['1', 'true', 'yes', 'on'];
const strictMode = STRICT_ENV.includes(
    String(process.env.RESPONSIVE_TEST_STRICT ?? '').toLowerCase()
);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const defaultWorkers = Math.max(
    Number.parseInt(String(process.env.RESPONSIVE_TEST_WORKERS ?? '1'), 10) || 1,
    1
);
const serverMode = String(process.env.RESPONSIVE_TEST_SERVER_MODE ?? 'production').toLowerCase();
const adminAuthFilePath = path.join(projectRoot, 'tests', '.auth', 'admin.json');

function run(command, args, options = {}) {
    return spawnSync(command, args, {
        stdio: 'pipe',
        encoding: 'utf-8',
        ...options,
    });
}

function resolveChromiumExecutable() {
    const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }

    const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (!fs.existsSync(cacheRoot)) {
        return null;
    }

    const candidates = fs
        .readdirSync(cacheRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium_headless_shell-'))
        .map((entry) => path.join(cacheRoot, entry.name, 'chrome-headless-shell-linux64', 'chrome-headless-shell'))
        .filter((candidate) => fs.existsSync(candidate))
        .sort();

    return candidates.at(-1) ?? null;
}

function resolveSupplementalLibraryPaths() {
    const configuredPaths = String(process.env.PLAYWRIGHT_EXTRA_LD_LIBRARY_PATH ?? '')
        .split(path.delimiter)
        .filter(Boolean);
    const extractedPath = path.join(
        projectRoot,
        '.cache',
        'playwright-libs',
        'extracted',
        'usr',
        'lib',
        'x86_64-linux-gnu'
    );

    return [...configuredPaths, extractedPath].filter((candidate, index, source) => {
        if (!candidate || source.indexOf(candidate) !== index) {
            return false;
        }
        return fs.existsSync(candidate);
    });
}

function withSupplementalLibraryEnv() {
    const supplemental = resolveSupplementalLibraryPaths();
    if (supplemental.length === 0) {
        return { ...process.env };
    }

    const existing = String(process.env.LD_LIBRARY_PATH ?? '')
        .split(path.delimiter)
        .filter(Boolean);
    const merged = [...supplemental, ...existing].filter(
        (entry, index, source) => source.indexOf(entry) === index
    );

    return {
        ...process.env,
        LD_LIBRARY_PATH: merged.join(path.delimiter),
    };
}

function collectMissingLibraries(binaryPath, env) {
    const ldd = run('ldd', [binaryPath], { env });
    if (ldd.status !== 0) {
        return [`ldd failed: ${ldd.stderr.trim() || ldd.stdout.trim() || 'unknown error'}`];
    }

    return ldd.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('not found'))
        .map((line) => line.split('=>')[0]?.trim() || line);
}

function printSkip(missingLibraries) {
    console.warn('[responsive-test] SKIP: missing Playwright system dependencies');
    console.warn(`[responsive-test] missing libs: ${missingLibraries.join(', ')}`);
    console.warn('[responsive-test] remediation: run `npx playwright install-deps chromium` in an interactive sudo shell.');
    console.warn('[responsive-test] set RESPONSIVE_TEST_STRICT=1 to fail instead of skipping.');
}

function hasWorkersFlag(args) {
    return args.some((arg, index) => {
        if (arg.startsWith('--workers=')) {
            return true;
        }
        return arg === '--workers' && index < args.length - 1;
    });
}

function hasSupabaseCookieStorageState(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
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

function hasAdminAuthHint() {
    const hasAdminCreds = Boolean(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD);
    const hasAdminCookieEnv = Boolean(String(process.env.INSIGHTS_CHAT_ADMIN_COOKIE ?? '').trim());
    const hasAdminCookieFile = hasSupabaseCookieStorageState(adminAuthFilePath);
    return hasAdminCreds || hasAdminCookieEnv || hasAdminCookieFile;
}

function ensureServerConfig(env) {
    const nextEnv = { ...env };
    if (!nextEnv.PLAYWRIGHT_WEB_SERVER_COMMAND) {
        nextEnv.PLAYWRIGHT_WEB_SERVER_COMMAND =
            serverMode === 'dev' ? 'npm run dev:playwright' : 'npm run start:playwright';
    }
    if (!nextEnv.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS) {
        nextEnv.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS = '240000';
    }
    if (!nextEnv.RESPONSIVE_TEST_NAV_TIMEOUT_MS) {
        nextEnv.RESPONSIVE_TEST_NAV_TIMEOUT_MS = '180000';
    }
    return nextEnv;
}

function maybeBuildForProduction(env) {
    if (serverMode === 'dev') {
        return true;
    }

    const skipBuild = STRICT_ENV.includes(
        String(process.env.RESPONSIVE_TEST_SKIP_BUILD ?? '').toLowerCase()
    );
    if (skipBuild) {
        return true;
    }

    console.log('[responsive-test] building Next.js app for production server mode...');
    const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: false, env });
    return build.status === 0;
}

function main() {
    const executable = resolveChromiumExecutable();
    const runtimeEnv = ensureServerConfig(withSupplementalLibraryEnv());

    if (!executable) {
        const message = '[responsive-test] Playwright chromium executable not found. Run `npx playwright install chromium`.';
        if (strictMode) {
            console.error(message);
            process.exit(1);
        }
        console.warn(message);
        console.warn('[responsive-test] SKIP (non-strict mode).');
        process.exit(0);
    }

    const missingLibraries = collectMissingLibraries(executable, runtimeEnv);
    if (missingLibraries.length > 0) {
        if (strictMode) {
            console.error('[responsive-test] missing Playwright system dependencies (strict mode):');
            missingLibraries.forEach((lib) => console.error(`- ${lib}`));
            process.exit(1);
        }
        printSkip(missingLibraries);
        process.exit(0);
    }

    if (!maybeBuildForProduction(runtimeEnv)) {
        console.error('[responsive-test] build failed. Aborting responsive test run.');
        process.exit(1);
    }

    if (!hasAdminAuthHint()) {
        console.warn('[responsive-test] admin auth not detected (E2E_ADMIN_EMAIL/PASSWORD or INSIGHTS_CHAT_ADMIN_COOKIE or tests/.auth/admin.json).');
        console.warn('[responsive-test] admin route responsive cases will be skipped.');
    }

    const forwardedArgs = process.argv.slice(2);
    const workerArgs = hasWorkersFlag(forwardedArgs)
        ? forwardedArgs
        : [`--workers=${defaultWorkers}`, ...forwardedArgs];
    const result = spawnSync(
        'npx',
        ['playwright', 'test', 'tests/responsive-overflow.spec.ts', ...workerArgs],
        { stdio: 'inherit', shell: false, env: runtimeEnv }
    );
    if (typeof result.status === 'number') {
        process.exit(result.status);
    }
    process.exit(1);
}

main();
