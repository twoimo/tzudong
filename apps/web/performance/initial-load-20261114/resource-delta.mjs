#!/usr/bin/env node
// Read-only: node resource-delta.mjs <validated-fixture-directory> > resource-delta.json
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireValid = (ok, code) => { if (!ok) throw new Error(code); };
const types = ['Script', 'Stylesheet', 'Font'];
const profiles = ['mobile', 'tablet', 'desktop'];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summarize = (values) => {
  const center = median(values);
  return { count: values.length, median: center, mad: median(values.map((value) => Math.abs(value - center))) };
};

try {
  requireValid(process.argv.length === 3, 'EXPECTED_VALIDATED_FIXTURE_DIRECTORY');
  const directory = resolve(process.argv[2]);
  const read = (name) => readFileSync(join(directory, name));
  const mapBytes = read('fixture-artifact-map.json');
  const mapSha = hash(mapBytes);
  const entries = JSON.parse(mapBytes).files;
  requireValid(Array.isArray(entries) && new Set(entries.map((entry) => entry.path)).size === entries.length, 'INVALID_ARTIFACT_MAP');
  const mapped = new Map(entries.map((entry) => [entry.path, entry]));
  const evidence = (name) => {
    const entry = mapped.get(name);
    requireValid(entry, 'UNMAPPED_EVIDENCE');
    const bytes = read(name);
    requireValid(hash(bytes) === entry.sha256 && bytes.length === entry.sizeBytes, 'EVIDENCE_HASH_MISMATCH');
    return JSON.parse(bytes);
  };
  const scoreBytes = read('fixture-scored.json');
  const validationBytes = read('fixture-validated.json');
  const score = JSON.parse(scoreBytes), validation = JSON.parse(validationBytes);
  requireValid(score.context?.eligible === true && validation.comparisonEligible === true &&
    validation.status === 'evidence-and-calculation-verified' && validation.comparableMetrics === 21, 'INELIGIBLE_COMPARISON');
  requireValid(['productionMetricAdmissionCount', 'fieldAdmissionCount', 'g003AdmissionCount']
    .every((key) => score[key] === 0 && validation[key] === 0), 'INVALID_ADMISSION_SCOPE');
  requireValid(score.scope === 'frontend-fixture' && validation.scope === 'frontend-fixture' &&
    score.artifactMapSha256 === mapSha && validation.artifactMapSha256 === mapSha, 'MAP_BINDING_MISMATCH');
  const historyBytes = readFileSync(new URL('./experiment-history.json', import.meta.url));
  const policy = JSON.parse(historyBytes).experiments.find((entry) => entry.id === 'remove-unrequested-startup-resources');
  requireValid(policy?.decisionPolicy?.resourceDefinition, 'RESOURCE_POLICY_MISSING');
  const phases = {};
  for (const phase of ['before', 'after']) {
    const scored = score.phases?.[phase];
    requireValid(scored?.trials?.length === 15 && /^[a-f0-9]{40}$/.test(scored.sourceSha), 'INVALID_PHASE');
    const run = evidence(`${phase}/run.json`);
    requireValid(run.status === 'valid' && run.sourceSha === scored.sourceSha && run.sourceTreeSha === scored.sourceTreeSha, 'SOURCE_BINDING_MISMATCH');
    const seen = new Set();
    const trials = scored.trials.map((trial) => {
      requireValid(trial.eligible === true && profiles.includes(trial.viewportId) &&
        new RegExp(`^${trial.viewportId}-0[1-5]$`).test(trial.attemptId) && !seen.has(trial.attemptId), 'INVALID_TRIAL');
      seen.add(trial.attemptId);
      const prefix = `${phase}/${trial.attemptId}`;
      const metrics = evidence(`${prefix}/lighthouse.sanitized.json`).audits?.metrics?.details?.items?.[0];
      const start = metrics?.observedNavigationStartTs, end = metrics?.observedTraceEndTs;
      requireValid(Number.isFinite(start) && Number.isFinite(end) && end >= start, 'INVALID_TRACE_WINDOW');
      const network = evidence(`${prefix}/network.sanitized.json`);
      requireValid(network.timeUnit === 'CDP monotonic seconds' && Array.isArray(network.records), 'INVALID_NETWORK');
      const subtotals = Object.fromEntries(types.map((type) => [type, { bytes: 0, requests: 0 }]));
      const excluded = { otherType: 0, nonLocalStatic: 0, non2xx: 0, incomplete: 0, invalidBytes: 0, outsideTrace: 0 };
      for (const record of network.records) {
        const reason = !types.includes(record.resourceType) ? 'otherType'
          : typeof record.url !== 'string' || !record.url.startsWith('http://localhost:8080/_next/static/') ? 'nonLocalStatic'
            : !Number.isFinite(record.status) || record.status < 200 || record.status >= 300 ? 'non2xx'
              : record.failed || record.canceled || !Number.isFinite(record.endTime) ? 'incomplete'
                : !Number.isFinite(record.encodedDataLength) || record.encodedDataLength < 0 ? 'invalidBytes'
                  : record.endTime * 1_000_000 < start || record.endTime * 1_000_000 > end ? 'outsideTrace' : null;
        if (reason) { excluded[reason]++; continue; }
        subtotals[record.resourceType].bytes += record.encodedDataLength;
        subtotals[record.resourceType].requests++;
      }
      return { attemptId: trial.attemptId, viewportId: trial.viewportId, observedNavigationStartTs: start,
        observedTraceEndTs: end, bytes: types.reduce((sum, type) => sum + subtotals[type].bytes, 0),
        requests: types.reduce((sum, type) => sum + subtotals[type].requests, 0), byType: subtotals,
        excludedCount: Object.values(excluded).reduce((sum, value) => sum + value, 0), excludedByFirstReason: excluded };
    });
    phases[phase] = { sourceSha: scored.sourceSha, sourceTreeSha: scored.sourceTreeSha, trials };
  }
  const comparisons = profiles.map((id) => {
    const summary = (phase) => {
      const trials = phases[phase].trials.filter((trial) => trial.viewportId === id);
      requireValid(trials.length === 5, 'INVALID_PROFILE_SAMPLE_COUNT');
      return { bytes: summarize(trials.map((trial) => trial.bytes)), requests: summarize(trials.map((trial) => trial.requests)),
        byType: Object.fromEntries(types.map((type) => [type, { bytes: summarize(trials.map((trial) => trial.byType[type].bytes)),
          requests: summarize(trials.map((trial) => trial.byType[type].requests)) }])) };
    };
    const before = summary('before'), after = summary('after');
    const reductionBytes = before.bytes.median - after.bytes.median;
    return { id, before, after, reductionBytes, reductionRequests: before.requests.median - after.requests.median,
      meets60000ByteReduction: reductionBytes >= 60_000 };
  });
  process.stdout.write(`${JSON.stringify({ schemaVersion: 'frontend-fixture-resource-delta.v1', scope: 'frontend-fixture',
    artifactMapSha256: mapSha, scoreSha256: hash(scoreBytes), validationSha256: hash(validationBytes),
    evaluatorSha256: hash(readFileSync(new URL(import.meta.url))), experimentHistorySha256: hash(historyBytes),
    resourceDefinitionSha256: hash(JSON.stringify(policy.decisionPolicy.resourceDefinition)),
    productionMetricAdmissionCount: 0, validTrialCount: 30, phases, profiles: comparisons,
    requiredReductionBytesPerProfile: 60_000,
    resourceCriterionMet: comparisons.filter((profile) => profile.id !== 'desktop').every((profile) => profile.meets60000ByteReduction),
    adoptionVerdictIncluded: false }, null, 2)}\n`);
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'RESOURCE_EVIDENCE_READ_ERROR';
  process.stderr.write(`${JSON.stringify({ status: 'rejected', code })}\n`);
  process.exitCode = 1;
}
