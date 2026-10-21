import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocalNightlyEnvironment, loadLocalSupabaseEnvironment } from '../../scripts/local-supabase-runtime.mjs';
import { redactCliText } from '../../scripts/privacy-safe-cli-log.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(18925, '127.0.0.1', () => probe.close(resolve));
});
const local = loadLocalSupabaseEnvironment({ repositoryRoot: path.resolve(app, '../..') });
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '18925'], {
    cwd: app,
    env: { ...buildLocalNightlyEnvironment(local), TZUDONG_NEXT_DIST_DIR: '.next-overseas-map-20261021', __NEXT_PROCESSED_ENV: 'true', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => process.stdout.write(redactCliText(chunk.toString(), 1024)));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
