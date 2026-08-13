import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import {
    logCliError,
    redactCliText,
    safeCliErrorName,
} from './privacy-safe-cli-log.mjs';

const projectRoot = process.cwd();
const repoRoot = path.resolve(projectRoot, '..', '..');
const repoEnvLocalPath = path.join(repoRoot, '.env.local');
const configuredNextDistDir = process.env.TZUDONG_NEXT_DIST_DIR?.trim();
if (
    configuredNextDistDir
    && !/^\.next-[a-z0-9](?:[a-z0-9-]{0,47})$/.test(configuredNextDistDir)
) {
    process.stderr.write('[clean-next] error=InvalidDistDir\n');
    process.exit(1);
}
const nextDirectoryName = configuredNextDistDir || '.next';
const nextDir = path.join(projectRoot, nextDirectoryName);
const stalePrefix = `${nextDirectoryName}-stale-`;
const verbose = ['1', 'true', 'yes', 'on'].includes((process.env.CLEAN_NEXT_VERBOSE ?? '').toLowerCase());
const nightlyLocalEnvOnly = process.env.NIGHTLY_LOCAL_ENV_ONLY === '1';
const nightlyEnvFileOnly = process.env.NIGHTLY_ENV_FILE_ONLY === '1';
const nightlyMode = process.env.NIGHTLY_MODE?.trim();
const nightlyRun = nightlyLocalEnvOnly || nightlyEnvFileOnly || nightlyMode === 'local' || nightlyMode === 'hosted';
const strictLocalDev = process.env.TZUDONG_LOCAL_SUPABASE_DEV === '1';
const warnedStaleEntries = new Set();
const rawArgs = process.argv.slice(2);
const separatorIndex = rawArgs.indexOf('--');
const commandArgs = separatorIndex >= 0
    ? rawArgs.slice(separatorIndex + 1)
    : rawArgs.filter((arg) => arg !== '--skip-clean');
const skipClean = separatorIndex >= 0
    ? rawArgs.slice(0, separatorIndex).includes('--skip-clean')
    : rawArgs.includes('--skip-clean');

const readCommandArg = (name) => {
    const exactIndex = commandArgs.indexOf(name);
    if (exactIndex >= 0) {
        return commandArgs[exactIndex + 1];
    }

    const prefixed = commandArgs.find((arg) => arg.startsWith(`${name}=`));
    return prefixed ? prefixed.slice(name.length + 1) : undefined;
};

const isNextDevCommand = () => {
    const commandText = commandArgs.join(' ');
    return commandText.includes('node_modules/next/dist/bin/next') && commandArgs.includes('dev');
};

const getGuardedDevPort = () => {
    const isDevPrewarmCommand = commandArgs.some((arg) => arg.endsWith('scripts/dev-prewarm.mjs'));

    if (!isNextDevCommand() && !isDevPrewarmCommand) {
        return null;
    }

    const rawPort = readCommandArg('--port') ?? process.env.PORT ?? '8080';
    const port = Number(rawPort);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
};

const canBindPort = (port) =>
    new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '::');
    });

const tryRemove = (targetPath) => {
    fs.rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 150,
    });
};

const childOutputLimit = 4_096;

const writeCliError = (scope, error) => {
    logCliError(error, (line) => process.stderr.write(`[clean-next] ${scope} ${line}`));
};

const forwardChildOutput = (stream, target) => {
    if (!stream?.on) {
        return;
    }

    stream.on('data', (chunk) => {
        const text = typeof chunk === 'string'
            ? chunk
            : Buffer.isBuffer(chunk)
                ? chunk.toString('utf8')
                : '';
        if (text) {
            target.write(redactCliText(text, childOutputLimit));
        }
    });
};

const isLockLikeError = (error) => {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const code = 'code' in error ? String(error.code) : '';
    return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY' || code === 'UNKNOWN';
};

const purgeStaleCaches = () => {
    let entries = [];
    try {
        entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    } catch (error) {
        if (nightlyRun) {
            writeCliError('stale-cache-scan', error);
            throw error;
        }
        return;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(stalePrefix)) {
            continue;
        }

        try {
            tryRemove(path.join(projectRoot, entry.name));
        } catch (error) {
            if (isLockLikeError(error) && !verbose) {
                continue;
            }

            const key = safeCliErrorName(error);
            if (warnedStaleEntries.has(key)) {
                continue;
            }

            warnedStaleEntries.add(key);
            writeCliError('stale-cache-cleanup', error);
        }
    }
};
if (nightlyRun) {
    if (process.env.NODE_ENV === 'production') {
        process.stderr.write('[clean-next] error=NightlyProductionMode\n');
        process.exit(1);
    }
    if (!process.env.NIGHTLY_ENV_PROVENANCE?.trim() && !process.env.NIGHTLY_ENV_PROVENANCE_SHA256?.trim()) {
        process.stderr.write('[clean-next] error=MissingNightlyEnvProvenance\n');
        process.exit(1);
    }
    if (nightlyLocalEnvOnly && !nightlyEnvFileOnly) {
        process.stderr.write('[clean-next] error=NightlyEnvFileGateRequired\n');
        process.exit(1);
    }
    if (nightlyMode === 'local' && !nightlyLocalEnvOnly) {
        process.stderr.write('[clean-next] error=NightlyLocalGateRequired\n');
        process.exit(1);
    }
    if (nightlyMode === 'hosted' && nightlyLocalEnvOnly) {
        process.stderr.write('[clean-next] error=HostedLocalGateConflict\n');
        process.exit(1);
    }
}


if (!nightlyRun && !strictLocalDev && fs.existsSync(repoEnvLocalPath)) {
    loadEnv({ path: repoEnvLocalPath, override: false });
}

process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA ??= 'true';
process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= 'true';

if (!skipClean) {
    const guardedDevPort = getGuardedDevPort();
    if (guardedDevPort && !(await canBindPort(guardedDevPort))) {
        process.stderr.write('[clean-next] error=ActiveDevServer\n');
        process.exit(1);
    }

    purgeStaleCaches();

    try {
        tryRemove(nextDir);
    } catch (error) {
        if (verbose || !isLockLikeError(error)) {
            writeCliError('primary-cache-cleanup', error);
        }

        try {
            const fallbackName = `${stalePrefix}${Date.now()}`;
            const fallbackPath = path.join(projectRoot, fallbackName);
            fs.renameSync(nextDir, fallbackPath);
            tryRemove(fallbackPath);
            if (verbose) {
                process.stderr.write('[clean-next] stale-cache-cleanup completed\n');
            }
        } catch (fallbackError) {
            writeCliError('fallback-cache-cleanup', fallbackError);
            if (nightlyRun) {
                process.stderr.write('[clean-next] error=NightlyCacheCleanup\n');
                process.exit(1);
            }
        }
    }

    purgeStaleCaches();
}

if (commandArgs.length > 0) {
    const [command, ...args] = commandArgs;
    const childEnv = { ...process.env };
    if (isNextDevCommand()) {
        childEnv.NODE_ENV = 'development';
        if (nightlyLocalEnvOnly) {
            childEnv.NODE_ENV = 'test';
        }
    }
    if (nightlyRun || strictLocalDev) {
        childEnv.__NEXT_PROCESSED_ENV = 'true';
    }
    if (nightlyRun) {
        childEnv.NIGHTLY_ENV_FILE_ONLY = '1';
    }
    const child = spawn(command, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: childEnv,
    });

    forwardChildOutput(child.stdout, process.stdout);
    forwardChildOutput(child.stderr, process.stderr);

    child.on('error', (error) => {
        writeCliError('child-process', error);
        process.exit(1);
    });

    let stoppingSignal = null;
    let stopTimer;
    const signalExitCode = (signal) => 128 + (osConstants.signals[signal] ?? 0);

    child.on('exit', (code, signal) => {
        if (stopTimer) clearTimeout(stopTimer);
        const effectiveSignal = stoppingSignal ?? signal;
        process.exit(effectiveSignal ? signalExitCode(effectiveSignal) : (code ?? 0));
    });

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
            if (stoppingSignal) return;
            stoppingSignal = signal;
            child.kill(signal);
            stopTimer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                process.exit(signalExitCode(signal));
            }, 3_000);
            stopTimer.unref();
        });
    }
}
