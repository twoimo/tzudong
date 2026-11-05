import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const pendingReleases = new Set();
const ACQUIRE_REJECTED_EXIT_CODE = 20;
const BUDGET_TARGET_ENV_KEYS = Object.freeze([
    'GEMINI_BUDGET_PATH', 'TZUDONG_PROVIDER_STATE_DIR', 'GEMINI_BUDGET_PROJECT',
    'GEMINI_REQUESTS_PER_MINUTE', 'GEMINI_MAX_INFLIGHT',
    'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
]);

class BudgetCommandFailure {
    constructor(cause, { childStarted, acquireRejected = false }) {
        this.cause = cause;
        this.childStarted = childStarted;
        this.acquireRejected = acquireRejected;
    }
}

function commandCause(error) {
    return error instanceof BudgetCommandFailure ? error.cause : error;
}

function budgetTargetEnvironment(env) {
    const target = {};
    for (const key of BUDGET_TARGET_ENV_KEYS) {
        if (Object.hasOwn(env, key)) target[key] = env[key];
    }
    return target;
}

function releaseEnvironment(debt, runnerEnv) {
    const env = { ...runnerEnv };
    for (const key of BUDGET_TARGET_ENV_KEYS) delete env[key];
    return Object.assign(env, debt.budgetEnv);
}

function validateBudgetEnvironment(env) {
    const scope = env.GEMINI_BUDGET_PROJECT ?? 'configured-project';
    if (typeof scope !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(scope))
        throw new Error('PROVIDER_BUDGET_UNAVAILABLE');
    for (const [key, fallback, ceiling] of [
        ['GEMINI_REQUESTS_PER_MINUTE', 30, 100000],
        ['GEMINI_MAX_INFLIGHT', 1, 8],
    ]) {
        const value = env[key] === undefined ? fallback : Number(env[key]);
        if (!Number.isSafeInteger(value) || value < 1 || value > ceiling)
            throw new Error('PROVIDER_BUDGET_UNAVAILABLE');
    }
}

function budgetCommand(args, env = process.env, { signal } = {}) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const customRunner = Boolean(env.RUN_DAILY_PYTHON);
        const child = spawn(env.RUN_DAILY_PYTHON || 'python3',
            ['-m', 'backend.utils.provider_budget', ...args],
            { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'ignore'] });
        let result = '';
        let settled = false;
        let aborted = false;
        let childStarted = false;
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
        child.once('spawn', () => { childStarted = true; });
        child.stdout.on('data', chunk => {
            const remaining = 128 - result.length;
            if (remaining > 0) result += chunk.toString('utf8').slice(0, remaining);
        });
        child.once('error', (cause) => {
            const error = aborted
                ? abortError()
                : new Error('PROVIDER_BUDGET_UNAVAILABLE', { cause });
            finish(new BudgetCommandFailure(error, { childStarted }));
        });
        child.once('close', code => {
            if (aborted) return finish(new BudgetCommandFailure(abortError(), { childStarted }));
            if (code === 0) return finish(undefined, result.trim());
            const error = new Error('PROVIDER_BUDGET_UNAVAILABLE');
            // Only the canonical module's explicit pre-commit exit is definite.
            // Custom runners cannot suppress cleanup by imitating transport text
            // or the numeric protocol code.
            const acquireRejected = args[0] === 'acquire' && !customRunner
                && code === ACQUIRE_REJECTED_EXIT_CODE && result.length === 0;
            finish(new BudgetCommandFailure(error, { childStarted, acquireRejected }));
        });
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
    if (delay !== null) {
        try { await budgetCommand(['cooldown', '--delay', String(delay)], env); }
        catch (failure) { throw commandCause(failure); }
    }
}

async function releasePermit(debt, runnerEnv) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await budgetCommand(
                ['release', '--lease', debt.lease],
                releaseEnvironment(debt, runnerEnv),
            );
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
    const env = { ...(requestedEnv ?? process.env) };
    validateBudgetEnvironment(env);
    signal?.throwIfAborted();
    // Retry old lease identities with the current healthy runner while keeping
    // the exact budget path/project identity from their acquisition.
    for (const debt of [...pendingReleases]) await releasePermit(debt, env);
    if (pendingReleases.size) throw new Error('PROVIDER_BUDGET_UNAVAILABLE');
    // The parent chooses the identity so an abort racing with a committed child
    // can still release the exact lease after that child has exited.
    const lease = randomBytes(16).toString('hex');
    const debt = { lease, budgetEnv: budgetTargetEnvironment(env) };
    let acquireMayHaveCommitted = false;
    try {
        const acquired = await budgetCommand([
            'acquire', '--pid', String(process.pid), '--timeout', String(acquireTimeoutMs / 1000), '--lease', lease,
        ], env, { signal });
        acquireMayHaveCommitted = true;
        if (acquired !== lease) throw new Error('PROVIDER_BUDGET_UNAVAILABLE');
        signal?.throwIfAborted();
    } catch (failure) {
        const commandFailure = failure instanceof BudgetCommandFailure ? failure : null;
        const cleanupRequired = commandFailure
            ? commandFailure.childStarted === true && commandFailure.acquireRejected !== true
            : acquireMayHaveCommitted;
        if (cleanupRequired && !await releasePermit(debt, env)) {
            process.stderr.write('warning=PROVIDER_BUDGET_RELEASE_UNAVAILABLE\n');
        }
        throw commandCause(failure);
    }
    try { return await work(); }
    catch (error) {
        try { await applyProjectCooldown(error, env); }
        catch { process.stderr.write('warning=PROVIDER_BUDGET_COOLDOWN_UNAVAILABLE\n'); }
        throw error;
    } finally {
        // A bookkeeping failure cannot discard a settled paid response or
        // replace the provider's original error with a retryable local error.
        if (!await releasePermit(debt, env)) process.stderr.write('warning=PROVIDER_BUDGET_RELEASE_UNAVAILABLE\n');
    }
}
