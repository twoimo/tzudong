import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(output, '../../../apps/web');
const { buildLocalNightlyEnvironment, loadLocalSupabaseEnvironment } = await import(path.join(app, 'scripts/local-supabase-runtime.mjs'));
const { redactCliText } = await import(path.join(app, 'scripts/privacy-safe-cli-log.mjs'));
const local = loadLocalSupabaseEnvironment();
const env = { ...buildLocalNightlyEnvironment(local), TZUDONG_NEXT_DIST_DIR: '.next-device-location-20261021', __NEXT_PROCESSED_ENV: 'true', NEXT_TELEMETRY_DISABLED: '1', SENTRY_AUTH_TOKEN: '' };
const build = process.argv.includes('--build');
const tests = process.argv.includes('--tests');
const args = build ? ['run', 'build'] : tests
    ? ['node_modules/@playwright/test/cli.js', 'test', 'tests/privacy-safeguards.spec.ts', '--grep', 'device location controls', '--project=chromium', '--workers=1', '--retries=0', '--reporter=line']
    : ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '18925'];
if (tests) Object.assign(env, { PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:18925', PLAYWRIGHT_WEB_SERVER_URL: 'http://127.0.0.1:18925', PLAYWRIGHT_REUSE_EXISTING_SERVER: '1' });
const phase = build ? 'build' : tests ? 'browser-tests' : 'server';
for (const suffix of ['.log', '-receipt.json', ...(tests ? ['.json'] : [])]) {
    const original = path.join(output, phase + suffix);
    if (!existsSync(original)) continue;
    let attempt = 1;
    while (existsSync(path.join(output, `${phase}-attempt-${attempt}${suffix}`))) attempt++;
    renameSync(original, path.join(output, `${phase}-attempt-${attempt}${suffix}`));
}
const log = path.join(output, phase + '.log');
writeFileSync(log, '');
const startedAt = new Date().toISOString();
const child = spawn(build ? '/opt/homebrew/opt/node@24/bin/npm' : process.execPath, args, { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.on('data', chunk => {
        pending += chunk.toString();
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) appendFileSync(log, redactCliText(line, 1024) + '\n');
    });
    stream.on('end', () => { if (pending) appendFileSync(log, redactCliText(pending, 1024) + '\n'); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
const result = { startedAt, finishedAt: new Date().toISOString(), phase, exitCode: code, distDir: env.TZUDONG_NEXT_DIST_DIR, localDatabaseStarted: false, deployed: false };
writeFileSync(path.join(output, phase + '-receipt.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
process.exitCode = code ?? 1;
