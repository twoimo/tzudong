import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  fsyncSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  operatingAdmissionFailureResult,
  parseOperatingAdmissionArguments,
  prepareReviewMediaApplyAdmission,
  prepareReviewMediaRehearsalAdmission,
} from '../scripts/review-media-operating-admission.mjs';
import {
  loadSuccessorManifest,
  validateSuccessorAdmission,
  validateSuccessorRehearsalAdmission,
} from '../scripts/review-media-sql-successor.mjs';
import { elevenMigrationBundleSuffixRoot } from '../scripts/supabase-migration-bundle.mjs';

const manifestRecord = loadSuccessorManifest();
const { manifest } = manifestRecord;
const fixedNow = new Date('2026-10-13T08:00:20.000Z');
const createdAt = '2026-10-13T08:00:00.000Z';
const expiresAt = '2026-10-13T08:10:00.000Z';
const observedAt = '2026-10-13T08:00:10.000Z';
const sourceRevision = '4d4ecf608a7922df5a68beaf3e1ea2dcc250a3b7';
const roots: string[] = [];

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): any => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const canonicalBytes = (value: any) => Buffer.from(`${JSON.stringify(canonical(value))}\n`);

afterEach(() => {
  while (roots.length > 0) {
    const root = roots[roots.length - 1];
    rmSync(root, { recursive: true, force: true });
    roots.pop();
  }
});

function privateRoot() {
  const root = mkdtempSync(join(tmpdir(), 'tzudong-operating-admission-test-'));
  roots.push(root);
  chmodSync(root, 0o700);
  return root;
}

function writePrivateCanonical(path: string, value: any) {
  writeFileSync(path, canonicalBytes(value), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function rehearsalInput() {
  const common = {
    expiresAt,
    id: manifest.id,
    manifestSha256: manifestRecord.manifestSha256,
    observedAt,
    projectRef: manifest.projectRef,
    purpose: manifest.purpose,
    schemaVersion: 1,
    sourceRevision,
  };
  return {
    attemptId: '123e4567-e89b-42d3-a456-426614174100',
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
    manifestSha256: manifestRecord.manifestSha256,
    protectedMainReceipt: {
      ...common,
      kind: 'protected-main-readback-receipt',
      ref: manifest.protectedSource.ref,
      remote: manifest.protectedSource.remote,
      repositoryUrl: manifest.protectedSource.repositoryUrl,
      revision: sourceRevision,
    },
    rollbackReadbackReceipt: {
      ...common,
      deploymentId: 'dpl_TestOnlyAdmissionEvidence123',
      deploymentSha: '1884f87e53c4567ead7c9a0fb394b09b91a70396',
      deploymentUrl: 'https://tzudong-test-only-twoimos-projects.vercel.app/',
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
      sourceRoot: manifest.sourceRoot,
    },
    sourceRevision,
    sourceRoot: manifest.sourceRoot,
    writerFenceReceipts: Object.fromEntries(Object.entries(manifest.requiredWriterFences).map(
      ([fence, state]) => [fence, {
        ...common,
        fence,
        kind: 'writer-fence-readback-receipt',
        state,
      }],
    )),
  };
}

function prepareRehearsal(input = rehearsalInput()) {
  const root = privateRoot();
  const inputPath = join(root, 'rehearsal-input.json');
  const custodyDirectory = join(root, 'custody');
  writePrivateCanonical(inputPath, input);
  const result = prepareReviewMediaRehearsalAdmission({
    custodyDirectory,
    inputPath,
    manifestRecord,
    now: fixedNow,
  });
  return { custodyDirectory: result.custodyDirectory, input, inputPath, result, root };
}

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
      ledgerRoot: index === 0 ? prefixRoot : (index + 1).toString(16).repeat(64),
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

function publishSyntheticRehearsal(custodyDirectory: string) {
  const admissionPath = join(custodyDirectory, 'rehearsal-admission.json');
  const admissionBytes = readFileSync(admissionPath);
  const admission = JSON.parse(admissionBytes.toString('utf8'));
  const admissionSha256 = sha256(admissionBytes);
  const stages = stageStates();
  const rehearsalReceiptPath = join(custodyDirectory, 'rehearsal-receipt.json');
  const rehearsalJournalPath = join(custodyDirectory, 'rehearsal-journal.jsonl');
  const receipt = {
    admissionSha256,
    attemptId: admission.attemptId,
    expiresAt: admission.expiresAt,
    id: admission.id,
    journalPathSha256: sha256(rehearsalJournalPath),
    kind: 'successor-rehearsal-receipt',
    manifestSha256: admission.manifestSha256,
    observedAt,
    passed: true,
    preflightStateSha256: sha256(JSON.stringify(canonical(stages[0]))),
    projectRef: admission.projectRef,
    purpose: admission.purpose,
    restoredStateSha256: sha256(JSON.stringify(canonical(stages[0]))),
    schemaVersion: 1,
    serverVersionNum: 170006,
    sourceRevision: admission.sourceRevision,
    sourceRoot: admission.sourceRoot,
    stageStates: stages,
    stageStatesSha256: sha256(JSON.stringify(canonical(stages))),
    suffixRoot: elevenMigrationBundleSuffixRoot(manifest.migrations),
  };
  const receiptBytes = canonicalBytes(receipt);
  const receiptSha256 = sha256(receiptBytes);
  const journal = [
    {
      admissionSha256,
      attemptId: admission.attemptId,
      event: 'started',
      manifestSha256: admission.manifestSha256,
      sourceRevision: admission.sourceRevision,
      sourceRoot: admission.sourceRoot,
      startedAt: createdAt,
    },
    {
      admissionSha256,
      attemptId: admission.attemptId,
      code: 'SUCCESSOR_REHEARSAL_VERIFIED',
      event: 'verification',
      manifestSha256: admission.manifestSha256,
      receiptSha256,
      sourceRevision: admission.sourceRevision,
      sourceRoot: admission.sourceRoot,
      verifiedAt: observedAt,
    },
    {
      admissionSha256,
      attemptId: admission.attemptId,
      code: 'SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED',
      event: 'publication',
      manifestSha256: admission.manifestSha256,
      publishedAt: '2026-10-13T08:00:15.000Z',
      receiptSha256,
      sourceRevision: admission.sourceRevision,
      sourceRoot: admission.sourceRoot,
    },
  ];
  const journalBytes = Buffer.from(`${journal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`);
  writeFileSync(rehearsalReceiptPath, receiptBytes, { mode: 0o600 });
  writeFileSync(rehearsalJournalPath, journalBytes, { mode: 0o600 });
  chmodSync(rehearsalReceiptPath, 0o600);
  chmodSync(rehearsalJournalPath, 0o600);
  return {
    admission,
    admissionSha256,
    custodyDirectory,
    journalSha256: sha256(journalBytes),
    receipt,
    receiptSha256,
  };
}

function writeApplyOperatingEvidence(custodyDirectory: string) {
  const freshObservedAt = '2026-10-13T08:00:18.000Z';
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
    runId: '42',
    schemaVersion: 1,
    scope: 'stopped-until-application-result',
    sourceRevision,
    workflowRef: 'twoimo/tzudong/.github/workflows/review-media-sql-successor.yml@refs/heads/main',
  };
  const bundle = {
    adminRecordMutationsHold: {
      commit: sourceRevision,
      deploymentId: 'dpl_TestOnlyAdmissionEvidence123',
      holdActive: true,
      observedAt,
    },
    createdAt,
    expiresAt,
    kind: 'review-media-successor-vercel-operating-bundle',
    manifestSha256: manifestRecord.manifestSha256,
    protectedMain: {},
    rollbackPolicy: {},
    rollbackReadback: {
      deploymentId: 'dpl_TestOnlyAdmissionEvidence123',
      gitSha: '1884f87e53c4567ead7c9a0fb394b09b91a70396',
    },
    schemaVersion: 1,
    sourceRevision,
    sourceRoot: manifest.sourceRoot,
    storyboardPolicy: {
      deployment: {
        branch: 'main',
        deploymentId: 'dpl_TestOnlyAdmissionEvidence123',
        sourceCommit: sourceRevision,
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
    observedAt: freshObservedAt,
  };
  const machine = {
    adminRuntimeHold: {
      deploymentId: 'dpl_TestOnlyAdmissionEvidence123',
      holdActive: true,
      observedAt,
    },
    automaticReviewer: { observedAt: freshObservedAt, state: 'stopped' },
    g037WriteFreeze: { observedAt: freshObservedAt, state: 'active' },
    inFlightQuiescence,
    kind: 'review-media-successor-machine-operating-observations',
    schemaVersion: 1,
    sourceRevision,
  };
  const common = {
    expiresAt,
    id: manifest.id,
    manifestSha256: manifestRecord.manifestSha256,
    projectRef: manifest.projectRef,
    purpose: manifest.purpose,
    schemaVersion: 1,
    sourceRevision,
  };
  const quiescence = {
    ...common,
    ...inFlightQuiescence,
    kind: 'apply-in-flight-quiescence-readback',
  };
  const attestationBytes = canonicalBytes(attestation);
  const bundleBytes = canonicalBytes(bundle);
  const machineBytes = canonicalBytes(machine);
  const quiescenceBytes = canonicalBytes(quiescence);
  const receiptProvenance: Record<string, any> = {};
  for (const [fence, state] of Object.entries(manifest.requiredWriterFences)) {
    const operator = ['browserRpc', 'dashboard', 'directSql', 'providerIngress'].includes(fence);
    const receipt = {
      ...common,
      fence,
      kind: 'writer-fence-readback-receipt',
      observedAt: ['automaticReviewer', 'g037WriteFreeze'].includes(fence)
        ? freshObservedAt
        : observedAt,
      state,
    };
    const receiptBytes = canonicalBytes(receipt);
    writeFileSync(join(custodyDirectory, `apply-writer-fence-${fence}.json`), receiptBytes, { mode: 0o600 });
    receiptProvenance[fence] = {
      evidenceSha256: operator
        ? sha256(attestationBytes)
        : fence === 'adminRecordMutationsHold'
          ? sha256(bundleBytes)
          : sha256(machineBytes),
      provenance: operator
        ? 'authenticated-owner-custody-commitment'
        : fence === 'adminRecordMutationsHold'
          ? 'immutable-deployment-machine-observation'
          : 'fresh-machine-observation',
      receiptSha256: sha256(receiptBytes),
    };
  }
  const map = {
    attestationSha256: sha256(attestationBytes),
    bundleSha256: sha256(bundleBytes),
    kind: 'review-media-successor-apply-operating-evidence-map',
    machineSha256: sha256(machineBytes),
    quiescenceSha256: sha256(quiescenceBytes),
    receiptProvenance,
    schemaVersion: 1,
    sourceRevision,
  };
  writePrivateCanonical(join(custodyDirectory, 'operator-custody-attestation.json'), attestation);
  writePrivateCanonical(join(custodyDirectory, 'vercel-operating-bundle.json'), bundle);
  writePrivateCanonical(join(custodyDirectory, 'apply-machine-operating-observations.json'), machine);
  writePrivateCanonical(join(custodyDirectory, 'apply-quiescence-readback.json'), quiescence);
  writePrivateCanonical(join(custodyDirectory, 'apply-operating-evidence-map.json'), map);
  return {
    applyEvidenceMapSha256: sha256(canonicalBytes(map)),
    applyQuiescenceReadbackSha256: sha256(quiescenceBytes),
  };
}

function rehashApplyOperatingEvidence(custodyDirectory: string, input: any) {
  const attestationBytes = readFileSync(join(custodyDirectory, 'operator-custody-attestation.json'));
  const bundleBytes = readFileSync(join(custodyDirectory, 'vercel-operating-bundle.json'));
  const machineBytes = readFileSync(join(custodyDirectory, 'apply-machine-operating-observations.json'));
  const quiescenceBytes = readFileSync(join(custodyDirectory, 'apply-quiescence-readback.json'));
  const mapPath = join(custodyDirectory, 'apply-operating-evidence-map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  map.attestationSha256 = sha256(attestationBytes);
  map.bundleSha256 = sha256(bundleBytes);
  map.machineSha256 = sha256(machineBytes);
  map.quiescenceSha256 = sha256(quiescenceBytes);
  for (const key of Object.keys(manifest.requiredWriterFences)) {
    const receiptBytes = readFileSync(join(custodyDirectory, `apply-writer-fence-${key}.json`));
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
  input.applyEvidenceMapSha256 = sha256(mapBytes);
  input.applyQuiescenceReadbackSha256 = sha256(quiescenceBytes);
}

function applyInput(published: ReturnType<typeof publishSyntheticRehearsal>, overrides = {}) {
  return {
    ...writeApplyOperatingEvidence(published.custodyDirectory),
    attemptId: '123e4567-e89b-42d3-a456-426614174101',
    expiresAt,
    kind: 'review-media-successor-apply-admission-input',
    manifestSha256: manifestRecord.manifestSha256,
    observedAt: '2026-10-13T08:00:20.000Z',
    rehearsalAdmissionSha256: published.admissionSha256,
    rehearsalJournalSha256: published.journalSha256,
    rehearsalReceiptSha256: published.receiptSha256,
    schemaVersion: 1,
    sourceRevision,
    ...overrides,
  };
}

test('CLI contract accepts only the explicit rehearsal or apply producer modes', () => {
  expect(parseOperatingAdmissionArguments([
    '--mode', 'rehearsal',
    '--input', '/private/input.json',
    '--custody-dir', '/private/custody',
  ])).toEqual({
    custodyDirectory: '/private/custody',
    inputPath: '/private/input.json',
    mode: 'rehearsal',
  });
  expect(() => parseOperatingAdmissionArguments([
    '--mode', 'ready',
    '--input', '/private/input.json',
    '--custody-dir', '/private/custody',
  ])).toThrow('SUCCESSOR_OPERATING_ADMISSION_ARGUMENT_INVALID');
  const throwingCode = {};
  Object.defineProperty(throwingCode, 'code', { get() { throw new Error('secret'); } });
  expect(operatingAdmissionFailureResult(throwingCode)).toEqual({
    code: 'SUCCESSOR_OPERATING_ADMISSION_INPUT_INVALID',
    status: 'failed',
  });
});

test('rehearsal producer preserves proven receipts and creates a controller-valid private admission', () => {
  const prepared = prepareRehearsal();
  const admissionBytes = readFileSync(prepared.result.admissionPath);
  const admission = JSON.parse(admissionBytes.toString('utf8'));
  expect(prepared.result.status).toBe('prepared');
  expect(prepared.result.admissionSha256).toBe(sha256(admissionBytes));
  expect(statSync(prepared.custodyDirectory).mode & 0o077).toBe(0);
  expect(statSync(prepared.result.admissionPath).mode & 0o077).toBe(0);
  expect(readFileSync(join(prepared.custodyDirectory, 'source-receipt.json')))
    .toEqual(canonicalBytes(prepared.input.sourceReceipt));
  expect(readFileSync(join(prepared.custodyDirectory, 'checkout-readback.json')))
    .toEqual(canonicalBytes(prepared.input.checkoutReadback));
  expect(existsSync(prepared.result.journalPath)).toBe(false);
  expect(existsSync(prepared.result.receiptPath)).toBe(false);
  expect(validateSuccessorRehearsalAdmission(admission, manifestRecord, {
    now: fixedNow,
    receiptDirectory: prepared.custodyDirectory,
  })).toEqual({
    createdAt: Date.parse(createdAt),
    expiresAt: Date.parse(expiresAt),
  });
});

test('unknown, missing, stale, and mismatched evidence is rejected before custody creation', () => {
  const cases = [
    (input: any) => { input.writerFenceReceipts.unknownFence = input.writerFenceReceipts.dashboard; },
    (input: any) => { delete input.writerFenceReceipts.dashboard; },
    (input: any) => { input.sourceReceipt.observedAt = '2026-10-13T07:59:59.999Z'; },
    (input: any) => { input.protectedMainReceipt.revision = 'a'.repeat(40); },
    (input: any) => { input.expiresAt = fixedNow.toISOString(); },
    (input: any) => { input.expiresAt = '2026-10-13T08:16:00.000Z'; },
  ];
  for (const mutate of cases) {
    const root = privateRoot();
    const input = rehearsalInput();
    mutate(input);
    const inputPath = join(root, 'input.json');
    const custodyDirectory = join(root, 'custody');
    writePrivateCanonical(inputPath, input);
    expect(() => prepareReviewMediaRehearsalAdmission({
      custodyDirectory,
      inputPath,
      manifestRecord,
      now: fixedNow,
    })).toThrow('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
    expect(existsSync(custodyDirectory)).toBe(false);
  }
});

test('rehearsal producer never overwrites an existing custody directory', () => {
  const prepared = prepareRehearsal();
  const before = sha256(readFileSync(prepared.result.admissionPath));
  expect(() => prepareReviewMediaRehearsalAdmission({
    custodyDirectory: prepared.custodyDirectory,
    inputPath: prepared.inputPath,
    manifestRecord,
    now: fixedNow,
  })).toThrow('SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS');
  expect(sha256(readFileSync(prepared.result.admissionPath))).toBe(before);
});

test('rehearsal producer fails closed on parent, file, and custody fsync failures', () => {
  for (const failAt of [1, 2, 14]) {
    const root = privateRoot();
    const inputPath = join(root, `input-${failAt}.json`);
    const custodyDirectory = join(root, `custody-${failAt}`);
    writePrivateCanonical(inputPath, rehearsalInput());
    let fsyncCalls = 0;
    expect(() => prepareReviewMediaRehearsalAdmission({
      custodyDirectory,
      fsyncImpl: (descriptor: number) => {
        fsyncCalls += 1;
        if (fsyncCalls === failAt) throw new Error('fixture-fsync-failure');
        fsyncSync(descriptor);
      },
      inputPath,
      manifestRecord,
      now: fixedNow,
    })).toThrow('SUCCESSOR_OPERATING_ADMISSION_WRITE_FAILED');
    expect(fsyncCalls).toBe(failAt);
  }
});

test('rehearsal producer rejects symlink and oversized inputs before custody creation', () => {
  const root = privateRoot();
  const targetPath = join(root, 'target.json');
  const symlinkPath = join(root, 'symlink.json');
  const oversizedPath = join(root, 'oversized.json');
  writePrivateCanonical(targetPath, rehearsalInput());
  symlinkSync(targetPath, symlinkPath);
  writeFileSync(oversizedPath, Buffer.alloc(1024 * 1024 + 1, 0x20), { mode: 0o600 });
  chmodSync(oversizedPath, 0o600);
  for (const [inputPath, name] of [[symlinkPath, 'symlink'], [oversizedPath, 'oversized']]) {
    const custodyDirectory = join(root, `custody-${name}`);
    expect(() => prepareReviewMediaRehearsalAdmission({
      custodyDirectory,
      inputPath,
      manifestRecord,
      now: fixedNow,
    })).toThrow('SUCCESSOR_OPERATING_ADMISSION_INPUT_INVALID');
    expect(existsSync(custodyDirectory)).toBe(false);
  }
});

test('apply producer binds the verified rehearsal artifacts without extending their time window', () => {
  const prepared = prepareRehearsal();
  const published = publishSyntheticRehearsal(prepared.custodyDirectory);
  const applyInputDocument = applyInput(published);
  const inputPath = join(prepared.root, 'apply-input.json');
  writePrivateCanonical(inputPath, applyInputDocument);
  expect(published.receipt.admissionSha256).toBe(published.admissionSha256);
  expect(published.receipt.journalPathSha256)
    .toBe(sha256(join(prepared.custodyDirectory, 'rehearsal-journal.jsonl')));
  expect(published.receipt.sourceRoot).toBe(manifest.sourceRoot);
  expect({
    id: published.receipt.id,
    kind: published.receipt.kind,
    manifestSha256: published.receipt.manifestSha256,
    passed: published.receipt.passed,
    projectRef: published.receipt.projectRef,
    purpose: published.receipt.purpose,
    schemaVersion: published.receipt.schemaVersion,
    serverMajor: Math.floor(published.receipt.serverVersionNum / 10_000),
    sourceRevision: published.receipt.sourceRevision,
  }).toEqual({
    id: manifest.id,
    kind: 'successor-rehearsal-receipt',
    manifestSha256: manifestRecord.manifestSha256,
    passed: true,
    projectRef: manifest.projectRef,
    purpose: manifest.purpose,
    schemaVersion: 1,
    serverMajor: manifest.serverMajor,
    sourceRevision,
  });
  expect(published.receipt.suffixRoot).toBe(elevenMigrationBundleSuffixRoot(manifest.migrations));
  expect(published.receipt.stageStatesSha256)
    .toBe(sha256(JSON.stringify(canonical(published.receipt.stageStates))));
  expect(published.receipt.preflightStateSha256)
    .toBe(sha256(JSON.stringify(canonical(published.receipt.stageStates[0]))));
  const result = prepareReviewMediaApplyAdmission({
    custodyDirectory: prepared.custodyDirectory,
    inputPath,
    manifestRecord,
    now: fixedNow,
  });
  const admission = JSON.parse(readFileSync(result.admissionPath, 'utf8'));
  expect(published.receipt.attemptId).toBe(published.admission.attemptId);
  expect(admission.attemptId).toBe(applyInputDocument.attemptId);
  expect(admission.attemptId).not.toBe(published.admission.attemptId);
  expect(admission.rehearsalAdmissionSha256).toBe(sha256(readFileSync(
    join(prepared.custodyDirectory, 'rehearsal-admission.json'),
  )));
  expect(admission.rehearsalAdmissionSha256).toBe(published.receipt.admissionSha256);
  for (const key of [
    'adminRecordMutationsHold', 'browserRpc', 'dashboard', 'directSql', 'providerIngress',
  ]) {
    expect(admission.writerFences[key]).toEqual(published.admission.writerFences[key]);
  }
  for (const key of ['automaticReviewer', 'g037WriteFreeze']) {
    expect(admission.writerFences[key].state).toBe(published.admission.writerFences[key].state);
    expect(admission.writerFences[key].evidenceSha256)
      .not.toBe(published.admission.writerFences[key].evidenceSha256);
  }
  expect(admission.createdAt).toBe(createdAt);
  expect(admission.expiresAt).toBe(expiresAt);
  expect(admission.stageStates).toEqual(published.receipt.stageStates);
  expect(existsSync(result.journalPath)).toBe(false);
  expect(validateSuccessorAdmission(admission, manifestRecord, {
    now: fixedNow,
    receiptDirectory: prepared.custodyDirectory,
  }).suffixRoot).toBe(elevenMigrationBundleSuffixRoot(manifest.migrations));
  expect(() => prepareReviewMediaApplyAdmission({
    custodyDirectory: prepared.custodyDirectory,
    inputPath,
    manifestRecord,
    now: fixedNow,
  })).toThrow('SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS');
});

test('apply producer rejects pre-publication machine evidence even when every hash is refreshed', () => {
  const prepared = prepareRehearsal();
  const published = publishSyntheticRehearsal(prepared.custodyDirectory);
  const input = applyInput(published);
  const staleObservedAt = '2026-10-13T08:00:14.000Z';
  const machinePath = join(prepared.custodyDirectory, 'apply-machine-operating-observations.json');
  const machine = JSON.parse(readFileSync(machinePath, 'utf8'));
  machine.automaticReviewer.observedAt = staleObservedAt;
  machine.g037WriteFreeze.observedAt = staleObservedAt;
  machine.inFlightQuiescence.observedAt = staleObservedAt;
  writePrivateCanonical(machinePath, machine);
  const quiescencePath = join(prepared.custodyDirectory, 'apply-quiescence-readback.json');
  const quiescence = JSON.parse(readFileSync(quiescencePath, 'utf8'));
  quiescence.observedAt = staleObservedAt;
  writePrivateCanonical(quiescencePath, quiescence);
  for (const key of ['automaticReviewer', 'g037WriteFreeze']) {
    const path = join(prepared.custodyDirectory, `apply-writer-fence-${key}.json`);
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    receipt.observedAt = staleObservedAt;
    writePrivateCanonical(path, receipt);
  }
  rehashApplyOperatingEvidence(prepared.custodyDirectory, input);
  const inputPath = join(prepared.root, 'apply-input-stale-machine.json');
  writePrivateCanonical(inputPath, input);
  expect(() => prepareReviewMediaApplyAdmission({
    custodyDirectory: prepared.custodyDirectory,
    inputPath,
    manifestRecord,
    now: fixedNow,
  })).toThrow('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  expect(existsSync(join(prepared.custodyDirectory, 'apply-admission.json'))).toBe(false);
});

test('apply producer rejects a changed deployment after rehearsal even when rehashed', () => {
  const prepared = prepareRehearsal();
  const published = publishSyntheticRehearsal(prepared.custodyDirectory);
  const input = applyInput(published);
  const machinePath = join(prepared.custodyDirectory, 'apply-machine-operating-observations.json');
  const machine = JSON.parse(readFileSync(machinePath, 'utf8'));
  machine.adminRuntimeHold.deploymentId = 'dpl_ChangedDuringRehearsal123';
  writePrivateCanonical(machinePath, machine);
  rehashApplyOperatingEvidence(prepared.custodyDirectory, input);
  const inputPath = join(prepared.root, 'apply-input-changed-deployment.json');
  writePrivateCanonical(inputPath, input);
  expect(() => prepareReviewMediaApplyAdmission({
    custodyDirectory: prepared.custodyDirectory,
    inputPath,
    manifestRecord,
    now: fixedNow,
  })).toThrow('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  expect(existsSync(join(prepared.custodyDirectory, 'apply-admission.json'))).toBe(false);
});

test('apply producer rejects a rehashed storyboard runtime identity drift', () => {
  const prepared = prepareRehearsal();
  const published = publishSyntheticRehearsal(prepared.custodyDirectory);
  const input = applyInput(published);
  const bundlePath = join(prepared.custodyDirectory, 'vercel-operating-bundle.json');
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  bundle.storyboardPolicy.deployment.sourceCommit = 'f'.repeat(40);
  writePrivateCanonical(bundlePath, bundle);
  rehashApplyOperatingEvidence(prepared.custodyDirectory, input);
  const inputPath = join(prepared.root, 'apply-input-storyboard-policy-drift.json');
  writePrivateCanonical(inputPath, input);
  expect(() => prepareReviewMediaApplyAdmission({
    custodyDirectory: prepared.custodyDirectory,
    inputPath,
    manifestRecord,
    now: fixedNow,
  })).toThrow('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  expect(existsSync(join(prepared.custodyDirectory, 'apply-admission.json'))).toBe(false);
});

test('apply producer rejects a relabeled or tampered rehearsal before writing an admission', () => {
  for (const [name, overrides] of [
    ['extended', { expiresAt: '2026-10-13T08:11:00.000Z' }],
    ['tampered', { rehearsalJournalSha256: 'f'.repeat(64) }],
  ] as const) {
    const prepared = prepareRehearsal();
    const published = publishSyntheticRehearsal(prepared.custodyDirectory);
    const inputPath = join(prepared.root, `apply-input-${name}.json`);
    writePrivateCanonical(inputPath, applyInput(published, overrides));
    expect(() => prepareReviewMediaApplyAdmission({
      custodyDirectory: prepared.custodyDirectory,
      inputPath,
      manifestRecord,
      now: fixedNow,
    })).toThrow('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
    expect(existsSync(join(prepared.custodyDirectory, 'apply-admission.json'))).toBe(false);
  }
});

test('apply producer rejects a fully rehashed receipt and journal relabeled to another rehearsal attempt', () => {
  const prepared = prepareRehearsal();
  const published = publishSyntheticRehearsal(prepared.custodyDirectory);
  const relabeledAttemptId = '123e4567-e89b-42d3-a456-426614174102';
  const receiptPath = join(prepared.custodyDirectory, 'rehearsal-receipt.json');
  const journalPath = join(prepared.custodyDirectory, 'rehearsal-journal.jsonl');
  const relabeledReceipt = {
    ...published.receipt,
    attemptId: relabeledAttemptId,
  };
  const relabeledReceiptBytes = canonicalBytes(relabeledReceipt);
  const relabeledReceiptSha256 = sha256(relabeledReceiptBytes);
  const relabeledJournal = readFileSync(journalPath, 'utf8').trimEnd().split('\n').map(line => {
    const entry = JSON.parse(line);
    return {
      ...entry,
      attemptId: relabeledAttemptId,
      ...(entry.receiptSha256 ? { receiptSha256: relabeledReceiptSha256 } : {}),
    };
  });
  const relabeledJournalBytes = Buffer.from(
    `${relabeledJournal.map(entry => JSON.stringify(canonical(entry))).join('\n')}\n`,
  );
  writeFileSync(receiptPath, relabeledReceiptBytes, { mode: 0o600 });
  writeFileSync(journalPath, relabeledJournalBytes, { mode: 0o600 });
  chmodSync(receiptPath, 0o600);
  chmodSync(journalPath, 0o600);

  const inputPath = join(prepared.root, 'apply-input-relabeled-attempt.json');
  writePrivateCanonical(inputPath, applyInput(published, {
    rehearsalJournalSha256: sha256(relabeledJournalBytes),
    rehearsalReceiptSha256: relabeledReceiptSha256,
  }));

  expect(() => prepareReviewMediaApplyAdmission({
    custodyDirectory: prepared.custodyDirectory,
    inputPath,
    manifestRecord,
    now: fixedNow,
  })).toThrow('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  expect(existsSync(join(prepared.custodyDirectory, 'apply-admission.json'))).toBe(false);
});

test('apply producer treats a dangling reserved journal symlink as an existing output', () => {
  const prepared = prepareRehearsal();
  const published = publishSyntheticRehearsal(prepared.custodyDirectory);
  const inputPath = join(prepared.root, 'apply-input.json');
  writePrivateCanonical(inputPath, applyInput(published));
  symlinkSync(join(prepared.root, 'missing-target'), join(prepared.custodyDirectory, 'apply-journal.jsonl'));
  expect(() => prepareReviewMediaApplyAdmission({
    custodyDirectory: prepared.custodyDirectory,
    inputPath,
    manifestRecord,
    now: fixedNow,
  })).toThrow('SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS');
  expect(existsSync(join(prepared.custodyDirectory, 'apply-admission.json'))).toBe(false);
});

test('apply producer reads rehearsal journals through the no-follow bounded reader', () => {
  for (const mode of ['symlink', 'oversized'] as const) {
    const prepared = prepareRehearsal();
    const published = publishSyntheticRehearsal(prepared.custodyDirectory);
    const journalPath = join(prepared.custodyDirectory, 'rehearsal-journal.jsonl');
    let journalSha256 = published.journalSha256;
    if (mode === 'symlink') {
      const targetPath = join(prepared.root, 'journal-target.jsonl');
      writeFileSync(targetPath, readFileSync(journalPath), { mode: 0o600 });
      chmodSync(targetPath, 0o600);
      unlinkSync(journalPath);
      symlinkSync(targetPath, journalPath);
    } else {
      const oversized = Buffer.alloc(1024 * 1024 + 1, 0x20);
      writeFileSync(journalPath, oversized, { mode: 0o600 });
      chmodSync(journalPath, 0o600);
      journalSha256 = sha256(oversized);
    }
    const inputPath = join(prepared.root, `apply-input-${mode}.json`);
    writePrivateCanonical(inputPath, applyInput(published, { rehearsalJournalSha256: journalSha256 }));
    expect(() => prepareReviewMediaApplyAdmission({
      custodyDirectory: prepared.custodyDirectory,
      inputPath,
      manifestRecord,
      now: fixedNow,
    })).toThrow('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
    expect(existsSync(join(prepared.custodyDirectory, 'apply-admission.json'))).toBe(false);
  }
});
