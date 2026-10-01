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
    const results = new Array(items.length);
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length) {
            const current = index++;
            results[current] = await work(items[current], current);
        }
    }));
    return results;
}

const cpuLimit = Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 4));
export const mediaPool = new Semaphore(boundedLimit(process.env.PIPELINE_FFMPEG_JOBS, cpuLimit, cpuLimit));
