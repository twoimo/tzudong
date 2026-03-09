import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const nextDir = path.join(projectRoot, '.next');
const stalePrefix = '.next-stale-';
const verbose = ['1', 'true', 'yes', 'on'].includes((process.env.CLEAN_NEXT_VERBOSE ?? '').toLowerCase());
const warnedStaleEntries = new Set();

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
