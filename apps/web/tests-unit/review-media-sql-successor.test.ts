import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendJournal,
  successorFailureResult,
  compileSuccessorRehearsalPlan,
  compileSuccessorStateReadQuery,
  compileSuccessorPlan,
  createSuccessorPsqlRunner,
  loadSuccessorManifest,
  protectedSourceReadbackBinding,
  runReviewMediaSuccessor,
  runReviewMediaSuccessorRehearsal,
  SUCCESSOR_PRE_COMMIT_EXPIRY_MARKER,
  validateSuccessorAdmission,
  validateSuccessorRehearsalAdmission,
} from '../scripts/review-media-sql-successor.mjs';
import { parseRehearsalArguments } from '../scripts/review-media-sql-rehearsal.mjs';
import { elevenMigrationBundleSuffixRoot } from '../scripts/supabase-migration-bundle.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const manifestBytes = readFileSync(new URL('../../../.github/review-media-sql-successor.v1.json', import.meta.url));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const record = Object.freeze({
  bytes: manifestBytes,
  manifest,
  manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  materials: Object.freeze(manifest.migrations.map((migration: any) => ({
    path: migration.path,
    bytes: readFileSync(new URL(`../../../${migration.path}`, import.meta.url)),
    originalVector: migration.originalStatementVector,
  }))),
});
const executableRecord = Object.freeze({
  ...record,
  manifest: Object.freeze({
    ...record.manifest,
    launchPolicy: Object.freeze({ ...record.manifest.launchPolicy, state: 'ready' }),
  }),
});
const fixedNow = new Date('2026-10-12T08:00:00.000Z');
const revision = '056a86600f412eb42df4304e3206841679012f3e';
// This injected transport has no credential. Keep its project/role/database
// identity bound to the same manifest that the controller validates.
const databaseUrl = new URL(
  `postgresql://${record.manifest.executorRole}.${record.manifest.projectRef}@aws-0-ap-southeast-1.pooler.supabase.com:6543/${record.manifest.databaseName}`,
).toString();
const rollback = Object.freeze({
  deploymentId: 'dpl_EUxJnWmDDozCSMWb2sqNSPgKJLM5',
  deploymentSha: '1884f87e53c4567ead7c9a0fb394b09b91a70396',
  deploymentUrl: 'https://tzudong-fixture-twoimos-projects.vercel.app/',
  gitRef: 'main',
  productionAliases: ['tzudong.app', 'www.tzudong.app'],
  projectId: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
  readyState: 'READY',
  repository: 'twoimo/tzudong',
  state: 'ready',
  target: 'production',
  teamId: 'team_OUj64KeLxJI3PkEbOaFZnorA',
});
const directories: string[] = [];
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): any => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const canonicalBytes = (value: any) => Buffer.from(`${JSON.stringify(canonical(value))}\n`);
const writeCanonicalLine = (descriptor: number, entry: any, { sync = true } = {}) => {
  const bytes = canonicalBytes(entry);
  expect(writeSync(descriptor, bytes)).toBe(bytes.length);
  if (sync) fsyncSync(descriptor);
};

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories[directories.length - 1];
    rmSync(directory, { recursive: true, force: true });
    directories.pop();
  }
});

function stageStates() {
  const prefixRoot = '1'.repeat(64);
  return Array.from({ length: 12 }, (_, index) => ({
    bundle: {
      ledgerCount: 86 + index,
      prefixRoot,
      priorCount: 86,
      suffixRoot: index === 11 ? elevenMigrationBundleSuffixRoot(manifest.migrations) : null,
      targetCount: index,
    },
    state: {
      activeReviewItems: 0,
      currentUser: 'postgres',
      databaseName: 'postgres',
      finishCleanupBodySha256: index === 10
        ? manifest.terminalContract.finishPreimageSha256
        : index === 11
          ? manifest.terminalContract.finishPostimageSha256
          : index === 0 ? null : (index + 2).toString(16).repeat(64),
      g014Root: (index < 3 ? 'a' : index === 3 ? 'b' : 'c').repeat(64),
      ledgerRoot: (index + 1).toString(16).repeat(64),
      ownerAuthorityReady: true,
      reviewItems: 0,
      reviewPolicyEnabled: false,
      reviewRuns: 0,
      schemaRoot: (index + 3).toString(16).repeat(64),
      serverMajor: 17,
      sessionUser: 'postgres',
      storageRoot: (index + 4).toString(16).repeat(64),
      terminalContractReady: index === 11,
    },
  }));
}

function admission() {
  const stages = stageStates();
  const writerFences = Object.fromEntries(Object.entries(manifest.requiredWriterFences).map(
    ([key, state], index) => [key, { evidenceSha256: (index + 8).toString(16).repeat(64), state }],
  ));
  return {
    applyEvidenceMapSha256: '6'.repeat(64),
    applyQuiescenceReadbackSha256: '7'.repeat(64),
    attemptId: '123e4567-e89b-42d3-a456-426614174000',
    createdAt: '2026-10-12T07:59:00.000Z',
    expiresAt: '2026-10-12T08:10:00.000Z',
    id: manifest.id,
    journalPathSha256: 'f'.repeat(64),
    manifestSha256: record.manifestSha256,
    projectRef: manifest.projectRef,
    protectedMainReceiptSha256: '1'.repeat(64),
    purpose: manifest.purpose,
    rehearsalAdmissionSha256: '6'.repeat(64),
    rehearsalJournalSha256: '5'.repeat(64),
    rehearsalReceiptSha256: '2'.repeat(64),
    rollback: { ...structuredClone(rollback), readbackSha256: '3'.repeat(64) },
    schemaVersion: 1,
    sourceReceiptSha256: '4'.repeat(64),
    sourceRevision: revision,
    sourceRoot: manifest.sourceRoot,
    stageStates: stages,
    writerFences,
  };
}

function custodyFiles(document = admission()) {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-review-successor-'));
  directories.push(directory);
  chmodSync(directory, 0o700);
  const admissionPath = join(directory, 'admission.json');
  const journalPath = join(directory, 'attempt.jsonl');
  const rehearsalJournalPath = join(directory, 'rehearsal-journal.jsonl');
  document.journalPathSha256 = sha256(journalPath);
  const common = {
    schemaVersion: 1,
    id: document.id,
    projectRef: document.projectRef,
    purpose: document.purpose,
    manifestSha256: document.manifestSha256,
    sourceRevision: document.sourceRevision,
    observedAt: document.createdAt,
    expiresAt: document.expiresAt,
  };
  const rehearsalAttemptId = '123e4567-e89b-42d3-a456-426614174001';
  let rehearsalAdmissionSha256 = '';
  const receipts: Record<string, any> = {
    'source-receipt.json': { ...common, kind: 'successor-source-receipt', sourceRoot: document.sourceRoot },
    'protected-main-receipt.json': {
      ...common,
      kind: 'protected-main-readback-receipt',
      ref: manifest.protectedSource.ref,
      remote: manifest.protectedSource.remote,
      repositoryUrl: manifest.protectedSource.repositoryUrl,
      revision: document.sourceRevision,
    },
    'rehearsal-receipt.json': {
      ...common,
      admissionSha256: rehearsalAdmissionSha256,
      attemptId: rehearsalAttemptId,
      kind: 'successor-rehearsal-receipt',
      journalPathSha256: sha256(rehearsalJournalPath),
      observedAt: new Date(Date.parse(document.createdAt) - 60_000).toISOString(),
      passed: true,
      preflightStateSha256: sha256(JSON.stringify(canonical(document.stageStates[0]))),
      restoredStateSha256: sha256(JSON.stringify(canonical(document.stageStates[0]))),
      serverVersionNum: 170006,
      sourceRoot: document.sourceRoot,
      stageStates: document.stageStates,
      stageStatesSha256: sha256(JSON.stringify(canonical(document.stageStates))),
      suffixRoot: elevenMigrationBundleSuffixRoot(manifest.migrations),
    },
    'rollback-readback-receipt.json': {
      ...common,
      kind: 'rollback-readback-receipt',
      deploymentId: document.rollback.deploymentId,
      deploymentSha: document.rollback.deploymentSha,
      deploymentUrl: document.rollback.deploymentUrl,
      gitRef: document.rollback.gitRef,
      productionAliases: document.rollback.productionAliases,
      projectId: document.rollback.projectId,
      readyState: document.rollback.readyState,
      repository: document.rollback.repository,
      state: document.rollback.state,
      target: document.rollback.target,
      teamId: document.rollback.teamId,
    },
  };
  document.sourceReceiptSha256 = sha256(canonicalBytes(receipts['source-receipt.json']));
  document.protectedMainReceiptSha256 = sha256(canonicalBytes(receipts['protected-main-receipt.json']));
  document.rehearsalReceiptSha256 = sha256(canonicalBytes(receipts['rehearsal-receipt.json']));
  const rehearsalJournal = [
    {
      admissionSha256: rehearsalAdmissionSha256,
      attemptId: rehearsalAttemptId,
      event: 'started',
      manifestSha256: document.manifestSha256,
      sourceRevision: document.sourceRevision,
      sourceRoot: document.sourceRoot,
      startedAt: new Date(Date.parse(document.createdAt) - 120_000).toISOString(),
    },
    {
      admissionSha256: rehearsalAdmissionSha256,
      attemptId: rehearsalAttemptId,
      code: 'SUCCESSOR_REHEARSAL_VERIFIED',
      event: 'verification',
      manifestSha256: document.manifestSha256,
      receiptSha256: document.rehearsalReceiptSha256,
      sourceRevision: document.sourceRevision,
      sourceRoot: document.sourceRoot,
      verifiedAt: new Date(Date.parse(document.createdAt) - 60_000).toISOString(),
    },
    {
      admissionSha256: rehearsalAdmissionSha256,
      attemptId: rehearsalAttemptId,
      code: 'SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED',
      event: 'publication',
      manifestSha256: document.manifestSha256,
      publishedAt: new Date(Date.parse(document.createdAt) - 30_000).toISOString(),
      receiptSha256: document.rehearsalReceiptSha256,
      sourceRevision: document.sourceRevision,
      sourceRoot: document.sourceRoot,
    },
  ];
  const rehearsalJournalBytes = Buffer.from(rehearsalJournal
    .map(entry => JSON.stringify(canonical(entry)))
    .join('\n') + '\n');
  document.rehearsalJournalSha256 = sha256(rehearsalJournalBytes);
  document.rollback.readbackSha256 = sha256(canonicalBytes(receipts['rollback-readback-receipt.json']));
  for (const [key, state] of Object.entries(manifest.requiredWriterFences)) {
    const name = `writer-fence-${key}.json`;
    receipts[name] = { ...common, fence: key, kind: 'writer-fence-readback-receipt', state };
  }
  const attestation = {
    assertedAt: document.createdAt,
    authority: 'authenticated-repository-owner-workflow-dispatch',
    basis: 'standing-custody-confirmation-bound-by-owner-dispatch',
    event: 'workflow_dispatch',
    fences: {
      browserRpc: 'stopped', dashboard: 'stopped', directSql: 'stopped', providerIngress: 'stopped',
    },
    kind: 'review-media-successor-operator-custody-attestation',
    noticeState: 'not-issued',
    operatorRole: 'repository-owner',
    repository: 'twoimo/tzudong',
    runAttempt: '1',
    runId: '42',
    schemaVersion: 1,
    scope: 'stopped-until-application-result',
    sourceRevision: document.sourceRevision,
    workflowRef: 'twoimo/tzudong/.github/workflows/review-media-sql-successor.yml@refs/heads/main',
  };
  const bundle = {
    adminRecordMutationsHold: {
      commit: document.sourceRevision,
      deploymentId: document.rollback.deploymentId,
      holdActive: true,
      observedAt: document.createdAt,
    },
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
    kind: 'review-media-successor-vercel-operating-bundle',
    manifestSha256: document.manifestSha256,
    protectedMain: {},
    rollbackPolicy: {},
    rollbackReadback: {
      deploymentId: document.rollback.deploymentId,
      gitSha: document.rollback.deploymentSha,
    },
    schemaVersion: 1,
    sourceRevision: document.sourceRevision,
    sourceRoot: document.sourceRoot,
    storyboardPolicy: {
      deployment: {
        branch: 'main',
        deploymentId: document.rollback.deploymentId,
        sourceCommit: document.sourceRevision,
      },
      policy: { canonicalPolicySha256: 'c'.repeat(64) },
      schemaVersion: 1,
    },
  };
  const inFlightQuiescence = {
    coverage: [
      'pipeline_control.admin_record_media_cleanup',
      'pipeline_control.admin_record_operations',
      'public.reviews',
      'storage.objects',
    ],
    inFlightWriters: 0,
    lockMode: 'SHARE',
    observedAt: document.createdAt,
  };
  const machine = {
    adminRuntimeHold: {
      deploymentId: document.rollback.deploymentId,
      holdActive: true,
      observedAt: document.createdAt,
    },
    automaticReviewer: { observedAt: document.createdAt, state: 'stopped' },
    g037WriteFreeze: { observedAt: document.createdAt, state: 'active' },
    inFlightQuiescence,
    kind: 'review-media-successor-machine-operating-observations',
    schemaVersion: 1,
    sourceRevision: document.sourceRevision,
  };
  const quiescence = {
    ...common,
    ...inFlightQuiescence,
    kind: 'apply-in-flight-quiescence-readback',
  };
  receipts['operator-custody-attestation.json'] = attestation;
  receipts['vercel-operating-bundle.json'] = bundle;
  receipts['apply-machine-operating-observations.json'] = machine;
  receipts['apply-quiescence-readback.json'] = quiescence;
  const attestationSha256 = sha256(canonicalBytes(attestation));
  const bundleSha256 = sha256(canonicalBytes(bundle));
  const machineSha256 = sha256(canonicalBytes(machine));
  const receiptProvenance: Record<string, any> = {};
  for (const [key, state] of Object.entries(manifest.requiredWriterFences)) {
    const name = `apply-writer-fence-${key}.json`;
    const operator = ['browserRpc', 'dashboard', 'directSql', 'providerIngress'].includes(key);
    receipts[name] = { ...common, fence: key, kind: 'writer-fence-readback-receipt', state };
    document.writerFences[key].evidenceSha256 = sha256(canonicalBytes(receipts[name]));
    receiptProvenance[key] = {
      evidenceSha256: operator
        ? attestationSha256
        : key === 'adminRecordMutationsHold' ? bundleSha256 : machineSha256,
      provenance: operator
        ? 'authenticated-owner-custody-commitment'
        : key === 'adminRecordMutationsHold'
          ? 'immutable-deployment-machine-observation'
          : 'fresh-machine-observation',
      receiptSha256: document.writerFences[key].evidenceSha256,
    };
  }
  const evidenceMap = {
    attestationSha256,
    bundleSha256,
    kind: 'review-media-successor-apply-operating-evidence-map',
    machineSha256,
    quiescenceSha256: sha256(canonicalBytes(quiescence)),
    receiptProvenance,
    schemaVersion: 1,
    sourceRevision: document.sourceRevision,
  };
  receipts['apply-operating-evidence-map.json'] = evidenceMap;
  document.applyEvidenceMapSha256 = sha256(canonicalBytes(evidenceMap));
  document.applyQuiescenceReadbackSha256 = evidenceMap.quiescenceSha256;
  const storedRehearsalAdmission = {
    ...rehearsalAdmission(),
    attemptId: rehearsalAttemptId,
    createdAt: new Date(Math.max(
      Date.parse(document.createdAt) - 120_000, Date.parse(document.expiresAt) - 15 * 60_000,
    )).toISOString(),
    expiresAt: document.expiresAt,
    journalPathSha256: sha256(rehearsalJournalPath),
    receiptPathSha256: sha256(join(directory, 'rehearsal-receipt.json')),
    protectedMainReceiptSha256: document.protectedMainReceiptSha256,
    rollback: structuredClone(document.rollback),
    sourceReceiptSha256: document.sourceReceiptSha256,
    writerFences: structuredClone(document.writerFences),
  };
  const storedRehearsalBytes = canonicalBytes(storedRehearsalAdmission);
  rehearsalAdmissionSha256 = sha256(storedRehearsalBytes);
  document.rehearsalAdmissionSha256 = rehearsalAdmissionSha256;
  receipts['rehearsal-receipt.json'].admissionSha256 = rehearsalAdmissionSha256;
  document.rehearsalReceiptSha256 = sha256(canonicalBytes(receipts['rehearsal-receipt.json']));
  for (const entry of rehearsalJournal) {
    entry.admissionSha256 = rehearsalAdmissionSha256;
    if ('receiptSha256' in entry) entry.receiptSha256 = document.rehearsalReceiptSha256;
  }
  const boundJournalBytes = Buffer.from(`${rehearsalJournal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`);
  document.rehearsalJournalSha256 = sha256(boundJournalBytes);
  writeFileSync(join(directory, 'rehearsal-admission.json'), storedRehearsalBytes, { mode: 0o600 });
  for (const [name, receipt] of Object.entries(receipts)) {
    const path = join(directory, name);
    writeFileSync(path, canonicalBytes(receipt), { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  writeFileSync(rehearsalJournalPath, boundJournalBytes, { mode: 0o600 });
  chmodSync(rehearsalJournalPath, 0o600);
  writeFileSync(admissionPath, canonicalBytes(document), { mode: 0o600 });
  chmodSync(admissionPath, 0o600);
  return { admissionPath, directory, document, journalPath, rehearsalJournalPath };
}

function rehashApplyOperatingEvidence(files: ReturnType<typeof custodyFiles>) {
  const attestationBytes = readFileSync(join(files.directory, 'operator-custody-attestation.json'));
  const bundleBytes = readFileSync(join(files.directory, 'vercel-operating-bundle.json'));
  const machineBytes = readFileSync(join(files.directory, 'apply-machine-operating-observations.json'));
  const quiescenceBytes = readFileSync(join(files.directory, 'apply-quiescence-readback.json'));
  const mapPath = join(files.directory, 'apply-operating-evidence-map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  map.attestationSha256 = sha256(attestationBytes);
  map.bundleSha256 = sha256(bundleBytes);
  map.machineSha256 = sha256(machineBytes);
  map.quiescenceSha256 = sha256(quiescenceBytes);
  for (const key of Object.keys(manifest.requiredWriterFences)) {
    const receiptBytes = readFileSync(join(files.directory, `apply-writer-fence-${key}.json`));
    files.document.writerFences[key].evidenceSha256 = sha256(receiptBytes);
    map.receiptProvenance[key].receiptSha256 = sha256(receiptBytes);
    map.receiptProvenance[key].evidenceSha256 = [
      'browserRpc', 'dashboard', 'directSql', 'providerIngress',
    ].includes(key)
      ? map.attestationSha256
      : key === 'adminRecordMutationsHold'
        ? map.bundleSha256
        : map.machineSha256;
  }
  const mapBytes = canonicalBytes(map);
  writeFileSync(mapPath, mapBytes, { mode: 0o600 });
  files.document.applyEvidenceMapSha256 = sha256(mapBytes);
  files.document.applyQuiescenceReadbackSha256 = sha256(quiescenceBytes);
}

function rewriteRehearsalTimeline(files: ReturnType<typeof custodyFiles>, {
  expiresAt = files.document.expiresAt,
  observedAt,
  publishedAt,
  startedAt,
  verifiedAt,
}: {
  expiresAt?: string;
  observedAt: string;
  publishedAt: string;
  startedAt: string;
  verifiedAt: string;
}) {
  const receiptPath = join(files.directory, 'rehearsal-receipt.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.expiresAt = expiresAt;
  receipt.observedAt = observedAt;
  const receiptBytes = canonicalBytes(receipt);
  writeFileSync(receiptPath, receiptBytes, { mode: 0o600 });
  files.document.rehearsalReceiptSha256 = sha256(receiptBytes);

  const journal = readFileSync(files.rehearsalJournalPath, 'utf8').trim().split('\n').map(JSON.parse);
  journal[0].startedAt = startedAt;
  journal[1].verifiedAt = verifiedAt;
  journal[1].receiptSha256 = files.document.rehearsalReceiptSha256;
  journal[2].publishedAt = publishedAt;
  journal[2].receiptSha256 = files.document.rehearsalReceiptSha256;
  const journalBytes = Buffer.from(`${journal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`);
  writeFileSync(files.rehearsalJournalPath, journalBytes, { mode: 0o600 });
  files.document.rehearsalJournalSha256 = sha256(journalBytes);

  const freshObservedAt = new Date(Date.parse(publishedAt) + 1_000).toISOString();
  const machinePath = join(files.directory, 'apply-machine-operating-observations.json');
  const machine = JSON.parse(readFileSync(machinePath, 'utf8'));
  machine.automaticReviewer.observedAt = freshObservedAt;
  machine.g037WriteFreeze.observedAt = freshObservedAt;
  machine.inFlightQuiescence.observedAt = freshObservedAt;
  const machineBytes = canonicalBytes(machine);
  writeFileSync(machinePath, machineBytes, { mode: 0o600 });

  const quiescencePath = join(files.directory, 'apply-quiescence-readback.json');
  const quiescence = JSON.parse(readFileSync(quiescencePath, 'utf8'));
  quiescence.observedAt = freshObservedAt;
  const quiescenceBytes = canonicalBytes(quiescence);
  writeFileSync(quiescencePath, quiescenceBytes, { mode: 0o600 });

  for (const key of ['automaticReviewer', 'g037WriteFreeze']) {
    const fencePath = join(files.directory, `apply-writer-fence-${key}.json`);
    const fence = JSON.parse(readFileSync(fencePath, 'utf8'));
    fence.observedAt = freshObservedAt;
    const fenceBytes = canonicalBytes(fence);
    writeFileSync(fencePath, fenceBytes, { mode: 0o600 });
  }
  rehashApplyOperatingEvidence(files);
}

function rebindRehearsalEvidence(files: ReturnType<typeof custodyFiles>, stored: any) {
  const admissionBytes = canonicalBytes(stored);
  writeFileSync(join(files.directory, 'rehearsal-admission.json'), admissionBytes, { mode: 0o600 });
  const digest = sha256(admissionBytes);
  const receiptPath = join(files.directory, 'rehearsal-receipt.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  Object.assign(receipt, { admissionSha256: digest, attemptId: stored.attemptId });
  const receiptBytes = canonicalBytes(receipt);
  writeFileSync(receiptPath, receiptBytes, { mode: 0o600 });
  files.document.rehearsalReceiptSha256 = sha256(receiptBytes);
  const journal = readFileSync(files.rehearsalJournalPath, 'utf8').trim().split('\n').map(JSON.parse);
  for (const entry of journal) {
    entry.admissionSha256 = digest;
    entry.attemptId = stored.attemptId;
    if ('receiptSha256' in entry) entry.receiptSha256 = files.document.rehearsalReceiptSha256;
  }
  const journalBytes = Buffer.from(`${journal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`);
  writeFileSync(files.rehearsalJournalPath, journalBytes, { mode: 0o600 });
  files.document.rehearsalJournalSha256 = sha256(journalBytes);
  return digest;
}

function rehearsalAdmission() {
  const writerFences = Object.fromEntries(Object.entries(manifest.requiredWriterFences).map(
    ([key, state], index) => [key, { evidenceSha256: (index + 8).toString(16).repeat(64), state }],
  ));
  return {
    attemptId: '123e4567-e89b-42d3-a456-426614174001',
    createdAt: '2026-10-12T07:59:00.000Z',
    expiresAt: '2026-10-12T08:10:00.000Z',
    id: manifest.id,
    journalPathSha256: 'f'.repeat(64),
    kind: 'successor-rehearsal-admission',
    manifestSha256: record.manifestSha256,
    projectRef: manifest.projectRef,
    protectedMainReceiptSha256: '1'.repeat(64),
    purpose: manifest.purpose,
    receiptPathSha256: '2'.repeat(64),
    rollback: { ...structuredClone(rollback), readbackSha256: '3'.repeat(64) },
    schemaVersion: 1,
    sourceReceiptSha256: '4'.repeat(64),
    sourceRevision: revision,
    sourceRoot: manifest.sourceRoot,
    writerFences,
  };
}

function rehearsalCustodyFiles(document = rehearsalAdmission()) {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-review-rehearsal-'));
  directories.push(directory);
  chmodSync(directory, 0o700);
  const admissionPath = join(directory, 'rehearsal-admission.json');
  const journalPath = join(directory, 'rehearsal-journal.jsonl');
  const receiptPath = join(directory, 'rehearsal-receipt.json');
  const pendingReceiptPath = `${receiptPath}.${document.attemptId}.pending`;
  document.journalPathSha256 = sha256(journalPath);
  document.receiptPathSha256 = sha256(receiptPath);
  const common = {
    schemaVersion: 1,
    id: document.id,
    projectRef: document.projectRef,
    purpose: document.purpose,
    manifestSha256: document.manifestSha256,
    sourceRevision: document.sourceRevision,
    observedAt: document.createdAt,
    expiresAt: document.expiresAt,
  };
  const receipts: Record<string, any> = {
    'source-receipt.json': { ...common, kind: 'successor-source-receipt', sourceRoot: document.sourceRoot },
    'protected-main-receipt.json': {
      ...common,
      kind: 'protected-main-readback-receipt',
      ref: manifest.protectedSource.ref,
      remote: manifest.protectedSource.remote,
      repositoryUrl: manifest.protectedSource.repositoryUrl,
      revision: document.sourceRevision,
    },
    'rollback-readback-receipt.json': {
      ...common,
      kind: 'rollback-readback-receipt',
      deploymentId: document.rollback.deploymentId,
      deploymentSha: document.rollback.deploymentSha,
      deploymentUrl: document.rollback.deploymentUrl,
      gitRef: document.rollback.gitRef,
      productionAliases: document.rollback.productionAliases,
      projectId: document.rollback.projectId,
      readyState: document.rollback.readyState,
      repository: document.rollback.repository,
      state: document.rollback.state,
      target: document.rollback.target,
      teamId: document.rollback.teamId,
    },
  };
  document.sourceReceiptSha256 = sha256(canonicalBytes(receipts['source-receipt.json']));
  document.protectedMainReceiptSha256 = sha256(canonicalBytes(receipts['protected-main-receipt.json']));
  document.rollback.readbackSha256 = sha256(canonicalBytes(receipts['rollback-readback-receipt.json']));
  for (const [key, state] of Object.entries(manifest.requiredWriterFences)) {
    const name = `writer-fence-${key}.json`;
    receipts[name] = { ...common, fence: key, kind: 'writer-fence-readback-receipt', state };
    document.writerFences[key].evidenceSha256 = sha256(canonicalBytes(receipts[name]));
  }
  for (const [name, receipt] of Object.entries(receipts)) {
    const path = join(directory, name);
    writeFileSync(path, canonicalBytes(receipt), { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  writeFileSync(admissionPath, canonicalBytes(document), { mode: 0o600 });
  chmodSync(admissionPath, 0o600);
  return { admissionPath, directory, document, journalPath, pendingReceiptPath, receiptPath };
}

function rehearsalReadback(state = stageStates()[0]) {
  return JSON.stringify({
    kind: 'successor-rehearsal-readback',
    serverVersionNum: 170006,
    state,
  });
}

function rehearsalStageOutput(stages = stageStates()) {
  return stages.map((state, index) => JSON.stringify({
    index,
    kind: 'successor-rehearsal-stage',
    serverVersionNum: 170006,
    state,
  })).join('\n');
}

function rollbackReadback(now = fixedNow) {
  return {
    schemaVersion: 1,
    kind: 'vercel-rollback-readback',
    projectId: rollback.projectId,
    teamId: rollback.teamId,
    deploymentId: rollback.deploymentId,
    deploymentUrl: rollback.deploymentUrl,
    readyState: rollback.readyState,
    target: rollback.target,
    repository: rollback.repository,
    gitSha: rollback.deploymentSha,
    gitRef: rollback.gitRef,
    productionAliases: [...rollback.productionAliases],
    observedAt: now.toISOString(),
  };
}

test('manifest binds the exact eleven sources and remains held without fresh admission', () => {
  const loaded = loadSuccessorManifest();
  expect(loaded.manifest.migrations).toHaveLength(11);
  expect(loaded.manifest.toolchain[0].path).toBe('apps/web/scripts/review-media-sql-successor.mjs');
  expect(loaded.manifest.operatingTransition).toEqual({ beforeEleven: 86, afterEleven: 97 });
  expect(loaded.manifest.launchPolicy.state).toBe('held');
  expect(loaded.manifest.sourceRoot).toBe('61f9d7637c0714a7b0d9108c6f7959ea820175a7870dba681498b570296a1544');
  expect(() => loadSuccessorManifest({ readVectorImpl: () => ['drift'] })).toThrow('SUCCESSOR_SOURCE_DRIFT');
});

test('rehearsal CLI requires one admission, journal and receipt path', () => {
  expect(parseRehearsalArguments([
    '--admission', '/private/admission.json',
    '--journal', '/private/journal.jsonl',
    '--receipt', '/private/rehearsal-receipt.json',
  ])).toEqual({
    admission: '/private/admission.json',
    journal: '/private/journal.jsonl',
    receipt: '/private/rehearsal-receipt.json',
  });
  expect(() => parseRehearsalArguments(['--admission', '/private/admission.json'])).toThrow(
    'SUCCESSOR_REHEARSAL_ARGUMENT_INVALID',
  );
  expect(() => parseRehearsalArguments([
    '--admission', '/private/admission.json',
    '--admission', '/private/duplicate.json',
    '--receipt', '/private/rehearsal-receipt.json',
  ])).toThrow('SUCCESSOR_REHEARSAL_ARGUMENT_INVALID');
});

test('compiled plan has one advisory lock, one outer transaction and eleven ledger writes', () => {
  const admitted = admission();
  const plan = compileSuccessorPlan(executableRecord, admitted);
  expect(plan.transactionMode).toBe('single-outer-transaction');
  expect(plan.sql.match(/pg_advisory_xact_lock\(7311754282260211::bigint\)/g)).toHaveLength(1);
  expect(plan.sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(plan.sql.match(/SUCCESSOR_ADMISSION_EXPIRED/g)).toHaveLength(13);
  expect(plan.sql.match(/set_config\('transaction_timeout'/g)).toHaveLength(1);
  expect(plan.sql).toContain('transaction_timestamp()');
  expect(plan.sql.match(new RegExp(SUCCESSOR_PRE_COMMIT_EXPIRY_MARKER, 'g'))).toHaveLength(1);
  expect(statementSpans(plan.sql).some(span => /^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(span.token))).toBe(false);
  const lockTimeout = plan.sql.indexOf("SET LOCAL lock_timeout='2s'");
  const statementTimeout = plan.sql.indexOf("SET LOCAL statement_timeout='15s'");
  const advisoryLock = plan.sql.indexOf('pg_advisory_xact_lock(7311754282260211::bigint)');
  const expiryCheck = plan.sql.indexOf('SUCCESSOR_ADMISSION_EXPIRED');
  const firstMigration = plan.sql.indexOf('INSERT INTO supabase_migrations.schema_migrations');
  expect(lockTimeout).toBeGreaterThanOrEqual(0);
  expect(statementTimeout).toBeGreaterThan(lockTimeout);
  expect(advisoryLock).toBeGreaterThan(statementTimeout);
  expect(expiryCheck).toBeGreaterThan(advisoryLock);
  expect(firstMigration).toBeGreaterThan(expiryCheck);
  const ledgerWrites = [...plan.sql.matchAll(/INSERT INTO supabase_migrations\.schema_migrations/g)]
    .map(match => match.index ?? -1);
  const expiryChecks = [...plan.sql.matchAll(/SUCCESSOR_ADMISSION_EXPIRED/g)]
    .map(match => match.index ?? -1);
  ledgerWrites.forEach((writeAt, index) => {
    expect(expiryChecks[index + 1]).toBeGreaterThan(writeAt);
    if (index + 1 < ledgerWrites.length) expect(expiryChecks[index + 1]).toBeLessThan(ledgerWrites[index + 1]);
  });
  const preCommitMarker = plan.sql.indexOf(SUCCESSOR_PRE_COMMIT_EXPIRY_MARKER);
  expect(preCommitMarker).toBeGreaterThan(ledgerWrites.at(-1) ?? -1);
  expect(expiryChecks.at(-1) ?? -1).toBeGreaterThan(preCommitMarker);
  expect(statementSpans(plan.sql).at(-1)?.token).toContain('SUCCESSOR_ADMISSION_EXPIRED');
  expect(plan.sql).toContain(`clock_timestamp() >= '${admitted.expiresAt}'::timestamptz`);
  expect(plan.stateQuery).toContain('terminalContractReady');
  expect(plan.stateQuery).toContain(manifest.terminalContract.finishPostimageSha256);
  expect(plan.stateQuery).toContain("c.relkind IN('v','m') THEN pg_get_viewdef(c.oid,true)");
  expect(plan.stateQuery).toContain("unnest(coalesce(c.reloptions,'{}'))");
  expect(plan.stateQuery).toContain("unnest(coalesce(a.attacl,'{}'))");
  expect(plan.stateQuery).toContain('m.inherit_option,m.set_option');
  const storageState = plan.stateQuery.slice(
    plan.stateQuery.indexOf('storage_material AS'),
    plan.stateQuery.indexOf('contract AS'),
  );
  expect(storageState).toContain('lifecycle_configuration_generation');
  expect(storageState).not.toContain('created_at');
  expect(storageState).not.toContain('updated_at');
});

test('apply accepts rehearsal evidence completed after thirty seconds within its original lease', () => {
  const document = admission();
  document.createdAt = '2026-10-12T07:55:00.000Z';
  document.expiresAt = '2026-10-12T08:10:00.000Z';
  const files = custodyFiles(document);
  rewriteRehearsalTimeline(files, {
    startedAt: '2026-10-12T07:55:00.000Z',
    observedAt: '2026-10-12T08:08:00.000Z',
    verifiedAt: '2026-10-12T08:08:05.000Z',
    publishedAt: '2026-10-12T08:08:10.000Z',
  });
  const rehearsalAdmissionDocument = JSON.parse(readFileSync(
    join(files.directory, 'rehearsal-admission.json'),
    'utf8',
  ));
  for (const key of [
    'adminRecordMutationsHold', 'browserRpc', 'dashboard', 'directSql', 'providerIngress',
  ]) {
    expect(files.document.writerFences[key]).toEqual(rehearsalAdmissionDocument.writerFences[key]);
  }
  for (const key of ['automaticReviewer', 'g037WriteFreeze']) {
    expect(files.document.writerFences[key].state)
      .toBe(rehearsalAdmissionDocument.writerFences[key].state);
    expect(files.document.writerFences[key].evidenceSha256)
      .not.toBe(rehearsalAdmissionDocument.writerFences[key].evidenceSha256);
  }
  expect(validateSuccessorAdmission(files.document, executableRecord, {
    now: new Date('2026-10-12T08:09:00.000Z'),
    receiptDirectory: files.directory,
  })).toMatchObject({
    createdAt: Date.parse(document.createdAt),
    expiresAt: Date.parse(document.expiresAt),
  });
});

test('apply rejects rehearsal evidence outside the original fifteen-minute lease', () => {
  const document = admission();
  document.createdAt = '2026-10-12T07:55:00.000Z';
  document.expiresAt = '2026-10-12T08:10:00.000Z';
  const files = custodyFiles(document);
  rewriteRehearsalTimeline(files, {
    startedAt: '2026-10-12T07:54:59.999Z',
    observedAt: '2026-10-12T08:08:00.000Z',
    verifiedAt: '2026-10-12T08:08:05.000Z',
    publishedAt: '2026-10-12T08:08:10.000Z',
  });
  expect(() => validateSuccessorAdmission(files.document, executableRecord, {
    now: new Date('2026-10-12T08:09:00.000Z'),
    receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('apply rejects machine evidence observed before rehearsal publication even when rehashed', () => {
  const files = custodyFiles();
  const staleObservedAt = new Date(Date.parse(files.document.createdAt) - 31_000).toISOString();
  const machinePath = join(files.directory, 'apply-machine-operating-observations.json');
  const machine = JSON.parse(readFileSync(machinePath, 'utf8'));
  machine.automaticReviewer.observedAt = staleObservedAt;
  machine.g037WriteFreeze.observedAt = staleObservedAt;
  machine.inFlightQuiescence.observedAt = staleObservedAt;
  writeFileSync(machinePath, canonicalBytes(machine), { mode: 0o600 });
  const quiescencePath = join(files.directory, 'apply-quiescence-readback.json');
  const quiescence = JSON.parse(readFileSync(quiescencePath, 'utf8'));
  quiescence.observedAt = staleObservedAt;
  writeFileSync(quiescencePath, canonicalBytes(quiescence), { mode: 0o600 });
  for (const key of ['automaticReviewer', 'g037WriteFreeze']) {
    const path = join(files.directory, `apply-writer-fence-${key}.json`);
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    receipt.observedAt = staleObservedAt;
    writeFileSync(path, canonicalBytes(receipt), { mode: 0o600 });
  }
  rehashApplyOperatingEvidence(files);
  expect(() => validateSuccessorAdmission(files.document, executableRecord, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('apply rejects a changed deployment in fresh machine evidence even when rehashed', () => {
  const files = custodyFiles();
  const machinePath = join(files.directory, 'apply-machine-operating-observations.json');
  const machine = JSON.parse(readFileSync(machinePath, 'utf8'));
  machine.adminRuntimeHold.deploymentId = 'dpl_ChangedDuringRehearsal123';
  writeFileSync(machinePath, canonicalBytes(machine), { mode: 0o600 });
  rehashApplyOperatingEvidence(files);
  expect(() => validateSuccessorAdmission(files.document, executableRecord, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('apply rejects a rehashed storyboard runtime deployment mismatch', () => {
  const files = custodyFiles();
  const bundlePath = join(files.directory, 'vercel-operating-bundle.json');
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  bundle.storyboardPolicy.deployment.deploymentId = 'dpl_ChangedStoryboardRuntime123';
  writeFileSync(bundlePath, canonicalBytes(bundle), { mode: 0o600 });
  rehashApplyOperatingEvidence(files);
  expect(() => validateSuccessorAdmission(files.document, executableRecord, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('apply rejects a fence timestamp relabeled as fresh when its machine provenance is older', () => {
  const files = custodyFiles();
  const path = join(files.directory, 'apply-writer-fence-automaticReviewer.json');
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  receipt.observedAt = new Date(Date.parse(receipt.observedAt) + 1_000).toISOString();
  writeFileSync(path, canonicalBytes(receipt), { mode: 0o600 });
  rehashApplyOperatingEvidence(files);
  expect(() => validateSuccessorAdmission(files.document, executableRecord, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('apply rejects a post-admission fence receipt tamper before database transport', () => {
  const files = custodyFiles();
  const path = join(files.directory, 'apply-writer-fence-automaticReviewer.json');
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  receipt.observedAt = new Date(Date.parse(receipt.observedAt) + 1).toISOString();
  writeFileSync(path, canonicalBytes(receipt), { mode: 0o600 });
  let transports = 0;
  expect(() => runReviewMediaSuccessor({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => executableRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => { transports += 1; return '{}'; },
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  expect(transports).toBe(0);
});

test('actual psql runner with a spy transport preserves the post-lock expiry code', () => {
  let spawnCalls = 0;
  const runner = createSuccessorPsqlRunner(databaseUrl, {
    environment: {},
    psql: '/fixture/psql',
    spawnImpl: (command: string, args: string[], options: any) => {
      spawnCalls += 1;
      expect(command).toBe('/fixture/psql');
      expect(args).toContain('--file=-');
      expect(options.input).toContain('SUCCESSOR_ADMISSION_EXPIRED');
      return {
        status: 1,
        stderr: 'ERROR:  P0001: SUCCESSOR_ADMISSION_EXPIRED\n',
        stdout: '',
      };
    },
  });
  let observedCode = '';
  try {
    runner(databaseUrl, "DO $$ BEGIN RAISE EXCEPTION 'SUCCESSOR_ADMISSION_EXPIRED'; END $$;", false);
  } catch (error: any) {
    observedCode = error?.code;
  }
  expect(spawnCalls).toBe(1);
  expect(observedCode).toBe('SUCCESSOR_ADMISSION_EXPIRED');
});

test('rollback-only rehearsal plan owns one transaction and captures twelve safe stages', () => {
  const admitted = rehearsalAdmission();
  const stages = stageStates();
  const plan = compileSuccessorRehearsalPlan(record, admitted, stages[0]);
  expect(plan.transactionMode).toBe('explicit-rollback-only');
  expect(plan.sql.match(/^BEGIN;$/gm)).toHaveLength(1);
  expect(plan.sql.match(/^ROLLBACK;$/gm)).toHaveLength(1);
  expect(plan.sql.trim().endsWith('ROLLBACK;')).toBe(true);
  expect(plan.sql.match(/pg_advisory_xact_lock\(7311754282260211::bigint\)/g)).toHaveLength(1);
  expect(plan.sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(plan.sql.match(/'successor-rehearsal-stage'/g)).toHaveLength(12);
  expect(plan.sql.match(/^\\o \/dev\/null$/gm)).toHaveLength(11);
  expect(plan.sql.match(/^\\o$/gm)).toHaveLength(11);
  const lockTimeout = plan.sql.indexOf("SET LOCAL lock_timeout='2s'");
  const statementTimeout = plan.sql.indexOf("SET LOCAL statement_timeout='15s'");
  const advisoryLock = plan.sql.indexOf('pg_advisory_xact_lock(7311754282260211::bigint)');
  const expiryCheck = plan.sql.indexOf('SUCCESSOR_ADMISSION_EXPIRED');
  const baselineGuard = plan.sql.indexOf('SUCCESSOR_REHEARSAL_BASELINE_INVALID');
  expect(lockTimeout).toBeGreaterThanOrEqual(0);
  expect(statementTimeout).toBeGreaterThan(lockTimeout);
  expect(advisoryLock).toBeGreaterThan(statementTimeout);
  expect(expiryCheck).toBeGreaterThan(advisoryLock);
  expect(baselineGuard).toBeGreaterThan(expiryCheck);
  expect(plan.sql).toContain(`clock_timestamp() >= '${admitted.expiresAt}'::timestamptz`);
  expect(plan.sql).toContain(manifest.migrations[0].originalStatementVector[1]);
  expect(plan.sql).toContain(manifest.migrations.at(-1).originalStatementVector.at(-2));
  expect(compileSuccessorStateReadQuery(record).sql).toContain('successor-rehearsal-readback');
});

test('rehearsal admission is distinct and rejects stale source or any wrong writer fence', () => {
  {
    const files = rehearsalCustodyFiles();
    expect(validateSuccessorRehearsalAdmission(files.document, record, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toMatchObject({ expiresAt: Date.parse(files.document.expiresAt) });
  }
  {
    const files = rehearsalCustodyFiles();
    files.document.sourceRoot = '0'.repeat(64);
    expect(() => validateSuccessorRehearsalAdmission(files.document, record, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  for (const key of Object.keys(manifest.requiredWriterFences)) {
    const files = rehearsalCustodyFiles();
    files.document.writerFences[key].state = 'wrong';
    expect(() => validateSuccessorRehearsalAdmission(files.document, record, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
});

test('rehearsal rolls back, separately confirms restoration and emits an apply-bound receipt', () => {
  const files = rehearsalCustodyFiles();
  const calls: string[] = [];
  let rollbackReads = 0;
  const result = runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => { rollbackReads += 1; return rollbackReadback(); },
    runPsqlImpl: (_url, sql) => {
      calls.push(sql);
      if (calls.length === 2) return rehearsalStageOutput();
      return rehearsalReadback();
    },
  });
  expect(result).toMatchObject({
    code: 'SUCCESSOR_REHEARSAL_PASSED',
    publicationAuditReadback: 'confirmed',
    publicationReadback: 'confirmed',
    status: 'rolled_back',
  });
  expect(rollbackReads).toBe(2);
  expect(calls).toHaveLength(3);
  expect(calls[0]).toContain('READ ONLY');
  expect(calls[1].match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(calls[1].trim().endsWith('ROLLBACK;')).toBe(true);
  expect(calls[2]).toContain('READ ONLY');
  const receipt = JSON.parse(readFileSync(files.receiptPath, 'utf8'));
  expect(receipt.stageStates).toEqual(stageStates());
  expect(receipt.attemptId).toBe(files.document.attemptId);
  expect(receipt.admissionSha256).toBe(sha256(readFileSync(files.admissionPath)));
  expect(receipt.journalPathSha256).toBe(sha256(files.journalPath));
  expect(receipt.preflightStateSha256).toBe(receipt.restoredStateSha256);
  expect(receipt.stageStatesSha256).toBe(sha256(JSON.stringify(canonical(receipt.stageStates))));
  const journal = readFileSync(files.journalPath, 'utf8').trim().split('\n').map(JSON.parse);
  expect(journal).toHaveLength(3);
  expect(journal[1]).toMatchObject({
    admissionSha256: receipt.admissionSha256,
    attemptId: receipt.attemptId,
    code: 'SUCCESSOR_REHEARSAL_VERIFIED',
    event: 'verification',
    manifestSha256: record.manifestSha256,
    receiptSha256: result.receiptSha256,
    sourceRevision: revision,
    sourceRoot: manifest.sourceRoot,
  });
  expect(journal[2]).toMatchObject({
    admissionSha256: receipt.admissionSha256,
    attemptId: receipt.attemptId,
    code: 'SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED',
    event: 'publication',
    manifestSha256: record.manifestSha256,
    receiptSha256: result.receiptSha256,
    sourceRevision: revision,
    sourceRoot: manifest.sourceRoot,
  });
  expect(existsSync(files.pendingReceiptPath)).toBe(true);
});

test('lost rehearsal response performs restoration readback once and never resends', () => {
  const files = rehearsalCustodyFiles();
  const calls: string[] = [];
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: (_url, sql) => {
      calls.push(sql);
      if (calls.length === 2) throw new Error('lost response');
      return rehearsalReadback();
    },
  })).toThrow('SUCCESSOR_REHEARSAL_OUTCOME_UNCONFIRMED');
  expect(calls).toHaveLength(3);
  expect(calls.filter(sql => /INSERT INTO supabase_migrations\.schema_migrations/.test(sql))).toHaveLength(1);
  expect(() => readFileSync(files.receiptPath)).toThrow();
  expect(readFileSync(files.journalPath, 'utf8')).toContain('SUCCESSOR_REHEARSAL_OUTCOME_UNCONFIRMED');
});

test('post-lock rehearsal expiry keeps its exact bounded code after restoration readback', () => {
  const files = rehearsalCustodyFiles();
  let calls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      if (calls === 2) {
        throw Object.assign(new Error('provider diagnostic must not escape'), {
          code: 'SUCCESSOR_ADMISSION_EXPIRED',
        });
      }
      return rehearsalReadback();
    },
  })).toThrow('SUCCESSOR_ADMISSION_EXPIRED');
  expect(calls).toBe(3);
  const journal = readFileSync(files.journalPath, 'utf8');
  expect(journal).toContain('SUCCESSOR_ADMISSION_EXPIRED');
  expect(journal).not.toContain('SUCCESSOR_REHEARSAL_OUTCOME_UNCONFIRMED');
});

test('incomplete rehearsal output cannot create an apply admission receipt', () => {
  const files = rehearsalCustodyFiles();
  let calls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      if (calls === 2) return rehearsalStageOutput().split('\n').slice(0, 11).join('\n');
      return rehearsalReadback();
    },
  })).toThrow('SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
  expect(calls).toBe(3);
  expect(() => readFileSync(files.receiptPath)).toThrow();
});

test('verification line write-success then fsync-failure never publishes the canonical receipt', () => {
  const files = rehearsalCustodyFiles();
  let calls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    appendJournalImpl: (descriptor: number, entry: any) => {
      const bytes = Buffer.from(`${JSON.stringify(canonical(entry))}\n`);
      expect(writeSync(descriptor, bytes)).toBe(bytes.length);
      throw new Error('verification fsync failed after full write');
    },
  })).toThrow('SUCCESSOR_JOURNAL_APPEND_FAILED');
  expect(existsSync(files.receiptPath)).toBe(false);
  expect(JSON.parse(readFileSync(files.pendingReceiptPath, 'utf8')).passed).toBe(true);
  const orphanJournal = readFileSync(files.journalPath);
  const journalEntries = orphanJournal.toString('utf8').trim().split('\n').map(JSON.parse);
  expect(journalEntries).toHaveLength(2);
  expect(journalEntries[1]).toMatchObject({
    code: 'SUCCESSOR_REHEARSAL_VERIFIED',
    event: 'verification',
  });

  const applyFiles = custodyFiles();
  writeFileSync(applyFiles.rehearsalJournalPath, orphanJournal, { mode: 0o600 });
  applyFiles.document.rehearsalJournalSha256 = sha256(orphanJournal);
  expect(() => validateSuccessorAdmission(applyFiles.document, executableRecord, {
    now: fixedNow,
    receiptDirectory: applyFiles.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('pending receipt full-write then fsync-failure records failure without canonical publication', () => {
  const files = rehearsalCustodyFiles();
  let calls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    writePendingReceiptImpl: (path: string, receipt: any) => {
      const descriptor = openSync(path, 'wx', 0o600);
      const bytes = canonicalBytes(receipt);
      expect(writeSync(descriptor, bytes)).toBe(bytes.length);
      closeSync(descriptor);
      throw new Error('pending receipt fsync failed after full write');
    },
  })).toThrow('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
  expect(existsSync(files.receiptPath)).toBe(false);
  expect(JSON.parse(readFileSync(files.pendingReceiptPath, 'utf8')).passed).toBe(true);
  const journal = readFileSync(files.journalPath, 'utf8');
  expect(journal).toContain('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
  expect(journal).not.toContain('SUCCESSOR_REHEARSAL_VERIFIED');
  const applyFiles = custodyFiles();
  const failedJournal = Buffer.from(journal);
  writeFileSync(applyFiles.rehearsalJournalPath, failedJournal, { mode: 0o600 });
  applyFiles.document.rehearsalJournalSha256 = sha256(failedJournal);
  expect(() => validateSuccessorAdmission(applyFiles.document, executableRecord, {
    now: fixedNow,
    receiptDirectory: applyFiles.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('pending receipt storage delay cannot verify after the admission expires', () => {
  const document = rehearsalAdmission();
  const expiresAt = new Date(fixedNow.getTime() + 1_000);
  document.expiresAt = expiresAt.toISOString();
  const files = rehearsalCustodyFiles(document);
  let clock = fixedNow;
  let calls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => clock,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    writePendingReceiptImpl: (path: string, receipt: any) => {
      const descriptor = openSync(path, 'wx', 0o600);
      const bytes = canonicalBytes(receipt);
      expect(writeSync(descriptor, bytes)).toBe(bytes.length);
      fsyncSync(descriptor);
      closeSync(descriptor);
      clock = expiresAt;
    },
  })).toThrow('SUCCESSOR_ADMISSION_EXPIRED');
  expect(existsSync(files.pendingReceiptPath)).toBe(true);
  expect(existsSync(files.receiptPath)).toBe(false);
  const journal = readFileSync(files.journalPath, 'utf8');
  expect(journal).toContain('SUCCESSOR_ADMISSION_EXPIRED');
  expect(journal).not.toContain('SUCCESSOR_REHEARSAL_VERIFIED');
  expect(journal).not.toContain('SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED');
});

test('expiry terminal audit failure preserves the bounded rehearsal outcome', () => {
  const document = rehearsalAdmission();
  const expiresAt = new Date(fixedNow.getTime() + 1_000);
  document.expiresAt = expiresAt.toISOString();
  const files = rehearsalCustodyFiles(document);
  let clock = fixedNow;
  let calls = 0;
  let observed: any;
  try {
    runReviewMediaSuccessorRehearsal({
      admissionPath: files.admissionPath,
      journalPath: files.journalPath,
      receiptPath: files.receiptPath,
      environment: { SUPABASE_DB_URL: databaseUrl },
    }, {
      now: () => clock,
      gitFactsImpl: () => ({ clean: true, detached: true, revision }),
      loadManifestImpl: () => record,
      protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
      rollbackReadbackImpl: () => rollbackReadback(),
      runPsqlImpl: () => {
        calls += 1;
        return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
      },
      writePendingReceiptImpl: (path: string, receipt: any) => {
        writeFileSync(path, canonicalBytes(receipt), { flag: 'wx', mode: 0o600 });
        clock = expiresAt;
      },
      appendJournalImpl: () => { throw new Error('fixture expiry audit unavailable'); },
    });
  } catch (error) {
    observed = successorFailureResult(error);
  }
  expect(observed).toEqual({
    code: 'SUCCESSOR_JOURNAL_APPEND_FAILED',
    operationCode: 'SUCCESSOR_ADMISSION_EXPIRED',
    status: 'failed',
  });
  expect(existsSync(files.receiptPath)).toBe(false);
});

test('verification journal storage delay cannot publish after the admission expires', () => {
  const document = rehearsalAdmission();
  const expiresAt = new Date(fixedNow.getTime() + 1_000);
  document.expiresAt = expiresAt.toISOString();
  const files = rehearsalCustodyFiles(document);
  let clock = fixedNow;
  let calls = 0;
  let appendCalls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => clock,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    appendJournalImpl: (descriptor: number, entry: any, options: any) => {
      appendCalls += 1;
      const result = appendJournal(descriptor, entry, options);
      if (appendCalls === 1) clock = expiresAt;
      return result;
    },
  })).toThrow('SUCCESSOR_ADMISSION_EXPIRED');
  expect(appendCalls).toBe(2);
  expect(existsSync(files.pendingReceiptPath)).toBe(true);
  expect(existsSync(files.receiptPath)).toBe(false);
  const journal = readFileSync(files.journalPath, 'utf8');
  expect(journal).toContain('SUCCESSOR_REHEARSAL_VERIFIED');
  expect(journal).toContain('SUCCESSOR_ADMISSION_EXPIRED');
  expect(journal).not.toContain('SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED');
});

test('canonical publication storage delay cannot record an expired passed result', () => {
  const document = rehearsalAdmission();
  const expiresAt = new Date(fixedNow.getTime() + 1_000);
  document.expiresAt = expiresAt.toISOString();
  const files = rehearsalCustodyFiles(document);
  let clock = fixedNow;
  let calls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => clock,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    publishReceiptImpl: (pendingPath: string, receiptPath: string) => {
      linkSync(pendingPath, receiptPath);
      const directoryDescriptor = openSync(files.directory, 'r');
      fsyncSync(directoryDescriptor);
      closeSync(directoryDescriptor);
      clock = expiresAt;
    },
  })).toThrow('SUCCESSOR_ADMISSION_EXPIRED');
  expect(readFileSync(files.receiptPath)).toEqual(readFileSync(files.pendingReceiptPath));
  const journal = readFileSync(files.journalPath, 'utf8');
  expect(journal).toContain('SUCCESSOR_REHEARSAL_VERIFIED');
  expect(journal).toContain('SUCCESSOR_ADMISSION_EXPIRED');
  expect(journal).not.toContain('SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED');
});

test('publication journal completion cannot return passed after the admission expires', () => {
  const document = rehearsalAdmission();
  const expiresAt = new Date(fixedNow.getTime() + 1_000);
  document.expiresAt = expiresAt.toISOString();
  const files = rehearsalCustodyFiles(document);
  let clock = fixedNow;
  let calls = 0;
  let appendCalls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => clock,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    appendJournalImpl: (descriptor: number, entry: any, options: any) => {
      appendCalls += 1;
      const result = appendJournal(descriptor, entry, options);
      if (appendCalls === 2) clock = expiresAt;
      return result;
    },
  })).toThrow('SUCCESSOR_ADMISSION_EXPIRED');
  expect(appendCalls).toBe(2);
  expect(readFileSync(files.receiptPath)).toEqual(readFileSync(files.pendingReceiptPath));
  const journal = readFileSync(files.journalPath, 'utf8').trim().split('\n').map(JSON.parse);
  expect(journal).toHaveLength(3);
  expect(journal[2].code).toBe('SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED');
});

test('prepublication interruption leaves verified journal and pending receipt apply-invalid', () => {
  const files = rehearsalCustodyFiles();
  let calls = 0;
  let appendCalls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    appendJournalImpl: (descriptor: number, entry: any) => {
      appendCalls += 1;
      if (appendCalls > 1) throw new Error('interrupted before failure audit');
      const bytes = Buffer.from(`${JSON.stringify(canonical(entry))}\n`);
      expect(writeSync(descriptor, bytes)).toBe(bytes.length);
      fsyncSync(descriptor);
    },
    publishReceiptImpl: () => { throw new Error('interrupted before atomic publication'); },
  })).toThrow('SUCCESSOR_JOURNAL_APPEND_FAILED');
  expect(appendCalls).toBe(2);
  expect(existsSync(files.pendingReceiptPath)).toBe(true);
  expect(existsSync(files.receiptPath)).toBe(false);
  expect(readFileSync(files.journalPath, 'utf8')).toContain('SUCCESSOR_REHEARSAL_VERIFIED');
});

test('failed canonical publication is audited as failure, never as passed', () => {
  const files = rehearsalCustodyFiles();
  let calls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    publishReceiptImpl: () => { throw new Error('canonical publication failed'); },
  })).toThrow('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');
  expect(existsSync(files.pendingReceiptPath)).toBe(true);
  expect(existsSync(files.receiptPath)).toBe(false);
  const journal = readFileSync(files.journalPath, 'utf8');
  expect(journal).toContain('SUCCESSOR_REHEARSAL_VERIFIED');
  expect(journal).toContain('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');
  expect(journal).not.toContain('SUCCESSOR_REHEARSAL_PASSED');
});

test('pre-existing exact canonical bytes do not make an unperformed link durable', () => {
  const files = rehearsalCustodyFiles();
  let calls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    writePendingReceiptImpl: (pendingPath: string, receipt: any) => {
      const bytes = canonicalBytes(receipt);
      writeFileSync(pendingPath, bytes, { flag: 'wx', mode: 0o600 });
      writeFileSync(files.receiptPath, bytes, { flag: 'wx', mode: 0o600 });
    },
  })).toThrow('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');
  expect(readFileSync(files.receiptPath)).toEqual(readFileSync(files.pendingReceiptPath));
  const journal = readFileSync(files.journalPath, 'utf8');
  expect(journal).toContain('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');
  expect(journal).not.toContain('SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED');
});

test('unconfirmed directory durability cannot be reconciled from visible canonical bytes', () => {
  const files = rehearsalCustodyFiles();
  let calls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    publishReceiptImpl: (pendingPath: string, receiptPath: string) => {
      linkSync(pendingPath, receiptPath);
      throw new Error('directory fsync not confirmed');
    },
  })).toThrow('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');
  expect(existsSync(files.receiptPath)).toBe(true);
  const journal = readFileSync(files.journalPath, 'utf8');
  expect(journal).toContain('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');

  const applyFiles = custodyFiles();
  const entries = readFileSync(applyFiles.rehearsalJournalPath, 'utf8').trim().split('\n').map(JSON.parse);
  entries.push({
    attemptId: entries[0].attemptId,
    code: 'SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED',
    completedAt: fixedNow.toISOString(),
    event: 'terminal',
  });
  const failed = Buffer.from(entries.map(entry => JSON.stringify(canonical(entry))).join('\n') + '\n');
  writeFileSync(applyFiles.rehearsalJournalPath, failed, { mode: 0o600 });
  applyFiles.document.rehearsalJournalSha256 = sha256(failed);
  expect(() => validateSuccessorAdmission(applyFiles.document, executableRecord, {
    now: fixedNow,
    receiptDirectory: applyFiles.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('directory fsync failure plus failure-audit loss leaves visible receipt apply-invalid', () => {
  const files = rehearsalCustodyFiles();
  let transportCalls = 0;
  let appendCalls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      transportCalls += 1;
      return transportCalls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    appendJournalImpl: (descriptor: number, entry: any) => {
      appendCalls += 1;
      if (appendCalls === 1) return writeCanonicalLine(descriptor, entry);
      throw new Error('failure audit unavailable after directory fsync failure');
    },
    publishReceiptImpl: (pendingPath: string, receiptPath: string) => {
      linkSync(pendingPath, receiptPath);
      const error: Error & { publicationReadbackEligible?: boolean } = new Error(
        'directory fsync failed after canonical link',
      );
      error.publicationReadbackEligible = false;
      throw error;
    },
  })).toThrow('SUCCESSOR_JOURNAL_APPEND_FAILED');
  expect(appendCalls).toBe(2);
  expect(readFileSync(files.receiptPath)).toEqual(readFileSync(files.pendingReceiptPath));
  const orphanJournal = readFileSync(files.journalPath);
  expect(orphanJournal.toString('utf8').trim().split('\n')).toHaveLength(2);

  const applyDocument = admission();
  applyDocument.createdAt = fixedNow.toISOString();
  const applyFiles = custodyFiles(applyDocument);
  const rehearsalReceipt = readFileSync(files.receiptPath);
  writeFileSync(join(applyFiles.directory, 'rehearsal-receipt.json'), rehearsalReceipt, { mode: 0o600 });
  writeFileSync(applyFiles.rehearsalJournalPath, orphanJournal, { mode: 0o600 });
  applyFiles.document.rehearsalReceiptSha256 = sha256(rehearsalReceipt);
  applyFiles.document.rehearsalJournalSha256 = sha256(orphanJournal);
  expect(() => validateSuccessorAdmission(applyFiles.document, executableRecord, {
    now: fixedNow,
    receiptDirectory: applyFiles.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

for (const failureAt of ['fsync', 'close'] as const) {
  test(`publication audit ${failureAt} failure requires proven durability before reconciliation`, () => {
    const files = rehearsalCustodyFiles();
    let transportCalls = 0;
    let appendCalls = 0;
    const run = () => runReviewMediaSuccessorRehearsal({
      admissionPath: files.admissionPath,
      journalPath: files.journalPath,
      receiptPath: files.receiptPath,
      environment: { SUPABASE_DB_URL: databaseUrl },
    }, {
      now: () => fixedNow,
      gitFactsImpl: () => ({ clean: true, detached: true, revision }),
      loadManifestImpl: () => record,
      protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
      rollbackReadbackImpl: () => rollbackReadback(),
      runPsqlImpl: () => {
        transportCalls += 1;
        return transportCalls === 2 ? rehearsalStageOutput() : rehearsalReadback();
      },
      appendJournalImpl: (descriptor: number, entry: any, options: any) => {
        appendCalls += 1;
        if (appendCalls === 1) return appendJournal(descriptor, entry, options);
        return appendJournal(descriptor, entry, {
          fsyncImpl: (fd: number) => {
            if (failureAt === 'fsync') throw new Error('fixture sync failure');
            fsyncSync(fd);
          },
          closeImpl: () => { throw new Error('fixture close acknowledgement loss'); },
        });
      },
    });
    if (failureAt === 'fsync') expect(run).toThrow('SUCCESSOR_JOURNAL_APPEND_FAILED');
    else expect(run()).toMatchObject({
      code: 'SUCCESSOR_REHEARSAL_PASSED',
      publicationAuditReadback: 'reconciled',
      publicationReadback: 'confirmed',
    });
    expect(transportCalls).toBe(3);
    expect(appendCalls).toBe(2);
    // Both failures leave visible bytes; only the completed fsync can reconcile.
    const journal = readFileSync(files.journalPath, 'utf8').trim().split('\n').map(JSON.parse);
    expect(journal).toHaveLength(3);
    expect(journal[2].code).toBe('SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED');
  });
}

test('publication audit failure before any bytes leaves durable receipt apply-invalid', () => {
  const files = rehearsalCustodyFiles();
  let transportCalls = 0;
  let appendCalls = 0;
  expect(() => runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      transportCalls += 1;
      return transportCalls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    appendJournalImpl: (descriptor: number, entry: any) => {
      appendCalls += 1;
      if (appendCalls === 1) return writeCanonicalLine(descriptor, entry);
      throw new Error('publication audit unavailable before write');
    },
  })).toThrow('SUCCESSOR_JOURNAL_APPEND_FAILED');
  expect(appendCalls).toBe(2);
  expect(readFileSync(files.receiptPath)).toEqual(readFileSync(files.pendingReceiptPath));
  const journal = readFileSync(files.journalPath);
  expect(journal.toString('utf8').trim().split('\n')).toHaveLength(2);

  const applyFiles = custodyFiles();
  const validEntries = readFileSync(applyFiles.rehearsalJournalPath, 'utf8')
    .trim().split('\n').map(JSON.parse);
  const missingPublication = Buffer.from(validEntries.slice(0, 2)
    .map(entry => JSON.stringify(canonical(entry))).join('\n') + '\n');
  writeFileSync(applyFiles.rehearsalJournalPath, missingPublication, { mode: 0o600 });
  applyFiles.document.rehearsalJournalSha256 = sha256(missingPublication);
  expect(() => validateSuccessorAdmission(applyFiles.document, executableRecord, {
    now: fixedNow,
    receiptDirectory: applyFiles.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('atomic publication acknowledgement loss reconciles exact receipt without retry', () => {
  const files = rehearsalCustodyFiles();
  let calls = 0;
  let publishCalls = 0;
  const result = runReviewMediaSuccessorRehearsal({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    receiptPath: files.receiptPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => record,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: () => {
      calls += 1;
      return calls === 2 ? rehearsalStageOutput() : rehearsalReadback();
    },
    publishReceiptImpl: (pendingPath: string, receiptPath: string) => {
      publishCalls += 1;
      linkSync(pendingPath, receiptPath);
      const directoryDescriptor = openSync(files.directory, 'r');
      fsyncSync(directoryDescriptor);
      closeSync(directoryDescriptor);
      const error: Error & { publicationReadbackEligible?: boolean } = new Error(
        'publication acknowledgement lost',
      );
      error.publicationReadbackEligible = true;
      throw error;
    },
  });
  expect(publishCalls).toBe(1);
  expect(result).toMatchObject({
    code: 'SUCCESSOR_REHEARSAL_PASSED',
    publicationAuditReadback: 'confirmed',
    publicationReadback: 'reconciled',
  });
  expect(readFileSync(files.receiptPath)).toEqual(readFileSync(files.pendingReceiptPath));
});

test('apply rejects orphan and semantically tampered rehearsal journals even when rehashed', () => {
  {
    const files = custodyFiles();
    const firstLine = readFileSync(files.rehearsalJournalPath, 'utf8').split('\n')[0];
    const orphan = Buffer.from(`${firstLine}\n`);
    writeFileSync(files.rehearsalJournalPath, orphan, { mode: 0o600 });
    files.document.rehearsalJournalSha256 = sha256(orphan);
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  {
    const files = custodyFiles();
    const entries = readFileSync(files.rehearsalJournalPath, 'utf8').trim().split('\n').map(JSON.parse);
    entries[1].receiptSha256 = '0'.repeat(64);
    const tampered = Buffer.from(entries.map(entry => JSON.stringify(canonical(entry))).join('\n') + '\n');
    writeFileSync(files.rehearsalJournalPath, tampered, { mode: 0o600 });
    files.document.rehearsalJournalSha256 = sha256(tampered);
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  {
    const files = custodyFiles();
    const entries = readFileSync(files.rehearsalJournalPath, 'utf8').trim().split('\n').map(JSON.parse);
    entries[2] = {
      attemptId: entries[0].attemptId,
      code: 'SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED',
      completedAt: fixedNow.toISOString(),
      event: 'terminal',
    };
    const failed = Buffer.from(entries.map(entry => JSON.stringify(canonical(entry))).join('\n') + '\n');
    writeFileSync(files.rehearsalJournalPath, failed, { mode: 0o600 });
    files.document.rehearsalJournalSha256 = sha256(failed);
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
});

test('apply pins the stored admission against a valid fully rehashed rehearsal from another attempt', () => {
  const files = custodyFiles();
  expect(validateSuccessorAdmission(files.document, executableRecord, {
    now: fixedNow, receiptDirectory: files.directory,
  }).expiresAt).toBe(Date.parse(files.document.expiresAt));
  const storedPath = join(files.directory, 'rehearsal-admission.json');
  const originalBytes = readFileSync(storedPath);
  const other = JSON.parse(originalBytes.toString('utf8'));
  other.attemptId = '123e4567-e89b-42d3-a456-426614174002';
  const otherDigest = rebindRehearsalEvidence(files, other);
  expect(otherDigest).not.toBe(files.document.rehearsalAdmissionSha256);
  expect(validateSuccessorRehearsalAdmission(other, record, {
    now: fixedNow, receiptDirectory: files.directory,
  }).expiresAt).toBe(Date.parse(other.expiresAt));
  expect(() => validateSuccessorAdmission(files.document, executableRecord, {
    now: fixedNow, receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  // Restore the pinned file, leaving the internally consistent other receipt/journal.
  writeFileSync(storedPath, originalBytes, { mode: 0o600 });
  expect(() => validateSuccessorAdmission(files.document, executableRecord, {
    now: fixedNow, receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

for (const changed of ['attempt', 'rollback', 'writerFence'] as const) {
  test(`apply rejects a rehashed rehearsal with mismatched ${changed} binding`, () => {
    const files = custodyFiles();
    const stored = JSON.parse(readFileSync(join(files.directory, 'rehearsal-admission.json'), 'utf8'));
    if (changed === 'attempt') {
      // Receipt and all journal entries agree on B, but the actual admission is A.
      const other = { ...stored, attemptId: '123e4567-e89b-42d3-a456-426614174002' };
      rebindRehearsalEvidence(files, other);
      const receiptPath = join(files.directory, 'rehearsal-receipt.json');
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      receipt.admissionSha256 = files.document.rehearsalAdmissionSha256;
      writeFileSync(receiptPath, canonicalBytes(receipt), { mode: 0o600 });
      files.document.rehearsalReceiptSha256 = sha256(readFileSync(receiptPath));
      const journal = readFileSync(files.rehearsalJournalPath, 'utf8').trim().split('\n').map(JSON.parse);
      for (const entry of journal) {
        entry.admissionSha256 = files.document.rehearsalAdmissionSha256;
        if ('receiptSha256' in entry) entry.receiptSha256 = files.document.rehearsalReceiptSha256;
      }
      const bytes = Buffer.from(`${journal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`);
      writeFileSync(files.rehearsalJournalPath, bytes, { mode: 0o600 });
      files.document.rehearsalJournalSha256 = sha256(bytes);
      writeFileSync(join(files.directory, 'rehearsal-admission.json'), canonicalBytes(stored), { mode: 0o600 });
    } else {
      stored.attemptId = '123e4567-e89b-42d3-a456-426614174002';
      const fileName = changed === 'rollback' ? 'rollback-readback-receipt.json' : 'writer-fence-directSql.json';
      const receiptPath = join(files.directory, fileName);
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      if (changed === 'rollback') {
        receipt.deploymentSha = '2'.repeat(40);
        stored.rollback.deploymentSha = receipt.deploymentSha;
      } else receipt.observedAt = fixedNow.toISOString();
      const bytes = canonicalBytes(receipt);
      writeFileSync(receiptPath, bytes, { mode: 0o600 });
      if (changed === 'rollback') stored.rollback.readbackSha256 = sha256(bytes);
      else stored.writerFences.directSql.evidenceSha256 = sha256(bytes);
      // Even rebinding the apply digest cannot mix B's rollback/fence with A's.
      files.document.rehearsalAdmissionSha256 = rebindRehearsalEvidence(files, stored);
    }
    expect(validateSuccessorRehearsalAdmission(stored, record, {
      now: fixedNow, receiptDirectory: files.directory,
    }).expiresAt).toBe(Date.parse(stored.expiresAt));
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow, receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  });
}

test('apply requires the pinned private canonical rehearsal admission before any external read', () => {
  for (const invalid of ['missing', 'public', 'noncanonical', 'wrongDigest'] as const) {
    const files = custodyFiles();
    const path = join(files.directory, 'rehearsal-admission.json');
    if (invalid === 'missing') rmSync(path);
    if (invalid === 'public') chmodSync(path, 0o644);
    if (invalid === 'noncanonical') {
      const stored = JSON.parse(readFileSync(path, 'utf8'));
      writeFileSync(path, JSON.stringify(stored, null, 2), { mode: 0o600 });
      files.document.rehearsalAdmissionSha256 = sha256(readFileSync(path));
    }
    if (invalid === 'wrongDigest') files.document.rehearsalAdmissionSha256 = '0'.repeat(64);
    writeFileSync(files.admissionPath, canonicalBytes(files.document), { mode: 0o600 });
    let externalCalls = 0;
    const unexpected = () => { externalCalls += 1; throw new Error('unexpected external read'); };
    expect(() => runReviewMediaSuccessor({
      admissionPath: files.admissionPath, journalPath: files.journalPath, environment: {},
    }, {
      now: () => fixedNow,
      loadManifestImpl: () => executableRecord,
      gitFactsImpl: unexpected,
      protectedMainReadbackImpl: unexpected,
      rollbackReadbackImpl: unexpected,
      runPsqlImpl: unexpected,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
    expect(externalCalls).toBe(0);
    expect(existsSync(files.journalPath)).toBe(false);
  }
});

test('admission rejects wrong preimage and every wrong writer fence', () => {
  {
    const files = custodyFiles();
    files.document.stageStates[10].state.finishCleanupBodySha256 = '0'.repeat(64);
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  {
    const files = custodyFiles();
    files.document.stageStates[0].state.ownerAuthorityReady = false;
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  for (const key of Object.keys(manifest.requiredWriterFences)) {
    const files = custodyFiles();
    files.document.writerFences[key].state = 'wrong';
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
});

test('success path performs preflight, rechecks rollback and commits all eleven once', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  const calls: string[] = [];
  let rollbackReads = 0;
  const result = runReviewMediaSuccessor({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => executableRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => { rollbackReads += 1; return rollbackReadback(); },
    runPsqlImpl: (_url, sql) => {
      calls.push(sql);
      return JSON.stringify(calls.length === 1 ? plan.priorReadback.expected : plan.finalReadback.expected);
    },
  });
  expect(result).toMatchObject({ code: 'SUCCESSOR_COMMITTED', status: 'committed' });
  expect(rollbackReads).toBe(2);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toStartWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  expect(calls[0]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
  expect(calls[1].match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(readFileSync(files.journalPath, 'utf8')).toContain('SUCCESSOR_COMMITTED');
});

for (const remainingMs of [600_000, 5_000]) {
  for (const failure of ['clientStall', 'statementTimeout', 'lockTimeout', 'expiry'] as const) {
    test(`bounded preflight ${failure} with ${remainingMs}ms left cannot journal or write`, () => {
      const document = admission();
      document.expiresAt = new Date(fixedNow.getTime() + remainingMs).toISOString();
      const files = custodyFiles(document);
      const plan = compileSuccessorPlan(executableRecord, files.document);
      let spawnCalls = 0;
      let rollbackReads = 0;
      const runner = createSuccessorPsqlRunner(databaseUrl, {
        environment: {}, psql: '/fixture/psql',
        spawnImpl: (_command: string, args: string[], options: any) => {
          spawnCalls += 1;
          expect(args).toContain('--single-transaction');
          expect(options.timeout).toBe(Math.min(30_000, remainingMs));
          expect(options.killSignal).toBe('SIGKILL');
          const sql = options.input;
          const queryAt = sql.indexOf(plan.stateQuery);
          for (const setting of [
            'REPEATABLE READ READ ONLY', 'standard_conforming_strings=on',
            "lock_timeout='2s'", "statement_timeout='15s'",
            "idle_in_transaction_session_timeout='30s'", "set_config('transaction_timeout',least(30000",
          ]) {
            expect(sql.indexOf(setting)).toBeGreaterThanOrEqual(0);
            expect(sql.indexOf(setting)).toBeLessThan(queryAt);
          }
          expect(sql).toContain('transaction_timestamp()');
          expect(sql).toContain(`clock_timestamp() >= '${document.expiresAt}'::timestamptz`);
          expect(sql.match(/SUCCESSOR_ADMISSION_EXPIRED/g)).toHaveLength(2);
          expect(sql).not.toMatch(/INSERT INTO supabase_migrations\.schema_migrations/);
          if (failure === 'clientStall') return {
            error: Object.assign(new Error('private transport diagnostic'), { code: 'ETIMEDOUT' }),
            status: null, stdout: '', stderr: 'private transport diagnostic',
          };
          const sqlstate = failure === 'statementTimeout' ? '57014' : failure === 'lockTimeout' ? '55P03' : 'P0001';
          return { status: 1, stdout: '', stderr: `ERROR: ${sqlstate}: ${failure === 'expiry' ? 'SUCCESSOR_ADMISSION_EXPIRED' : 'private diagnostic'}\n` };
        },
      });
      const expectedCode = failure === 'clientStall' ? 'MIGRATION_PSQL_EXECUTION_FAILED'
        : failure === 'statementTimeout' ? 'MIGRATION_PSQL_FAILED_57014'
          : failure === 'lockTimeout' ? 'MIGRATION_PSQL_FAILED_55P03' : 'SUCCESSOR_ADMISSION_EXPIRED';
      expect(() => runReviewMediaSuccessor({
        admissionPath: files.admissionPath, journalPath: files.journalPath,
        environment: { SUPABASE_DB_URL: databaseUrl },
      }, {
        now: () => fixedNow,
        gitFactsImpl: () => ({ clean: true, detached: true, revision }),
        loadManifestImpl: () => executableRecord,
        protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
        rollbackReadbackImpl: () => { rollbackReads += 1; return rollbackReadback(); },
        runPsqlImpl: runner,
      })).toThrow(expectedCode);
      expect(spawnCalls).toBe(1);
      expect(rollbackReads).toBe(1);
      expect(existsSync(files.journalPath)).toBe(false);
    });
  }
}

test('psql runner keeps a finite mutation/reconciliation cap and rejects unbounded overrides', () => {
  let calls = 0;
  const runner = createSuccessorPsqlRunner(databaseUrl, {
    environment: {},
    spawnImpl: (_command: string, _args: string[], options: any) => {
      calls += 1;
      expect(options.timeout).toBe(930_000);
      expect(options.killSignal).toBe('SIGKILL');
      return { status: 0, stdout: 'fixture', stderr: '' };
    },
  });
  expect(runner(databaseUrl, 'SELECT 1;', true)).toBe('fixture');
  for (const timeoutMs of [0, -1, Infinity, NaN, 930_001]) {
    expect(() => runner(databaseUrl, 'SELECT 1;', true, { timeoutMs })).toThrow('SUCCESSOR_ARGUMENT_INVALID');
  }
  expect(calls).toBe(1);
});

for (const failureAt of ['fsync', 'close'] as const) {
  test(`committed terminal audit ${failureAt} failure preserves the committed outcome`, () => {
    const files = custodyFiles();
    const plan = compileSuccessorPlan(executableRecord, files.document);
    const calls: string[] = [];
    let observed: any;
    try {
      observed = runReviewMediaSuccessor({
        admissionPath: files.admissionPath,
        journalPath: files.journalPath,
        environment: { SUPABASE_DB_URL: databaseUrl },
      }, {
        now: () => fixedNow,
        gitFactsImpl: () => ({ clean: true, detached: true, revision }),
        loadManifestImpl: () => executableRecord,
        protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
        rollbackReadbackImpl: () => rollbackReadback(),
        runPsqlImpl: (_url, sql) => {
          calls.push(sql);
          return JSON.stringify(calls.length === 1
            ? plan.priorReadback.expected
            : plan.finalReadback.expected);
        },
        appendJournalImpl: (descriptor: number, entry: any) => appendJournal(descriptor, entry, {
          fsyncImpl: (fd: number) => {
            if (failureAt === 'fsync') throw new Error('fixture committed audit sync failure');
            fsyncSync(fd);
          },
          closeImpl: () => { throw new Error('fixture committed audit close acknowledgement loss'); },
        }),
      });
    } catch (error) {
      observed = successorFailureResult(error);
    }
    if (failureAt === 'fsync') {
      expect(observed).toEqual({
        code: 'SUCCESSOR_JOURNAL_APPEND_FAILED',
        operationCode: 'SUCCESSOR_COMMITTED',
        status: 'failed',
      });
    } else {
      expect(observed).toMatchObject({
        code: 'SUCCESSOR_COMMITTED',
        status: 'committed',
        terminalAuditReadback: 'reconciled',
      });
    }
    expect(calls).toHaveLength(2);
    expect(calls[1].match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
    const journal = readFileSync(files.journalPath, 'utf8').trim().split('\n').map(JSON.parse);
    expect(journal).toHaveLength(2);
    expect(journal[1].code).toBe('SUCCESSOR_COMMITTED');
  });
}

test('committed terminal audit readback requires both durability and exact bytes', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  const calls: string[] = [];
  let observed: any;
  try {
    runReviewMediaSuccessor({
      admissionPath: files.admissionPath,
      journalPath: files.journalPath,
      environment: { SUPABASE_DB_URL: databaseUrl },
    }, {
      now: () => fixedNow,
      gitFactsImpl: () => ({ clean: true, detached: true, revision }),
      loadManifestImpl: () => executableRecord,
      protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
      rollbackReadbackImpl: () => rollbackReadback(),
      runPsqlImpl: (_url, sql) => {
        calls.push(sql);
        return JSON.stringify(calls.length === 1
          ? plan.priorReadback.expected
          : plan.finalReadback.expected);
      },
      appendJournalImpl: () => {
        const error: Error & { publicationAuditReadbackEligible?: boolean } = new Error(
          'fixture durable acknowledgement without terminal bytes',
        );
        error.publicationAuditReadbackEligible = true;
        throw error;
      },
    });
  } catch (error) {
    observed = successorFailureResult(error);
  }
  expect(observed).toEqual({
    code: 'SUCCESSOR_JOURNAL_APPEND_FAILED',
    operationCode: 'SUCCESSOR_COMMITTED',
    status: 'failed',
  });
  expect(calls).toHaveLength(2);
  const journal = readFileSync(files.journalPath, 'utf8').trim().split('\n').map(JSON.parse);
  expect(journal).toHaveLength(1);
  expect(journal[0].event).toBe('started');
});

test('concurrent rollback deployment change rejects before journal or mutation', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  let rollbackReads = 0;
  const calls: string[] = [];
  expect(() => runReviewMediaSuccessor({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => executableRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => {
      rollbackReads += 1;
      return rollbackReads === 1 ? rollbackReadback() : { ...rollbackReadback(), gitSha: '0'.repeat(40) };
    },
    runPsqlImpl: (_url, sql) => { calls.push(sql); return JSON.stringify(plan.priorReadback.expected); },
  })).toThrow('SUCCESSOR_ROLLBACK_READBACK_INVALID');
  expect(rollbackReads).toBe(2);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toStartWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  expect(calls[0]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
});

test('prior readback mismatch fails before journal and mutating transport', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  const mismatch = structuredClone(plan.priorReadback.expected);
  mismatch.bundle.ledgerCount += 1;
  const calls: string[] = [];
  expect(() => runReviewMediaSuccessor({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => executableRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: (_url, sql) => { calls.push(sql); return JSON.stringify(mismatch); },
  })).toThrow('SUCCESSOR_PREFLIGHT_MISMATCH');
  expect(calls).toHaveLength(1);
  expect(calls[0]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
  expect(() => readFileSync(files.journalPath)).toThrow();
});

test('lost apply acknowledgement reconciles once and never resends eleven mutations', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  const calls: string[] = [];
  expect(() => runReviewMediaSuccessor({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => executableRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: (_url, sql) => {
      calls.push(sql);
      if (calls.length === 1) return JSON.stringify(plan.priorReadback.expected);
      if (calls.length === 2) throw new Error('lost acknowledgement');
      return JSON.stringify(plan.finalReadback.expected);
    },
  })).toThrow('MIGRATION_BUNDLE_OUTCOME_UNCONFIRMED');
  expect(calls).toHaveLength(3);
  expect(calls[1].match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(calls[2]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
  expect(readFileSync(files.journalPath, 'utf8')).toContain('MIGRATION_BUNDLE_OUTCOME_UNCONFIRMED');
});

for (const failureAt of [1, 2, 3, 4, 5, 6]) {
  test(`apply fsync failure at custody/start boundary ${failureAt} prevents database mutation`, () => {
    const files = custodyFiles();
    const plan = compileSuccessorPlan(executableRecord, files.document);
    let syncs = 0;
    let transports = 0;
    expect(() => runReviewMediaSuccessor({
      admissionPath: files.admissionPath,
      journalPath: files.journalPath,
      environment: { SUPABASE_DB_URL: databaseUrl },
    }, {
      now: () => fixedNow,
      gitFactsImpl: () => ({ clean: true, detached: true, revision }),
      loadManifestImpl: () => executableRecord,
      protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
      rollbackReadbackImpl: () => rollbackReadback(),
      fsyncImpl: (fd: number) => {
        syncs += 1;
        if (syncs === failureAt) throw new Error('fixture durability failure');
        fsyncSync(fd);
      },
      runPsqlImpl: (_url, sql) => {
        transports += 1;
        expect(sql).toStartWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
        return JSON.stringify(plan.priorReadback.expected);
      },
    })).toThrow(failureAt <= 4 ? 'SUCCESSOR_ADMISSION_INVALID' : 'SUCCESSOR_JOURNAL_INVALID');
    expect(transports).toBe(1);
    expect(syncs).toBe(failureAt);
  });
}

test('apply preserves expiry and audit failure as separate bounded outcomes', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  let transports = 0;
  let observed: any;
  try {
    runReviewMediaSuccessor({
      admissionPath: files.admissionPath,
      journalPath: files.journalPath,
      environment: { SUPABASE_DB_URL: databaseUrl },
    }, {
      now: () => fixedNow,
      gitFactsImpl: () => ({ clean: true, detached: true, revision }),
      loadManifestImpl: () => executableRecord,
      protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
      rollbackReadbackImpl: () => rollbackReadback(),
      runPsqlImpl: () => {
        transports += 1;
        if (transports === 2) throw Object.assign(new Error('fixture diagnostic omitted'), {
          code: 'SUCCESSOR_ADMISSION_EXPIRED',
        });
        return JSON.stringify(plan.priorReadback.expected);
      },
      appendJournalImpl: () => { throw new Error('fixture audit failure omitted'); },
    });
  } catch (error) { observed = successorFailureResult(error); }
  expect(observed).toEqual({
    code: 'SUCCESSOR_JOURNAL_APPEND_FAILED',
    operationCode: 'SUCCESSOR_ADMISSION_EXPIRED',
    status: 'failed',
  });
  expect(transports).toBe(3);
  expect(successorFailureResult({
    code: 'SUCCESSOR_JOURNAL_APPEND_FAILED', operationCode: 'arbitrary diagnostic',
  })).toEqual({ code: 'SUCCESSOR_JOURNAL_APPEND_FAILED', status: 'failed' });
  expect(successorFailureResult({
    code: 'SUCCESSOR_JOURNAL_APPEND_FAILED',
    get operationCode() { throw new Error('fixture diagnostic must not escape'); },
  })).toEqual({ code: 'SUCCESSOR_JOURNAL_APPEND_FAILED', status: 'failed' });
});
