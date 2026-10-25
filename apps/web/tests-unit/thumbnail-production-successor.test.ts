import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, fsyncSync, linkSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';

import {
  FENCE_COVERAGE, MANIFEST_PATH, MANIFEST_SHA256, PROJECT_REF, RELEASE_ADMISSION_PATH,
  RELEASE_ADMISSION_SHA256, REPOSITORY_ROOT, REQUIRED_FENCES, SERIALIZER_KEY,
  TLS_ROOT_PATH, TLS_ROOT_SHA256, createThumbnailPsqlRunner,
  loadThumbnailRecord, loadThumbnailRelease, main, runThumbnailSuccessor, thumbnailApplySql,
  thumbnailReleaseContract, validateThumbnailRelease,
} from '../scripts/thumbnail-production-successor.mjs';

// Real pinned source/vector/compiler. Only external observations/transport and
// private test custody are injected; no test makes the held draft executable.
const record = loadThumbnailRecord();
const revision = 'a'.repeat(40);
const createdAt = '2026-10-24T10:00:00.000Z';
const observedAt = '2026-10-24T10:00:01.000Z';
const expiresAt = '2026-10-24T10:15:00.000Z';
const now = new Date('2026-10-24T10:00:05.000Z');
const attemptId = '01234567-89ab-4cde-8fab-0123456789ab';
const roots: string[] = [];
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const bytes = (value: any) => Buffer.from(JSON.stringify(canonical(value)) + '\n');
function writePrivate(path: string, value: any) {
  writeFileSync(path, bytes(value), { mode: 0o600 });
  chmodSync(path, 0o600);
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function localOwner(operationId = attemptId, instant = createdAt) {
  return { kind: 'thumbnail-local-owner-observation-v1', authority: 'authenticated-repository-owner-local-cli',
    operationId, repository: 'twoimo/tzudong', principal: 'repository-owner', identityVerified: true,
    branch: 'main', protected: true, sourceRevision: revision, observedAt: instant };
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'thumbnail-successor-test-')));
  chmodSync(root, 0o700);
  roots.push(root);
  const evidence: Record<string, any> = {};
  const evidenceSha256: Record<string, string> = {};
  for (const [name, state] of Object.entries(REQUIRED_FENCES)) {
    evidence[name] = {
      kind: 'thumbnail-writer-observation-v2', fence: name, state,
      projectRef: PROJECT_REF, sourceRevision: revision, manifestSha256: MANIFEST_SHA256,
      operationId: attemptId, observedAt,
      scope: 'privileged-custody-until-reconciled', coverage: [...FENCE_COVERAGE],
      basis: 'authenticated-owner-custody',
    };
    evidenceSha256[name] = sha(bytes(evidence[name]));
    writePrivate(join(root, 'writer-fence-' + name + '.json'), evidence[name]);
  }
  const fence: any = {
    kind: 'thumbnail-writer-fence-readback-v2',
    authority: 'authenticated-repository-owner-local-cli',
    projectRef: PROJECT_REF, sourceRevision: revision, manifestSha256: MANIFEST_SHA256,
    observedAt, expiresAt, operationId: attemptId, ownerObservation: localOwner(),
    fences: { ...REQUIRED_FENCES }, coverage: [...FENCE_COVERAGE], evidenceSha256,
  };
  const admission: any = {
    kind: 'thumbnail-production-admission-v2', attemptId, projectRef: PROJECT_REF,
    databaseName: 'postgres', executorRole: 'postgres', serverVersionNum: 170006,
    manifestSha256: MANIFEST_SHA256, releaseAdmissionSha256: RELEASE_ADMISSION_SHA256,
    sourceSha256: record.migration.sha256, vectorSha256: record.migration.originalVectorSha256,
    sourceRevision: revision, createdAt, expiresAt, writerFenceSha256: sha(bytes(fence)),
  };
  const save = () => {
    admission.writerFenceSha256 = sha(bytes(fence));
    writePrivate(join(root, 'writer-fence.json'), fence);
    writePrivate(join(root, 'admission.json'), admission);
  };
  save();
  const calls: { sql: string; singleTransaction: boolean }[] = [];
  const committed = () => ({
    ledger_exists: true, ledger_equal: true, prior: null,
    terminal: structuredClone(record.migration.terminalReadback.expected),
  });
  const dependencies: any = {
    loadRecordImpl: () => record,
    loadReleaseImpl: () => validateThumbnailRelease(bytes(thumbnailReleaseContract())),
    custodyDirectory: root, now: () => now,
    sourceImpl: () => ({ revision, clean: true, detached: true, origin: 'https://github.com/twoimo/tzudong.git' }),
    protectedRevisionImpl: () => revision,
    // Actual local-owner observation validation; identity transport is substituted.
    attestationImpl: ({ operationId, clock }: any) => localOwner(operationId, clock().toISOString()),
    runPsqlImpl: (_url: string, sql: string, singleTransaction: boolean) => {
      calls.push({ sql, singleTransaction });
      if (sql.includes('$thumbnail_serializer$')) return JSON.stringify(record.migration.terminalReadback.expected);
      if (sql.includes('\\gset')) return JSON.stringify(committed());
      return JSON.stringify(record.migration.expectedPriorState.expected);
    },
  };
  const environment: any = {
    SUPABASE_DB_URL: 'postgresql://postgres@db.' + PROJECT_REF + '.supabase.co:5432/postgres?sslmode=require',
  };
  const run = (mode = 'apply') => runThumbnailSuccessor({ mode, environment }, dependencies);
  return { root, fence, admission, evidence, save, calls, dependencies, environment, committed, run };
}
function expectCode(run: () => any, code: string) {
  let caught: any;
  try { run(); } catch (error) { caught = error; }
  expect(caught?.code).toBe(code);
}
const sends = (f: ReturnType<typeof fixture>) => f.calls.filter(call => call.sql.includes('$thumbnail_serializer$'));

test('inspect validates the real pinned draft/source/vector without source, release, provider or hosted observations', () => {
  const unreachable = () => { throw new Error('external observation is forbidden'); };
  const value = runThumbnailSuccessor({ mode: 'inspect', environment: {} }, {
    sourceImpl: unreachable, protectedRevisionImpl: unreachable, attestationImpl: unreachable,
    runPsqlImpl: unreachable, loadReleaseImpl: unreachable,
  });
  expect(value.status).toBe('held');
  expect(value.executionEnabled).toBe(false);
  expect(value.manifestSha256).toBe(MANIFEST_SHA256);
  expect(value.statementCount).toBe(43);
  expect(record.manifest.executionEnabled).toBe(false);
});

test('committed operating release is byte pinned and has no CLI override', () => {
  expect(existsSync(join(REPOSITORY_ROOT, RELEASE_ADMISSION_PATH))).toBe(true);
  expect(loadThumbnailRelease().sha256).toBe(RELEASE_ADMISSION_SHA256);
  for (const argv of [
    ['--mode', 'apply', '--ready'], ['--mode', 'apply', '--manifest', MANIFEST_PATH],
    ['--mode', 'apply', '--dependencies', '{}'], ['--mode', 'bad'],
  ]) expectCode(() => main(argv), 'THUMBNAIL_ARGUMENT_INVALID');
});

test('missing release still rejects apply before source, custody or external observations', () => {
  let observations = 0;
  const unreachable = () => { observations++; throw new Error('external observation is forbidden'); };
  expectCode(() => runThumbnailSuccessor({ mode: 'apply', environment: {} }, {
    loadReleaseImpl: () => { throw Object.assign(new Error('missing release'), { code: 'THUMBNAIL_RELEASE_ADMISSION_REQUIRED' }); },
    sourceImpl: unreachable, protectedRevisionImpl: unreachable, attestationImpl: unreachable,
    runPsqlImpl: unreachable,
  }), 'THUMBNAIL_RELEASE_ADMISSION_REQUIRED');
  expect(observations).toBe(0);
});

test('native transport binds verify-full to the pinned CA after common PG environment cleanup', () => {
  const observed: any[] = [];
  const url = 'postgresql://postgres.aqlcofblfxdrjhhdmarw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require';
  const environment = { HOME: '/native-test-home', PATH: '/trusted/bin', PGSSLMODE: 'disable',
    PGSSLROOTCERT: '/untrusted/root.crt', PGHOST: 'other.invalid', PGOPTIONS: '-c unsafe=1' };
  const runner = createThumbnailPsqlRunner(url, { environment, spawnImpl: (...args: any[]) => {
    observed.push(args); return { status: 0, stdout: 'readonly-result', stderr: '' };
  } });
  expect(runner(url, 'SELECT 1;', false)).toBe('readonly-result');
  expect(observed).toHaveLength(1);
  const [command, args, options] = observed[0];
  expect(command).toBe('psql');
  expect(args).toContain('--no-psqlrc');
  expect(options.env.PGSSLMODE).toBe('verify-full');
  expect(options.env.PGSSLROOTCERT).toBe(join(REPOSITORY_ROOT, TLS_ROOT_PATH));
  expect(options.env.PGHOST).toBe('aws-0-ap-northeast-2.pooler.supabase.com');
  expect(options.env.PGOPTIONS).toBeUndefined();
  expect(options.env.HOME).toBe(environment.HOME);
  expect(options.env.PATH).toBe(environment.PATH);
  expect(environment.PGSSLMODE).toBe('disable');
  expect(environment.PGSSLROOTCERT).toBe('/untrusted/root.crt');
  expect(sha(readFileSync(join(REPOSITORY_ROOT, TLS_ROOT_PATH)))).toBe(TLS_ROOT_SHA256);
  expectCode(() => createThumbnailPsqlRunner('postgresql://other.invalid/postgres'), 'SUCCESSOR_DATABASE_TARGET_INVALID');
  expect(observed).toHaveLength(1);
});

test('separate release contract is byte pinned; changed scope, target, false flag or noncanonical bytes fail', () => {
  expect(validateThumbnailRelease(bytes(thumbnailReleaseContract())).sha256).toBe(RELEASE_ADMISSION_SHA256);
  for (const edit of [
    (v: any) => { v.projectRef = 'other'; }, (v: any) => { v.executionEnabled = false; },
    (v: any) => { v.coverage.pop(); }, (v: any) => { v.serializerKey += ':other'; },
    (v: any) => { v.originalVectorSha256 = '0'.repeat(64); },
  ]) {
    const value = thumbnailReleaseContract(); edit(value);
    expectCode(() => validateThumbnailRelease(bytes(value)), 'THUMBNAIL_RELEASE_ADMISSION_INVALID');
  }
  expectCode(() => validateThumbnailRelease(Buffer.concat([bytes(thumbnailReleaseContract()), Buffer.from('\n')])),
    'THUMBNAIL_RELEASE_ADMISSION_INVALID');
});

test('real manifest, SQL, component and imported toolchain bytes fail closed on drift', () => {
  for (const [path, code] of [
    [MANIFEST_PATH, 'THUMBNAIL_MANIFEST_DRIFT'],
    [record.migration.candidatePath, 'THUMBNAIL_SOURCE_DRIFT'],
    [record.manifest.components[0].path, 'THUMBNAIL_COMPONENT_DRIFT'],
    ['apps/web/scripts/admin-record-sql-successor.mjs', 'THUMBNAIL_TOOLCHAIN_DRIFT'],
    [TLS_ROOT_PATH, 'THUMBNAIL_TOOLCHAIN_DRIFT'],
  ]) {
    expectCode(() => loadThumbnailRecord({
      readBytesImpl: (absolute: string) => absolute === join(REPOSITORY_ROOT, path)
        ? Buffer.concat([readFileSync(absolute), Buffer.from('\n')]) : readFileSync(absolute),
      readVectorImpl: () => record.envelope.originalVector,
    }), code);
  }
  expectCode(() => loadThumbnailRecord({ readVectorImpl: () => [...record.envelope.originalVector, 'SELECT 1;'] }),
    'THUMBNAIL_VECTOR_DRIFT');
});

test('executable path uses real release/admission/owner validation and fsyncs journal before the only mutation send', () => {
  const f = fixture();
  const syncs: boolean[] = [];
  f.dependencies.fsyncImpl = (fd: number) => { fsyncSync(fd); syncs.push(true); };
  const transport = f.dependencies.runPsqlImpl;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    if (args[1].includes('$thumbnail_serializer$')) {
      expect(syncs.length).toBe(2);
      const entry = JSON.parse(readFileSync(join(f.root, 'apply-journal.jsonl'), 'utf8').split('\n')[0]);
      expect(entry.event).toBe('started');
      expect(entry.attemptId).toBe(attemptId);
      expect(entry.admissionSha256).toBe(sha(readFileSync(join(f.root, 'admission.json'))));
      expect(entry.releaseAdmissionSha256).toBe(RELEASE_ADMISSION_SHA256);
      expect(statSync(join(f.root, 'apply-journal.jsonl')).mode & 0o777).toBe(0o600);
    }
    return transport(...args);
  };
  expect(f.run().status).toBe('committed');
  expect(sends(f).length).toBe(1);
  expect(f.calls.length).toBe(3);
  expect(f.calls.every(call => call.singleTransaction)).toBe(true);
  const sql = sends(f)[0].sql;
  expect(sql.indexOf(SERIALIZER_KEY)).toBeLessThan(sql.indexOf('LOCK TABLE supabase_migrations.schema_migrations'));
  expect(sql).toContain("server_version_num')::integer<>170006");
  expect(sql).toContain('MIGRATION_PRIOR_STATE_MISMATCH');
  expect(sql).toContain('MIGRATION_TERMINAL_READBACK_FAILED');
  expect(sql).toContain('MIGRATION_LEDGER_READBACK_FAILED');
  expect(sql).toContain('INSERT INTO supabase_migrations.schema_migrations');
  expect(sql).toContain('THUMBNAIL_ADMISSION_EXPIRED');
  expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
  expect(sql).toBe(thumbnailApplySql(record, f.admission));
  expect(syncs.length).toBe(3);
  expect(record.manifest.executionEnabled).toBe(false);
});

test('lost COMMIT acknowledgement stays bounded unconfirmed despite committed readback; restart never sends again', () => {
  const f = fixture();
  const transport = f.dependencies.runPsqlImpl;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    const output = transport(...args);
    if (args[1].includes('$thumbnail_serializer$')) throw new Error('connection lost; private diagnostic');
    return output;
  };
  expectCode(() => f.run(), 'THUMBNAIL_OUTCOME_UNCONFIRMED');
  expect(sends(f).length).toBe(1);
  const count = f.calls.length;
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
  expect(f.calls.length).toBe(count);
  // Even replacing the admission with a fresh attempt cannot create a second send.
  f.admission.attemptId = '11234567-89ab-4cde-8fab-0123456789ab'; f.save();
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
  expect(f.calls.length).toBe(count);
});

test('reconcile is read-only after expiry, accepts a partial terminal append, and never grants replay', () => {
  const f = fixture(); f.run();
  const path = join(f.root, 'apply-journal.jsonl');
  const first = readFileSync(path, 'utf8').split('\n')[0];
  writeFileSync(path, first + '\n{"event":"termin');
  f.dependencies.now = () => new Date('2026-10-25T00:00:00.000Z');
  f.dependencies.sourceImpl = () => { throw new Error('historical recovery must not require current HEAD'); };
  f.calls.length = 0;
  const result = f.run('reconcile');
  expect(result).toEqual({ status: 'reconciliation', disposition: 'committed', attemptId, replayAllowed: false });
  expect(f.calls.length).toBe(1);
  expect(f.calls[0].sql.startsWith('SET TRANSACTION READ ONLY;')).toBe(true);
  expect(sends(f)).toEqual([]);
  expect(readFileSync(path, 'utf8')).toBe(first + '\n{"event":"termin');
});

test('a foreign attempt or altered SQL journal binding cannot reconcile', () => {
  const f = fixture(); f.run(); f.calls.length = 0;
  f.admission.attemptId = '11234567-89ab-4cde-8fab-0123456789ab';
  f.fence.operationId = f.admission.attemptId;
  f.fence.ownerObservation.operationId = f.admission.attemptId;
  for (const name of Object.keys(f.evidence)) {
    f.evidence[name].operationId = f.admission.attemptId;
    writePrivate(join(f.root, 'writer-fence-' + name + '.json'), f.evidence[name]);
    f.fence.evidenceSha256[name] = sha(bytes(f.evidence[name]));
  }
  f.save();
  expectCode(() => f.run('reconcile'), 'THUMBNAIL_JOURNAL_BINDING_INVALID');
  expect(f.calls).toEqual([]);
});

test('journal hardlinks, widened mode, oversized and partial first-line data never authorize recovery or resend', () => {
  for (const mutation of ['hardlink', 'mode', 'size', 'partial-start']) {
    const f = fixture(); f.run(); f.calls.length = 0;
    const path = join(f.root, 'apply-journal.jsonl');
    if (mutation === 'hardlink') linkSync(path, join(f.root, 'journal-alias'));
    if (mutation === 'mode') chmodSync(path, 0o640);
    if (mutation === 'size') writeFileSync(path, Buffer.alloc(128 * 1024 + 1));
    if (mutation === 'partial-start') writeFileSync(path, '{"event":"started"');
    expect(() => f.run('reconcile')).toThrow();
    expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
    expect(f.calls).toEqual([]);
  }
});

test('prior ledger drift rejects before mutation or journal creation', () => {
  const f = fixture();
  f.dependencies.runPsqlImpl = (_url: string, sql: string, singleTransaction: boolean) => {
    f.calls.push({ sql, singleTransaction });
    return JSON.stringify({ ...record.migration.expectedPriorState.expected, ledgerCount: 90 });
  };
  expectCode(() => f.run(), 'THUMBNAIL_PRIOR_STATE_DRIFT');
  expect(f.calls.length).toBe(1);
  expect(sends(f)).toEqual([]);
  expect(existsSync(join(f.root, 'apply-journal.jsonl'))).toBe(false);
});

test('terminal extra ledger row is a conflict even with an apparently successful acknowledgement', () => {
  const f = fixture();
  const transport = f.dependencies.runPsqlImpl;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    const output = transport(...args);
    if (!args[1].includes('\\gset')) return output;
    const value = f.committed(); value.terminal.ledgerCount = 91;
    return JSON.stringify(value);
  };
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILIATION_CONFLICT');
  expect(sends(f).length).toBe(1);
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
});

test('drift after pre-read still meets the compiler prior guard under ledger lock, and failure never replays', () => {
  const f = fixture();
  const transport = f.dependencies.runPsqlImpl;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    const output = transport(...args);
    const sql = args[1];
    if (sql.includes('$thumbnail_serializer$')) {
      expect(sql.indexOf('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE'))
        .toBeLessThan(sql.indexOf('MIGRATION_PRIOR_STATE_MISMATCH'));
      expect(sql.indexOf('MIGRATION_PRIOR_STATE_MISMATCH'))
        .toBeLessThan(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations'));
      throw Object.assign(new Error('fixture: concurrent migration before lock'), { code: 'MIGRATION_PRIOR_STATE_MISMATCH' });
    }
    if (sql.includes('\\gset')) return JSON.stringify({
      ledger_exists: false, ledger_equal: false, terminal: null,
      prior: { ...record.migration.expectedPriorState.expected, ledgerCount: 90 },
    });
    return output;
  };
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILIATION_CONFLICT');
  expect(sends(f).length).toBe(1);
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
});

test('an exact prior readback is still unconfirmed without proof that the original operation is terminal', () => {
  const f = fixture();
  const transport = f.dependencies.runPsqlImpl;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    const output = transport(...args);
    if (args[1].includes('$thumbnail_serializer$')) throw new Error('rollback');
    return args[1].includes('\\gset') ? JSON.stringify({
      ledger_exists: false, ledger_equal: false, terminal: null,
      prior: record.migration.expectedPriorState.expected,
    }) : output;
  };
  expectCode(() => f.run(), 'THUMBNAIL_OUTCOME_UNCONFIRMED');
  expect(sends(f).length).toBe(1);
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
});

test('a pending original operation may commit after a prior snapshot; recovery observes it without resending', () => {
  const f = fixture();
  const transport = f.dependencies.runPsqlImpl;
  let originalCommitted = false;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    const output = transport(...args);
    if (args[1].includes('$thumbnail_serializer$')) throw new Error('response lost while backend remains live');
    if (args[1].includes('\\gset')) return JSON.stringify(originalCommitted ? f.committed() : {
      ledger_exists: false, ledger_equal: false, terminal: null,
      prior: record.migration.expectedPriorState.expected,
    });
    return output;
  };
  expectCode(() => f.run(), 'THUMBNAIL_OUTCOME_UNCONFIRMED');
  const journal = readFileSync(join(f.root, 'apply-journal.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(journal[1].code).toBe('THUMBNAIL_OUTCOME_UNCONFIRMED');
  expect(journal[1].disposition).toBe('prior_observed');
  expect(f.run('reconcile').disposition).toBe('prior_observed');
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
  originalCommitted = true;
  expect(f.run('reconcile').disposition).toBe('committed');
  expect(sends(f).length).toBe(1);
  expect(readFileSync(join(f.root, 'apply-journal.jsonl'), 'utf8').trim().split('\n').length).toBe(2);
});

test('journal file and parent fsync failures consume custody but make zero mutation sends', () => {
  for (const failAt of [1, 2]) {
    const f = fixture();
    let syncs = 0;
    f.dependencies.fsyncImpl = (fd: number) => { if (++syncs === failAt) throw new Error('disk failure'); fsyncSync(fd); };
    expectCode(() => f.run(), 'THUMBNAIL_JOURNAL_UNCONFIRMED');
    expect(sends(f)).toEqual([]);
    expect(existsSync(join(f.root, 'apply-journal.jsonl'))).toBe(true);
    expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
  }
});

test('post-commit append failure leaves durable start; new process can only reconcile', () => {
  const f = fixture();
  f.dependencies.appendJournalImpl = () => { throw new Error('disk failure'); };
  expectCode(() => f.run(), 'THUMBNAIL_JOURNAL_UNCONFIRMED');
  expect(sends(f).length).toBe(1);
  const journal = readFileSync(join(f.root, 'apply-journal.jsonl'), 'utf8');
  expect(journal.trim().split('\n').length).toBe(1);
  const count = f.calls.length;
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
  expect(f.calls.length).toBe(count);
  expect(f.run('reconcile').disposition).toBe('committed');
  expect(readFileSync(join(f.root, 'apply-journal.jsonl'), 'utf8')).toBe(journal);
});

test('expired admission, future or stale fence, missing coverage and source/hash drift reject before transport', () => {
  const cases: [((f: ReturnType<typeof fixture>) => void), string][] = [
    [f => { f.dependencies.now = () => new Date(expiresAt); }, 'THUMBNAIL_ADMISSION_EXPIRED'],
    [f => { f.fence.observedAt = '2026-10-24T10:00:06.000Z'; f.save(); }, 'THUMBNAIL_FENCE_STALE'],
    [f => { f.dependencies.now = () => new Date('2026-10-24T10:01:02.000Z'); }, 'THUMBNAIL_FENCE_STALE'],
    [f => { f.fence.coverage.pop(); f.save(); }, 'THUMBNAIL_FENCE_INVALID'],
    [f => { f.fence.fences.workerProvisioning = 'active'; f.save(); }, 'THUMBNAIL_FENCE_INVALID'],
    [f => { f.admission.sourceSha256 = '0'.repeat(64); f.save(); }, 'THUMBNAIL_ADMISSION_INVALID'],
    [f => { f.admission.vectorSha256 = '0'.repeat(64); f.save(); }, 'THUMBNAIL_ADMISSION_INVALID'],
    [f => { f.admission.releaseAdmissionSha256 = '0'.repeat(64); f.save(); }, 'THUMBNAIL_ADMISSION_INVALID'],
    [f => { f.admission.serverVersionNum = 170011; f.save(); }, 'THUMBNAIL_ADMISSION_INVALID'],
    [f => { f.dependencies.protectedRevisionImpl = () => 'b'.repeat(40); }, 'THUMBNAIL_SOURCE_DRIFT'],
    [f => { const read = f.dependencies.sourceImpl; f.dependencies.sourceImpl = () => ({ ...read(), clean: false }); }, 'THUMBNAIL_SOURCE_DRIFT'],
    [f => { const read = f.dependencies.sourceImpl; f.dependencies.sourceImpl = () => ({ ...read(), detached: false }); }, 'THUMBNAIL_SOURCE_DRIFT'],
    [f => { f.fence.ownerObservation.protected = false; f.save(); }, 'THUMBNAIL_FENCE_INVALID'],
  ];
  for (const [edit, code] of cases) {
    const f = fixture(); edit(f);
    expectCode(() => f.run(), code);
    expect(f.calls).toEqual([]);
    expect(existsSync(join(f.root, 'apply-journal.jsonl'))).toBe(false);
  }
});

test('a hash alone is insufficient: actual evidence bytes, current observation scope and custody are checked', () => {
  for (const mutation of ['bytes', 'scope', 'mode']) {
    const f = fixture();
    const name = 'workerProvisioning';
    const path = join(f.root, 'writer-fence-' + name + '.json');
    if (mutation === 'mode') chmodSync(path, 0o644);
    else {
      f.evidence[name].scope = 'historic-only';
      writePrivate(path, f.evidence[name]);
      if (mutation === 'scope') { f.fence.evidenceSha256[name] = sha(bytes(f.evidence[name])); f.save(); }
    }
    expectCode(() => f.run(), mutation === 'bytes' ? 'THUMBNAIL_FENCE_EVIDENCE_DRIFT'
      : mutation === 'scope' ? 'THUMBNAIL_FENCE_EVIDENCE_INVALID' : 'THUMBNAIL_CUSTODY_INVALID');
    expect(f.calls).toEqual([]);
  }
});

test('changed fence after prior readback is rejected before mutation', () => {
  const f = fixture();
  const transport = f.dependencies.runPsqlImpl;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    const output = transport(...args);
    f.fence.fences.privilegedCatalogWriters = 'uncontrolled'; f.save();
    return output;
  };
  expectCode(() => f.run(), 'THUMBNAIL_FENCE_EVIDENCE_DRIFT');
  expect(f.calls.length).toBe(1);
  expect(sends(f)).toEqual([]);
  expect(existsSync(join(f.root, 'apply-journal.jsonl'))).toBe(false);
});

test('source changes during journal publication consume attempt without sending', () => {
  const f = fixture();
  let syncs = 0;
  f.dependencies.fsyncImpl = (fd: number) => {
    fsyncSync(fd);
    if (++syncs === 2) f.dependencies.protectedRevisionImpl = () => 'b'.repeat(40);
  };
  // Dependencies are captured once, so model a changing observation, not a new callback.
  f.dependencies.protectedRevisionImpl = () => syncs >= 2 ? 'b'.repeat(40) : revision;
  expectCode(() => f.run(), 'THUMBNAIL_OUTCOME_UNCONFIRMED');
  expect(sends(f)).toEqual([]);
  expectCode(() => f.run(), 'THUMBNAIL_RECONCILE_REQUIRED');
});

test('target spoofing, credential overlap and an unverified local owner are rejected before transport', () => {
  for (const edit of [
    (f: ReturnType<typeof fixture>) => { f.environment.SUPABASE_DB_URL = 'postgresql://postgres@db.wrong.supabase.co:5432/postgres'; },
    (f: ReturnType<typeof fixture>) => { f.environment.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only'; },
    (f: ReturnType<typeof fixture>) => { f.dependencies.attestationImpl = () => ({ ...localOwner(), identityVerified: false }); },
  ]) {
    const f = fixture(); edit(f);
    expect(() => f.run()).toThrow();
    expect(f.calls).toEqual([]);
  }
});
