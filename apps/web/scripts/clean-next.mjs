import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
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
const nextDir = path.join(projectRoot, '.next');
const stalePrefix = '.next-stale-';
const verbose = ['1', 'true', 'yes', 'on'].includes((process.env.CLEAN_NEXT_VERBOSE ?? '').toLowerCase());
const nightlyLocalEnvOnly = process.env.NIGHTLY_LOCAL_ENV_ONLY === '1';
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
    } catch {
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

if (!nightlyLocalEnvOnly && fs.existsSync(repoEnvLocalPath)) {
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
            const fallbackName = `.next-stale-${Date.now()}`;
            const fallbackPath = path.join(projectRoot, fallbackName);
            fs.renameSync(nextDir, fallbackPath);
            tryRemove(fallbackPath);
            if (verbose) {
                process.stderr.write('[clean-next] stale-cache-cleanup completed\n');
            }
        } catch (fallbackError) {
            writeCliError('fallback-cache-cleanup', fallbackError);
        }
    }

    purgeStaleCaches();
}

if (commandArgs.length > 0) {
    const [command, ...args] = commandArgs;
    const childEnv = { ...process.env };
    if (isNextDevCommand()) {
        childEnv.NODE_ENV = nightlyLocalEnvOnly ? 'test' : 'development';
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

    child.on('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }

        process.exit(code ?? 0);
    });
}
