import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

import {
  FEATURE_SUCCESSOR_FILES,
  FEATURE_SUCCESSOR_PRE_COMMIT_EXPIRY_MARKER,
  buildFeatureSuccessorStateQuery,
  compileFeatureApplyPlan,
  compileFeatureRehearsalPlan,
  loadFeatureSuccessorManifest,
  parseFeatureSuccessorArguments,
  prepareFeatureApplyAdmission,
  prepareFeatureRehearsalAdmission,
  runFeatureSuccessorApply,
  runFeatureSuccessorRehearsal,
  validateFeatureStageStates,
} from '../scripts/review-media-feature-sql-successor.mjs';
import {
  prepareReviewMediaApplyAdmission,
  prepareReviewMediaRehearsalAdmission,
} from '../scripts/review-media-operating-admission.mjs';
import {
  loadSuccessorManifest,
  protectedSourceReadbackBinding,
} from '../scripts/review-media-sql-successor.mjs';
import {
  elevenMigrationBundleSuffixRoot,
  migrationBundleSuffixRoot,
} from '../scripts/supabase-migration-bundle.mjs';

const predecessorRecord = loadSuccessorManifest();
const featureRecord = loadFeatureSuccessorManifest();
const featureManifest = featureRecord.manifest;
const predecessor = predecessorRecord.manifest;
const sourceRevision = 'a'.repeat(40);
const createdAt = '2026-10-14T01:00:00.000Z';
const observedAt = '2026-10-14T01:00:05.000Z';
const expiresAt = '2026-10-14T01:15:00.000Z';
const fixedNow = new Date('2026-10-14T01:00:40.000Z');
const databaseUrlFixture = new URL('postgresql://localhost/postgres');
databaseUrlFixture.hostname = 'aws-0-ap-southeast-1.pooler.supabase.com';
databaseUrlFixture.username = `postgres.${featureManifest.projectRef}`;
databaseUrlFixture.port = '6543';
const databaseUrl = databaseUrlFixture.toString();

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): any => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const canonicalBytes = (value: any) => Buffer.from(`${JSON.stringify(canonical(value))}\n`);

function privateRoot() {
  const root = mkdtempSync(join(tmpdir(), 'review-media-feature-successor-'));
  chmodSync(root, 0o700);
  return realpathSync(root);
}

function writeCanonical(path: string, value: any) {
  writeFileSync(path, canonicalBytes(value), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function predecessorStageStates() {
  const prefixRoot = '1'.repeat(64);
  return Array.from({ length: 12 }, (_, index) => ({
    bundle: {
      ledgerCount: 86 + index,
      prefixRoot,
      priorCount: 86,
      suffixRoot: index === 11 ? elevenMigrationBundleSuffixRoot(predecessor.migrations) : null,
      targetCount: index,
    },
    state: {
      activeReviewItems: 0,
      currentUser: 'postgres',
      databaseName: 'postgres',
      finishCleanupBodySha256: index === 10
        ? predecessor.terminalContract.finishPreimageSha256
        : index === 11
          ? predecessor.terminalContract.finishPostimageSha256
          : index === 0 ? null : sha256(`finish-${index}`),
      g014Root: index < 3 ? '2'.repeat(64) : '3'.repeat(64),
      ledgerRoot: index === 0 ? prefixRoot : sha256(`predecessor-ledger-${index}`),
      ownerAuthorityReady: true,
      reviewItems: 0,
      reviewPolicyEnabled: false,
      reviewRuns: 0,
      schemaRoot: sha256(`predecessor-schema-${index}`),
      serverMajor: 17,
      sessionUser: 'postgres',
      storageRoot: sha256(`predecessor-storage-${index}`),
      terminalContractReady: index === 11,
    },
  }));
}

function operatingInput(rollbackRevision = sourceRevision) {
  const common = {
    expiresAt,
    id: predecessor.id,
    manifestSha256: predecessorRecord.manifestSha256,
    observedAt,
    projectRef: predecessor.projectRef,
    purpose: predecessor.purpose,
    schemaVersion: 1,
    sourceRevision,
  };
  return {
    attemptId: '123e4567-e89b-42d3-a456-426614174200',
    checkoutReadback: {
      clean: true,
      detached: true,
      expiresAt,
      kind: 'successor-checkout-readback',
      observedAt,
      revision: sourceRevision,
      schemaVersion: 1,
    },
    createdAt,
    expiresAt,
    kind: 'review-media-successor-rehearsal-admission-input',
    manifestSha256: predecessorRecord.manifestSha256,
    protectedMainReceipt: {
      ...common,
      kind: 'protected-main-readback-receipt',
      ref: predecessor.protectedSource.ref,
      remote: predecessor.protectedSource.remote,
      repositoryUrl: predecessor.protectedSource.repositoryUrl,
      revision: sourceRevision,
    },
    rollbackReadbackReceipt: {
      ...common,
      deploymentId: 'dpl_FeatureSuccessorFixture123',
      deploymentSha: rollbackRevision,
      deploymentUrl: 'https://tzudong-feature-successor-fixture.vercel.app/',
      gitRef: 'main',
      kind: 'rollback-readback-receipt',
      productionAliases: ['tzudong.app', 'www.tzudong.app'],
      projectId: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
      readyState: 'READY',
      repository: 'twoimo/tzudong',
      state: 'ready',
      target: 'production',
      teamId: 'team_OUj64KeLxJI3PkEbOaFZnorA',
    },
    schemaVersion: 1,
    sourceReceipt: {
      ...common,
      kind: 'successor-source-receipt',
      sourceRoot: predecessor.sourceRoot,
    },
    sourceRevision,
    sourceRoot: predecessor.sourceRoot,
    writerFenceReceipts: Object.fromEntries(Object.entries(predecessor.requiredWriterFences).map(
      ([fence, state]) => [fence, {
        ...common,
        fence,
        kind: 'writer-fence-readback-receipt',
        state,
      }],
    )),
  };
}

function publishPredecessorRehearsal(custody: string) {
  const admissionPath = join(custody, 'rehearsal-admission.json');
  const admissionBytes = readFileSync(admissionPath);
  const admission = JSON.parse(admissionBytes.toString('utf8'));
  const admissionSha256 = sha256(admissionBytes);
  const stages = predecessorStageStates();
  const receiptPath = join(custody, 'rehearsal-receipt.json');
  const journalPath = join(custody, 'rehearsal-journal.jsonl');
  const receipt = {
    admissionSha256,
    attemptId: admission.attemptId,
    expiresAt,
    id: predecessor.id,
    journalPathSha256: sha256(journalPath),
    kind: 'successor-rehearsal-receipt',
    manifestSha256: predecessorRecord.manifestSha256,
    observedAt: '2026-10-14T01:00:10.000Z',
    passed: true,
    preflightStateSha256: sha256(JSON.stringify(canonical(stages[0]))),
    projectRef: predecessor.projectRef,
    purpose: predecessor.purpose,
    restoredStateSha256: sha256(JSON.stringify(canonical(stages[0]))),
    schemaVersion: 1,
    serverVersionNum: 170006,
    sourceRevision,
    sourceRoot: predecessor.sourceRoot,
    stageStates: stages,
    stageStatesSha256: sha256(JSON.stringify(canonical(stages))),
    suffixRoot: elevenMigrationBundleSuffixRoot(predecessor.migrations),
  };
  const receiptBytes = canonicalBytes(receipt);
  const receiptSha256 = sha256(receiptBytes);
  const journal = [
    {
      admissionSha256,
      attemptId: admission.attemptId,
      event: 'started',
      manifestSha256: predecessorRecord.manifestSha256,
      sourceRevision,
      sourceRoot: predecessor.sourceRoot,
      startedAt: '2026-10-14T01:00:06.000Z',
    },
    {
      admissionSha256,
      attemptId: admission.attemptId,
      code: 'SUCCESSOR_REHEARSAL_VERIFIED',
      event: 'verification',
      manifestSha256: predecessorRecord.manifestSha256,
      receiptSha256,
      sourceRevision,
      sourceRoot: predecessor.sourceRoot,
      verifiedAt: '2026-10-14T01:00:10.000Z',
    },
    {
      admissionSha256,
      attemptId: admission.attemptId,
      code: 'SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED',
      event: 'publication',
      manifestSha256: predecessorRecord.manifestSha256,
      publishedAt: '2026-10-14T01:00:11.000Z',
      receiptSha256,
      sourceRevision,
      sourceRoot: predecessor.sourceRoot,
    },
  ];
  writeFileSync(receiptPath, receiptBytes, { mode: 0o600 });
  writeFileSync(journalPath, Buffer.from(`${journal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`), { mode: 0o600 });
  chmodSync(receiptPath, 0o600);
  chmodSync(journalPath, 0o600);
  return { admissionSha256, receiptSha256, journalSha256: sha256(readFileSync(journalPath)) };
}

function publishPredecessorApplyEvidence(custody: string, rollbackRevision = sourceRevision) {
  const freshObservedAt = '2026-10-14T01:00:20.000Z';
  const coverage = [
    'pipeline_control.admin_record_media_cleanup',
    'pipeline_control.admin_record_operations',
    'public.reviews',
    'storage.objects',
  ];
  const attestation = {
    assertedAt: observedAt,
    authority: 'authenticated-repository-owner-workflow-dispatch',
    basis: 'standing-custody-confirmation-bound-by-owner-dispatch',
    event: 'workflow_dispatch',
    fences: {
      browserRpc: 'stopped',
      dashboard: 'stopped',
      directSql: 'stopped',
      providerIngress: 'stopped',
    },
    kind: 'review-media-successor-operator-custody-attestation',
    noticeState: 'not-issued',
    operatorRole: 'repository-owner',
    repository: 'twoimo/tzudong',
    runAttempt: '1',
    runId: '987654321',
    schemaVersion: 1,
    scope: 'stopped-until-application-result',
    sourceRevision,
    workflowRef: 'twoimo/tzudong/.github/workflows/review-media-sql-successor.yml@refs/heads/main',
  };
  const bundle = {
    adminRecordMutationsHold: {
      commit: sourceRevision,
      deploymentId: 'dpl_FeatureSuccessorFixture123',
      holdActive: true,
      observedAt,
    },
    createdAt,
    expiresAt,
    kind: 'review-media-successor-vercel-operating-bundle',
    manifestSha256: predecessorRecord.manifestSha256,
    protectedMain: {},
    rollbackPolicy: {},
    rollbackReadback: {
      deploymentId: 'dpl_FeatureSuccessorFixture123',
      gitSha: rollbackRevision,
    },
    schemaVersion: 1,
    sourceRevision,
    sourceRoot: predecessor.sourceRoot,
    storyboardPolicy: {
      deployment: {
        branch: 'main',
        deploymentId: 'dpl_FeatureSuccessorFixture123',
        sourceCommit: sourceRevision,
      },
      policy: { canonicalPolicySha256: 'c'.repeat(64) },
      schemaVersion: 1,
    },
  };
  const machine = {
    adminRuntimeHold: {
      deploymentId: 'dpl_FeatureSuccessorFixture123',
      holdActive: true,
      observedAt,
    },
    automaticReviewer: { observedAt: freshObservedAt, state: 'stopped' },
    g037WriteFreeze: { observedAt: freshObservedAt, state: 'active' },
    inFlightQuiescence: {
      coverage,
      inFlightWriters: 0,
      lockMode: 'SHARE',
      observedAt: freshObservedAt,
    },
    kind: 'review-media-successor-machine-operating-observations',
    schemaVersion: 1,
    sourceRevision,
  };
  const common = {
    expiresAt,
    id: predecessor.id,
    manifestSha256: predecessorRecord.manifestSha256,
    projectRef: predecessor.projectRef,
    purpose: predecessor.purpose,
    schemaVersion: 1,
    sourceRevision,
  };
  const quiescence = {
    ...common,
    coverage,
    inFlightWriters: 0,
    kind: 'apply-in-flight-quiescence-readback',
    lockMode: 'SHARE',
    observedAt: freshObservedAt,
  };
  const records = {
    attestation: { name: 'operator-custody-attestation.json', value: attestation },
    bundle: { name: 'vercel-operating-bundle.json', value: bundle },
    machine: { name: 'apply-machine-operating-observations.json', value: machine },
    quiescence: { name: 'apply-quiescence-readback.json', value: quiescence },
  };
  for (const record of Object.values(records)) writeCanonical(join(custody, record.name), record.value);
  const hashes = Object.fromEntries(Object.entries(records).map(([key, record]) => [
    key,
    sha256(readFileSync(join(custody, record.name))),
  ]));
  const receiptProvenance: Record<string, any> = {};
  for (const [fence, state] of Object.entries(predecessor.requiredWriterFences)) {
    const operator = ['browserRpc', 'dashboard', 'directSql', 'providerIngress'].includes(fence);
    const receipt = {
      ...common,
      fence,
      kind: 'writer-fence-readback-receipt',
      observedAt: ['automaticReviewer', 'g037WriteFreeze'].includes(fence)
        ? freshObservedAt
        : fence === 'adminRecordMutationsHold'
          ? bundle.adminRecordMutationsHold.observedAt
          : attestation.assertedAt,
      state,
    };
    const name = `apply-writer-fence-${fence}.json`;
    writeCanonical(join(custody, name), receipt);
    receiptProvenance[fence] = {
      evidenceSha256: operator
        ? hashes.attestation
        : fence === 'adminRecordMutationsHold' ? hashes.bundle : hashes.machine,
      provenance: operator
        ? 'authenticated-owner-custody-commitment'
        : fence === 'adminRecordMutationsHold'
          ? 'immutable-deployment-machine-observation'
          : 'fresh-machine-observation',
      receiptSha256: sha256(readFileSync(join(custody, name))),
    };
  }
  const map = {
    attestationSha256: hashes.attestation,
    bundleSha256: hashes.bundle,
    kind: 'review-media-successor-apply-operating-evidence-map',
    machineSha256: hashes.machine,
    quiescenceSha256: hashes.quiescence,
    receiptProvenance,
    schemaVersion: 1,
    sourceRevision,
  };
  const mapPath = join(custody, 'apply-operating-evidence-map.json');
  writeCanonical(mapPath, map);
  return {
    applyEvidenceMapSha256: sha256(readFileSync(mapPath)),
    applyQuiescenceReadbackSha256: hashes.quiescence,
  };
}

function createCommittedPredecessor(rollbackRevision = sourceRevision) {
  const root = privateRoot();
  const inputPath = join(root, 'operating-input.json');
  const custodyDirectory = join(root, 'custody');
  writeCanonical(inputPath, operatingInput(rollbackRevision));
  prepareReviewMediaRehearsalAdmission({
    custodyDirectory,
    inputPath,
    manifestRecord: predecessorRecord,
    now: new Date('2026-10-14T01:00:06.000Z'),
  });
  const published = publishPredecessorRehearsal(custodyDirectory);
  const applyEvidence = publishPredecessorApplyEvidence(custodyDirectory, rollbackRevision);
  const applyInputPath = join(root, 'apply-input.json');
  writeCanonical(applyInputPath, {
    ...applyEvidence,
    attemptId: '123e4567-e89b-42d3-a456-426614174201',
    expiresAt,
    kind: 'review-media-successor-apply-admission-input',
    manifestSha256: predecessorRecord.manifestSha256,
    observedAt: '2026-10-14T01:00:12.000Z',
    rehearsalAdmissionSha256: published.admissionSha256,
    rehearsalJournalSha256: published.journalSha256,
    rehearsalReceiptSha256: published.receiptSha256,
    schemaVersion: 1,
    sourceRevision,
  });
  const apply = prepareReviewMediaApplyAdmission({
    custodyDirectory,
    inputPath: applyInputPath,
    manifestRecord: predecessorRecord,
    now: new Date('2026-10-14T01:00:12.000Z'),
  });
  const admissionBytes = readFileSync(apply.admissionPath);
  const admission = JSON.parse(admissionBytes.toString('utf8'));
  const journal = [
    {
      admissionSha256: sha256(admissionBytes),
      attemptId: admission.attemptId,
      event: 'started',
      manifestSha256: admission.manifestSha256,
      sourceRevision,
      sourceRoot: admission.sourceRoot,
      startedAt: '2026-10-14T01:00:20.000Z',
    },
    {
      attemptId: admission.attemptId,
      code: 'SUCCESSOR_COMMITTED',
      completedAt: '2026-10-14T01:00:25.000Z',
      event: 'terminal',
    },
  ];
  writeFileSync(apply.journalPath, Buffer.from(`${journal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`), { mode: 0o600 });
  chmodSync(apply.journalPath, 0o600);
  return { custodyDirectory, root };
}

function featureStageStates() {
  const prefixRoot = '8'.repeat(64);
  const roleRoot = sha256('feature-role-root');
  const g014Before = sha256('feature-g014-before');
  const g014After = sha256('feature-g014-after');
  const storageBefore = sha256('feature-storage-before');
  const storageAfter = sha256('feature-storage-after');
  const storyboardBefore = sha256('feature-storyboard-before');
  const storyboardAfter = sha256('feature-storyboard-after');
  return Array.from({ length: 5 }, (_, index) => ({
    bundle: {
      ledgerCount: 97 + index,
      prefixRoot,
      priorCount: 97,
      suffixRoot: index === 4 ? migrationBundleSuffixRoot(featureManifest.migrations) : null,
      targetCount: index,
    },
    state: {
      activeReviewItems: 0,
      baseReviewReady: true,
      catalogRoot: sha256(`feature-catalog-${index}`),
      currentUser: 'postgres',
      databaseName: 'postgres',
      featureRuntimeReady: index >= 4,
      g014Ready: index >= 3,
      g014Root: index < 3 ? g014Before : g014After,
      immutableReady: index >= 4,
      ledgerRoot: index === 0 ? prefixRoot : sha256(`feature-ledger-${index}`),
      ocrReady: index >= 2,
      predecessorReady: true,
      reviewPolicyEnabled: false,
      reviewRuns: 0,
      roleRoot,
      serverMajor: 17,
      sessionUser: 'postgres',
      storageRoot: index < 4 ? storageBefore : storageAfter,
      storyboardReady: index >= 1,
      storyboardRoot: index === 0 ? storyboardBefore : storyboardAfter,
    },
  }));
}

function liveRollbackReadback() {
  return {
    deploymentId: 'dpl_FeatureSuccessorFixture123',
    deploymentUrl: 'https://tzudong-feature-successor-fixture.vercel.app/',
    gitRef: 'main',
    gitSha: sourceRevision,
    kind: 'vercel-rollback-readback',
    observedAt: '2026-10-14T01:00:30.000Z',
    productionAliases: ['tzudong.app', 'www.tzudong.app'],
    projectId: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
    readyState: 'READY',
    repository: 'twoimo/tzudong',
    schemaVersion: 1,
    target: 'production',
    teamId: 'team_OUj64KeLxJI3PkEbOaFZnorA',
  };
}

function publishFeatureRehearsal(custody: string) {
  const admissionPath = join(custody, FEATURE_SUCCESSOR_FILES.rehearsalAdmission);
  const admissionBytes = readFileSync(admissionPath);
  const admission = JSON.parse(admissionBytes.toString('utf8'));
  const admissionSha256 = sha256(admissionBytes);
  const stages = featureStageStates();
  const receipt = {
    admissionSha256,
    attemptId: admission.attemptId,
    expiresAt,
    id: featureManifest.id,
    kind: 'feature-successor-rehearsal-receipt',
    manifestSha256: featureRecord.manifestSha256,
    observedAt: '2026-10-14T01:00:32.000Z',
    passed: true,
    preflightStateSha256: sha256(JSON.stringify(canonical(stages[0]))),
    projectRef: featureManifest.projectRef,
    purpose: featureManifest.purpose,
    restoredStateSha256: sha256(JSON.stringify(canonical(stages[0]))),
    schemaVersion: 1,
    serverVersionNum: 170006,
    sourceRevision,
    sourceRoot: featureManifest.sourceRoot,
    stageStates: stages,
    stageStatesSha256: sha256(JSON.stringify(canonical(stages))),
    suffixRoot: migrationBundleSuffixRoot(featureManifest.migrations),
  };
  const receiptBytes = canonicalBytes(receipt);
  const receiptSha256 = sha256(receiptBytes);
  const journal = [
    {
      admissionSha256,
      attemptId: admission.attemptId,
      event: 'started',
      manifestSha256: featureRecord.manifestSha256,
      sourceRevision,
      sourceRoot: featureManifest.sourceRoot,
      startedAt: '2026-10-14T01:00:30.000Z',
    },
    {
      attemptId: admission.attemptId,
      code: 'FEATURE_SUCCESSOR_REHEARSAL_PASSED',
      completedAt: '2026-10-14T01:00:33.000Z',
      event: 'terminal',
      receiptSha256,
    },
  ];
  writeFileSync(join(custody, FEATURE_SUCCESSOR_FILES.rehearsalReceipt), receiptBytes, { mode: 0o600 });
  writeFileSync(
    join(custody, FEATURE_SUCCESSOR_FILES.rehearsalJournal),
    Buffer.from(`${journal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`),
    { mode: 0o600 },
  );
  chmodSync(join(custody, FEATURE_SUCCESSOR_FILES.rehearsalReceipt), 0o600);
  chmodSync(join(custody, FEATURE_SUCCESSOR_FILES.rehearsalJournal), 0o600);
}

test('manifest freezes the exact four sources and ledger 97 to 101 while launch remains held', () => {
  expect(featureManifest.operatingTransition).toEqual({ beforeFour: 97, afterFour: 101 });
  expect(featureManifest.launchPolicy.state).toBe('held');
  expect(featureManifest.migrations.map((migration: any) => [
    migration.version,
    migration.bytes,
    migration.sha256,
  ])).toEqual([
    ['20261013093518', 15228, '84d351dead86ef90040b6949fe4a6dc93eb91a783c1b7a78531c7f564ea4ff4e'],
    ['20261013190000', 56061, '7a140594826c3375da71e74be44bdfe9c6e99c4465d8a9484a9d8180d696480d'],
    ['20261013190100', 25506, '0c3f8b4cadc1d4bb0d88b53de49be34ef8e2751a47bfc18ebad89ae543b4c370'],
    ['20261013190200', 14358, '0a060ca537d3558779fd0cb1b780e7965189eb129f5018987f157c1cb5f2cd3d'],
  ]);
  expect(featureManifest.predecessor).toMatchObject({
    afterLedger: 97,
    id: predecessor.id,
    manifestSha256: predecessorRecord.manifestSha256,
    sourceRoot: predecessor.sourceRoot,
  });
  expect(featureManifest.toolchain.map((entry: any) => entry.path)).toEqual([
    'apps/web/scripts/review-media-feature-sql-successor.mjs',
    'apps/web/scripts/review-media-sql-successor.mjs',
    'apps/web/scripts/supabase-migration-bundle.mjs',
    'apps/web/scripts/supabase-migration-transaction.mjs',
    'apps/web/scripts/apply-supabase-migration.mjs',
    'apps/web/scripts/vercel-rollback-readback.mjs',
  ]);
});

test('manifest rejects a predecessor manifest that changed outside the SQL source root', () => {
  expect(() => loadFeatureSuccessorManifest({
    loadPredecessorImpl: () => ({
      ...predecessorRecord,
      manifestSha256: '0'.repeat(64),
    }),
  })).toThrow('FEATURE_SUCCESSOR_SOURCE_DRIFT');
});

test('state contract binds G014, Storage, roles, catalog and cumulative feature readiness', () => {
  const query = buildFeatureSuccessorStateQuery(featureRecord);
  for (const token of [
    "'catalogRoot'", "'g014Root'", "'storageRoot'", "'roleRoot'",
    "'storyboardReady'", "'ocrReady'", "'g014Ready'", "'immutableReady'", "'featureRuntimeReady'",
    'pg_auth_members', 'g014_public_rpc_allowlist', "polrelid='storage.objects'::regclass",
    "a.attrelid='public.reviews'::regclass", 'a.atttypmod = -1', "a.attidentity = ''", "a.attgenerated = ''",
    "WHEN 'idx_reviews_receipt_hash'", "pg_get_indexdef(c.oid,1,true)='receipt_hash'",
    "WHEN 'reviews_ocr_pending_idx'", "WHEN 'reviews_duplicate_idx'", "am.amname='btree'",
    'i.indisvalid AND i.indisready AND i.indislive',
  ]) expect(query).toContain(token);
  const stages = featureStageStates();
  expect(validateFeatureStageStates(stages, featureManifest)).toEqual({
    prefixRoot: '8'.repeat(64),
    priorCount: 97,
    suffixRoot: migrationBundleSuffixRoot(featureManifest.migrations),
  });
  const roleDrift = structuredClone(stages);
  roleDrift[3].state.roleRoot = sha256('drift');
  expect(() => validateFeatureStageStates(roleDrift, featureManifest))
    .toThrow('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  const storageTooEarly = structuredClone(stages);
  storageTooEarly[2].state.storageRoot = sha256('early-storage-drift');
  expect(() => validateFeatureStageStates(storageTooEarly, featureManifest))
    .toThrow('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  const falseG014 = structuredClone(stages);
  falseG014[3].state.g014Ready = false;
  expect(() => validateFeatureStageStates(falseG014, featureManifest))
    .toThrow('FEATURE_SUCCESSOR_ADMISSION_INVALID');
});

test('four-stage rehearsal and apply plans preserve source order, rollback, and expiry guards', () => {
  const stages = featureStageStates();
  const admission = { expiresAt, stageStates: stages } as any;
  const rehearsal = compileFeatureRehearsalPlan(featureRecord, admission, stages[0]);
  expect(rehearsal.transactionMode).toBe('explicit-rollback-only');
  expect(rehearsal.sql.match(/feature-successor-rehearsal-stage/g)).toHaveLength(5);
  expect(rehearsal.sql).toContain('ROLLBACK;');
  for (const migration of featureManifest.migrations) {
    expect(rehearsal.sql).toContain(
      `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${migration.version}','${migration.name}'`,
    );
  }
  const apply = compileFeatureApplyPlan(featureRecord, admission);
  expect(apply.plans).toHaveLength(4);
  expect(apply.priorCount).toBe(97);
  expect(apply.sql).toContain(FEATURE_SUCCESSOR_PRE_COMMIT_EXPIRY_MARKER);
  expect(apply.sql).toContain('pg_advisory_xact_lock(7311754282260212::bigint)');
  expect(apply.transactionMode).toBe('single-outer-transaction');
});

test('feature admission reuses committed parent fences and window without creating receipts', () => {
  const { custodyDirectory } = createCommittedPredecessor();
  const before = new Set(readdirSync(custodyDirectory));
  const prepared = prepareFeatureRehearsalAdmission({
    custodyDirectory,
    loadManifestImpl: () => featureRecord,
    now: fixedNow,
  });
  const after = new Set(readdirSync(custodyDirectory));
  expect([...after].filter(name => !before.has(name))).toEqual([
    FEATURE_SUCCESSOR_FILES.rehearsalAdmission,
  ]);
  const admission = JSON.parse(readFileSync(prepared.admissionPath, 'utf8'));
  const parent = JSON.parse(readFileSync(join(custodyDirectory, FEATURE_SUCCESSOR_FILES.baseAdmission), 'utf8'));
  expect(admission).toMatchObject({
    baseAdmissionSha256: sha256(readFileSync(join(
      custodyDirectory,
      FEATURE_SUCCESSOR_FILES.baseAdmission,
    ))),
    baseApplyEvidenceMapSha256: parent.applyEvidenceMapSha256,
    baseApplyQuiescenceReadbackSha256: parent.applyQuiescenceReadbackSha256,
    baseRehearsalAdmissionSha256: parent.rehearsalAdmissionSha256,
    createdAt,
    expiresAt,
    kind: 'feature-successor-rehearsal-admission',
    sourceRevision,
    writerFences: parent.writerFences,
  });
  expect(parent.applyEvidenceMapSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(parent.applyQuiescenceReadbackSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(parent.rehearsalAdmissionSha256).toBe(sha256(readFileSync(join(
    custodyDirectory,
    'rehearsal-admission.json',
  ))));
  expect(admission.rollback.deploymentSha).toBe(sourceRevision);
  expect([...after].filter(name => name.startsWith('writer-fence-')))
    .toEqual([...before].filter(name => name.startsWith('writer-fence-')));

  publishFeatureRehearsal(custodyDirectory);
  const apply = prepareFeatureApplyAdmission({
    custodyDirectory,
    loadManifestImpl: () => featureRecord,
    now: fixedNow,
  });
  const applyAdmission = JSON.parse(readFileSync(apply.admissionPath, 'utf8'));
  expect(applyAdmission.stageStates).toEqual(featureStageStates());
  expect(applyAdmission.expiresAt).toBe(expiresAt);
  expect(applyAdmission).toMatchObject({
    baseApplyEvidenceMapSha256: parent.applyEvidenceMapSha256,
    baseApplyQuiescenceReadbackSha256: parent.applyQuiescenceReadbackSha256,
    baseRehearsalAdmissionSha256: parent.rehearsalAdmissionSha256,
  });
});

test('rehearsal records a bounded terminal failure when rollback restoration differs', () => {
  const { custodyDirectory } = createCommittedPredecessor();
  prepareFeatureRehearsalAdmission({
    custodyDirectory,
    loadManifestImpl: () => featureRecord,
    now: fixedNow,
  });
  const stages = featureStageStates();
  const changedRestore = structuredClone(stages[0]);
  changedRestore.state.reviewRuns = 1;
  let call = 0;
  expect(() => runFeatureSuccessorRehearsal({
    custodyDirectory,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    clock: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision: sourceRevision }),
    loadManifestImpl: () => featureRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(featureManifest, sourceRevision),
    rollbackReadbackImpl: () => liveRollbackReadback(),
    runPsqlImpl: () => {
      call += 1;
      if (call === 1) return JSON.stringify(stages[0]);
      if (call === 2) return stages.map((state, index) => JSON.stringify({
        index,
        kind: 'feature-successor-rehearsal-stage',
        serverVersionNum: 170006,
        state,
      })).join('\n');
      return JSON.stringify(changedRestore);
    },
  })).toThrow('FEATURE_SUCCESSOR_REHEARSAL_RESTORE_INVALID');
  const journal = readFileSync(
    join(custodyDirectory, FEATURE_SUCCESSOR_FILES.rehearsalJournal),
    'utf8',
  ).trimEnd().split('\n').map(line => JSON.parse(line));
  expect(journal).toHaveLength(2);
  expect(journal[1]).toMatchObject({
    code: 'FEATURE_SUCCESSOR_REHEARSAL_RESTORE_INVALID',
    event: 'terminal',
  });
  expect(existsSync(join(custodyDirectory, FEATURE_SUCCESSOR_FILES.rehearsalReceipt))).toBe(false);
});

test('unsafe rollback and expired custody fail before any feature admission is written', () => {
  const unsafe = createCommittedPredecessor('b'.repeat(40));
  expect(() => prepareFeatureRehearsalAdmission({
    custodyDirectory: unsafe.custodyDirectory,
    loadManifestImpl: () => featureRecord,
    now: fixedNow,
  })).toThrow('FEATURE_SUCCESSOR_ROLLBACK_INCOMPATIBLE');
  expect(readdirSync(unsafe.custodyDirectory)).not.toContain(
    FEATURE_SUCCESSOR_FILES.rehearsalAdmission,
  );

  const stale = createCommittedPredecessor();
  expect(() => prepareFeatureRehearsalAdmission({
    custodyDirectory: stale.custodyDirectory,
    loadManifestImpl: () => featureRecord,
    now: new Date(expiresAt),
  })).toThrow('FEATURE_SUCCESSOR_ADMISSION_EXPIRED');
  expect(readdirSync(stale.custodyDirectory)).not.toContain(
    FEATURE_SUCCESSOR_FILES.rehearsalAdmission,
  );
});

test('tampered parent provenance, rehearsal admission, and future journals cannot seed the feature phase', () => {
  const tampered = createCommittedPredecessor();
  const machinePath = join(tampered.custodyDirectory, 'apply-machine-operating-observations.json');
  const machine = JSON.parse(readFileSync(machinePath, 'utf8'));
  machine.automaticReviewer.state = 'running';
  writeCanonical(machinePath, machine);
  expect(() => prepareFeatureRehearsalAdmission({
    custodyDirectory: tampered.custodyDirectory,
    loadManifestImpl: () => featureRecord,
    now: fixedNow,
  })).toThrow('FEATURE_SUCCESSOR_ADMISSION_INVALID');

  const relabeled = createCommittedPredecessor();
  const rehearsalPath = join(relabeled.custodyDirectory, 'rehearsal-admission.json');
  const rehearsal = JSON.parse(readFileSync(rehearsalPath, 'utf8'));
  rehearsal.attemptId = '123e4567-e89b-42d3-a456-426614174299';
  writeCanonical(rehearsalPath, rehearsal);
  expect(() => prepareFeatureRehearsalAdmission({
    custodyDirectory: relabeled.custodyDirectory,
    loadManifestImpl: () => featureRecord,
    now: fixedNow,
  })).toThrow('FEATURE_SUCCESSOR_ADMISSION_INVALID');

  const future = createCommittedPredecessor();
  const journalPath = join(future.custodyDirectory, FEATURE_SUCCESSOR_FILES.baseJournal);
  const journal = readFileSync(journalPath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  journal[1].completedAt = '2026-10-14T01:10:00.000Z';
  writeFileSync(
    journalPath,
    Buffer.from(`${journal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`),
    { mode: 0o600 },
  );
  expect(() => prepareFeatureRehearsalAdmission({
    custodyDirectory: future.custodyDirectory,
    loadManifestImpl: () => featureRecord,
    now: fixedNow,
  })).toThrow('FEATURE_SUCCESSOR_PARENT_NOT_COMMITTED');
});

test('feature execution pins every parent apply and rehearsal digest before external reads', () => {
  for (const field of [
    'baseApplyEvidenceMapSha256',
    'baseApplyQuiescenceReadbackSha256',
    'baseRehearsalAdmissionSha256',
  ]) {
    const { custodyDirectory } = createCommittedPredecessor();
    const prepared = prepareFeatureRehearsalAdmission({
      custodyDirectory,
      loadManifestImpl: () => featureRecord,
      now: fixedNow,
    });
    const admission = JSON.parse(readFileSync(prepared.admissionPath, 'utf8'));
    admission[field] = '0'.repeat(64);
    writeCanonical(prepared.admissionPath, admission);
    let touched = 0;
    expect(() => runFeatureSuccessorRehearsal({
      custodyDirectory,
    }, {
      clock: () => fixedNow,
      gitFactsImpl: () => { touched += 1; return {}; },
      loadManifestImpl: () => featureRecord,
      protectedMainReadbackImpl: () => { touched += 1; return {}; },
      rollbackReadbackImpl: () => { touched += 1; return {}; },
      runPsqlImpl: () => { touched += 1; return ''; },
    } as any)).toThrow('FEATURE_SUCCESSOR_ADMISSION_INVALID');
    expect(touched).toBe(0);
  }
});

test('held apply fails before custody, database, rollback, or controller access', () => {
  let touched = 0;
  expect(() => runFeatureSuccessorApply({
    custodyDirectory: '/missing/private/custody',
  }, {
    gitFactsImpl: () => { touched += 1; return {}; },
    loadManifestImpl: () => featureRecord,
    protectedMainReadbackImpl: () => { touched += 1; return {}; },
    rollbackReadbackImpl: () => { touched += 1; return {}; },
    runPsqlImpl: () => { touched += 1; return ''; },
  } as any)).toThrow('FEATURE_SUCCESSOR_LAUNCH_HELD');
  expect(touched).toBe(0);
});

test('CLI exposes only the explicit four-phase protected sequence', () => {
  expect(parseFeatureSuccessorArguments([
    '--mode', 'prepare-rehearsal', '--custody-dir', '/private/custody',
  ])).toEqual({ custodyDirectory: '/private/custody', mode: 'prepare-rehearsal' });
  for (const mode of ['rehearsal', 'prepare-apply', 'apply']) {
    expect(parseFeatureSuccessorArguments([
      '--mode', mode, '--custody-dir', '/private/custody',
    ])).toEqual({ custodyDirectory: '/private/custody', mode });
  }
  expect(() => parseFeatureSuccessorArguments([
    '--mode', 'observe', '--custody-dir', '/private/custody',
  ])).toThrow('FEATURE_SUCCESSOR_ARGUMENT_INVALID');
});
