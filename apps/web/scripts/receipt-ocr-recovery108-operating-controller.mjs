#!/usr/bin/env node
/** Held, source-bound operating path for the 89 -> 108 receipt OCR chain. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectDirectDatabaseTransport } from './apply-supabase-migration.mjs';
import { compileRecovery108ChainPlan, loadRecovery108ChainSource } from './receipt-ocr-recovery108-chain-plan.mjs';
import {
  assembleOperatingEvidence,
  authenticatedOwnerAttestation,
  captureLocalVercelBundle,
  createRuntimeVerifiedRollbackReadback,
  createExclusivePrivateDirectory,
  readPrivateCanonicalJson,
  validateLocalVercelBundle,
  writeExclusiveCanonical,
} from './review-media-operating-orchestrator.mjs';
import { assertSuccessorDatabaseTarget, createSuccessorPsqlRunner } from './review-media-sql-successor.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SHA = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const outcome = (status, code, sourceRoot) => Object.freeze({ status, code, sourceRoot });

export function chainManifestRecord(source = loadRecovery108ChainSource()) {
  const manifests = [source.predecessor, source.feature, source.post105, source.acl, source.recovery]
    .map(record => record.manifest);
  const requiredWriterFences = manifests[0].requiredWriterFences;
  if (!SHA.test(source.sourceRoot)
    || !manifests.every(manifest => equal(manifest.requiredWriterFences, requiredWriterFences)
      && equal(manifest.protectedSource, manifests[0].protectedSource)
      && manifest.projectRef === 'aqlcofblfxdrjhhdmarw'
      && manifest.databaseName === 'postgres' && manifest.serverMajor === 17)) {
    fail('RECEIPT_OCR_CHAIN_SOURCE_INVALID');
  }
  return Object.freeze({
    manifest: Object.freeze({
      ...source.recovery.manifest,
      id: 'receipt_ocr_89_to_108_operating_chain',
      purpose: 'receipt-ocr-89-to-108-operating-chain',
      requiredWriterFences,
      sourceRoot: source.sourceRoot,
    }),
    manifestSha256: source.recovery.manifestSha256,
  });
}

function allConstituentsReady(source) {
  const states = [source.predecessor, source.feature, source.post105, source.acl, source.recovery]
    .map(record => record.manifest.launchPolicy?.state);
  if (states.some(state => !['held', 'ready'].includes(state))) fail('RECEIPT_OCR_CHAIN_SOURCE_INVALID');
  return states.every(state => state === 'ready');
}

function validateStageAdmission(value, source) {
  if (!exactKeys(value, ['featureAdmission', 'manifestSha256s', 'predecessorAdmission', 'sourceRoot'])
    || value.sourceRoot !== source.sourceRoot
    || !equal(value.manifestSha256s, source.manifestSha256s)) {
    fail('RECEIPT_OCR_CHAIN_ADMISSION_INVALID');
  }
  return value;
}

function assertFreshWindow(bundle, clock) {
  const now = clock();
  const instant = now instanceof Date ? now.getTime() : NaN;
  const start = Date.parse(bundle.createdAt);
  const end = Date.parse(bundle.expiresAt);
  if (!Number.isFinite(instant) || !Number.isFinite(start) || !Number.isFinite(end)
    || instant < start || instant >= end || end - start !== 900_000) {
    fail('RECEIPT_OCR_CHAIN_ADMISSION_EXPIRED');
  }
  return now.toISOString();
}

function assertEvidence(evidence, manifestRecord, bundle, environment) {
  const { input, machine } = evidence ?? {};
  const fences = manifestRecord.manifest.requiredWriterFences;
  if (!input || !machine || !exactKeys(input.writerFenceReceipts, Object.keys(fences))
    || input.sourceRevision !== environment.GITHUB_SHA
    || input.sourceRoot !== manifestRecord.manifest.sourceRoot
    || input.manifestSha256 !== manifestRecord.manifestSha256
    || input.createdAt !== bundle.createdAt || input.expiresAt !== bundle.expiresAt
    || !Object.entries(fences).every(([key, state]) => input.writerFenceReceipts[key]?.state === state)
    || machine.inFlightQuiescence?.inFlightWriters !== 0) {
    fail('RECEIPT_OCR_CHAIN_EVIDENCE_INVALID');
  }
  return evidence;
}

function privateCustody(directory) {
  createExclusivePrivateDirectory(directory);
  return Object.freeze({
    record(name, value) {
      if (!['authority', 'rehearsal', 'apply', 'settlement'].includes(name)) {
        fail('RECEIPT_OCR_CHAIN_CUSTODY_INVALID');
      }
      const written = writeExclusiveCanonical(join(directory, `${name}.json`), value);
      if (sha256(readPrivateCanonicalJson(written.path).bytes) !== written.sha256) {
        fail('RECEIPT_OCR_CHAIN_CUSTODY_INVALID');
      }
      return written;
    },
  });
}

async function defaultReadbackExecutor(input, { environment }) {
  const { createRecovery108PsqlReadbackExecutor } = await import('./receipt-ocr-recovery108-chain-readback.mjs');
  return createRecovery108PsqlReadbackExecutor({ environment })(input);
}

export function createRecovery108MutationExecutor({ environment = process.env,
  spawnImpl = spawnSync } = {}) {
  const { databaseUrl } = selectDirectDatabaseTransport(environment);
  return ({ sql, manifest }) => {
    assertSuccessorDatabaseTarget(databaseUrl, manifest);
    const serializerPid = environment.SUCCESSOR_SERIALIZER_BACKEND_PID;
    const serializerStartMicros = environment.SUCCESSOR_SERIALIZER_BACKEND_START_MICROS;
    if (!/^[1-9][0-9]{0,9}$/.test(serializerPid ?? '')
      || !/^[1-9][0-9]{0,19}$/.test(serializerStartMicros ?? '')) {
      fail('RECEIPT_OCR_CHAIN_SERIALIZER_UNCONFIRMED');
    }
    const runnerOptions = {
      environment,
      spawnImpl(binary, args, options) {
        return spawnImpl(binary, [...args, '--no-password'], {
          ...options,
          env: { ...options.env, PGCONNECT_TIMEOUT: '5' },
        });
      },
    };
    const heartbeat = createSuccessorPsqlRunner(databaseUrl, {
      ...runnerOptions,
      spawnImpl(binary, args, options) {
        return spawnImpl(binary, [...args, '--no-password'], {
          ...options,
          env: { ...options.env, PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c default_transaction_read_only=on' },
        });
      },
    });
    const health = heartbeat(databaseUrl, `SELECT CASE WHEN EXISTS (
 SELECT 1 FROM pg_catalog.pg_locks lock
 JOIN pg_catalog.pg_stat_activity activity ON activity.pid=lock.pid
 WHERE activity.pid=${serializerPid} AND activity.datname='postgres'
  AND lock.database=activity.datid
  AND (EXTRACT(EPOCH FROM activity.backend_start)*1000000)::bigint=${serializerStartMicros}
  AND lock.locktype='advisory' AND lock.mode='ExclusiveLock'
  AND lock.granted AND lock.objsubid=1
  AND lock.classid::bigint=((pg_catalog.hashtextextended('tzudong:review-media-sql-successor:workflow:v1', 0) >> 32) & 4294967295::bigint)
  AND lock.objid::bigint=(pg_catalog.hashtextextended('tzudong:review-media-sql-successor:workflow:v1', 0) & 4294967295::bigint)
) THEN 'SERIALIZER_ALIVE' ELSE 'SERIALIZER_LOST' END;`, false, { timeoutMs: 5_000 });
    if (health.trim() !== 'SERIALIZER_ALIVE') fail('RECEIPT_OCR_CHAIN_SERIALIZER_UNCONFIRMED');
    const runner = createSuccessorPsqlRunner(databaseUrl, runnerOptions);
    runner(databaseUrl, sql, false, { timeoutMs: 810_000 });
    return Object.freeze({ ack: 'confirmed' });
  };
}

function defaultExecuteSqlOnce({ sql, environment, manifest }) {
  return createRecovery108MutationExecutor({ environment })({ sql, manifest });
}

async function settled(readbackExecutor, input, environment) {
  try {
    const result = await readbackExecutor(input, { environment });
    return ['settled_initial_match', 'settled_terminal_match', 'conflict', 'unknown']
      .includes(result?.status) ? result.status : 'unknown';
  } catch { return 'unknown'; }
}

async function sentOnce(executeSqlOnce, sql, environment, manifest) {
  try {
    const result = await executeSqlOnce({ sql, environment, manifest });
    return result?.ack === 'confirmed';
  } catch { return false; }
}

export async function runRecovery108OperatingController({
  bundle,
  custodyDirectory,
  environment = process.env,
  mode,
  stageAdmission,
} = {}, {
  assembleEvidenceImpl = assembleOperatingEvidence,
  attestationImpl = authenticatedOwnerAttestation,
  clock = () => new Date(),
  compilePlanImpl = compileRecovery108ChainPlan,
  createCustodyImpl = privateCustody,
  executeSqlOnce = defaultExecuteSqlOnce,
  loadSourceImpl = loadRecovery108ChainSource,
  readbackExecutor = defaultReadbackExecutor,
  validateBundleImpl = validateLocalVercelBundle,
  verifyRuntimeRollbackImpl = createRuntimeVerifiedRollbackReadback,
} = {}) {
  if (!['observe', 'rehearsal', 'apply'].includes(mode)
    || !REVISION.test(environment.GITHUB_SHA ?? '')) fail('RECEIPT_OCR_CHAIN_ARGUMENT_INVALID');
  const source = loadSourceImpl();
  const manifestRecord = chainManifestRecord(source);
  if (!allConstituentsReady(source)) return outcome('held', 'RECEIPT_OCR_CHAIN_LAUNCH_HELD', source.sourceRoot);
  validateStageAdmission(stageAdmission, source);
  const now = assertFreshWindow(bundle, clock);
  validateBundleImpl({ bundle, manifestRecord, now: new Date(now), sourceRevision: environment.GITHUB_SHA });
  const attestation = attestationImpl({ bundle, clock, environment, sourceRevision: environment.GITHUB_SHA });
  const capture = () => assembleEvidenceImpl({
    attestation, bundle, clock, environment, manifestRecord, sourceRevision: environment.GITHUB_SHA,
  });
  const evidence = assertEvidence(await capture(), manifestRecord, bundle, environment);
  const input = {
    predecessorAdmission: stageAdmission.predecessorAdmission,
    featureAdmission: stageAdmission.featureAdmission,
    now,
    expiresAt: bundle.expiresAt,
  };
  const plan = compilePlanImpl(input);
  if (plan.kind !== 'receipt-ocr-89-to-108-source-only-chain-plan'
    || plan.sourceRoot !== source.sourceRoot || plan.migrationCount !== 19
    || plan.sourceManifestSha256 !== source.recovery.manifestSha256
    || !equal(plan.sourceManifestSha256s, source.manifestSha256s)
    || plan.rehearsalSql !== `BEGIN;\n${plan.bodySql}ROLLBACK;\n`
    || plan.applySql !== `BEGIN;\n${plan.bodySql}COMMIT;\n`) {
    fail('RECEIPT_OCR_CHAIN_PLAN_INVALID');
  }
  const custody = createCustodyImpl(custodyDirectory);
  const binding = {
    attemptId: evidence.input.attemptId,
    bodySha256: sha256(plan.bodySql),
    expiresAt: bundle.expiresAt,
    fenceStates: Object.fromEntries(Object.entries(evidence.input.writerFenceReceipts)
      .map(([key, receipt]) => [key, receipt.state])),
    runAttempt: attestation.runAttempt,
    runId: attestation.runId,
    sourceManifestSha256s: plan.sourceManifestSha256s,
    sourceRevision: environment.GITHUB_SHA,
    sourceRoot: source.sourceRoot,
  };
  custody.record('authority', { binding, bundle, attestation,
    evidence, stageAdmissionSha256: sha256(`${JSON.stringify(canonical(stageAdmission))}\n`) });
  const before = await settled(readbackExecutor, input, environment);
  if (before === 'settled_terminal_match') {
    custody.record('settlement', { binding, phase: 'before', state: before });
    return outcome('terminal_observed', 'RECEIPT_OCR_CHAIN_TERMINAL_OBSERVED', source.sourceRoot);
  }
  if (before !== 'settled_initial_match') {
    custody.record('settlement', { binding, phase: 'before', state: before });
    return outcome(before === 'conflict' ? 'conflict' : 'unknown', 'RECEIPT_OCR_CHAIN_INITIAL_UNCONFIRMED', source.sourceRoot);
  }
  if (mode === 'observe') {
    custody.record('settlement', { binding, phase: 'observe', state: before });
    return outcome('observed', 'RECEIPT_OCR_CHAIN_INITIAL_OBSERVED', source.sourceRoot);
  }
  await verifyRuntimeRollbackImpl({ bundle,
    bundleSha256: sha256(Buffer.from(`${JSON.stringify(canonical(bundle))}\n`)) });
  const rehearsalAcknowledged = await sentOnce(executeSqlOnce, plan.rehearsalSql,
    environment, manifestRecord.manifest);
  const afterRehearsal = await settled(readbackExecutor, input, environment);
  custody.record('rehearsal', { binding, acknowledged: rehearsalAcknowledged, state: afterRehearsal });
  if (!rehearsalAcknowledged || afterRehearsal !== 'settled_initial_match') {
    return outcome('unknown', 'RECEIPT_OCR_CHAIN_REHEARSAL_UNCONFIRMED', source.sourceRoot);
  }
  if (mode === 'rehearsal') return outcome('rolled_back', 'RECEIPT_OCR_CHAIN_REHEARSAL_PASSED', source.sourceRoot);
  assertFreshWindow(bundle, clock);
  const refreshed = assertEvidence(await capture(), manifestRecord, bundle, environment);
  if (!equal(Object.fromEntries(Object.entries(refreshed.input.writerFenceReceipts)
    .map(([key, receipt]) => [key, receipt.state])), binding.fenceStates)) {
    fail('RECEIPT_OCR_CHAIN_EVIDENCE_INVALID');
  }
  await verifyRuntimeRollbackImpl({ bundle,
    bundleSha256: sha256(Buffer.from(`${JSON.stringify(canonical(bundle))}\n`)) });
  custody.record('apply', { binding, refreshedEvidence: refreshed, ready: true });
  const applyAcknowledged = await sentOnce(executeSqlOnce, plan.applySql,
    environment, manifestRecord.manifest);
  const afterApply = await settled(readbackExecutor, input, environment);
  custody.record('settlement', { binding, acknowledged: applyAcknowledged, phase: 'apply', state: afterApply });
  if (afterApply === 'settled_terminal_match') {
    return applyAcknowledged
      ? outcome('committed', 'RECEIPT_OCR_CHAIN_COMMITTED', source.sourceRoot)
      : outcome('terminal_observed', 'RECEIPT_OCR_CHAIN_TERMINAL_OBSERVED', source.sourceRoot);
  }
  return outcome(afterApply === 'conflict' ? 'conflict' : 'unknown',
    'RECEIPT_OCR_CHAIN_APPLY_UNCONFIRMED', source.sourceRoot);
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const command = argv[0];
  if (command === 'check-gates' && argv.length === 1) {
    const source = loadRecovery108ChainSource();
    chainManifestRecord(source);
    return allConstituentsReady(source)
      ? outcome('ready', 'RECEIPT_OCR_CHAIN_LAUNCH_READY', source.sourceRoot)
      : outcome('held', 'RECEIPT_OCR_CHAIN_LAUNCH_HELD', source.sourceRoot);
  }
  if (command === 'capture-vercel' && argv.length === 5
    && argv[1] === '--source-revision' && REVISION.test(argv[2])
    && argv[3] === '--output') {
    const source = loadRecovery108ChainSource();
    const bundle = await captureLocalVercelBundle({
      manifestRecord: chainManifestRecord(source), sourceRevision: argv[2],
    });
    const written = writeExclusiveCanonical(argv[4], bundle);
    return Object.freeze({ status: 'captured', code: 'RECEIPT_OCR_CHAIN_VERCEL_BUNDLE_CAPTURED',
      sha256: written.sha256, sourceRoot: source.sourceRoot });
  }
  if (command !== 'operate' || argv.length !== 9 || argv[1] !== '--mode'
    || !['observe', 'rehearse', 'apply'].includes(argv[2]) || argv[3] !== '--input'
    || argv[5] !== '--stage-admission' || argv[7] !== '--custody-dir') {
    fail('RECEIPT_OCR_CHAIN_ARGUMENT_INVALID');
  }
  const bundle = readPrivateCanonicalJson(argv[4]).value;
  const stageAdmission = readPrivateCanonicalJson(argv[6]).value;
  return runRecovery108OperatingController({ bundle, stageAdmission,
    custodyDirectory: argv[8], mode: argv[2] === 'rehearse' ? 'rehearsal' : argv[2] }, dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!['captured', 'ready', 'observed', 'rolled_back', 'committed'].includes(result.status)) process.exitCode = 2;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({ status: 'failed', code: 'RECEIPT_OCR_CHAIN_OPERATING_FAILED' })}\n`);
    process.exitCode = 2;
  });
}
