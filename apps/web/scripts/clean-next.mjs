import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const nextDir = path.join(projectRoot, '.next');
const stalePrefix = '.next-stale-';

const tryRemove = (targetPath) => {
    fs.rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 150,
    });
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
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[clean-next] failed to remove ${entry.name}: ${message}`);
        }
    }
};

purgeStaleCaches();

try {
    tryRemove(nextDir);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[clean-next] primary remove failed: ${message}`);

    try {
        const fallbackName = `.next-stale-${Date.now()}`;
        const fallbackPath = path.join(projectRoot, fallbackName);
        fs.renameSync(nextDir, fallbackPath);
        tryRemove(fallbackPath);
        console.warn(`[clean-next] renamed + removed stale cache: ${fallbackName}`);
    } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.warn(`[clean-next] fallback cleanup skipped: ${fallbackMessage}`);
    }
}

purgeStaleCaches();
