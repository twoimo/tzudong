import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

const projectRoot = process.cwd();
const repoRoot = path.resolve(projectRoot, '..', '..');
const repoEnvLocalPath = path.join(repoRoot, '.env.local');
const nextDir = path.join(projectRoot, '.next');
const stalePrefix = '.next-stale-';
const verbose = ['1', 'true', 'yes', 'on'].includes((process.env.CLEAN_NEXT_VERBOSE ?? '').toLowerCase());
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

const toMessage = (error) => (error instanceof Error ? error.message : String(error));

const isLockLikeError = (error) => {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const code = 'code' in error ? String(error.code) : '';
    if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY' || code === 'UNKNOWN') {
        return true;
    }

    const message = toMessage(error).toLowerCase();
    return (
        message.includes('resource busy') ||
        message.includes('cannot be accessed by the system') ||
        message.includes('directory not empty')
    );
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

            const message = toMessage(error);
            const key = `${entry.name}:${message}`;
            if (warnedStaleEntries.has(key)) {
                continue;
            }

            warnedStaleEntries.add(key);
            console.warn(`[clean-next] failed to remove ${entry.name}: ${message}`);
        }
    }
};

if (fs.existsSync(repoEnvLocalPath)) {
    loadEnv({ path: repoEnvLocalPath, override: false });
}

process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA ??= 'true';
process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= 'true';

if (!skipClean) {
    const guardedDevPort = getGuardedDevPort();
    if (guardedDevPort && !(await canBindPort(guardedDevPort))) {
        console.error(
            `[clean-next] refusing to remove .next because port ${guardedDevPort} is already in use. Stop the existing dev server first.`,
        );
        process.exit(1);
    }

    purgeStaleCaches();

    try {
        tryRemove(nextDir);
    } catch (error) {
        const message = toMessage(error);
        if (verbose || !isLockLikeError(error)) {
            console.warn(`[clean-next] primary remove failed: ${message}`);
        }

        try {
            const fallbackName = `.next-stale-${Date.now()}`;
            const fallbackPath = path.join(projectRoot, fallbackName);
            fs.renameSync(nextDir, fallbackPath);
            tryRemove(fallbackPath);
            if (verbose) {
                console.warn(`[clean-next] renamed + removed stale cache: ${fallbackName}`);
            }
        } catch (fallbackError) {
            const fallbackMessage = toMessage(fallbackError);
            console.warn(`[clean-next] fallback cleanup skipped: ${fallbackMessage}`);
        }
    }

    purgeStaleCaches();
}

if (commandArgs.length > 0) {
    const [command, ...args] = commandArgs;
    const childEnv = { ...process.env };
    if (isNextDevCommand()) {
        childEnv.NODE_ENV = 'development';
    }
    const child = spawn(command, args, {
        stdio: 'inherit',
        env: childEnv,
    });

    child.on('error', (error) => {
        console.error(error instanceof Error ? error.message : String(error));
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
