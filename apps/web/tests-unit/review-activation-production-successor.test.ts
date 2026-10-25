import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, fstatSync, fsyncSync, linkSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import {
  CUSTODY_DIRECTORY, MANIFEST_PATH, MANIFEST_SHA256, PROJECT_REF, RELEASE_ADMISSION_PATH,
  RELEASE_ADMISSION_SHA256, REPOSITORY_ROOT, REQUIRED_FENCES, SERIALIZER_KEY,
  reviewActivationApplySql, reviewActivationReleaseContract, loadReviewActivationRecord, loadReviewActivationRelease,
  runReviewActivationSuccessor, validateReviewActivationAdmission, validateReviewActivationRelease,
  observeReviewActivationPredecessor,
} from '../scripts/review-activation-production-successor.mjs';
import { main, operateReviewActivationSuccessor, prepareReviewActivationOperation } from '../scripts/review-activation-operating-collector.mjs';

// Real source, official parser, compiler, admission validation and private-file
// operations. Only observations, transport, clock/UUID and test custody are DI.
// These tests do not observe hosted state or exercise the real gh/psql binaries.
const record = loadReviewActivationRecord();
const revision = 'b'.repeat(40);
const attemptId = '01234567-89ab-4cde-8fab-0123456789ab';
const predecessorId = '11234567-89ab-4cde-8fab-0123456789ab';
const instant = '2026-10-24T10:00:00.000Z';
const roots: string[] = [];
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const bytes = (v: any) => Buffer.from(JSON.stringify(canonical(v)) + '\n');
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const clone = (v: any) => JSON.parse(JSON.stringify(v));
function expectCode(run: () => unknown, code: string) {
  let caught: any;
  try { run(); } catch (error) { caught = error; }
  expect(caught?.code).toBe(code);
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'reviewActivation-operation-test-')));
  chmodSync(root, 0o700); roots.push(root);
  const directory = join(root, 'custody');
  const calls: { sql: string; singleTransaction: boolean }[] = [];
  const syncs: string[] = [];
  let predecessors = 0;
  const environment: any = {
    HOME: userInfo().homedir, REVIEW_ACTIVATION_PRIVILEGED_CUSTODY: 'true',
    SUPABASE_DB_URL: `postgresql://postgres@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`,
  };
  const state: any = { prior: clone(record.migration.expectedPriorState.expected),
    terminal: clone(record.migration.terminalReadback.expected), outcome: 'committed', ackLost: false };
  const dependencies: any = {
    loadRecordImpl: () => record, loadReleaseImpl: loadReviewActivationRelease, custodyDirectory: directory,
    now: () => new Date(instant), uuidImpl: () => attemptId,
    sourceImpl: () => ({ revision, clean: true, detached: true, origin: 'https://github.com/twoimo/tzudong.git' }),
    protectedRevisionImpl: () => revision,
    attestationImpl: ({ operationId, clock }: any) => ({
      kind: 'thumbnail-local-owner-observation-v1', authority: 'authenticated-repository-owner-local-cli',
      operationId, repository: 'twoimo/tzudong', principal: 'repository-owner', identityVerified: true,
      branch: 'main', protected: true, sourceRevision: revision, observedAt: clock().toISOString(),
    }),
    predecessorImpl: () => { predecessors++; return {
      status: 'reconciliation', disposition: 'committed', attemptId: predecessorId, replayAllowed: false,
      admissionSha256: 'a'.repeat(64), journalSha256: 'b'.repeat(64), journalFirstEntrySha256: 'c'.repeat(64),
    }; },
    fsyncImpl: (fd: number) => { syncs.push(fstatSync(fd).isDirectory() ? 'directory' : 'file'); fsyncSync(fd); },
    runPsqlImpl: (_url: string, sql: string, singleTransaction: boolean) => {
      calls.push({ sql, singleTransaction });
      if (sql.includes('$provider_budget_serializer$')) {
        if (state.ackLost) throw new Error('raw-transport-canary-do-not-output');
        return JSON.stringify(state.terminal) + '\n';
      }
      if (sql.includes('\\if :ledger_exists')) return JSON.stringify(state.outcome === 'prior_observed'
        ? { ledger_exists: false, ledger_equal: false, prior: state.prior, terminal: null }
        : { ledger_exists: true, ledger_equal: state.outcome !== 'vector_conflict', prior: null, terminal: state.terminal }) + '\n';
      return JSON.stringify(state.prior) + '\n';
    },
  };
  const confirmation = `apply:${revision}:${MANIFEST_SHA256}`;
  return { root, directory, environment, dependencies, state, calls, syncs,
    get predecessors() { return predecessors; },
    prepare: () => prepareReviewActivationOperation({ environment, confirmation }, dependencies),
    apply: () => operateReviewActivationSuccessor({ mode: 'apply', environment, confirmation }, dependencies),
    send: () => runReviewActivationSuccessor({ mode: 'apply', environment }, dependencies),
    reconcile: () => operateReviewActivationSuccessor({ mode: 'reconcile', environment }, dependencies),
  };
}
const sends = (f: ReturnType<typeof fixture>) => f.calls.filter(c => c.sql.includes('$provider_budget_serializer$'));
const snapshot = (directory: string) => Object.fromEntries(readdirSync(directory).sort().map(name =>
  [name, readFileSync(join(directory, name)).toString('hex')]));

test('inspect uses exact four-statement draft without release, owner, predecessor or DB observations', () => {
  const unreachable = () => { throw new Error('external observation forbidden'); };
  const result = operateReviewActivationSuccessor({ mode: 'inspect', environment: {} }, {
    loadReleaseImpl: unreachable, sourceImpl: unreachable, protectedRevisionImpl: unreachable,
    attestationImpl: unreachable, predecessorImpl: unreachable, runPsqlImpl: unreachable,
  });
  expect(result).toEqual({ status: 'held', executionEnabled: false, manifestSha256: MANIFEST_SHA256,
    sourceSha256: record.migration.sha256, vectorSha256: record.envelope.vectorSha256, statementCount: 4 });
  expect(CUSTODY_DIRECTORY).toBe(join(userInfo().homedir, '.codex/runtime-cache/review-activation-production-successor', PROJECT_REF, MANIFEST_SHA256));
  expect(REQUIRED_FENCES).toEqual({ privilegedCatalogWriters: 'controlled' });
});

test('separate exact release is installed; neither false draft nor noncanonical/changed contract authorizes a send', () => {
  expect(loadReviewActivationRelease().sha256).toBe(RELEASE_ADMISSION_SHA256);
  expect(readFileSync(join(REPOSITORY_ROOT, RELEASE_ADMISSION_PATH))).toEqual(bytes(reviewActivationReleaseContract()));
  for (const edit of [
    (v: any) => { v.executionEnabled = false; }, (v: any) => { v.projectRef = 'other'; },
    (v: any) => { v.originalVectorSha256 = '0'.repeat(64); },
    (v: any) => { v.predecessorRequiredDisposition = 'prior_observed'; },
    (v: any) => { v.requiredFences.workerProvisioning = 'withheld'; },
  ]) { const value = reviewActivationReleaseContract(); edit(value);
    expectCode(() => validateReviewActivationRelease(bytes(value)), 'REVIEW_ACTIVATION_RELEASE_ADMISSION_INVALID'); }
  expectCode(() => validateReviewActivationRelease(Buffer.concat([bytes(reviewActivationReleaseContract()), Buffer.from('\n')])),
    'REVIEW_ACTIVATION_RELEASE_ADMISSION_INVALID');
  expect(record.manifest.executionEnabled).toBe(false);
});

test('fixed policy-free catalog contract changes only configure body and 91-to92 ledger admission', () => {
  const prior = record.migration.expectedPriorState.expected;
  const terminal = clone(prior);
  expect(prior.ledgerCount).toBe(91); expect(prior.ledgerPrefixCount).toBe(91);
  expect(prior.ledgerPrefixDigest).toBe('fa0d91d7badd9ae960938fbb49a153d1b11eed77c147a869fd752bfb411c84e0');
  expect(prior.ledgerTargetPresent).toBe(false);
  const configure = terminal.functions.find((f: any) => f.signature.startsWith('public.restaurant_review_automation_configure('));
  expect(configure.bodySha256).toBe('6fe71abbb6fd73ce34758f5584b6bf5ad6d033f075c22b64161a710d69da1c57');
  configure.bodySha256 = '602fffdcdc81fd7b96c70a40ff04a225c53c9a43c4320b778681cd5e7237bf5c';
  terminal.ledgerCount = 92; terminal.ledgerTargetPresent = true;
  expect(record.migration.terminalReadback.expected).toEqual(terminal);
  expect(prior).not.toHaveProperty('policy'); expect(prior).not.toHaveProperty('policies');
  expect(prior.revisionServicePrivileges).toEqual([true, false, false]);
  expect(record.envelope.originalVector).toHaveLength(4);
  expect(record.envelope.vectorSha256).toBe('65b506ca4d44ba47b96d5b2efa6c6b593d56bfe2db1f4226cf0069aaf3997c91');
  const predecessor = reviewActivationReleaseContract();
  expect(predecessor.predecessorLedgerCount).toBe(91);
  expect(predecessor.predecessorManifestSha256).toBe('fdc67b1d2a8b1a69bae70b75c659eb3726a423c13c00dbbe1f7c1ee50b44dfd9');
  expect(predecessor.predecessorCustodyBinding).toBe('original-budget-admission-and-journal');
  expect(predecessor.predecessorObservation).toBe('prepare-only-never-during-activation-reconciliation');
});

test('raw revision ACL, role/default metadata, helper hash and ledger prior remain exact', () => {
  for (const change of [
    (v: any) => { v.revisionTable[1] = null; },
    (v: any) => { v.revisionServicePrivileges[2] = true; },
    (v: any) => { v.rolesDigest = '0'.repeat(64); },
    (v: any) => { v.defaultAclDigest = '0'.repeat(64); },
    (v: any) => { v.functions[0].bodySha256 = '0'.repeat(64); },
    (v: any) => { v.ledgerPrefixDigest = '0'.repeat(64); },
  ]) {
    const f = fixture(); change(f.state.prior);
    expectCode(f.apply, 'REVIEW_ACTIVATION_PRIOR_STATE_DRIFT');
    expect(sends(f)).toHaveLength(0); expect(existsSync(f.directory)).toBe(false);
  }
});

test('missing release rejects preparation before source, credential, custody or DB observation', () => {
  const f = fixture();
  f.dependencies.loadReleaseImpl = () => { throw Object.assign(new Error('missing'), { code: 'REVIEW_ACTIVATION_RELEASE_ADMISSION_REQUIRED' }); };
  for (const key of ['loadRecordImpl', 'sourceImpl', 'protectedRevisionImpl', 'attestationImpl', 'predecessorImpl', 'runPsqlImpl'])
    f.dependencies[key] = () => { throw new Error('must not reach'); };
  expectCode(f.apply, 'REVIEW_ACTIVATION_RELEASE_ADMISSION_REQUIRED');
  expect(readdirSync(f.root)).toEqual([]);
  expect(f.syncs).toEqual([]);
});

test('real manifest, candidate, frozen predecessor, transitive tools and official parser reject drift', () => {
  for (const [path, code] of [
    [MANIFEST_PATH, 'MANIFEST'], [record.migration.candidatePath, 'SOURCE'],
    ['apps/web/scripts/provider-budget-production-successor.mjs', 'TOOLCHAIN'],
    ['apps/web/scripts/supabase-migration-transaction.mjs', 'TOOLCHAIN'],
    ['backend/supabase/scripts/g037_supabase_statement_vector.mjs', 'TOOLCHAIN'],
    ['.github/provider-budget-installation.operating.v1.json', 'TOOLCHAIN'],
    ['apps/web/scripts/thumbnail-production-successor.mjs', 'TOOLCHAIN'],
    ['apps/web/scripts/supabase-migration-bundle.mjs', 'TOOLCHAIN'],
    ['backend/supabase/certificates/prod-ca-2021.crt', 'TOOLCHAIN'],
  ]) expectCode(() => loadReviewActivationRecord({ readBytesImpl: (absolute: string) => absolute === join(REPOSITORY_ROOT, path)
    ? Buffer.concat([readFileSync(absolute), Buffer.from('\n')]) : readFileSync(absolute) }), `REVIEW_ACTIVATION_${code}_DRIFT`);
  let parserPath = '';
  expectCode(() => loadReviewActivationRecord({ readVectorImpl: (migration: any, raw: Buffer) => {
    parserPath = migration.path;
    expect(parserPath.endsWith('/20261024160000_restaurant_review_activation_lock.sql')).toBe(true);
    expect(readFileSync(parserPath)).toEqual(raw);
    expect(statSync(parserPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(parserPath, '..')).mode & 0o777).toBe(0o700);
    return [...record.envelope.originalVector, 'COMMIT'];
  } }), 'REVIEW_ACTIVATION_VECTOR_DRIFT');
  expect(existsSync(parserPath)).toBe(false);
});

test('prepare persists bounded exact predecessor/prior and private canonical admission with actual fsync', () => {
  const f = fixture();
  expect(f.prepare().status).toBe('prepared');
  expect(f.predecessors).toBe(1);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].sql).toContain('REPEATABLE READ READ ONLY');
  expect(sends(f)).toHaveLength(0);
  expect(statSync(f.directory).mode & 0o777).toBe(0o700);
  expect(readdirSync(f.directory)).toHaveLength(5);
  for (const name of readdirSync(f.directory)) {
    const path = join(f.directory, name), stat = statSync(path);
    expect(stat.mode & 0o777).toBe(0o600); expect(stat.nlink).toBe(1); expect(stat.uid).toBe(process.getuid!());
    expect(readFileSync(path)).toEqual(bytes(readJson(path)));
  }
  const admission = readJson(join(f.directory, 'admission.json'));
  const fence = readJson(join(f.directory, 'writer-fence.json'));
  expect(() => validateReviewActivationAdmission(admission, fence, bytes(fence), record, new Date(instant))).not.toThrow();
  expect(admission.predecessorSha256).toBe(sha(readFileSync(join(f.directory, 'budget-predecessor.json'))));
  expect(f.syncs.filter(t => t === 'file')).toHaveLength(5);
  expect(f.syncs.filter(t => t === 'directory').length).toBeGreaterThanOrEqual(7);
});

test('prepare through send uses durable pre-send journal, exact serializer/compiler order and one transaction', () => {
  const f = fixture(), transport = f.dependencies.runPsqlImpl;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    if (args[1].includes('$provider_budget_serializer$')) {
      const raw = readFileSync(join(f.directory, 'apply-journal.jsonl'));
      const first = JSON.parse(raw.toString());
      expect(first.event).toBe('started'); expect(first.attemptId).toBe(attemptId);
      expect(first.admissionSha256).toBe(sha(readFileSync(join(f.directory, 'admission.json'))));
      expect(first.sqlSha256).toBe(sha(args[1]));
      expect(f.syncs.slice(-2)).toEqual(['file', 'directory']);
    }
    return transport(...args);
  };
  expect(f.apply().status).toBe('committed');
  expect(sends(f)).toHaveLength(1); expect(f.calls).toHaveLength(4);
  expect(f.calls.every(c => c.singleTransaction)).toBe(true);
  const sql = sends(f)[0].sql;
  expect(sql.startsWith(record.manifest.executionContract.serializerSql)).toBe(true);
  expect(sql.indexOf(SERIALIZER_KEY)).toBeLessThan(sql.indexOf('LOCK TABLE supabase_migrations.schema_migrations'));
  expect(sql).toContain('MIGRATION_PRIOR_STATE_MISMATCH');
  expect(sql).toContain('MIGRATION_TERMINAL_READBACK_FAILED');
  expect(sql).toContain('REVIEW_ACTIVATION_ADMISSION_EXPIRED');
  expect(sql).toBe(reviewActivationApplySql(record, readJson(join(f.directory, 'admission.json'))));
  const original = snapshot(f.directory);
  expectCode(f.apply, 'REVIEW_ACTIVATION_CUSTODY_ALREADY_EXISTS');
  expectCode(f.send, 'REVIEW_ACTIVATION_RECONCILE_REQUIRED');
  expect(sends(f)).toHaveLength(1); expect(snapshot(f.directory)).toEqual(original);
});

test('original budget must be committed; prior_observed, unknown, conflict and malformed identity publish nothing', () => {
  for (const disposition of ['prior_observed', 'unknown', 'partial_conflict', 'not_applied']) {
    const f = fixture(); f.dependencies.predecessorImpl = () => ({ status: 'reconciliation', disposition, attemptId: predecessorId, replayAllowed: false });
    expectCode(f.apply, 'REVIEW_ACTIVATION_PREDECESSOR_UNCONFIRMED');
    expect(f.calls).toHaveLength(0); expect(existsSync(f.directory)).toBe(false);
  }
  const f = fixture(); f.dependencies.predecessorImpl = () => ({ status: 'reconciliation', disposition: 'committed', attemptId: 'wrong', replayAllowed: false });
  expectCode(f.apply, 'REVIEW_ACTIVATION_PREDECESSOR_INVALID');
  expect(sends(f)).toHaveLength(0); expect(existsSync(f.directory)).toBe(false);
  for (const field of ['admissionSha256', 'journalSha256', 'journalFirstEntrySha256']) {
    const f = fixture(), observed = f.dependencies.predecessorImpl;
    f.dependencies.predecessorImpl = () => ({ ...observed(), [field]: 'invalid' });
    expectCode(f.apply, 'REVIEW_ACTIVATION_PREDECESSOR_INVALID');
    expect(sends(f)).toHaveLength(0); expect(existsSync(f.directory)).toBe(false);
  }
});

test('default predecessor observer delegates only original read-only reconcile and binds actual private budget custody', () => {
  const f = fixture(), directory = join(f.root, 'original-budget');
  mkdirSync(directory, { mode: 0o700 });
  const release = reviewActivationReleaseContract();
  const original = { kind: 'provider-budget-production-admission-v1', attemptId: predecessorId,
    manifestSha256: release.predecessorManifestSha256, releaseAdmissionSha256: release.predecessorReleaseAdmissionSha256,
    projectRef: PROJECT_REF, databaseName: 'postgres', executorRole: 'postgres', serverVersionNum: 170006,
    sourceRevision: revision };
  writeFileSync(join(directory, 'admission.json'), bytes(original), { mode: 0o600 });
  const first = { event: 'started', attemptId: predecessorId, admissionSha256: sha(bytes(original)),
    manifestSha256: original.manifestSha256, releaseAdmissionSha256: original.releaseAdmissionSha256,
    sourceRevision: revision, sqlSha256: 'd'.repeat(64) };
  // The frozen predecessor permits recovery from a partial terminal append;
  // bind those exact preserved bytes too, without reparsing or rewriting it.
  const journal = Buffer.concat([bytes(first), Buffer.from('{"event":')]);
  writeFileSync(join(directory, 'apply-journal.jsonl'), journal, { mode: 0o600 });
  const before = snapshot(directory), requests: any[] = [];
  const deps = { custodyDirectory: directory, runPredecessorImpl: (request: any) => {
    requests.push(request); return { status: 'reconciliation', disposition: 'committed', attemptId: predecessorId, replayAllowed: false };
  } };
  const receipt = observeReviewActivationPredecessor(f.environment, deps);
  expect(requests).toEqual([{ mode: 'reconcile', environment: f.environment }]);
  expect(receipt.admissionSha256).toBe(sha(bytes(original)));
  expect(receipt.journalSha256).toBe(sha(journal)); expect(receipt.journalFirstEntrySha256).toBe(sha(bytes(first)));
  expect(snapshot(directory)).toEqual(before);
  writeFileSync(join(directory, 'apply-journal.jsonl'), bytes({ ...first, attemptId }), { mode: 0o600 });
  expectCode(() => observeReviewActivationPredecessor(f.environment, deps), 'REVIEW_ACTIVATION_PREDECESSOR_INVALID');
  writeFileSync(join(directory, 'apply-journal.jsonl'), journal, { mode: 0o600 });
  linkSync(join(directory, 'apply-journal.jsonl'), join(f.root, 'journal-link'));
  expectCode(() => observeReviewActivationPredecessor(f.environment, deps), 'REVIEW_ACTIVATION_CUSTODY_INVALID');
});

test('source, protected branch, owner, target, confirmation and custody failures reject before transport', () => {
  for (const change of [
    (f: any) => { f.dependencies.sourceImpl = () => ({ revision, clean: false }); },
    (f: any) => { f.dependencies.protectedRevisionImpl = () => 'c'.repeat(40); },
    (f: any) => { const owner = f.dependencies.attestationImpl; f.dependencies.attestationImpl = (args: any) => ({ ...owner(args), principal: 'admin-collaborator' }); },
    (f: any) => { f.environment.SUPABASE_DB_URL = 'postgresql://postgres@other.invalid/postgres'; },
    (f: any) => { delete f.environment.REVIEW_ACTIVATION_PRIVILEGED_CUSTODY; },
  ]) { const f = fixture(); change(f); expect(() => f.apply()).toThrow();
    expect(f.calls).toHaveLength(0); expect(f.predecessors).toBe(0); expect(existsSync(f.directory)).toBe(false); }
  const f = fixture();
  expectCode(() => prepareReviewActivationOperation({ environment: f.environment, confirmation: 'apply:wrong' }, f.dependencies), 'REVIEW_ACTIVATION_CONFIRMATION_INVALID');
  expect(f.calls).toHaveLength(0);
});

test('expired admission, stale owner and malformed/future dates cannot send', () => {
  for (const elapsed of [60_001, 900_000]) {
    const f = fixture(); f.prepare(); f.dependencies.now = () => new Date(Date.parse(instant) + elapsed);
    expect(() => f.send()).toThrow(); expect(sends(f)).toHaveLength(0);
    expect(existsSync(join(f.directory, 'apply-journal.jsonl'))).toBe(false);
  }
  const f = fixture(), owner = f.dependencies.attestationImpl;
  f.dependencies.attestationImpl = (args: any) => ({ ...owner(args), observedAt: '2026-10-24T11:00:00.000Z' });
  expectCode(f.apply, 'REVIEW_ACTIVATION_OWNER_ATTESTATION_INVALID'); expect(f.calls).toHaveLength(0);
});

test('fresh exact prior drift fails before journal; the compiled SQL also guards a later concurrent drift', () => {
  const f = fixture(); f.prepare(); f.state.prior.ledgerPrefixDigest = '0'.repeat(64);
  expectCode(f.send, 'REVIEW_ACTIVATION_PRIOR_STATE_DRIFT');
  expect(sends(f)).toHaveLength(0); expect(existsSync(join(f.directory, 'apply-journal.jsonl'))).toBe(false);
  const g = fixture(); g.state.prior.ledgerCount = 90;
  expectCode(g.apply, 'REVIEW_ACTIVATION_PRIOR_STATE_DRIFT'); expect(existsSync(g.directory)).toBe(false);
});

test('fence/predecessor hash or input-file security drift fails before send', () => {
  for (const action of ['fence', 'predecessor', 'mode', 'hardlink', 'symlink', 'oversized']) {
    const f = fixture(); f.prepare(); const path = join(f.directory, 'writer-fence.json');
    if (action === 'fence') writeFileSync(path, bytes({ ...readJson(path), coverage: [] }));
    if (action === 'predecessor') writeFileSync(join(f.directory, 'budget-predecessor.json'), bytes({ ...readJson(join(f.directory, 'budget-predecessor.json')), disposition: 'prior_observed' }));
    if (action === 'mode') chmodSync(path, 0o644);
    if (action === 'hardlink') linkSync(path, join(f.root, 'linked'));
    if (action === 'symlink') { const backup = join(f.root, 'copy'); writeFileSync(backup, readFileSync(path)); rmSync(path); symlinkSync(backup, path); }
    if (action === 'oversized') writeFileSync(path, 'x'.repeat(128 * 1024 + 1));
    expect(() => f.send()).toThrow(); expect(sends(f)).toHaveLength(0);
  }
});

test('partial directory/file publication is preserved and cannot silently issue another admission', () => {
  for (const failAt of [1, 4, 7]) {
    const f = fixture(); let count = 0;
    f.dependencies.fsyncImpl = (fd: number) => { if (++count === failAt) throw new Error('disk failure'); fsyncSync(fd); };
    expectCode(f.apply, 'REVIEW_ACTIVATION_CUSTODY_PUBLICATION_UNCONFIRMED');
    expect(existsSync(f.directory)).toBe(true); const original = snapshot(f.directory);
    expectCode(f.apply, 'REVIEW_ACTIVATION_CUSTODY_ALREADY_EXISTS');
    expect(snapshot(f.directory)).toEqual(original); expect(sends(f)).toHaveLength(0);
  }
  const f = fixture(); mkdirSync(f.directory, { mode: 0o700 });
  expectCode(f.apply, 'REVIEW_ACTIVATION_CUSTODY_ALREADY_EXISTS'); expect(f.calls).toHaveLength(0);
});

test('journal fsync failure consumes the original attempt before any SQL send', () => {
  const f = fixture(); f.prepare(); f.dependencies.fsyncImpl = () => { throw new Error('disk failure'); };
  expectCode(f.send, 'REVIEW_ACTIVATION_JOURNAL_UNCONFIRMED');
  expect(existsSync(join(f.directory, 'apply-journal.jsonl'))).toBe(true);
  expect(sends(f)).toHaveLength(0);
  expectCode(f.send, 'REVIEW_ACTIVATION_RECONCILE_REQUIRED');
});

test('post-journal revalidation failure consumes the attempt and does not send', () => {
  const f = fixture(); f.prepare();
  // Initial load, pre-journal validation, then the post-journal source reload.
  let reloads = 0;
  f.dependencies.loadRecordImpl = () => { if (++reloads >= 3) throw new Error('source drift'); return record; };
  expectCode(f.send, 'REVIEW_ACTIVATION_OUTCOME_UNCONFIRMED');
  expect(sends(f)).toHaveLength(0);
  f.dependencies.loadRecordImpl = () => record;
  expectCode(f.send, 'REVIEW_ACTIVATION_RECONCILE_REQUIRED');
});

test('ACK loss with prior snapshot stays UNCONFIRMED; later committed recovery never sends or changes custody', () => {
  const f = fixture(); f.state.ackLost = true; f.state.outcome = 'prior_observed';
  expectCode(f.apply, 'REVIEW_ACTIVATION_OUTCOME_UNCONFIRMED'); expect(sends(f)).toHaveLength(1);
  const original = snapshot(f.directory);
  expect(f.reconcile()).toEqual({ status: 'reconciliation', disposition: 'prior_observed', attemptId, replayAllowed: false });
  expectCode(f.send, 'REVIEW_ACTIVATION_RECONCILE_REQUIRED');
  f.state.outcome = 'committed';
  f.dependencies.now = () => new Date('2026-10-25T10:00:00.000Z');
  const owner = f.dependencies.attestationImpl;
  f.dependencies.attestationImpl = (args: any) => ({ ...owner(args), sourceRevision: 'c'.repeat(40) });
  for (const key of ['sourceImpl', 'protectedRevisionImpl', 'predecessorImpl'])
    f.dependencies[key] = () => { throw new Error('must not rebind historical attempt'); };
  expect(f.reconcile().disposition).toBe('committed');
  expect(sends(f)).toHaveLength(1); expect(snapshot(f.directory)).toEqual(original);
  expect(Object.values(original).map(hex => Buffer.from(hex, 'hex').toString()).join('\n'))
    .not.toContain('raw-transport-canary-do-not-output');
});

test('lost ACK after commit remains unconfirmed until explicit read-only recovery', () => {
  const f = fixture(); f.state.ackLost = true;
  expectCode(f.apply, 'REVIEW_ACTIVATION_OUTCOME_UNCONFIRMED');
  expect(f.reconcile().disposition).toBe('committed');
  expectCode(f.send, 'REVIEW_ACTIVATION_RECONCILE_REQUIRED'); expect(sends(f)).toHaveLength(1);
});

test('partial terminal append preserves first journal binding for recovery, never resend', () => {
  const f = fixture();
  f.dependencies.appendJournalImpl = () => { writeFileSync(join(f.directory, 'apply-journal.jsonl'), '{"event":', { flag: 'a' }); throw new Error('disk partial'); };
  expectCode(f.apply, 'REVIEW_ACTIVATION_JOURNAL_UNCONFIRMED');
  const original = snapshot(f.directory);
  expect(f.reconcile().disposition).toBe('committed'); expectCode(f.send, 'REVIEW_ACTIVATION_RECONCILE_REQUIRED');
  expect(snapshot(f.directory)).toEqual(original); expect(sends(f)).toHaveLength(1);
});

test('corrupt or untrusted journal blocks reconciliation and cannot enable another send', () => {
  for (const action of ['partial-first', 'binding', 'hardlink', 'mode', 'oversized']) {
    const f = fixture(); f.apply(); const path = join(f.directory, 'apply-journal.jsonl');
    if (action === 'partial-first') writeFileSync(path, '{"event":');
    if (action === 'binding') { const first = JSON.parse(readFileSync(path, 'utf8').split('\n')[0]); first.attemptId = predecessorId; writeFileSync(path, bytes(first)); }
    if (action === 'hardlink') linkSync(path, join(f.root, 'linked'));
    if (action === 'mode') chmodSync(path, 0o644);
    if (action === 'oversized') writeFileSync(path, 'x'.repeat(128 * 1024 + 1));
    expect(() => f.reconcile()).toThrow(); expectCode(f.send, 'REVIEW_ACTIVATION_RECONCILE_REQUIRED'); expect(sends(f)).toHaveLength(1);
  }
});

test('target vector, terminal extra row, prefix and function drift are conflicts after a single send', () => {
  for (const change of [
    (f: any) => { f.state.outcome = 'vector_conflict'; },
    (f: any) => { f.state.terminal.ledgerCount = 93; },
    (f: any) => { f.state.terminal.ledgerPrefixDigest = '0'.repeat(64); },
    (f: any) => { f.state.terminal.functions[0].bodySha256 = '0'.repeat(64); },
  ]) { const f = fixture(); change(f);
    expectCode(f.apply, 'REVIEW_ACTIVATION_RECONCILIATION_CONFLICT');
    expect(f.reconcile().disposition).toBe('partial_conflict'); expectCode(f.send, 'REVIEW_ACTIVATION_RECONCILE_REQUIRED');
    expect(sends(f)).toHaveLength(1); }
});

test('CLI exposes no path/SQL/readiness overrides; fixed errors never print supplied secrets', () => {
  for (const argv of [
    ['--mode', 'bad'], ['--mode', 'apply', '--ready', 'true'], ['--manifest', MANIFEST_PATH],
    ['--mode', 'reconcile', '--confirmation', 'anything'], ['--mode', 'apply', '--custody', '/tmp/other'],
    ['--mode', 'inspect', '--mode', 'apply'],
  ]) expectCode(() => main(argv), 'REVIEW_ACTIVATION_ARGUMENT_INVALID');
  const child = spawnSync(process.execPath, [join(REPOSITORY_ROOT, 'apps/web/scripts/review-activation-operating-collector.mjs'),
    '--secret', 'private-input-canary-do-not-output'], { encoding: 'utf8', env: {} });
  expect(child.status).toBe(1); expect(child.stdout).toBe('');
  expect(child.stderr.trim()).toBe('{"status":"failed","code":"REVIEW_ACTIVATION_ARGUMENT_INVALID"}');
});
