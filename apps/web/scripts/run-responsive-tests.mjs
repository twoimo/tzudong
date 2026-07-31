import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { logCliError } from './privacy-safe-cli-log.mjs';

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
const SAFE_LIBRARY_NAME_PATTERN = /^lib[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const MISSING_LIBRARY_LINE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._+-]{0,127})\s+=>\s+not found$/;

class OperationFailure extends Error {
    constructor(code) {
        super();
        this.code = code;
    }
}

function reportFailure(code) {
    logCliError(new OperationFailure(code));
}

function logMissingLibraryFacts(missingLibraries, write = console.warn) {
    write(`[responsive-test] missing_library_count=${missingLibraries.length}`);
    if (missingLibraries.length > 0) {
        write(`[responsive-test] missing_libraries=${missingLibraries.join(', ')}`);
    }
}

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

    const cacheRoots = [
        path.join(os.homedir(), '.cache', 'ms-playwright'),
        process.platform === 'win32'
            ? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
            : null,
    ].filter(Boolean);

    const platformExecutable =
        process.platform === 'win32'
            ? ['chrome-headless-shell-win64', 'chrome-headless-shell.exe']
            : ['chrome-headless-shell-linux64', 'chrome-headless-shell'];

    const candidates = cacheRoots.flatMap((cacheRoot) => {
        if (!fs.existsSync(cacheRoot)) {
            return [];
        }

        return fs
            .readdirSync(cacheRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium_headless_shell-'))
            .map((entry) => path.join(cacheRoot, entry.name, ...platformExecutable))
            .filter((candidate) => fs.existsSync(candidate));
    }).sort();

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
    if (process.platform === 'win32') {
        return { inspectionFailed: false, missingLibraries: [] };
    }

    const ldd = run('ldd', [binaryPath], { env });
    if (ldd.status !== 0 || ldd.error) {
        return { inspectionFailed: true, missingLibraries: [] };
    }

    let inspectionFailed = false;
    const missingLibraries = new Set();
    const output = typeof ldd.stdout === 'string' ? ldd.stdout : '';
    for (const rawLine of output.split('\n')) {
        const line = rawLine.trim();
        if (!line.includes('not found')) {
            continue;
        }

        const match = line.match(MISSING_LIBRARY_LINE_PATTERN);
        if (!match || !SAFE_LIBRARY_NAME_PATTERN.test(match[1])) {
            inspectionFailed = true;
            continue;
        }
        missingLibraries.add(match[1]);
    }

    return {
        inspectionFailed,
        missingLibraries: [...missingLibraries],
    };
}

function printSkip(code, missingLibraries) {
    console.warn(`[responsive-test] SKIP code=${code}`);
    logMissingLibraryFacts(missingLibraries);
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

function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return Buffer.from(padded, 'base64').toString('utf8');
}

function hasUsableSupabaseCookieStorageState(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const cookies = Array.isArray(parsed?.cookies) ? parsed.cookies : [];
        const groupedCookies = new Map();

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

            const session = JSON.parse(decodeBase64Url(cookieValue.slice('base64-'.length)));
            if (typeof session?.expires_at === 'number' && session.expires_at > minimumExpiresAt) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
}

function hasAdminAuthHint() {
    const hasAdminCreds = Boolean(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD);
    const hasAdminCookieEnv = Boolean(String(process.env.INSIGHTS_CHAT_ADMIN_COOKIE ?? '').trim());
    const hasAdminCookieFile = hasUsableSupabaseCookieStorageState(adminAuthFilePath);
    return hasAdminCreds || hasAdminCookieEnv || hasAdminCookieFile;
}

function ensureServerConfig(env) {
    const nextEnv = { ...env };
    if (!nextEnv.PLAYWRIGHT_WEB_SERVER_COMMAND) {
        nextEnv.PLAYWRIGHT_WEB_SERVER_COMMAND =
            serverMode === 'dev' ? 'bun run dev:playwright' : 'bun run start:playwright';
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
    const build = spawnSync('bun', ['run', 'build'], { stdio: 'ignore', shell: false, env });
    return build.status === 0;
}

function main() {
    try {
        const executable = resolveChromiumExecutable();
        const runtimeEnv = ensureServerConfig(withSupplementalLibraryEnv());

        if (!executable) {
            if (strictMode) {
                reportFailure('RESPONSIVE_TEST_CHROMIUM_UNAVAILABLE');
                process.exit(1);
            }
            console.warn('[responsive-test] SKIP code=RESPONSIVE_TEST_CHROMIUM_UNAVAILABLE');
            console.warn('[responsive-test] remediation: run `npx playwright install chromium`.');
            console.warn('[responsive-test] set RESPONSIVE_TEST_STRICT=1 to fail instead of skipping.');
            process.exit(0);
        }

        const libraryCheck = collectMissingLibraries(executable, runtimeEnv);
        if (libraryCheck.inspectionFailed) {
            if (strictMode) {
                reportFailure('RESPONSIVE_TEST_LIBRARY_INSPECTION_FAILED');
                logMissingLibraryFacts(libraryCheck.missingLibraries, console.error);
                process.exit(1);
            }
            printSkip('RESPONSIVE_TEST_LIBRARY_INSPECTION_FAILED', libraryCheck.missingLibraries);
            process.exit(0);
        }

        if (libraryCheck.missingLibraries.length > 0) {
            if (strictMode) {
                reportFailure('RESPONSIVE_TEST_MISSING_SYSTEM_LIBRARIES');
                logMissingLibraryFacts(libraryCheck.missingLibraries, console.error);
                process.exit(1);
            }
            printSkip('RESPONSIVE_TEST_MISSING_SYSTEM_LIBRARIES', libraryCheck.missingLibraries);
            process.exit(0);
        }

        if (!maybeBuildForProduction(runtimeEnv)) {
            reportFailure('RESPONSIVE_TEST_BUILD_FAILED');
            process.exit(1);
        }

        if (!hasAdminAuthHint()) {
            console.warn('[responsive-test] admin auth not detected (configured credentials, cookie, or local state).');
            console.warn('[responsive-test] admin route responsive cases will be skipped.');
        }

        const forwardedArgs = process.argv.slice(2);
        const workerArgs = hasWorkersFlag(forwardedArgs)
            ? forwardedArgs
            : [`--workers=${defaultWorkers}`, ...forwardedArgs];
        const playwrightCli = path.join(projectRoot, 'node_modules', 'playwright', 'cli.js');
        const playwrightArgs = ['test', 'tests/responsive-overflow.spec.ts', ...workerArgs];
        const result = spawnSync(
            process.execPath,
            [playwrightCli, ...playwrightArgs],
            { stdio: 'ignore', shell: false, env: runtimeEnv }
        );
        if (typeof result.status === 'number') {
            process.exit(result.status);
        }
        reportFailure('RESPONSIVE_TEST_PLAYWRIGHT_LAUNCH_FAILED');
        process.exit(1);
    } catch {
        reportFailure('RESPONSIVE_TEST_RUNNER_FAILED');
        process.exit(1);
    }
}

main();
