import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalBytes } from '../../scripts/score-performance-backlog.mjs';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const WEB = resolve(HERE, '../..');
const CONTRACTS = {
  rawSchema: resolve(WEB, 'performance/backlog-raw.schema.json'),
  scoredSchema: resolve(WEB, 'performance/backlog-scored.schema.json'),
  budget: resolve(WEB, 'performance/performance-budgets.v1.json'),
};
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const FINAL_PLAN = 'plan-v6.json';
const FINAL_CANDIDATE_RECEIPT = 'build-candidate-v7/BUILD_ID';
const FINAL_RAW_INPUTS = ['paired-v6/raw.json', 'secondary-v5/raw.json'];
const fail = message => { throw new Error(`render-flow canonical: ${message}`); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const absolute = path => isAbsolute(path) ? path : resolve(process.cwd(), path);

function args(argv) {
  const mode = argv.shift(), result = { mode };
  if (!['prepare', 'finalize'].includes(mode)) fail('first argument must be prepare or finalize');
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1], allowed = mode === 'prepare' ? ['--local-scored', '--output-dir', '--release-id'] : ['--packet-dir', '--score-map-sha256'];
    if (!value || !allowed.includes(flag) || result[flag.slice(2)]) fail('invalid CLI');
    result[flag.slice(2)] = value;
  }
  if (mode === 'prepare' && (!result['local-scored'] || !result['output-dir'] || !ID.test(result['release-id'] ?? ''))) fail('prepare arguments');
  if (mode === 'finalize' && (!result['packet-dir'] || !HASH.test(result['score-map-sha256'] ?? ''))) fail('finalize arguments');
  return result;
}
function sixDigitTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) fail('invalid observed timestamp');
  return date.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}
async function readJson(path, name) { try { return JSON.parse(await readFile(path)); } catch { fail(`${name} is not JSON`); } }
async function writeNew(path, bytes) { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
function ref(path, bytes) { return { path, sha256: sha256(bytes) }; }
function contextArgs(root, map, pin, basis, terminalFlag, terminalPath) {
  return [
    '--artifact-root', root, '--artifact-map', map, '--artifact-map-sha256', pin,
    '--release-id', basis.releaseId, '--candidate-sha', basis.candidate.sha, '--candidate-tree', basis.candidate.tree,
    '--config-sha256', basis.configSha256, '--data-profile-sha256', basis.dataProfileSha256,
    '--frozen-as-of', basis.frozenAsOf, '--input', 'backlog.raw.json', terminalFlag, terminalPath,
  ];
}
function shellCommand(program, commandArgs) { return [program, ...commandArgs].map(value => `'${String(value).replaceAll("'", "'\\''")}'`).join(' '); }

async function localObservations(score) {
  const snapshots = [], incidents = [];
  for (let rawIndex = 0; rawIndex < score.rawInputs.length; rawIndex++) {
    const input = score.rawInputs[rawIndex], rawPath = isAbsolute(input.path) ? input.path : resolve(HERE, input.path), raw = await readJson(rawPath, `raw ${rawIndex}`);
    for (const pair of [...raw.warmups, ...raw.pairs]) for (const variant of ['baseline', 'candidate']) {
      const sample = pair[variant];
      for (const snapshot of [sample.resourceBefore, sample.resourceAfter]) snapshots.push(sixDigitTime(snapshot.observedAt));
      const errors = (sample.errors?.page ?? 0) + (sample.errors?.console ?? 0) + (sample.requests?.filter(request => request.completed !== true).length ?? 0);
      if (errors > 0) incidents.push({
        id: `local-browser-${rawIndex}-${pair.cell}-${pair.index < 0 ? `w${-pair.index}` : pair.index}-${variant}`.replaceAll('_', '-'),
        gate: 'required_cell_console_page_network_errors',
        capturedAt: sixDigitTime(sample.resourceAfter.observedAt),
      });
    }
  }
  if (snapshots.length < 2) fail('no measured resource timestamps');
  snapshots.sort(); incidents.sort((left, right) => left.id.localeCompare(right.id));
  return { start: snapshots[0], end: snapshots.at(-1), incidents };
}

async function prepare(options) {
  const scoredPath = absolute(options['local-scored']), scoreBytes = await readFile(scoredPath), score = JSON.parse(scoreBytes);
  if (
    score.schemaVersion !== 'render-flow-score.v1'
    || score.governance?.admittedFieldSlices !== 0
    || score.bindings?.candidate?.basis !== 'frozen_baseline_git_plus_retained_uncommitted_patch'
    || score.plan?.path !== FINAL_PLAN
    || typeof score.plan?.correctnessGate !== 'string'
    || score.plan.correctnessGate.length === 0
    || score.bindings?.candidate?.retainedBuildId !== FINAL_CANDIDATE_RECEIPT
    || FINAL_RAW_INPUTS.some((path, index) => score.rawInputs?.[index]?.path !== path)
  ) fail('local score is not the final plan-v6 candidate-v7 evidence set');
  const output = absolute(options['output-dir']);
  await mkdir(output, { recursive: false, mode: 0o700 });
  const [rawSchemaBytes, scoredSchemaBytes, budgetBytes] = await Promise.all(Object.values(CONTRACTS).map(path => readFile(path)));
  const rawSchema = JSON.parse(rawSchemaBytes), observations = await localObservations(score);
  const candidate = { sha: score.bindings.baseline.sourceCommit, tree: score.bindings.baseline.sourceTree };
  const patchDirectory = dirname(score.bindings.candidate.retainedBuildId), patchText = await readFile(resolve(HERE, patchDirectory, 'source.patch'), 'utf8');
  const patchCounts = new Map(); let patchPath = null;
  for (const line of patchText.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) { patchPath = header[2].replace(/^apps\/web\//, ''); if (!patchCounts.has(patchPath)) patchCounts.set(patchPath, { addedNonTestLoc: 0, deletedNonTestLoc: 0 }); continue; }
    if (!patchPath || line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) patchCounts.get(patchPath).addedNonTestLoc++;
    else if (line.startsWith('-')) patchCounts.get(patchPath).deletedNonTestLoc++;
  }
  const manifestFiles = ['components/map/NaverMapView.tsx', 'lib/naver-map-render-plan.ts', 'lib/marker-pool.ts'].map(path => {
    const counts = patchCounts.get(path); if (!counts) fail(`candidate patch missing ${path}`); return { path, ...counts };
  });
  const dataProfileSha256 = sha256(Buffer.from(JSON.stringify({ scope: score.scope, cells: score.cells.map(cell => cell.options) })));
  const basis = {
    schemaVersion: 'render-flow-canonical-basis.v1',
    releaseId: options['release-id'], candidate, configSha256: score.plan.sha256, dataProfileSha256,
    frozenAsOf: observations.end,
    bindingMeaning: 'canonical packet is bound to the frozen baseline Git object; the uncommitted candidate patch is retained only by SHA-256 and is not represented as a Git commit',
    uncommittedCandidatePatchSha256: score.bindings.candidate.patchSha256,
    localScoreSha256: sha256(scoreBytes),
    correctnessGate: score.plan.correctnessGate,
    fieldAdmissionAllowed: false,
  };
  const common = { releaseId: basis.releaseId, candidate, configSha256: basis.configSha256, dataProfileSha256 };
  const measurement = {
    schemaVersion: 'performance-measurement-source.v1', ...common,
    key: 'interaction.app_owned_p75_ms', surfaceClass: 'public', targetId: 'route.root',
    availability: { status: 'unavailable', reason: 'source_not_produced' },
    window: { start: observations.start, end: observations.end }, observations: [], attestations: [],
  };
  const manifest = {
    schemaVersion: 'performance-design-manifest.v1', ...common, candidateId: 'render-flow-local-lab',
    hypothesis: 'Reduce a bounded rendering delay without collecting private records.',
    symbols: [],
    files: manifestFiles,
    tests: [{ id: 'render-flow-regression', kind: 'source_contract', path: 'performance/render-flow-20260930/regression.mjs' }],
    boundaries: [{ boundary: 'runtime', mode: 'behavior_preserving' }],
    rollback: { kind: 'revert_candidate', steps: ['Revert the candidate commit.', 'Run the declared verification tests.'], verificationTestIds: ['render-flow-regression'] },
    stopConditions: [{ id: 'measured-regression', condition: 'Stop on a measured regression.', requiredAction: 'stop_and_revert' }],
  };
  const gateForms = {
    duplicate_hot_query_count: 'sanitized_query_summary',
    new_auth_rls_service_role_no_store_confirmation_readback_audit_violations: 'sanitized_security_review',
    app_owned_invocation_errors: 'function_summary',
    candidate_related_failed_production_deployments: 'deployment_summary',
    required_cell_console_page_network_errors: 'sanitized_browser_summary',
    required_manifest_validator_failures: 'validator_summary',
  };
  const health = {
    schemaVersion: 'performance-health-source.v1', ...common,
    window: { start: observations.start, end: observations.end },
    coverage: Object.entries(gateForms).map(([gate, evidenceForm]) => ({ gate, evidenceForm, count: observations.incidents.filter(incident => incident.gate === gate).length })),
    incidents: observations.incidents,
  };
  const measurementBytes = canonicalBytes(measurement, rawSchema.$defs.measurementReceipt, rawSchema);
  const manifestBytes = canonicalBytes(manifest, rawSchema.$defs.manifest, rawSchema);
  const healthBytes = canonicalBytes(health, rawSchema.$defs.healthReceipt, rawSchema);
  const raw = {
    schemaVersion: 'performance-backlog-raw.v2', ...common, frozenAsOf: basis.frozenAsOf,
    healthReceipt: ref('health.json', healthBytes),
    items: [{ id: 'render-flow-local-lab', key: measurement.key, surfaceClass: measurement.surfaceClass, targetId: measurement.targetId, measurement: ref('measurement.json', measurementBytes), manifest: ref('manifest.json', manifestBytes) }],
  };
  const rawBytes = canonicalBytes(raw, rawSchema, rawSchema);
  const pinEntries = {
    rawSchema: ref('contracts/backlog-raw.schema.json', rawSchemaBytes),
    scoredSchema: ref('contracts/backlog-scored.schema.json', scoredSchemaBytes),
    budget: ref('contracts/performance-budgets.v1.json', budgetBytes),
  };
  const scoreMap = {
    schemaVersion: 'performance-trusted-artifacts.v1', ...common, frozenAsOf: basis.frozenAsOf, pins: pinEntries,
    artifacts: { 'backlog.raw.json': sha256(rawBytes), 'health.json': sha256(healthBytes), 'manifest.json': sha256(manifestBytes), 'measurement.json': sha256(measurementBytes) },
  };
  const scoreMapBytes = canonicalBytes(scoreMap, {}, {});
  await mkdir(resolve(output, 'contracts'), { mode: 0o700 });
  await Promise.all([
    writeNew(resolve(output, 'contracts/backlog-raw.schema.json'), rawSchemaBytes),
    writeNew(resolve(output, 'contracts/backlog-scored.schema.json'), scoredSchemaBytes),
    writeNew(resolve(output, 'contracts/performance-budgets.v1.json'), budgetBytes),
    writeNew(resolve(output, 'basis.json'), Buffer.from(`${JSON.stringify(basis, null, 2)}\n`)),
    writeNew(resolve(output, 'measurement.json'), measurementBytes), writeNew(resolve(output, 'manifest.json'), manifestBytes),
    writeNew(resolve(output, 'health.json'), healthBytes), writeNew(resolve(output, 'backlog.raw.json'), rawBytes),
    writeNew(resolve(output, 'score-artifact-map.json'), scoreMapBytes),
  ]);
  const mapPin = sha256(scoreMapBytes), scorer = resolve(WEB, 'scripts/score-performance-backlog.mjs');
  const command = shellCommand(process.execPath, [scorer, ...contextArgs(output, 'score-artifact-map.json', mapPin, basis, '--output', 'backlog.scored.json')]);
  process.stdout.write(`${JSON.stringify({ prepared: true, fieldMeasurement: 'unavailable_source_not_produced', localBrowserGateIncidents: observations.incidents.length, admittedFieldSlices: 0, scoreArtifactMapSha256: mapPin, scorerCommand: command })}\n`);
}

async function finalize(options) {
  const root = absolute(options['packet-dir']), basis = await readJson(resolve(root, 'basis.json'), 'basis');
  const scoreMapBytes = await readFile(resolve(root, 'score-artifact-map.json'));
  if (sha256(scoreMapBytes) !== options['score-map-sha256']) fail('score map external pin mismatch');
  const scoredBytes = await readFile(resolve(root, 'backlog.scored.json'));
  const detachedBytes = Buffer.from(`${sha256(scoredBytes)}\n`);
  await writeNew(resolve(root, 'backlog.scored.json.sha256'), detachedBytes);
  const scoreMap = JSON.parse(scoreMapBytes), validateMap = {
    ...scoreMap,
    artifacts: { ...scoreMap.artifacts, 'backlog.scored.json': sha256(scoredBytes), 'backlog.scored.json.sha256': sha256(detachedBytes) },
  };
  const validateMapBytes = canonicalBytes(validateMap, {}, {}), validatePin = sha256(validateMapBytes);
  await writeNew(resolve(root, 'validate-artifact-map.json'), validateMapBytes);
  const validator = resolve(WEB, 'scripts/validate-performance-backlog.mjs');
  const command = shellCommand(process.execPath, [validator, ...contextArgs(root, 'validate-artifact-map.json', validatePin, basis, '--scored', 'backlog.scored.json')]);
  process.stdout.write(`${JSON.stringify({ finalized: true, validationArtifactMapSha256: validatePin, validatorCommand: command, expectedAdmission: 'zero', note: 'Run the printed validator command; finalization itself is not validation.' })}\n`);
}

async function main() { const options = args(process.argv.slice(2)); if (options.mode === 'prepare') await prepare(options); else await finalize(options); }
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
