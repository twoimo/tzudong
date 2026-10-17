import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const pendingReleases = new Set();

function budgetCommand(args, env = process.env, { signal } = {}) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn(env.RUN_DAILY_PYTHON || 'python3',
            ['-m', 'backend.utils.provider_budget', ...args],
            { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'ignore'] });
        let result = '';
        let settled = false;
        let aborted = false;
        let forceKill;
        const abortError = () => signal?.reason ?? new DOMException('Provider budget acquisition cancelled', 'AbortError');
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(forceKill);
            signal?.removeEventListener('abort', abort);
            if (error) reject(error); else resolve(value);
        };
        const abort = () => {
            if (settled || aborted) return;
            aborted = true;
            child.kill('SIGTERM');
            forceKill = setTimeout(() => child.kill('SIGKILL'), 250);
            forceKill.unref?.();
        };
        child.stdout.on('data', chunk => { if (result.length < 128) result += chunk; });
        child.once('error', (cause) => {
            if (aborted) finish(abortError());
            else {
                const error = new Error('PROVIDER_BUDGET_UNAVAILABLE', { cause });
                error.budgetChildStarted = false;
                finish(error);
            }
        });
        child.once('close', code => aborted
            ? finish(abortError())
            : code === 0 ? finish(undefined, result.trim()) : finish(new Error('PROVIDER_BUDGET_UNAVAILABLE')));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
    });
}

export function retryAfterSeconds(error) {
    const headers = error?.response?.headers || error?.headers;
    const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
    if (!raw) return null;
    const number = Number(raw);
    const seconds = Number.isFinite(number) ? number : (Date.parse(raw) - Date.now()) / 1000;
    return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
}

export async function applyProjectCooldown(error, env = process.env) {
    const delay = retryAfterSeconds(error);
    if (delay !== null) await budgetCommand(['cooldown', '--delay', String(delay)], env);
}

async function releasePermit(debt) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await budgetCommand(['release', '--lease', debt.lease], debt.env);
            pendingReleases.delete(debt);
            return true;
        } catch {
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
        }
    }
    pendingReleases.add(debt);
    return false;
}

/**
 * @template T
 * @param {() => Promise<T>} work
 * @param {{ acquireTimeoutMs?: number, env?: NodeJS.ProcessEnv, signal?: AbortSignal }} [options]
 * @returns {Promise<T>}
 */
export async function withProjectBudget(work, { acquireTimeoutMs = 600000, env: requestedEnv, signal } = {}) {
    if (!Number.isSafeInteger(acquireTimeoutMs) || acquireTimeoutMs < 1 || acquireTimeoutMs > 600000)
        throw new Error('PROVIDER_BUDGET_INVALID');
    for (const debt of [...pendingReleases]) await releasePermit(debt);
    if (pendingReleases.size) throw new Error('PROVIDER_BUDGET_UNAVAILABLE');
    // Cleanup uses the acquisition scope even if a caller changes its environment.
    const env = { ...(requestedEnv ?? process.env) };
    signal?.throwIfAborted();
    // The parent chooses the identity so an abort racing with a committed child
    // can still release the exact lease after that child has exited.
    const lease = randomBytes(16).toString('hex');
    const debt = { lease, env };
    try {
        const acquired = await budgetCommand([
            'acquire', '--pid', String(process.pid), '--timeout', String(acquireTimeoutMs / 1000), '--lease', lease,
        ], env, { signal });
        if (acquired !== lease) throw new Error('PROVIDER_BUDGET_UNAVAILABLE');
        signal?.throwIfAborted();
    } catch (error) {
        if (error?.budgetChildStarted !== false && !await releasePermit(debt)) {
            process.stderr.write('warning=PROVIDER_BUDGET_RELEASE_UNAVAILABLE\n');
        }
        throw error;
    }
    try { return await work(); }
    catch (error) {
        try { await applyProjectCooldown(error, env); }
        catch { process.stderr.write('warning=PROVIDER_BUDGET_COOLDOWN_UNAVAILABLE\n'); }
        throw error;
    } finally {
        // A bookkeeping failure cannot discard a settled paid response or
        // replace the provider's original error with a retryable local error.
        if (!await releasePermit(debt)) process.stderr.write('warning=PROVIDER_BUDGET_RELEASE_UNAVAILABLE\n');
    }
}
