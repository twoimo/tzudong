import { readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { loadavg, cpus, totalmem, platform, arch, release } from 'node:os';
import assert from 'node:assert/strict';

const here = new URL('./', import.meta.url);
const planBytes = await readFile(new URL('MEASUREMENT-PLAN-v2.json', here));
const plan = JSON.parse(planBytes);
const planHash = createHash('sha256').update(planBytes).digest('hex');
assert.equal(plan.runs.length, 40);
assert.equal(process.versions.node, '24.21.0');
const stateUrl = new URL('natural-progress-v2.json', here);
try { await stat(stateUrl); throw Error('EXISTING_SERIES_PRESERVED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const state = { startedAtUtc: new Date().toISOString(), planSha256: planHash, pid: process.pid,
  environment: { node: process.versions.node, platform: platform(), arch: arch(), osRelease: release(), cpuModel: cpus()[0]?.model, cpuCount: cpus().length, physicalMemoryBytes: totalmem(), physicalDevice: false },
  status: 'running', completed: [], performanceAdmission: 0, fieldAdmission: 0, primaryForcedGC: false };
await writeFile(stateUrl, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
let activeChild, stopRequested = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopRequested = true; activeChild?.kill('SIGTERM'); });
for (const run of plan.runs) {
  if (stopRequested) { state.status = 'stopped_on_requested_signal'; break; }
  const start = { ...run, startedAtUtc: new Date().toISOString(), loadBefore: loadavg() };
  await appendFile(new URL('natural-journal-v2.jsonl', here), JSON.stringify({ event: 'start', ...start }) + '\n');
  console.log(JSON.stringify({ event: 'start', ...run, completedProcesses: state.completed.length }));
  const child = activeChild = spawn(process.execPath, [new URL('measure-natural-v2.mjs', here).pathname, run.kind, run.label, '128', '2'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const capture = stream => { let pending = ''; stream.setEncoding('utf8'); stream.on('data', chunk => {
    pending += chunk; const rows = pending.split('\n'); pending = rows.pop();
    for (const line of rows) { try { console.log(JSON.stringify({ event: 'child', label: run.label, detail: JSON.parse(line) })); } catch { console.log(JSON.stringify({ event: 'bounded-child-diagnostic', label: run.label, bytes: Buffer.byteLength(line), sha256: createHash('sha256').update(line).digest('hex') })); } }
  }); };
  capture(child.stdout); capture(child.stderr);
  const code = await new Promise(resolve => child.once('exit', resolve));
  activeChild = null;
  let raw;
  try { raw = JSON.parse(await readFile(new URL(`ui-${run.label}/raw.json`, here))); } catch {}
  const result = { ...start, endedAtUtc: new Date().toISOString(), loadAfter: loadavg(), exit: code,
    passed: code === 0 && raw?.passed === true && raw?.cycles?.length === 256 && raw.environment?.forcedGC === false,
    rawSha256: raw ? createHash('sha256').update(await readFile(new URL(`ui-${run.label}/raw.json`, here))).digest('hex') : null };
  state.completed.push(result);
  await appendFile(new URL('natural-journal-v2.jsonl', here), JSON.stringify({ event: 'end', ...result }) + '\n');
  if (!result.passed) { state.status = stopRequested ? 'stopped_on_requested_signal' : 'stopped_on_first_failed_run'; state.failedLabel = run.label; }
  await writeFile(stateUrl, JSON.stringify(state, null, 2) + '\n');
  console.log(JSON.stringify({ event: 'end', label: run.label, passed: result.passed, completedProcesses: state.completed.length }));
  if (!result.passed) { process.exitCode = 1; break; }
}
if (state.completed.length === plan.runs.length && state.completed.every(run => run.passed)) state.status = 'collection_complete_unscored';
state.endedAtUtc = new Date().toISOString();
await writeFile(stateUrl, JSON.stringify(state, null, 2) + '\n');
console.log(JSON.stringify({ event: 'series-end', status: state.status, completedProcesses: state.completed.length, performanceAdmission: 0 }));
