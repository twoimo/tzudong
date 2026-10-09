import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  assertSuccessorDatabaseTarget,
  buildSuccessorStateQuery,
  compileSuccessorPlan,
  createSuccessorPsqlRunner,
  currentProtectedMainReadback,
  currentSuccessorGitFacts,
  loadSuccessorManifest,
  protectedSourceReadbackBinding,
  runAdminRecordSuccessor,
  validateSuccessorAdmission,
} from '../scripts/admin-record-sql-successor.mjs';
import { fiveMigrationBundleSuffixRoot } from '../scripts/supabase-migration-bundle.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const manifestBytes = readFileSync(new URL('../../../.github/admin-record-sql-successor.v1.json', import.meta.url));
const manifestDocument = JSON.parse(manifestBytes.toString('utf8'));
const record = Object.freeze({
  bytes: manifestBytes,
  manifest: manifestDocument,
  manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  materials: Object.freeze(manifestDocument.migrations.map((migration: any) => ({
    path: migration.path,
    bytes: readFileSync(new URL(`../../../${migration.path}`, import.meta.url)),
    originalVector: migration.originalStatementVector,
  }))),
});
const executableRecord = Object.freeze({
  ...record,
  manifest: Object.freeze({
    ...record.manifest,
    launchPolicy: Object.freeze({
      ...record.manifest.launchPolicy,
      state: 'ready',
    }),
  }),
});
const heldRecord = Object.freeze({
  ...record,
  manifest: Object.freeze({
    ...record.manifest,
    launchPolicy: Object.freeze({
      ...record.manifest.launchPolicy,
      state: 'held',
    }),
  }),
});
const fixedNow = new Date('2026-10-09T09:00:00.000Z');
const revision = '71da8656c45981e927821e935a09e00820e0bbd8';
const databaseUrl = 'postgresql://postgres.aqlcofblfxdrjhhdmarw:private-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const roots = ['1', '2', '3', '4', '5', '6'];
const schemas = ['a', 'b', 'c', 'd', 'e', 'f'];
const directories: string[] = [];
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): any => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const canonicalBytes = (value: any) => Buffer.from(`${JSON.stringify(canonical(value))}\n`);

afterAll(() => {
  for (const directory of directories) rmSync(directory, { force: true, recursive: true });
});

function admission(manifestRecord = executableRecord) {
  const manifest = manifestRecord.manifest;
  const suffixRoot = fiveMigrationBundleSuffixRoot(manifest.migrations);
  const priorCount = 80;
  const prefixRoot = roots[0].repeat(64);
  const stageStates = Array.from({ length: 6 }, (_, index) => ({
    bundle: {
      ledgerCount: priorCount + index,
      prefixRoot,
      priorCount,
      suffixRoot: index === 5 ? suffixRoot : null,
      targetCount: index,
    },
    state: {
      activeReviewItems: 0,
      currentUser: 'postgres',
      databaseName: 'postgres',
      ledgerRoot: roots[index].repeat(64),
      reviewItems: 0,
      reviewPolicyEnabled: false,
      reviewRuns: 0,
      schemaRoot: schemas[index].repeat(64),
      serverMajor: 17,
      sessionUser: 'postgres',
    },
  }));
  const writerFences = Object.fromEntries(Object.entries(manifest.requiredWriterFences).map(
    ([key, state], index) => [key, { evidenceSha256: (index + 6).toString(16).repeat(64), state }],
  ));
  return {
    attemptId: '123e4567-e89b-42d3-a456-426614174000',
    createdAt: '2026-10-09T08:59:00.000Z',
    expiresAt: '2026-10-09T09:10:00.000Z',
    id: manifest.id,
    journalPathSha256: 'f'.repeat(64),
    manifestSha256: manifestRecord.manifestSha256,
    projectRef: manifest.projectRef,
    protectedMainReceiptSha256: 'b'.repeat(64),
    purpose: manifest.purpose,
    rehearsalReceiptSha256: 'c'.repeat(64),
    rollback: {
      deploymentSha: 'd'.repeat(40),
      deploymentUrl: 'https://tzudong-rollback-fixture.vercel.app/',
      readbackSha256: 'd'.repeat(64),
      state: 'ready',
    },
    schemaVersion: 1,
    sourceReceiptSha256: 'e'.repeat(64),
    sourceRevision: revision,
    sourceRoot: manifest.sourceRoot,
    stageStates,
    writerFences,
  };
}

function custodyFiles(document = admission()) {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-admin-successor-'));
  directories.push(directory);
  chmodSync(directory, 0o700);
  const admissionPath = join(directory, 'admission.json');
  const journalPath = join(directory, 'attempt.jsonl');
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
  const receipts: Record<string, any> = {
    'source-receipt.json': {
      ...common,
      kind: 'successor-source-receipt',
      sourceRoot: document.sourceRoot,
    },
    'protected-main-receipt.json': {
      ...common,
      kind: 'protected-main-readback-receipt',
      ref: record.manifest.protectedSource.ref,
      remote: record.manifest.protectedSource.remote,
      repositoryUrl: record.manifest.protectedSource.repositoryUrl,
      revision: document.sourceRevision,
    },
    'rehearsal-receipt.json': {
      ...common,
      kind: 'successor-rehearsal-receipt',
      passed: true,
      serverVersionNum: 170006,
      sourceRoot: document.sourceRoot,
      stageStatesSha256: sha256(JSON.stringify(canonical(document.stageStates))),
      suffixRoot: fiveMigrationBundleSuffixRoot(record.manifest.migrations),
    },
    'rollback-readback-receipt.json': {
      ...common,
      kind: 'rollback-readback-receipt',
      deploymentSha: document.rollback.deploymentSha,
      deploymentUrl: document.rollback.deploymentUrl,
      state: document.rollback.state,
    },
  };
  document.sourceReceiptSha256 = sha256(canonicalBytes(receipts['source-receipt.json']));
  document.protectedMainReceiptSha256 = sha256(canonicalBytes(receipts['protected-main-receipt.json']));
  document.rehearsalReceiptSha256 = sha256(canonicalBytes(receipts['rehearsal-receipt.json']));
  document.rollback.readbackSha256 = sha256(canonicalBytes(receipts['rollback-readback-receipt.json']));
  for (const [key, state] of Object.entries(record.manifest.requiredWriterFences)) {
    const name = `writer-fence-${key}.json`;
    receipts[name] = {
      ...common,
      fence: key,
      kind: 'writer-fence-readback-receipt',
      state,
    };
    document.writerFences[key].evidenceSha256 = sha256(canonicalBytes(receipts[name]));
  }
  for (const [name, receipt] of Object.entries(receipts)) {
    const path = join(directory, name);
    writeFileSync(path, canonicalBytes(receipt), { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  writeFileSync(admissionPath, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  chmodSync(admissionPath, 0o600);
  return { admissionPath, directory, document, journalPath, receipts };
}

const dependencies = (runPsqlImpl: (...args: any[]) => string, manifestRecord = executableRecord) => ({
  gitFactsImpl: () => ({ clean: true, detached: true, revision }),
  loadManifestImpl: () => manifestRecord,
  now: () => fixedNow,
  protectedMainReadbackImpl: (manifest: any) => protectedSourceReadbackBinding(manifest, revision),
  runPsqlImpl,
});

test('protected main readback resolves the actual remote ref instead of trusting local HEAD', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-admin-successor-git-'));
  directories.push(directory);
  const remote = join(directory, 'remote.git');
  const checkout = join(directory, 'checkout');
  const git = (cwd: string, args: string[]) => {
    const result = spawnSync('/usr/bin/git', args, { cwd, encoding: 'utf8' });
    expect(result.status).toBe(0);
    return result.stdout.trim();
  };
  git(directory, ['init', '--bare', remote]);
  git(directory, ['init', checkout]);
  git(checkout, ['config', 'user.name', 'Fixture']);
  git(checkout, ['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(join(checkout, 'fixture.txt'), 'remote-main\n');
  git(checkout, ['add', 'fixture.txt']);
  git(checkout, ['commit', '-m', 'fixture']);
  git(checkout, ['branch', '-M', 'main']);
  git(checkout, ['remote', 'add', 'origin', remote]);
  git(checkout, ['push', '-u', 'origin', 'main']);
  const remoteRevision = git(checkout, ['rev-parse', 'HEAD']);
  writeFileSync(join(checkout, 'fixture.txt'), 'local-only\n');
  git(checkout, ['add', 'fixture.txt']);
  git(checkout, ['commit', '-m', 'local only']);
  const localRevision = git(checkout, ['rev-parse', 'HEAD']);
  expect(localRevision).not.toBe(remoteRevision);
  expect(currentSuccessorGitFacts({ repositoryRoot: checkout })).toEqual({
    clean: true,
    detached: false,
    revision: localRevision,
  });
  git(checkout, ['checkout', '--detach']);
  expect(currentSuccessorGitFacts({ repositoryRoot: checkout })).toEqual({
    clean: true,
    detached: true,
    revision: localRevision,
  });
  writeFileSync(join(checkout, 'untracked.txt'), 'dirty\n');
  expect(currentSuccessorGitFacts({ repositoryRoot: checkout }).clean).toBe(false);

  const manifest = {
    projectRef: record.manifest.projectRef,
    protectedSource: { ref: 'refs/heads/main', remote: 'origin', repositoryUrl: remote },
  };
  expect(currentProtectedMainReadback(manifest, { repositoryRoot: checkout })).toEqual(
    protectedSourceReadbackBinding(manifest, remoteRevision),
  );
  expect(() => currentProtectedMainReadback({
    ...manifest,
    protectedSource: { ...manifest.protectedSource, repositoryUrl: `${remote}-wrong` },
  }, { repositoryRoot: checkout })).toThrow('SUCCESSOR_CHECKOUT_INVALID');
});

test('dedicated manifest pins the exact five-source chain, full vectors, toolchain and untouched legacy manifest', () => {
  const manifest = record.manifest;
  expect(manifest.migrations.map((migration: any) => [
    migration.version,
    migration.id,
    migration.sha256,
    migration.statementCount,
    migration.statementVectorSha256,
  ])).toEqual([
    ['20261004190259', 'admin_record_guarded_actions', 'b373b7ea472c0352a33a4d4043cf8d6aa8474c04cc1ca5778805edfa77ac9c95', 39, '5038d14ce704d494889562f04d33cacae7bd7a117bf4cd2341752bd3b40f12af'],
    ['20261004192657', 'admin_evaluation_raw_warning_groups', '66eace1d6fb0dd55c1d780776bab855cc37690335ad40b0fdc1294c610e07d3a', 10, '082fec2c22c8588e262bbe6cd936cb30f6b100c3f5b2ffec489ff144bbdfc5f8'],
    ['20261004194715', 'admin_evaluation_raw_warning_invoker_contract', 'e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020', 4, 'f211b61f0959413d40783cd62b4221e9ec30d92792ad86b61ca186f504c6c0e1'],
    ['20261009022915', 'restaurant_review_manual_preview_eligibility', '8acf6d1428764260ed57dac5fe09711868a82896f0a6d631d502128004c168a3', 4, 'ab55e1704f6b54134d7153603d55f948b19ab2c8ac9dfdf31d7ea1ef82d43958'],
    ['20261009091342', 'admin_record_private_verification_cleanup', 'b596b200e52c6813a4cfa1b0a2818625f067864549e8854f3497afdcdab706da', 13, 'c7b5ae6c7c64b00a31658bbf42165dd9e25ac41f794a1149c62d47f39cf33f4d'],
  ]);
  expect(manifest.migrations.every((migration: any) => migration.originalStatementVector.length === migration.statementCount)).toBe(true);
  manifest.migrations.forEach((migration: any, index: number) => {
    expect(record.materials[index].bytes.byteLength).toBe(migration.bytes);
    expect(sha256(record.materials[index].bytes)).toBe(migration.sha256);
  });
  expect(manifest.sourceRoot).toBe('15da876acc3c544fef42ca3fe00c9a260c490d683a7d33593b53aac881f273f3');
  expect(fiveMigrationBundleSuffixRoot(manifest.migrations)).toBe('81595e4e24fa962a349a51247099d1d25f483c06370ffc99523cb2c52cfb708c');
  expect(manifest.legacyReleaseManifest).toEqual({
    entries: 3,
    path: '.github/supabase-migration-release-manifest.v1.json',
    sha256: '515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d',
  });
  expect(manifest.migrations.some((migration: any) => migration.id.startsWith('g016_'))).toBe(false);
  expect(manifest.launchPolicy).toEqual({
    code: 'SUCCESSOR_LAUNCH_HELD',
    reason: 'protected-release-and-fresh-admission-required',
    state: 'ready',
  });
  expect(manifest.protectedSource).toEqual({
    ref: 'refs/heads/main',
    remote: 'origin',
    repositoryUrl: 'https://github.com/twoimo/tzudong.git',
  });
});

test('production manifest loader either binds the exact current toolchain or fails closed on source drift', () => {
  const toolchainMatches = record.manifest.toolchain.every((entry: any) => {
    const bytes = readFileSync(new URL(`../../../${entry.path}`, import.meta.url));
    return sha256(bytes) === entry.sha256;
  });
  if (toolchainMatches) {
    expect(() => loadSuccessorManifest()).not.toThrow();
  } else {
    expect(() => loadSuccessorManifest()).toThrow('SUCCESSOR_SOURCE_DRIFT');
  }
});

test('production ready manifest still rejects corrupt fence custody before checkout, transport or journal creation', () => {
  const document = admission(record);
  const files = custodyFiles(document);
  writeFileSync(join(files.directory, 'writer-fence-dashboard.json'), '{}\n');
  let gitFactsCalls = 0;
  let transportCalls = 0;
  expect(() => runAdminRecordSuccessor({
    ...files,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    ...dependencies(() => { transportCalls += 1; return ''; }, record),
    gitFactsImpl: () => {
      gitFactsCalls += 1;
      return { clean: true, detached: true, revision };
    },
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  expect(gitFactsCalls).toBe(0);
  expect(transportCalls).toBe(0);
  expect(() => readFileSync(files.journalPath)).toThrow();

});

test('in-memory held manifest rejects before checkout, transport or journal creation', () => {
  const files = custodyFiles();
  let gitFactsCalls = 0;
  let transportCalls = 0;
  expect(() => runAdminRecordSuccessor({
    ...files,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    ...dependencies(() => { transportCalls += 1; return ''; }, heldRecord),
    gitFactsImpl: () => {
      gitFactsCalls += 1;
      return { clean: true, detached: true, revision };
    },
  })).toThrow('SUCCESSOR_LAUNCH_HELD');
  expect(gitFactsCalls).toBe(0);
  expect(transportCalls).toBe(0);
  expect(() => readFileSync(files.journalPath)).toThrow();
});

test('fresh admission binds exact revision, rehearsal, rollback, external fences and all five schema/ledger stages', () => {
  const files = custodyFiles();
  const document = files.document;
  expect(() => validateSuccessorAdmission(document, record, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).not.toThrow();
  const stale = structuredClone(document);
  stale.expiresAt = '2026-10-09T08:59:59.000Z';
  expect(() => validateSuccessorAdmission(stale, record, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_EXPIRED');
  const partial = structuredClone(document);
  partial.stageStates[2].bundle.targetCount = 1;
  expect(() => validateSuccessorAdmission(partial, record, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  const reusedRoot = structuredClone(document);
  reusedRoot.stageStates[3].state.ledgerRoot = reusedRoot.stageStates[2].state.ledgerRoot;
  expect(() => validateSuccessorAdmission(reusedRoot, record, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  const weakFence = structuredClone(document);
  weakFence.writerFences.directSql.state = 'unknown';
  expect(() => validateSuccessorAdmission(weakFence, record, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).toThrow('SUCCESSOR_ADMISSION_INVALID');
});

test('private canonical receipt bytes bind project, source, stage state, rollback and each writer fence', () => {
  expect(() => validateSuccessorAdmission(admission(), record, { now: fixedNow })).toThrow('SUCCESSOR_ADMISSION_INVALID');

  {
    const files = custodyFiles();
    writeFileSync(join(files.directory, 'source-receipt.json'), '{}\n', { mode: 0o600 });
    expect(() => validateSuccessorAdmission(files.document, record, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  {
    const files = custodyFiles();
    const wrongProject = { ...files.receipts['source-receipt.json'], projectRef: 'wrong-project' };
    const bytes = canonicalBytes(wrongProject);
    writeFileSync(join(files.directory, 'source-receipt.json'), bytes, { mode: 0o600 });
    files.document.sourceReceiptSha256 = sha256(bytes);
    expect(() => validateSuccessorAdmission(files.document, record, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  {
    const files = custodyFiles();
    const name = 'protected-main-receipt.json';
    const wrongRevision = { ...files.receipts[name], revision: '0'.repeat(40) };
    const bytes = canonicalBytes(wrongRevision);
    writeFileSync(join(files.directory, name), bytes, { mode: 0o600 });
    files.document.protectedMainReceiptSha256 = sha256(bytes);
    expect(() => validateSuccessorAdmission(files.document, record, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  {
    const files = custodyFiles();
    files.document.stageStates[2].state.schemaRoot = '9'.repeat(64);
    expect(() => validateSuccessorAdmission(files.document, record, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  {
    const files = custodyFiles();
    const name = 'writer-fence-directSql.json';
    const weakFence = { ...files.receipts[name], state: 'unknown' };
    const bytes = canonicalBytes(weakFence);
    writeFileSync(join(files.directory, name), bytes, { mode: 0o600 });
    files.document.writerFences.directSql.evidenceSha256 = sha256(bytes);
    expect(() => validateSuccessorAdmission(files.document, record, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  {
    const files = custodyFiles();
    const name = 'rollback-readback-receipt.json';
    const wrongState = { ...files.receipts[name], state: 'unknown' };
    const bytes = canonicalBytes(wrongState);
    writeFileSync(join(files.directory, name), bytes, { mode: 0o600 });
    files.document.rollback.readbackSha256 = sha256(bytes);
    expect(() => validateSuccessorAdmission(files.document, record, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
});

test('compiled plan checks catalog and ledger roots at every stage under an advisory and ledger-locked outer transaction', () => {
  const files = custodyFiles();
  const document = files.document;
  validateSuccessorAdmission(document, record, { now: fixedNow, receiptDirectory: files.directory });
  const plan = compileSuccessorPlan(record, document);
  expect(plan.plans).toHaveLength(5);
  expect(plan.sql).toContain("SET LOCAL idle_in_transaction_session_timeout='30s'");
  expect(plan.sql).toContain('pg_advisory_xact_lock(7311754282260165::bigint)');
  expect(plan.sql.match(/LOCK TABLE supabase_migrations\.schema_migrations IN EXCLUSIVE MODE/g)).toHaveLength(5);
  expect(plan.sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(5);
  expect(plan.sql).toContain(document.stageStates[0].state.schemaRoot);
  expect(plan.sql).toContain(document.stageStates[5].state.schemaRoot);
  expect(plan.sql).toContain('ADMIN_PRIVATE_CLEANUP_ACTION_SOURCE_DRIFT');
  expect(plan.sql.match(/MIGRATION_TERMINAL_READBACK_FAILED/g)).toHaveLength(6);
  expect(plan.stateQuery).toContain("'schemaRoot'");
  expect(plan.stateQuery).toContain("'ledgerRoot'");
  expect(plan.stateQuery).toContain("state IN('queued','running')");
  expect(plan.stateQuery).toContain("n.nspname IN('public','pipeline_control','privacy_retention')");
});

test('successful controller preflights before create-once journal and applies once without persisting the URI', () => {
  const document = admission();
  const { admissionPath, journalPath } = custodyFiles(document);
  const calls: Array<{ sql: string, singleTransaction: boolean }> = [];
  const result = runAdminRecordSuccessor({
    admissionPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
    journalPath,
  }, dependencies((_url, sql, singleTransaction) => {
    calls.push({ sql, singleTransaction });
    return JSON.stringify(calls.length === 1 ? document.stageStates[0] : document.stageStates[5]);
  }));
  expect(result).toMatchObject({ attemptId: document.attemptId, code: 'SUCCESSOR_COMMITTED', status: 'committed' });
  expect(calls).toHaveLength(2);
  expect(calls[0].sql).toStartWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  expect(calls[0].sql).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
  expect(calls[1].sql).toContain('pg_advisory_xact_lock');
  expect(calls[1].sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(5);
  expect(calls.every(call => call.singleTransaction)).toBe(true);
  const journal = readFileSync(journalPath, 'utf8');
  expect(journal.trim().split('\n')).toHaveLength(2);
  expect(journal).toContain('SUCCESSOR_COMMITTED');
  expect(journal).not.toContain(databaseUrl);
  expect(journal).not.toContain('private-password');

  let alternateCalls = 0;
  expect(() => runAdminRecordSuccessor({
    admissionPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
    journalPath: join(dirname(admissionPath), 'alternate.jsonl'),
  }, dependencies(() => { alternateCalls += 1; return ''; }))).toThrow('SUCCESSOR_JOURNAL_BINDING_MISMATCH');
  expect(alternateCalls).toBe(0);
});

test('source mismatch, journal collision and fresh preflight mismatch all stop before mutation', () => {
  {
    const files = custodyFiles();
    let calls = 0;
    expect(() => runAdminRecordSuccessor({ ...files, environment: { SUPABASE_DB_URL: databaseUrl } }, {
      ...dependencies(() => { calls += 1; return ''; }),
      gitFactsImpl: () => ({ clean: true, detached: true, revision: '0'.repeat(40) }),
    })).toThrow('SUCCESSOR_CHECKOUT_INVALID');
    expect(calls).toBe(0);
    expect(() => readFileSync(files.journalPath)).toThrow();
  }
  {
    const files = custodyFiles();
    let calls = 0;
    expect(() => runAdminRecordSuccessor({ ...files, environment: { SUPABASE_DB_URL: databaseUrl } }, {
      ...dependencies(() => { calls += 1; return ''; }),
      protectedMainReadbackImpl: (manifest: any) => protectedSourceReadbackBinding(manifest, '0'.repeat(40)),
    })).toThrow('SUCCESSOR_CHECKOUT_INVALID');
    expect(calls).toBe(0);
    expect(() => readFileSync(files.journalPath)).toThrow();
  }
  {
    const files = custodyFiles();
    writeFileSync(files.journalPath, 'existing\n', { mode: 0o600 });
    let calls = 0;
    expect(() => runAdminRecordSuccessor({ ...files, environment: { SUPABASE_DB_URL: databaseUrl } }, dependencies(() => {
      calls += 1; return '';
    }))).toThrow('SUCCESSOR_JOURNAL_EXISTS');
    expect(calls).toBe(0);
  }
  {
    const document = admission();
    const files = custodyFiles(document);
    let calls = 0;
    const mismatch = structuredClone(document.stageStates[0]);
    mismatch.state.schemaRoot = 'f'.repeat(64);
    expect(() => runAdminRecordSuccessor({ ...files, environment: { SUPABASE_DB_URL: databaseUrl } }, dependencies(() => {
      calls += 1; return JSON.stringify(mismatch);
    }))).toThrow('SUCCESSOR_PREFLIGHT_MISMATCH');
    expect(calls).toBe(1);
    expect(() => readFileSync(files.journalPath)).toThrow();
  }
});

test('lost acknowledgement never resends and journals bounded unconfirmed outcome after one readonly reconciliation', () => {
  const document = admission();
  const files = custodyFiles(document);
  const marker = 'private-provider-diagnostic';
  const calls: string[] = [];
  let caught: unknown;
  try {
    runAdminRecordSuccessor({ ...files, environment: { SUPABASE_DB_URL: databaseUrl } }, dependencies((_url, sql) => {
      calls.push(sql);
      if (calls.length === 1) return JSON.stringify(document.stageStates[0]);
      if (calls.length === 2) throw new Error(marker, { cause: new Error(marker) });
      return JSON.stringify(document.stageStates[5]);
    }));
  } catch (error) { caught = error; }
  expect((caught as Error).message).toBe('MIGRATION_BUNDLE_OUTCOME_UNCONFIRMED');
  expect((caught as Error).message).not.toContain(marker);
  expect((caught as Error).cause).toBeUndefined();
  expect(calls).toHaveLength(3);
  expect(calls.filter(sql => sql.includes('INSERT INTO supabase_migrations.schema_migrations'))).toHaveLength(1);
  expect(calls[2]).toContain('SET TRANSACTION READ ONLY');
  expect(calls[2]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
  const journal = readFileSync(files.journalPath, 'utf8');
  expect(journal).toContain('MIGRATION_BUNDLE_OUTCOME_UNCONFIRMED');
  expect(journal).not.toContain(marker);
});

test('target identity accepts only exact direct and official project-bound pooler endpoints', () => {
  const valid = [
    databaseUrl,
    'postgresql://postgres.aqlcofblfxdrjhhdmarw:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres',
    'postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:6543/postgres',
    'postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?sslmode=verify-full',
  ];
  for (const candidate of valid) {
    expect(() => assertSuccessorDatabaseTarget(candidate, record.manifest)).not.toThrow();
  }

  const invalid = [
    'postgresql://postgres.otherproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres.aqlcofblfxdrjhhdmarw:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres',
    'postgresql://postgres.aqlcofblfxdrjhhdmarw:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/other',
    'postgresql://postgres.aqlcofblfxdrjhhdmarw:secret@arbitrary.example.com:6543/postgres',
    'postgresql://postgres.aqlcofblfxdrjhhdmarw:secret@aws-x-ap-southeast-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres.aqlcofblfxdrjhhdmarw:secret@aws-0-ap-southeast-1.pooler.supabase.com:6432/postgres',
    'postgresql://postgres.aqlcofblfxdrjhhdmarw:secret@aws-0-ap-southeast-1.pooler.supabase.com/postgres',
    'postgresql://postgres%2Eaqlcofblfxdrjhhdmarw:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/%70ostgres',
    'postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres#redirect',
    'postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?sslmode=disable',
    'postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?sslmode=require&sslmode=require',
    'postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?application_name=successor',
    'postgresql://postgres%ZZ:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres',
    'postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?sslmode=%ZZ',
    ...['host', 'hostaddr', 'port', 'dbname', 'user', 'service', 'options'].map(
      key => `postgresql://postgres:secret@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?${key}=redirect`,
    ),
  ];
  for (const candidate of invalid) {
    expect(() => assertSuccessorDatabaseTarget(candidate, record.manifest)).toThrow('SUCCESSOR_DATABASE_TARGET_INVALID');
  }
});

test('psql transport keeps the URI out of argv and bounds verbose server diagnostics', () => {
  let observedArgs: string[] = [];
  let observedEnvironment: Record<string, string> = {};
  let observedInput = '';
  const runner = createSuccessorPsqlRunner(databaseUrl, {
    environment: {},
    psql: '/pinned/psql',
    spawnImpl: (_command: string, args: string[], options: { env: Record<string, string>, input: string }) => {
      observedArgs = args;
      observedEnvironment = options.env;
      observedInput = options.input;
      return {
        error: null,
        status: 1,
        stderr: 'ERROR:  P0001: MIGRATION_PRIOR_STATE_MISMATCH private provider detail',
        stdout: '',
      };
    },
  });
  let caught: unknown;
  try { runner(databaseUrl, 'SELECT 1', true); } catch (error) { caught = error; }
  expect(observedArgs.join(' ')).not.toContain(databaseUrl);
  expect(observedArgs.join(' ')).not.toContain('private-password');
  expect(observedArgs.filter(arg => arg === '--single-transaction')).toHaveLength(1);
  expect(observedArgs.filter(arg => arg === '--file=-')).toHaveLength(1);
  expect(observedEnvironment).toMatchObject({
    PGDATABASE: 'postgres',
    PGHOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    PGPASSWORD: 'private-password',
    PGPORT: '6543',
    PGUSER: 'postgres.aqlcofblfxdrjhhdmarw',
  });
  expect(Object.values(observedEnvironment)).not.toContain(databaseUrl);
  expect(observedInput).toBe('\\set VERBOSITY verbose\nSELECT 1');
  expect((caught as Error & { code: string }).code).toBe('MIGRATION_PSQL_FAILED_P0001');
  expect((caught as Error).message).not.toContain('private provider detail');

  let nonTransactionalArgs: string[] = [];
  const nonTransactionalRunner = createSuccessorPsqlRunner(databaseUrl, {
    environment: {},
    spawnImpl: (_command: string, args: string[]) => {
      nonTransactionalArgs = args;
      return { error: null, status: 0, stderr: '', stdout: 'ok' };
    },
  });
  expect(nonTransactionalRunner(databaseUrl, 'SELECT 1', false)).toBe('ok');
  expect(nonTransactionalArgs).toContain('--file=-');
  expect(nonTransactionalArgs).not.toContain('--single-transaction');
});

test('state query is a single read-only SELECT contract and does not expand the generic G016 path', () => {
  const query = buildSuccessorStateQuery(record.manifest);
  expect(query).toStartWith('SELECT * FROM (WITH');
  expect(statementSpans(query)).toHaveLength(1);
  expect(statementSpans(query)[0].token.trimStart()).toStartWith('SELECT');
  expect(query).not.toMatch(/^(?:INSERT|UPDATE|DELETE|CALL|COPY)\b/gm);
  expect(query).toContain("'reviewPolicyEnabled'");
  expect(query).toContain("'roles'");
  expect(query).toContain("'memberships'");
  const legacy = JSON.parse(readFileSync(new URL('../../../.github/supabase-migration-release-manifest.v1.json', import.meta.url), 'utf8'));
  expect(legacy.migrations.map((migration: any) => migration.id)).toEqual([
    'restaurant_refresh_history',
    'g016_privacy_audit_owner_policy',
    'g016_onboarding_confirmation_freshness',
  ]);
});
