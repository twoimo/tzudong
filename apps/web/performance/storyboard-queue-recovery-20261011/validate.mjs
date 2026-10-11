import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(root, '../../../..');
const readJson = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const config = readJson('config.json');
const raw = readJson('raw-cli-spy.json');
const summary = readJson('summary.json');
const scorer = readJson('scorer-output.json');
const artifactMap = readJson('artifact-map.json');
const mapped = [...artifactMap.evidence, ...artifactMap.changedFiles, ...artifactMap.unchangedAppliedSql];
const after = new Map(raw.after.map((entry) => [entry.scenario, entry]));
const before = new Map(raw.before.map((entry) => [entry.scenario, entry]));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const requiredBefore = [
  'actual-host-memory-gate', 'empty-queue', 'retired-provider', 'retired-model',
  'generation-auth-failure', 'partial-resume',
];
const requiredAfter = [...requiredBefore, 'catalog-auth-failure'];
const exactInventory = (entries, required) => Array.isArray(entries)
  && entries.length === required.length
  && required.every((scenario) => entries.filter((entry) => entry.scenario === scenario).length === 1);
const summaryConditions = new Map(summary.requestCountChanges.map((entry) => [entry.condition, entry]));
const scenarioNames = new Map([
  ['host_memory_rejection', 'actual-host-memory-gate'],
  ['empty_queue', 'empty-queue'],
  ['retired_provider_claim', 'retired-provider'],
  ['retired_model_claim', 'retired-model'],
]);
const allowedModels = config.providerPolicy.models.map((model) => model.id);

const checks = {
  artifactHashesExact: mapped.every((entry) => sha256(join(repositoryRoot, entry.path)) === entry.sha256),
  exactScenarioInventory: exactInventory(raw.before, requiredBefore) && exactInventory(raw.after, requiredAfter),
  nOneDeclared: config.measurement.sampleCountPerCondition === 1
    && summary.measurement.sampleCountPerCondition === 1,
  zeroNoiseBudget: Object.values(config.measurement.noiseBudget).every((value) => value === 0)
    && JSON.stringify(config.measurement.noiseBudget) === JSON.stringify(summary.measurement.noiseBudget),
  scorerPassed: scorer.allPassed === true && Object.values(scorer.checks).every(Boolean),
  summaryMatchesScorer: JSON.stringify(summary.requestCountChanges.map((entry) => ({
    condition: entry.condition,
    baseline: entry.before,
    candidate: entry.after,
    absoluteChange: entry.absoluteChange,
    relativeChangePercent: entry.relativeChangePercent,
  }))) === JSON.stringify(scorer.scoredChanges.map(({ exact: _exact, ...entry }) => entry)),
  summaryMatchesRaw: [...scenarioNames].every(([condition, scenario]) => {
    const declared = summaryConditions.get(condition);
    const baseline = before.get(scenario)?.catalogGets;
    const candidate = after.get(scenario)?.catalogGets;
    return baseline === declared?.before && candidate === declared?.after
      && candidate - baseline === declared?.absoluteChange
      && ((candidate - baseline) / baseline) * 100 === declared?.relativeChangePercent;
  }),
  exactAllowlist: equal(raw.modelOrder, allowedModels)
    && equal(after.get('empty-queue')?.heartbeatModelIds, allowedModels),
  rejectedWorkHasNoProviderCalls: ['empty-queue', 'retired-provider', 'retired-model']
    .every((scenario) => after.get(scenario)?.catalogGets === 0
      && equal(after.get(scenario)?.generationModels, [])),
  authFailuresAreTerminal: equal(after.get('catalog-auth-failure')?.generationModels, [])
    && equal(after.get('catalog-auth-failure')?.finishCodes, ['provider_auth_failed'])
    && equal(after.get('generation-auth-failure')?.generationModels, ['gemini-3.8-flash'])
    && equal(after.get('generation-auth-failure')?.finishCodes, ['provider_auth_failed']),
  noFallback: equal(config.providerPolicy.fallbackProviders, [])
    && raw.after.every((entry) => entry.generationModels.every((model) => allowedModels.includes(model))),
  partialResumeExact: equal(after.get('partial-resume')?.generationModels, ['gemini-3.1-flash-image'])
    && equal(after.get('partial-resume')?.uploads, [3])
    && after.get('partial-resume')?.draftCheckpoints === 0
    && after.get('partial-resume')?.fixtureDocumentUnchanged === true
    && after.get('partial-resume')?.preservedAssetCount === 5,
  externalOperationsZero: Object.values(config.externalOperations).every((value) => value === 0),
};
const output = {
  schemaVersion: 'storyboard-queue-recovery-validator-output.v1',
  checks,
  mappedFileCount: mapped.length,
  allPassed: Object.values(checks).every(Boolean),
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!output.allPassed) process.exitCode = 1;
