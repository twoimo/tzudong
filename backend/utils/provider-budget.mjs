import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function budgetCommand(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.env.RUN_DAILY_PYTHON || 'python3',
            ['-m', 'backend.utils.provider_budget', ...args],
            { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] });
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

export async function applyProjectCooldown(error) {
    const delay = retryAfterSeconds(error);
    if (delay !== null) await budgetCommand(['cooldown', '--delay', String(delay)]);
}

export async function withProjectBudget(work, { acquireTimeoutMs = 600000 } = {}) {
    if (!Number.isSafeInteger(acquireTimeoutMs) || acquireTimeoutMs < 1 || acquireTimeoutMs > 600000)
        throw new Error('PROVIDER_BUDGET_INVALID');
    const lease = await budgetCommand(['acquire', '--pid', String(process.pid), '--timeout', String(acquireTimeoutMs / 1000)]);
    if (!/^[a-f0-9]{32}$/.test(lease)) throw new Error('PROVIDER_BUDGET_UNAVAILABLE');
    try { return await work(); }
    catch (error) {
        try { await applyProjectCooldown(error); }
        catch { process.stderr.write('warning=PROVIDER_BUDGET_COOLDOWN_UNAVAILABLE\n'); }
        throw error;
    } finally {
        // A bookkeeping failure cannot discard a settled paid response or
        // replace the provider's original error with a retryable local error.
        try { await budgetCommand(['release', '--lease', lease]); }
        catch { process.stderr.write('warning=PROVIDER_BUDGET_RELEASE_UNAVAILABLE\n'); }
    }
}
