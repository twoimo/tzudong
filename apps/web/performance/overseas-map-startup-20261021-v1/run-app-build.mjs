import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocalNightlyEnvironment, loadLocalSupabaseEnvironment } from '../../scripts/local-supabase-runtime.mjs';
import { redactCliText } from '../../scripts/privacy-safe-cli-log.mjs';

const output = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(output, '../..');
const local = loadLocalSupabaseEnvironment({ repositoryRoot: path.resolve(app, '../..') });
const environment = {
    ...buildLocalNightlyEnvironment(local),
    NODE_ENV: 'test',
    NIGHTLY_LOCAL_ENV_ONLY: '1',
    TZUDONG_NEXT_DIST_DIR: '.next-overseas-map-20261021',
    NEXT_TELEMETRY_DISABLED: '1',
    SENTRY_AUTH_TOKEN: '',
};
const startedAt = new Date().toISOString();
for (const file of ['app-build.log', 'app-build-receipt.json']) {
    if (existsSync(path.join(output, file))) renameSync(path.join(output, file), path.join(output, 'initial-env-gate-' + file));
}
writeFileSync(path.join(output, 'app-build.log'), '');
const child = spawn('/opt/homebrew/opt/node@24/bin/npm', ['run', 'build'], { cwd: app, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.on('data', chunk => {
        pending += chunk.toString();
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) appendFileSync(path.join(output, 'app-build.log'), redactCliText(line, 1024) + '\n');
    });
    stream.on('end', () => { if (pending) appendFileSync(path.join(output, 'app-build.log'), redactCliText(pending, 1024) + '\n'); });
}
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
const receipt = { startedAt, finishedAt: new Date().toISOString(), exitCode: code, command: 'npm run build', distDir: environment.TZUDONG_NEXT_DIST_DIR, environment: 'Existing verified owner-only local stack inputs; stack not started or reset; local Nightly test gate; no hosted credentials printed', deployment: false };
writeFileSync(path.join(output, 'app-build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = code ?? 1;
