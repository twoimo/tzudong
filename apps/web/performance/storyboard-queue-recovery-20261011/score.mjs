import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const readJson = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const raw = readJson('raw-cli-spy.json');
const config = readJson('config.json');
const summary = readJson('summary.json');
const expected = new Map(summary.requestCountChanges.map((entry) => [entry.condition, entry]));
const requiredBefore = [
  'actual-host-memory-gate', 'empty-queue', 'retired-provider', 'retired-model',
  'generation-auth-failure', 'partial-resume',
];
const requiredAfter = [...requiredBefore, 'catalog-auth-failure'];
const scenarioNames = new Map([
  ['host_memory_rejection', 'actual-host-memory-gate'],
  ['empty_queue', 'empty-queue'],
  ['retired_provider_claim', 'retired-provider'],
  ['retired_model_claim', 'retired-model'],
]);
const byScenario = (side, name) => raw[side].find((entry) => entry.scenario === name);
const noiseBudget = config.measurement.noiseBudget;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exactInventory = (side, required) => Array.isArray(raw[side])
  && raw[side].length === required.length
  && required.every((scenario) => raw[side].filter((entry) => entry.scenario === scenario).length === 1);
const allowedModels = config.providerPolicy.models.map((model) => model.id);

const scoredChanges = [...scenarioNames].map(([condition, scenario]) => {
  const baseline = byScenario('before', scenario)?.catalogGets;
  const candidate = byScenario('after', scenario)?.catalogGets;
  const expectedEntry = expected.get(condition);
  const absoluteChange = candidate - baseline;
  const relativeChangePercent = baseline === 0 ? null : (absoluteChange / baseline) * 100;
  return {
    condition,
    baseline,
    candidate,
    absoluteChange,
    relativeChangePercent,
    exact: baseline === expectedEntry?.before
      && candidate === expectedEntry?.after
      && absoluteChange === expectedEntry?.absoluteChange
      && relativeChangePercent === expectedEntry?.relativeChangePercent,
  };
});

const output = {
  schemaVersion: 'storyboard-queue-recovery-scorer-output.v1',
  statisticalScope: {
    sampleCountPerCondition: config.measurement.sampleCountPerCondition,
    confidenceInterval: config.measurement.confidenceInterval,
    noiseBudget,
  },
  scoredChanges,
  checks: {
    exactScenarioInventory: exactInventory('before', requiredBefore) && exactInventory('after', requiredAfter),
    exactRequestCounts: scoredChanges.every((entry) => entry.exact),
    zeroNoiseBudget: Object.values(noiseBudget).every((value) => value === 0),
    zeroAfterGenerationForRejectedWork: ['empty-queue', 'retired-provider', 'retired-model']
      .every((scenario) => byScenario('after', scenario)?.catalogGets === 0
        && equal(byScenario('after', scenario)?.generationModels, [])),
    exactModelArrays: equal(raw.modelOrder, allowedModels)
      && equal(byScenario('after', 'empty-queue')?.heartbeatModelIds, allowedModels)
      && equal(byScenario('after', 'generation-auth-failure')?.generationModels, ['gemini-3.8-flash'])
      && equal(byScenario('after', 'partial-resume')?.generationModels, ['gemini-3.1-flash-image']),
    noAlternateLlmFallback: equal(config.providerPolicy.fallbackProviders, [])
      && raw.after.every((entry) => entry.generationModels.every((model) => allowedModels.includes(model))),
    terminalAuthFailures: equal(byScenario('after', 'catalog-auth-failure')?.generationModels, [])
      && equal(byScenario('after', 'catalog-auth-failure')?.finishCodes, ['provider_auth_failed'])
      && equal(byScenario('after', 'generation-auth-failure')?.finishCodes, ['provider_auth_failed']),
    partialResumeOneScene: equal(byScenario('after', 'partial-resume')?.uploads, [3])
      && byScenario('after', 'partial-resume')?.draftCheckpoints === 0
      && byScenario('after', 'partial-resume')?.fixtureDocumentUnchanged === true
      && byScenario('after', 'partial-resume')?.preservedAssetCount === 5,
  },
};
output.allPassed = Object.values(output.checks).every(Boolean);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!output.allPassed) process.exitCode = 1;
