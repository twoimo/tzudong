import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFixtureLaunchPlan } from '../admin-header-consistency-20261011/launch.mjs';
import { readE2EAdminRouteBypassContract, WEB_ROOT } from '../admin-header-consistency-20261011/source-contract.mjs';

const pinnedNode = '/opt/homebrew/opt/node@24/bin/node';
if (realpathSync(process.execPath) !== realpathSync(pinnedNode)) throw new Error('PINNED_NODE_REQUIRED');
const receipt = JSON.parse(readFileSync(resolve(import.meta.dirname, 'build-report-final.json')));
if (receipt.exitCode !== 0 || receipt.sourceDrift.length || receipt.cleanupFailures.length) throw new Error('BUILD_RECEIPT_NOT_ADMITTED');
for (const [path, expected] of Object.entries(receipt.source)) {
  const actual = createHash('sha256').update(readFileSync(resolve(WEB_ROOT, path))).digest('hex');
  if (actual !== expected.sha256) throw new Error(`BUILD_SOURCE_CHANGED:${path}`);
}
const dist = '.next-taste-admin-20261015-final';
readFileSync(resolve(WEB_ROOT, dist, 'BUILD_ID'));
const plan = buildFixtureLaunchPlan(['--production'], readE2EAdminRouteBypassContract(), process.env, { productionBuildExists: true });
const children = [
  spawn(pinnedNode, plan.nextArguments, { cwd: WEB_ROOT, env: { ...plan.nextEnvironment, TZUDONG_NEXT_DIST_DIR: dist }, stdio: 'inherit', shell: false }),
  spawn(pinnedNode, [resolve(import.meta.dirname, '../admin-header-consistency-20261011/fixture-gateway.mjs')], { cwd: WEB_ROOT, env: plan.gatewayEnvironment, stdio: 'inherit', shell: false }),
];
console.log(JSON.stringify({ launcherPid: process.pid, children: children.map(child => child.pid), origin: 'http://127.0.0.1:18822', dist, sourceInputsVerified: Object.keys(receipt.source).length, syntheticLoopbackOnly: true }));
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 5000);
  timer.unref();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop());
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!closing) stop(code || 1); });
}
