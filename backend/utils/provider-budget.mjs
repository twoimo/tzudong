import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const pendingReleases = new Set();

function budgetCommand(args, env = process.env) {
    return new Promise((resolve, reject) => {
        const child = spawn(env.RUN_DAILY_PYTHON || 'python3',
            ['-m', 'backend.utils.provider_budget', ...args],
            { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'ignore'] });
        let result = '';
        child.stdout.on('data', chunk => { if (result.length < 128) result += chunk; });
        child.once('error', () => reject(new Error('PROVIDER_BUDGET_UNAVAILABLE')));
        child.once('close', code => code === 0 ? resolve(result.trim()) : reject(new Error('PROVIDER_BUDGET_UNAVAILABLE')));
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

export async function withProjectBudget(work, { acquireTimeoutMs = 600000 } = {}) {
    if (!Number.isSafeInteger(acquireTimeoutMs) || acquireTimeoutMs < 1 || acquireTimeoutMs > 600000)
        throw new Error('PROVIDER_BUDGET_INVALID');
    for (const debt of [...pendingReleases]) await releasePermit(debt);
    if (pendingReleases.size) throw new Error('PROVIDER_BUDGET_UNAVAILABLE');
    // Cleanup uses the acquisition scope even if a caller changes its environment.
    const env = { ...process.env };
    const lease = await budgetCommand(['acquire', '--pid', String(process.pid), '--timeout', String(acquireTimeoutMs / 1000)], env);
    if (!/^[a-f0-9]{32}$/.test(lease)) throw new Error('PROVIDER_BUDGET_UNAVAILABLE');
    const debt = { lease, env };
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
