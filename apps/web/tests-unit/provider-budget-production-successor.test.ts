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
  budgetApplySql, budgetReleaseContract, loadBudgetRecord, loadBudgetRelease,
  runBudgetSuccessor, validateBudgetAdmission, validateBudgetRelease,
} from '../scripts/provider-budget-production-successor.mjs';
import { main, operateBudgetSuccessor, prepareBudgetOperation } from '../scripts/provider-budget-operating-collector.mjs';

// Real source, official parser, compiler, admission validation and private-file
// operations. Only observations, transport, clock/UUID and test custody are DI.
// These tests do not observe hosted state or exercise the real gh/psql binaries.
const record = loadBudgetRecord();
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'budget-operation-test-')));
  chmodSync(root, 0o700); roots.push(root);
  const directory = join(root, 'custody');
  const calls: { sql: string; singleTransaction: boolean }[] = [];
  const syncs: string[] = [];
  let predecessors = 0;
  const environment: any = {
    HOME: userInfo().homedir, PROVIDER_BUDGET_PRIVILEGED_CUSTODY: 'true',
    SUPABASE_DB_URL: `postgresql://postgres@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`,
  };
  const state: any = { prior: clone(record.migration.expectedPriorState.expected),
    terminal: clone(record.migration.terminalReadback.expected), outcome: 'committed', ackLost: false };
  const dependencies: any = {
    loadRecordImpl: () => record, loadReleaseImpl: loadBudgetRelease, custodyDirectory: directory,
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
    }; },
    fsyncImpl: (fd: number) => { syncs.push(fstatSync(fd).isDirectory() ? 'directory' : 'file'); fsyncSync(fd); },
    runPsqlImpl: (_url: string, sql: string, singleTransaction: boolean) => {
      calls.push({ sql, singleTransaction });
      if (sql.includes('$provider_budget_serializer$')) {
        if (state.ackLost) throw new Error('password=never-persist-raw-transport');
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
    prepare: () => prepareBudgetOperation({ environment, confirmation }, dependencies),
    apply: () => operateBudgetSuccessor({ mode: 'apply', environment, confirmation }, dependencies),
    send: () => runBudgetSuccessor({ mode: 'apply', environment }, dependencies),
    reconcile: () => operateBudgetSuccessor({ mode: 'reconcile', environment }, dependencies),
  };
}
const sends = (f: ReturnType<typeof fixture>) => f.calls.filter(c => c.sql.includes('$provider_budget_serializer$'));
const snapshot = (directory: string) => Object.fromEntries(readdirSync(directory).sort().map(name =>
  [name, readFileSync(join(directory, name)).toString('hex')]));

test('inspect uses exact 24-statement draft without release, owner, predecessor or DB observations', () => {
  const unreachable = () => { throw new Error('external observation forbidden'); };
  const result = operateBudgetSuccessor({ mode: 'inspect', environment: {} }, {
    loadReleaseImpl: unreachable, sourceImpl: unreachable, protectedRevisionImpl: unreachable,
    attestationImpl: unreachable, predecessorImpl: unreachable, runPsqlImpl: unreachable,
  });
  expect(result).toEqual({ status: 'held', executionEnabled: false, manifestSha256: MANIFEST_SHA256,
    sourceSha256: record.migration.sha256, vectorSha256: record.envelope.vectorSha256, statementCount: 24 });
  expect(CUSTODY_DIRECTORY).toBe(join(userInfo().homedir, '.codex/runtime-cache/provider-budget-production-successor', PROJECT_REF, MANIFEST_SHA256));
  expect(REQUIRED_FENCES).toEqual({ privilegedCatalogWriters: 'controlled' });
});

test('separate exact release is installed; neither false draft nor noncanonical/changed contract authorizes a send', () => {
  expect(loadBudgetRelease().sha256).toBe(RELEASE_ADMISSION_SHA256);
  expect(readFileSync(join(REPOSITORY_ROOT, RELEASE_ADMISSION_PATH))).toEqual(bytes(budgetReleaseContract()));
  for (const edit of [
    (v: any) => { v.executionEnabled = false; }, (v: any) => { v.projectRef = 'other'; },
    (v: any) => { v.originalVectorSha256 = '0'.repeat(64); },
    (v: any) => { v.predecessorRequiredDisposition = 'prior_observed'; },
    (v: any) => { v.requiredFences.workerProvisioning = 'withheld'; },
  ]) { const value = budgetReleaseContract(); edit(value);
    expectCode(() => validateBudgetRelease(bytes(value)), 'PROVIDER_BUDGET_RELEASE_ADMISSION_INVALID'); }
  expectCode(() => validateBudgetRelease(Buffer.concat([bytes(budgetReleaseContract()), Buffer.from('\n')])),
    'PROVIDER_BUDGET_RELEASE_ADMISSION_INVALID');
  expect(record.manifest.executionEnabled).toBe(false);
});

test('operating manifest binds the observed raw owner ACL and changes only three ACL cells in each readback', () => {
  const originalBytes = readFileSync(join(REPOSITORY_ROOT, '.github/provider-budget-installation.draft.v1.json'));
  expect(sha(originalBytes)).toBe('7fa566baf28aeefb6368eafedfd8dc5a6ca65fe42d842a30bf39d50fdcff90d6');
  const original = JSON.parse(originalBytes.toString());
  const expected = clone(original.migration);
  for (const stage of ['expectedPriorState', 'terminalReadback']) {
    expect(expected[stage].expected.tables).toHaveLength(3);
    for (const row of expected[stage].expected.tables) {
      expect(row[1]).toBe('postgres'); expect(row[2]).toBeNull();
      row[2] = '{postgres=arwdDxtm/postgres}';
    }
  }
  expect(record.migration).toEqual(expected);
  expect(record.manifest.parentDraft.sha256).toBe(sha(originalBytes));
  expect(record.manifest.rawAclObservation.sha256).toBe('6db29dfba7f6803cf1cf923ce97daed2a05d4eadf2d95b2fd6473427ee94429f');
  expect(record.manifest.rawAclObservation.transactionReadOnly).toBe(true);
  expect(record.manifest.rawAclDeltas).toHaveLength(3);
  expect(budgetReleaseContract().parentDraftSha256).toBe(sha(originalBytes));
  expect(budgetReleaseContract().rawAclObservationSha256).toBe(record.manifest.rawAclObservation.sha256);
  const v1 = readFileSync(join(REPOSITORY_ROOT, '.github/provider-budget-production-successor.v1.json'));
  expect(sha(v1)).toBe('b7e9284f0af15def66fa6881284fe68efb5a85dac944acef2f1df8c8739f61fe');
  expectCode(() => validateBudgetRelease(v1), 'PROVIDER_BUDGET_RELEASE_ADMISSION_INVALID');
});

test('raw ACL representation stays exact: old NULL prior and altered owner grant are rejected', () => {
  for (const acl of [null, '{postgres=arwdDxt/postgres}', '{postgres=arwdDxtm/postgres,service_role=r/postgres}']) {
    const f = fixture(); f.state.prior.tables[0][2] = acl;
    expectCode(f.apply, 'PROVIDER_BUDGET_PRIOR_STATE_DRIFT');
    expect(sends(f)).toHaveLength(0); expect(existsSync(f.directory)).toBe(false);
  }
});

test('missing release rejects preparation before source, credential, custody or DB observation', () => {
  const f = fixture();
  f.dependencies.loadReleaseImpl = () => { throw Object.assign(new Error('missing'), { code: 'PROVIDER_BUDGET_RELEASE_ADMISSION_REQUIRED' }); };
  for (const key of ['loadRecordImpl', 'sourceImpl', 'protectedRevisionImpl', 'attestationImpl', 'predecessorImpl', 'runPsqlImpl'])
    f.dependencies[key] = () => { throw new Error('must not reach'); };
  expectCode(f.apply, 'PROVIDER_BUDGET_RELEASE_ADMISSION_REQUIRED');
  expect(readdirSync(f.root)).toEqual([]);
  expect(f.syncs).toEqual([]);
});

test('real manifest, candidate, components, transitive tools and official parser reject drift', () => {
  for (const [path, code] of [
    [MANIFEST_PATH, 'MANIFEST'], [record.migration.candidatePath, 'SOURCE'],
    [record.manifest.components[0].path, 'COMPONENT'],
    ['apps/web/scripts/thumbnail-production-successor.mjs', 'TOOLCHAIN'],
    ['apps/web/scripts/supabase-migration-bundle.mjs', 'TOOLCHAIN'],
    ['backend/supabase/certificates/prod-ca-2021.crt', 'TOOLCHAIN'],
  ]) expectCode(() => loadBudgetRecord({ readBytesImpl: (absolute: string) => absolute === join(REPOSITORY_ROOT, path)
    ? Buffer.concat([readFileSync(absolute), Buffer.from('\n')]) : readFileSync(absolute) }), `PROVIDER_BUDGET_${code}_DRIFT`);
  let parserPath = '';
  expectCode(() => loadBudgetRecord({ readVectorImpl: (migration: any, raw: Buffer) => {
    parserPath = migration.path;
    expect(parserPath.endsWith('/20261024130000_provider_budget_install.sql')).toBe(true);
    expect(readFileSync(parserPath)).toEqual(raw);
    expect(statSync(parserPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(parserPath, '..')).mode & 0o777).toBe(0o700);
    return [...record.envelope.originalVector, 'COMMIT'];
  } }), 'PROVIDER_BUDGET_VECTOR_DRIFT');
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
  expect(() => validateBudgetAdmission(admission, fence, bytes(fence), record, new Date(instant))).not.toThrow();
  expect(admission.predecessorSha256).toBe(sha(readFileSync(join(f.directory, 'thumbnail-predecessor.json'))));
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
  expect(sql).toContain('PROVIDER_BUDGET_ADMISSION_EXPIRED');
  expect(sql).toBe(budgetApplySql(record, readJson(join(f.directory, 'admission.json'))));
  const original = snapshot(f.directory);
  expectCode(f.apply, 'PROVIDER_BUDGET_CUSTODY_ALREADY_EXISTS');
  expectCode(f.send, 'PROVIDER_BUDGET_RECONCILE_REQUIRED');
  expect(sends(f)).toHaveLength(1); expect(snapshot(f.directory)).toEqual(original);
});

test('original thumbnail must be committed; prior_observed, unknown, conflict and malformed identity publish nothing', () => {
  for (const disposition of ['prior_observed', 'unknown', 'partial_conflict', 'not_applied']) {
    const f = fixture(); f.dependencies.predecessorImpl = () => ({ status: 'reconciliation', disposition, attemptId: predecessorId, replayAllowed: false });
    expectCode(f.apply, 'PROVIDER_BUDGET_PREDECESSOR_UNCONFIRMED');
    expect(f.calls).toHaveLength(0); expect(existsSync(f.directory)).toBe(false);
  }
  const f = fixture(); f.dependencies.predecessorImpl = () => ({ status: 'reconciliation', disposition: 'committed', attemptId: 'wrong', replayAllowed: false });
  expectCode(f.apply, 'PROVIDER_BUDGET_PREDECESSOR_INVALID');
  expect(sends(f)).toHaveLength(0); expect(existsSync(f.directory)).toBe(false);
});

test('source, protected branch, owner, target, confirmation and custody failures reject before transport', () => {
  for (const change of [
    (f: any) => { f.dependencies.sourceImpl = () => ({ revision, clean: false }); },
    (f: any) => { f.dependencies.protectedRevisionImpl = () => 'c'.repeat(40); },
    (f: any) => { const owner = f.dependencies.attestationImpl; f.dependencies.attestationImpl = (args: any) => ({ ...owner(args), principal: 'admin-collaborator' }); },
    (f: any) => { f.environment.SUPABASE_DB_URL = 'postgresql://postgres@other.invalid/postgres'; },
    (f: any) => { delete f.environment.PROVIDER_BUDGET_PRIVILEGED_CUSTODY; },
  ]) { const f = fixture(); change(f); expect(() => f.apply()).toThrow();
    expect(f.calls).toHaveLength(0); expect(f.predecessors).toBe(0); expect(existsSync(f.directory)).toBe(false); }
  const f = fixture();
  expectCode(() => prepareBudgetOperation({ environment: f.environment, confirmation: 'apply:wrong' }, f.dependencies), 'PROVIDER_BUDGET_CONFIRMATION_INVALID');
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
  expectCode(f.apply, 'PROVIDER_BUDGET_OWNER_ATTESTATION_INVALID'); expect(f.calls).toHaveLength(0);
});

test('fresh exact prior drift fails before journal; the compiled SQL also guards a later concurrent drift', () => {
  const f = fixture(); f.prepare(); f.state.prior.ledgerPrefixDigest = '0'.repeat(64);
  expectCode(f.send, 'PROVIDER_BUDGET_PRIOR_STATE_DRIFT');
  expect(sends(f)).toHaveLength(0); expect(existsSync(join(f.directory, 'apply-journal.jsonl'))).toBe(false);
  const g = fixture(); g.state.prior.ledgerCount = 89;
  expectCode(g.apply, 'PROVIDER_BUDGET_PRIOR_STATE_DRIFT'); expect(existsSync(g.directory)).toBe(false);
});

test('fence/predecessor hash or input-file security drift fails before send', () => {
  for (const action of ['fence', 'predecessor', 'mode', 'hardlink', 'symlink', 'oversized']) {
    const f = fixture(); f.prepare(); const path = join(f.directory, 'writer-fence.json');
    if (action === 'fence') writeFileSync(path, bytes({ ...readJson(path), coverage: [] }));
    if (action === 'predecessor') writeFileSync(join(f.directory, 'thumbnail-predecessor.json'), bytes({ ...readJson(join(f.directory, 'thumbnail-predecessor.json')), disposition: 'prior_observed' }));
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
    expectCode(f.apply, 'PROVIDER_BUDGET_CUSTODY_PUBLICATION_UNCONFIRMED');
    expect(existsSync(f.directory)).toBe(true); const original = snapshot(f.directory);
    expectCode(f.apply, 'PROVIDER_BUDGET_CUSTODY_ALREADY_EXISTS');
    expect(snapshot(f.directory)).toEqual(original); expect(sends(f)).toHaveLength(0);
  }
  const f = fixture(); mkdirSync(f.directory, { mode: 0o700 });
  expectCode(f.apply, 'PROVIDER_BUDGET_CUSTODY_ALREADY_EXISTS'); expect(f.calls).toHaveLength(0);
});

test('journal fsync failure consumes the original attempt before any SQL send', () => {
  const f = fixture(); f.prepare(); f.dependencies.fsyncImpl = () => { throw new Error('disk failure'); };
  expectCode(f.send, 'PROVIDER_BUDGET_JOURNAL_UNCONFIRMED');
  expect(existsSync(join(f.directory, 'apply-journal.jsonl'))).toBe(true);
  expect(sends(f)).toHaveLength(0);
  expectCode(f.send, 'PROVIDER_BUDGET_RECONCILE_REQUIRED');
});

test('post-journal revalidation failure consumes the attempt and does not send', () => {
  const f = fixture(); f.prepare();
  // Initial load, pre-journal validation, then the post-journal source reload.
  let reloads = 0;
  f.dependencies.loadRecordImpl = () => { if (++reloads >= 3) throw new Error('source drift'); return record; };
  expectCode(f.send, 'PROVIDER_BUDGET_OUTCOME_UNCONFIRMED');
  expect(sends(f)).toHaveLength(0);
  f.dependencies.loadRecordImpl = () => record;
  expectCode(f.send, 'PROVIDER_BUDGET_RECONCILE_REQUIRED');
});

test('ACK loss with prior snapshot stays UNCONFIRMED; later committed recovery never sends or changes custody', () => {
  const f = fixture(); f.state.ackLost = true; f.state.outcome = 'prior_observed';
  expectCode(f.apply, 'PROVIDER_BUDGET_OUTCOME_UNCONFIRMED'); expect(sends(f)).toHaveLength(1);
  const original = snapshot(f.directory);
  expect(f.reconcile()).toEqual({ status: 'reconciliation', disposition: 'prior_observed', attemptId, replayAllowed: false });
  expectCode(f.send, 'PROVIDER_BUDGET_RECONCILE_REQUIRED');
  f.state.outcome = 'committed';
  f.dependencies.now = () => new Date('2026-10-25T10:00:00.000Z');
  const owner = f.dependencies.attestationImpl;
  f.dependencies.attestationImpl = (args: any) => ({ ...owner(args), sourceRevision: 'c'.repeat(40) });
  for (const key of ['sourceImpl', 'protectedRevisionImpl', 'predecessorImpl'])
    f.dependencies[key] = () => { throw new Error('must not rebind historical attempt'); };
  expect(f.reconcile().disposition).toBe('committed');
  expect(sends(f)).toHaveLength(1); expect(snapshot(f.directory)).toEqual(original);
  expect(Object.values(original).map(hex => Buffer.from(hex, 'hex').toString()).join('\n'))
    .not.toContain('never-persist-raw-transport');
});

test('lost ACK after commit remains unconfirmed until explicit read-only recovery', () => {
  const f = fixture(); f.state.ackLost = true;
  expectCode(f.apply, 'PROVIDER_BUDGET_OUTCOME_UNCONFIRMED');
  expect(f.reconcile().disposition).toBe('committed');
  expectCode(f.send, 'PROVIDER_BUDGET_RECONCILE_REQUIRED'); expect(sends(f)).toHaveLength(1);
});

test('partial terminal append preserves first journal binding for recovery, never resend', () => {
  const f = fixture();
  f.dependencies.appendJournalImpl = () => { writeFileSync(join(f.directory, 'apply-journal.jsonl'), '{"event":', { flag: 'a' }); throw new Error('disk partial'); };
  expectCode(f.apply, 'PROVIDER_BUDGET_JOURNAL_UNCONFIRMED');
  const original = snapshot(f.directory);
  expect(f.reconcile().disposition).toBe('committed'); expectCode(f.send, 'PROVIDER_BUDGET_RECONCILE_REQUIRED');
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
    expect(() => f.reconcile()).toThrow(); expectCode(f.send, 'PROVIDER_BUDGET_RECONCILE_REQUIRED'); expect(sends(f)).toHaveLength(1);
  }
});

test('target vector, terminal extra row, prefix and policy drift are conflicts after a single send', () => {
  for (const change of [
    (f: any) => { f.state.outcome = 'vector_conflict'; },
    (f: any) => { f.state.terminal.ledgerCount = 92; },
    (f: any) => { f.state.terminal.ledgerPrefixDigest = '0'.repeat(64); },
    (f: any) => { f.state.terminal.policies[0].global_per_day++; },
  ]) { const f = fixture(); change(f);
    expectCode(f.apply, 'PROVIDER_BUDGET_RECONCILIATION_CONFLICT');
    expect(f.reconcile().disposition).toBe('partial_conflict'); expectCode(f.send, 'PROVIDER_BUDGET_RECONCILE_REQUIRED');
    expect(sends(f)).toHaveLength(1); }
});

test('CLI exposes no path/SQL/readiness overrides; fixed errors never print supplied secrets', () => {
  for (const argv of [
    ['--mode', 'bad'], ['--mode', 'apply', '--ready', 'true'], ['--manifest', MANIFEST_PATH],
    ['--mode', 'reconcile', '--confirmation', 'anything'], ['--mode', 'apply', '--custody', '/tmp/other'],
    ['--mode', 'inspect', '--mode', 'apply'],
  ]) expectCode(() => main(argv), 'PROVIDER_BUDGET_ARGUMENT_INVALID');
  const child = spawnSync(process.execPath, [join(REPOSITORY_ROOT, 'apps/web/scripts/provider-budget-operating-collector.mjs'),
    '--secret', 'private-input-canary-do-not-output'], { encoding: 'utf8', env: {} });
  expect(child.status).toBe(1); expect(child.stdout).toBe('');
  expect(child.stderr.trim()).toBe('{"status":"failed","code":"PROVIDER_BUDGET_ARGUMENT_INVALID"}');
});
