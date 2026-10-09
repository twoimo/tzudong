import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { SameVideoDuplicateWarningRow } from '../lib/admin-same-video-duplicate-warning';

const file = 'apps/web/lib/admin-same-video-duplicate-warning.ts';
const before = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' });
const after = readFileSync('lib/admin-same-video-duplicate-warning.ts', 'utf8');
mkdirSync('.omx', { recursive: true });
const temporary = mkdtempSync('.omx/warning-gates-');
try {
  const modules = [];
  for (const [name, source] of [['before', before], ['after', after]]) {
    const patched = 'let benchCalls=0;export function resetCalls(){benchCalls=0;}export function callCount(){return benchCalls;}\n'
      + source.replace(/(function nameSimilarity[^\n]+\{)/, '$1\nbenchCalls++;');
    const path = join(temporary, `${name}.ts`); writeFileSync(path, patched);
    modules.push(await import(`../${path}`) as typeof import('../lib/admin-same-video-duplicate-warning') & { resetCalls(): void; callCount(): number });
  }
  const rows: SameVideoDuplicateWarningRow[] = Array.from({ length: 1000 }, (_, i) => ({
    id: String(i), origin_name: `서울 식당 후보 ${i}`, approved_name: `서울 식당 후보 ${i}`,
    youtube_link: 'https://youtu.be/abcdefghijk', status: i % 11 === 0 ? 'deleted' : 'pending',
    phone: i % 7 === 0 ? 'fixture-same-phone-1234567' : `fixture-${i}`,
    road_address: i % 13 === 0 ? 'same-business-address' : `different-business-${i}`,
    lat: 35 + i * 0.001, lng: 127 + i * 0.001,
  }));
  const observations = [];
  for (let repeat = 0; repeat < 7; repeat++) {
    for (const index of repeat % 2 === 0 ? [0, 1] : [1, 0]) {
      const library = modules[index]; library.resetCalls();
      const cpu = process.cpuUsage(); const start = performance.now();
      const outputs = rows.slice(1, 51).map((target) => library.findSameVideoDuplicateWarningCandidates(target, rows));
      const wallMs = performance.now() - start; const usage = process.cpuUsage(cpu);
      observations.push({ repeat, implementation: index === 0 ? 'before' : 'after', wallMs, cpuMs: (usage.user + usage.system) / 1000,
        nameDistanceCalls: library.callCount(), outputSha256: createHash('sha256').update(JSON.stringify(outputs)).digest('hex') });
    }
  }
  for (let i = 0; i < observations.length; i += 2) if (observations[i].outputSha256 !== observations[i + 1].outputSha256) throw new Error('WARNING_EQUIVALENCE_FAILED');
  const target = 'performance/pipeline-20261002/warning-gate-raw-20261004.json';
  writeFileSync(target, JSON.stringify({ environment: 'synthetic rows, Bun 1.4.0, local CPU only', rows: rows.length, targets: 50, samples: 7,
    beforeSourceSha256: createHash('sha256').update(before).digest('hex'), afterSourceSha256: createHash('sha256').update(after).digest('hex'), observations }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ pairs: 7, equivalent: true, distanceCalls: observations.slice(0, 2).map((row) => row.nameDistanceCalls) }));
} finally { rmSync(temporary, { recursive: true, force: true }); }
