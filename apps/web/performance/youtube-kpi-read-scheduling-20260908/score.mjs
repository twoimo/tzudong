import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = import.meta.dir;
const sha = value => createHash('sha256').update(value).digest('hex');
const raw = JSON.parse(readFileSync(path.join(root, 'raw.json'), 'utf8'));
const freeze = JSON.parse(readFileSync(path.join(root, 'freeze.json'), 'utf8'));
for (const [name, hash] of Object.entries(freeze.inputs)) {
  if (sha(readFileSync(path.join(root, name))) !== hash) throw new Error('FROZEN_INPUT_DRIFT');
}
const median = values => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const p75 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .75) - 1];
const scenarios = raw.scenarios.map(s => {
  if (s.pairs.length !== 30) throw new Error('INCOMPLETE_PAIRS');
  for (const pair of s.pairs) {
    if (pair.baseline.payloadSha256 !== pair.candidate.payloadSha256 || pair.baseline.queryCount !== pair.candidate.queryCount) throw new Error('PARITY_MISMATCH');
    for (const variant of ['baseline', 'candidate']) {
      const sample = pair[variant];
      if (!Number.isFinite(sample.elapsedMs) || sample.elapsedMs <= 0 || sample.queryCount !== sample.events.length) throw new Error('INVALID_SAMPLE');
    }
  }
  const baseline = s.pairs.map(p => p.baseline.elapsedMs);
  const candidate = s.pairs.map(p => p.candidate.elapsedMs);
  const differences = s.pairs.map(p => p.baseline.elapsedMs - p.candidate.elapsedMs);
  const difference = median(differences);
  const noise = median(differences.map(value => Math.abs(value - difference)));
  const relative = difference / median(baseline) * 100;
  const budgets = raw.budgets;
  return { id: s.id, pairs: s.pairs.length, baselineMedianMs: median(baseline), candidateMedianMs: median(candidate),
    baselineP75Ms: p75(baseline), candidateP75Ms: p75(candidate), pairedMedianImprovementMs: difference,
    relativeImprovementPercent: relative, pairedDifferenceMadMs: noise,
    controlledBudgetPass: difference >= budgets.absoluteImprovementFloorMs && relative >= budgets.relativeImprovementFloorPercent && noise <= budgets.pairedDifferenceMadNoiseBudgetMs,
    queryCounts: Object.fromEntries(['baseline','candidate'].map(v => [v, [...new Set(s.pairs.map(p => p[v].queryCount))]])),
    peakConcurrentReads: Object.fromEntries(['baseline','candidate'].map(v => [v, [...new Set(s.pairs.map(p => p[v].peakConcurrentReads))]])),
    clientFactoryCalls: Object.fromEntries(['baseline','candidate'].map(v => [v, [...new Set(s.pairs.map(p => p[v].clientFactoryCalls))]])),
  };
});
const scored = { schemaVersion: 'youtube-kpi-scheduling-controlled-score.v1', rawSha256: sha(readFileSync(path.join(root, 'raw.json'))),
  budgets: raw.budgets, scenarios, admittedSlices: 0, g003MeasuredImprovementEstablished: false,
  admissionReason: 'Synthetic fixed-delay transport and a frozen helper dependency set are not retained production route or full frozen-tree evidence. No canonical G003 slice is admitted.',
  limitations: ['No database or network request executed.', 'Concurrency per combined request increases from two to three temporarily; production pool contention is unmeasured.',
    'Query count and cached service-role factory calls are unchanged. No client construction speedup is claimed.',
    'Pagination and 200-ID map batches remain sequential. No cross-request result cache or auth change.',
    'Failure paths may launch a baseline read that the formerly serial row failure would have skipped.'] };
writeFileSync(path.join(root, 'scored.json'), JSON.stringify(scored, null, 2) + '\n');
const files = readdirSync(root).filter(name => name !== 'artifact-map.json').sort();
const map = { schemaVersion: 'youtube-kpi-scheduling-artifacts.v1', files: Object.fromEntries(files.map(name => [name, sha(readFileSync(path.join(root, name)))])) };
writeFileSync(path.join(root, 'artifact-map.json'), JSON.stringify(map, null, 2) + '\n');
console.log(JSON.stringify({ scenarios, admittedSlices: 0, artifactMapSha256: sha(readFileSync(path.join(root, 'artifact-map.json'))) }, null, 2));
