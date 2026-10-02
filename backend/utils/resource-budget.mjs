/** Separate resource limits; nested jobs share the same process-wide pool. */
import os from 'node:os';

export function boundedLimit(value, fallback, ceiling = 8) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, ceiling) : fallback;
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
