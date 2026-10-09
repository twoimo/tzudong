/** Local nested-work pool plus a separate project/context OS media lease. */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
export const sharedMediaLimit = 4;

function defaultMediaContext() {
    const checkout = path.resolve(backendRoot, '..');
    let git = path.join(checkout, '.git');
    if (fs.existsSync(git)) {
        if (fs.statSync(git).isFile()) {
            const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(fs.readFileSync(git, 'utf8'));
            if (!match) throw new Error('MEDIA_SHARED_CONTEXT_INVALID');
            git = path.resolve(checkout, match[1]);
        }
        const common = path.join(git, 'commondir');
        if (fs.existsSync(common)) git = path.resolve(git, fs.readFileSync(common, 'utf8').trim());
        // Worktrees of one project share the same admission namespace.
        return path.join(fs.realpathSync(git), 'tzudong-media-leases-v1');
    }
    return path.join(fs.realpathSync(backendRoot), '.runtime', 'media-leases');
}

/** Actual tool owns an inherited OS lease across parent crashes (POSIX only).
 * All processes in a context use the same directory; never unlink live slots.
 */
export function sharedMediaInvocation(file, args, env = process.env) {
    const directory = env.PIPELINE_MEDIA_RESOURCE_DIR || defaultMediaContext();
    if (!path.isAbsolute(directory) || /[\x00-\x1f\x7f]/.test(directory)) throw new Error('MEDIA_SHARED_CONTEXT_INVALID');
    return { file: env.RUN_DAILY_PYTHON || 'python3',
        args: [path.join(backendRoot, 'utils', 'media_lease_exec.py'), directory, '--', file, ...args] };
}

export function boundedLimit(value, fallback, ceiling = 8) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, ceiling) : fallback;
}

export function networkConcurrency(defaultLimit, env = process.env) {
    return boundedLimit(env.PIPELINE_NETWORK_JOBS || env.MAX_JOBS, defaultLimit, defaultLimit);
}

export class Semaphore {
    constructor(limit) { this.limit = limit; this.active = 0; this.waiters = []; }
    async run(work) {
        if (this.active >= this.limit) await new Promise(resolve => this.waiters.push(resolve));
        else this.active++;
        try { return await work(); }
        finally {
            const next = this.waiters.shift();
            if (next) next();
            else this.active--;
        }
    }
}

export async function mapBounded(items, limit, work) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('RESOURCE_LIMIT_INVALID');
    const results = new Array(items.length);
    let index = 0;
    let failure;
    const workers = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length && !failure) {
            const current = index++;
            try { results[current] = await work(items[current], current); }
            catch (error) { failure = error || new Error('RESOURCE_JOB_FAILED'); throw failure; }
        }
    }));
    const rejected = workers.find(result => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    return results;
}

const cpuLimit = Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 4));
export const mediaPool = new Semaphore(boundedLimit(process.env.PIPELINE_FFMPEG_JOBS, cpuLimit, cpuLimit));
