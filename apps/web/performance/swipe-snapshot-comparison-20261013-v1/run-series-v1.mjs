import { spawn } from 'node:child_process';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const here = new URL('./', import.meta.url);
if (process.versions.node !== '24.21.0') throw Error('PINNED_NODE_REQUIRED');
let seed = 20261013;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const schedule = Array.from({ length: 4 }, (_, index) => ({ kind: 'baseline', label: `aa-${index + 1}`, independentProcess: index + 1, phase: 'AA' }));
for (let pair = 1; pair <= 9; pair += 1) {
  const order = random() < 0.5 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  for (const kind of order) schedule.push({ kind, label: `ab-${pair}-${kind}`, pair, phase: 'AB', independentProcess: schedule.length + 1 });
}
const planBytes = await readFile(new URL('PLAN-v1.json', here));
const plan = { seed: 20261013, independentProcesses: 22, dependentActionsPerProcess: 256,
  planSha256: createHash('sha256').update(planBytes).digest('hex'), schedule,
  overwriteOrReplacementAllowed: false, failedRunsRetained: true, sourceOrOperatingMutation: false,
  measurementParameters: { queries: 128, passes: 2, profiler: false, forcedGC: false } };
await writeFile(new URL('series-plan-v1.json', here), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
const journal = new URL('series-execution-v1.jsonl', here);
await writeFile(journal, JSON.stringify({ event: 'series-start', atUtc: new Date().toISOString(), pid: process.pid, count: schedule.length }) + '\n', { flag: 'wx' });
for (const run of schedule) {
  const outcome = await new Promise(resolve => {
    const child = spawn(process.execPath, [new URL('measure-ui-https-v1.mjs', here).pathname, run.kind, run.label, '128', '2'], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderrBytes = 0;
    child.stdout.on('data', bytes => { if (stdout.length < 65536) stdout += bytes.toString(); });
    child.stderr.on('data', bytes => { stderrBytes += bytes.length; });
    appendFile(journal, JSON.stringify({ event: 'process-start', atUtc: new Date().toISOString(), ...run, pid: child.pid }) + '\n').catch(() => child.kill('SIGTERM'));
    child.on('exit', exit => resolve({ exit, stderrBytes, emittedLines: stdout.trim().split('\n').length }));
  });
  const output = new URL(`ui-${run.label}/raw.json`, here);
  const raw = await readFile(output), result = JSON.parse(raw);
  const complete = outcome.exit === 0 && result.passed === true && result.cycles.length === 256;
  await appendFile(journal, JSON.stringify({ event: 'process-end', atUtc: new Date().toISOString(), ...run, ...outcome, complete, rawSha256: createHash('sha256').update(raw).digest('hex') }) + '\n');
  console.log(JSON.stringify({ run: run.independentProcess, total: 22, label: run.label, complete, cycles: result.cycles.length }));
  if (!complete) throw Error('SERIES_INCOMPLETE_FAILED_RUN_RETAINED');
}
await writeFile(new URL('series-complete-v1.json', here), JSON.stringify({ completedAtUtc: new Date().toISOString(), independentProcesses: 22, totalDependentActions: 5632, performanceAdmitted: false, analysisPending: true }, null, 2) + '\n', { flag: 'wx' });
