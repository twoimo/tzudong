import { spawn } from 'node:child_process';
import { open, mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const here = new URL('./', import.meta.url);
const cache = '/Users/twoimo/.codex/runtime-cache/marker-category-recovery-20261015-v1';
assert.equal(process.versions.node, '24.21.0');
try { await stat(new URL('natural-progress-v3.json', here)); throw Error('EXISTING_RECOVERY_PRESERVED'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
await mkdir(cache, { mode: 0o700 });
const log = await open(cache + '/runner.log', 'wx', 0o600);
const child = spawn(process.execPath, [fileURLToPath(new URL('run-natural-recovery-v1.mjs', here))], {
  cwd: fileURLToPath(new URL('../../../..', here)), detached: true, stdio: ['ignore', log.fd, log.fd],
});
const receipt = { launchedAtUtc: new Date().toISOString(), pid: child.pid, detached: true,
  script: 'run-natural-recovery-v1.mjs', logPath: cache + '/runner.log',
  reason: 'Survive turn interruption; explicit stop remains SIGTERM to this owned PID. No retries on failure.' };
await writeFile(new URL('recovery-launch-v1.json', here), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
child.unref();
await log.close();
console.log(JSON.stringify(receipt));
