import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRecord, MANIFEST_SHA256, ROOT, executeSponsorship, validateAdmission,
  validatePrior, priorQuery, terminalQuery, preflightSql, applySql, reconcileSql,
  expectedTerminal, disposition, identityFor, parseAdmissionBytes, observeProtectedMain,
  validateProtectedMain, createSponsorshipPsqlRunner, sponsorshipResultExitCode } from '../scripts/sponsorship-sql-successor.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';
import { selectDirectDatabaseTransport } from '../scripts/apply-supabase-migration.mjs';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const record = loadRecord();
const source = { revision: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true,
  repositoryMatched: true, filesSha256: 'c'.repeat(64) };
const instant = new Date('2026-10-29T01:00:00Z');
// Assemble the explicitly fake credential as fixture fields, never a deployable
// connection string literal that secret scanners can mistake for a leaked key.
const databaseTarget = new URL('postgres://db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres');
databaseTarget.username = 'postgres';
databaseTarget.password = 'synthetic-fixture';
const databaseUrl = databaseTarget.toString();
function admission() {
  return { kind: 'sponsorship_scoped_admission_v2', authority: 'authenticated-repository-owner-local-cli',
    operationId: '12345678-1234-4234-8234-123456789abc', projectRef: record.manifest.projectRef,
    databaseName: 'postgres', manifestSha256: MANIFEST_SHA256, bundleSha256: record.manifest.bundleSha256, scopeSha256: hash(JSON.stringify(record.manifest.scope)),
    sourceRevision: source.revision, sourceTree: source.tree, sourceFilesSha256: source.filesSha256,
    issuedAt: instant.toISOString(), expiresAt: new Date(instant.getTime() + 300000).toISOString(),
    fences: structuredClone(record.manifest.fences),
    protectedMain: { repository: 'twoimo/tzudong', branch: 'main', sha: source.revision,
      protected: true, observedAt: instant.toISOString() } };
}
function prior() {
  return { identity: true, catalog: true,
    ledger: { count: 97, priorHash: record.manifest.priorLedger.sha256, targets: record.plans.map((p: any) => ({ version: p.version, present: false, equal: false })) },
    revision: { count: 1, singletonCount: 1, value: '9007199254740993' },
    data: { businessCount: 3, businessHash: hash('three synthetic business rows'),
      cohortCount: 2, cohortHash: hash('two selected synthetic keys'), indexCount: 3,
      indexHash: hash('old derived values'), untouchedCount: 1, untouchedHash: hash('outside cohort') } };
}
const bundleReply = () => [1, 2].map(stage => JSON.stringify(expectedTerminal(record, prior(), stage))).join('\n') + '\n';
const ro = (state: unknown) => JSON.stringify({ readOnly: 'on', state });
class MemoryJournal {
  first: any = null;
  spent = false;
  events: any[] = [];
  partialTail = false;
  read() { return this.first ? { first: structuredClone(this.first), spent: this.spent, partialTail: this.partialTail } : null; }
  prepare(first: any) { assert.equal(this.first, null); this.first = structuredClone(first); }
  spend(first: any) { assert.deepEqual(first, this.first); assert.equal(this.spent, false); this.spent = true; this.events.push('send_intent'); }
  append(event: any) { this.events.push(structuredClone(event)); }
}
function fixture() {
  const a = admission(), journal = new MemoryJournal();
  const calls: { sql: string; single: boolean }[] = [];
  const clock = { value: instant };
  const replies: (string | Error)[] = [];
  const options = { record, admission: a, databaseUrl, journal,
    now: () => clock.value, readSource: () => ({ ...source }), readAdmission: () => structuredClone(a),
    readFences: () => ({ generalFreeze: 'active', githubProducer: 'disabled_manually' }),
    readProtectedMain: () => ({ ...a.protectedMain, observedAt: clock.value.toISOString() }),
    transport: (_url: string, sql: string, single: boolean) => {
      calls.push({ sql, single });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      assert.equal(typeof reply, 'string', 'unexpected extra transport call');
      return reply;
    } };
  function prepare() { replies.push(ro(prior())); return executeSponsorship('preflight', options); }
  return { a, journal, calls, clock, replies, options, prepare };
}

describe('immutable two migration bundle and actual maintained interfaces', () => {
  it('pins five plus one original statements and retains both exact migration byte sequences', () => {
    const hashes = ['d0a91f3c1729b05b0aee508058973aecaa13f187f3f7e89ea9b2f71e415d82b9',
      '551c52c0f46f3283b9b6a12239bf3ba91eda784a8570950e18dddade2c642d4f'];
    const vectors = ['ba2154c3f8aadc1d203d49376bf3eacb30e686032bd7a75450d6cbc87f79ac48',
      '9b72d4faa1a0beb0a5194c3c339aaf3e165029f9a058983353a5a3f47c8162cb'];
    const sql = applySql(record, admission(), prior());
    for (const i of [0, 1]) {
      assert.equal(record.plans[i].originalVector.length, [5, 1][i]);
      assert.equal(hash(record.bytes[i]), hashes[i]);
      assert.equal(record.plans[i].vectorSha256, vectors[i]);
      assert.ok(sql.includes(record.bytes[i].toString('utf8')));
    }
  });
  it('rejects changed bytes, changed vector and mutated manifest before transport', () => {
    for (const i of [0, 1]) {
      assert.throws(() => loadRecord({ read: (path: string) => path === record.manifest.migrations[i].path
        ? Buffer.concat([record.bytes[i], Buffer.from('\n')]) : readFileSync(resolve(ROOT, path)) }), /MIGRATION_FILE_DIGEST_MISMATCH/);
    }
    const vector = { ...record, plans: [{ ...record.plans[0], originalVector: ['SELECT 1'] }, record.plans[1]] };
    assert.throws(() => applySql(vector, admission(), prior()), /SPONSORSHIP_VECTOR_DRIFT/);
    const changed = structuredClone(record.manifest); changed.projectRef = 'wrong-project';
    assert.throws(() => applySql({ ...record, manifest: changed }, admission(), prior()), /SPONSORSHIP_MANIFEST_DRIFT/);
  });
  it('uses the real existing runner signature, single transaction and private credential selection', () => {
    assert.equal(selectDirectDatabaseTransport({ SUPABASE_DB_URL: databaseUrl }).databaseUrl, databaseUrl);
    assert.throws(() => selectDirectDatabaseTransport({ SUPABASE_DB_URL: databaseUrl, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-overlap' }), /CREDENTIAL_OVERLAP/);
    let invoked = 0;
    const runner = createSponsorshipPsqlRunner(databaseUrl, { environment: {}, spawnImpl: (command: string, args: string[], options: any) => {
      invoked++;
      assert.equal(command, 'psql'); assert.ok(args.includes('--single-transaction'));
      assert.ok(!args.some(arg => arg.includes('synthetic-fixture') || arg.includes('postgres://')));
      assert.equal(options.env.PGSSLMODE, 'verify-full');
      assert.equal(options.timeout, 20000);
      assert.equal(options.killSignal, 'SIGKILL');
      assert.ok(options.env.PGSSLROOTCERT.endsWith('prod-ca-2021.crt'));
      assert.ok(options.input.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'));
      return { status: 0, stdout: ro(prior()), stderr: '' };
    } });
    assert.equal(runner(databaseUrl, preflightSql(record), true), ro(prior()));
    assert.equal(invoked, 1);
  });
  it('keeps an actual adapter timeout spent and reconciles without a second send', () => {
    const f = fixture(); f.prepare();
    let writes = 0;
    const runner = createSponsorshipPsqlRunner(databaseUrl, { environment: {}, spawnImpl: (_command: string, _args: string[], options: any) => {
      writes++;
      assert.equal(options.timeout, 20000); assert.equal(options.killSignal, 'SIGKILL');
      return { status: null, signal: 'SIGKILL', stdout: '', stderr: '', error: Object.assign(new Error('synthetic deadline'), { code: 'ETIMEDOUT' }) };
    } });
    f.options.transport = runner;
    assert.equal(executeSponsorship('apply', f.options).status, 'unconfirmed');
    assert.equal(f.journal.spent, true); assert.equal(writes, 1);
    assert.throws(() => executeSponsorship('apply', f.options), /RECONCILE_REQUIRED/);
    assert.equal(writes, 1);
    f.options.transport = (_url: string, sql: string, single: boolean) => {
      assert.equal(single, true); assert.ok(sql.includes('READ ONLY'));
      return ro({ prior: prior(), terminal: expectedTerminal(record, prior()) });
    };
    assert.equal(executeSponsorship('reconcile', f.options).disposition, 'committed');
    assert.equal(writes, 1);
  });
});

describe('actual offline CLI packaging and completion contract', () => {
  it('loads this staged artifact through the actual runtime and CLI entry point', () => {
    const p = spawnSync(process.execPath, [resolve(ROOT, 'apps/web/scripts/sponsorship-sql-successor.mjs'), 'prepare'],
      { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    assert.equal(p.error, undefined);
    if (process.versions.bun || Number(process.versions.node.split('.')[0]) !== 24) {
      assert.equal(p.status, 1); assert.equal(p.stdout, '');
      assert.deepEqual(JSON.parse(p.stderr), { code: 'SPONSORSHIP_NODE_VERSION_INVALID' });
      return;
    }
    assert.equal(p.status, 0); assert.equal(p.stderr, '');
    const result = JSON.parse(p.stdout);
    assert.equal(result.status, 'source_prepared_not_admitted'); assert.equal(result.executionReady, false);
    assert.equal(result.manifestSha256, MANIFEST_SHA256); assert.equal(result.statementCount, 6);
    assert.deepEqual(result.migrations.map((m: any) => m.statementCount), [5, 1]);
    assert.equal(result.bundleSha256, record.manifest.bundleSha256);
    assert.equal(result.admissionKind, 'sponsorship_scoped_admission_v2');
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
    assert.equal(git.status, 0); assert.equal(result.source.revision, git.stdout.trim());
    assert.match(result.source.filesSha256, /^[a-f0-9]{64}$/);
    // Offline prepare reports the checkout facts even for an unadmitted clone.
    // Actual execution separately requires the exact repository binding.
    assert.equal(typeof result.source.repositoryMatched, 'boolean');
  });
  it('rejects extra CLI arguments before any database or custody action', () => {
    const p = spawnSync(process.execPath, [resolve(ROOT, 'apps/web/scripts/sponsorship-sql-successor.mjs'), 'prepare', 'unexpected'],
      { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    assert.equal(p.error, undefined); assert.equal(p.status, 1); assert.equal(p.stdout, '');
    assert.deepEqual(JSON.parse(p.stderr), { code: 'SPONSORSHIP_ARGUMENT_INVALID' });
  });
  it('does not signal successful completion for uncertainty, conflict or postcommit data drift', () => {
    for (const value of [{ status: 'unconfirmed' }, { status: 'reconciled', disposition: 'conflict_or_unconfirmed' },
      { status: 'reconciled', disposition: 'not_applied_no_retry' },
      { status: 'reconciled', disposition: 'committed_schema_ledger_postcommit_data_unverified' }, {}]) {
      assert.equal(sponsorshipResultExitCode(value), 2);
    }
    for (const value of [{ status: 'source_prepared_not_admitted' }, { status: 'prepared' }, { status: 'committed' },
      { status: 'reconciled', disposition: 'committed' }]) assert.equal(sponsorshipResultExitCode(value), 0);
  });
});

describe('source, role, ledger, security and fresh scope admission', () => {
  it('rejects duplicate/unknown receipt keys and noncanonical bytes', () => {
    const a = admission();
    assert.deepEqual(parseAdmissionBytes(Buffer.from(JSON.stringify(a) + '\n')), a);
    assert.throws(() => parseAdmissionBytes(Buffer.from('{"kind":"old","kind":"new"}\n')), /ADMISSION_INVALID/);
    assert.throws(() => parseAdmissionBytes(Buffer.from(JSON.stringify(a, null, 2) + '\n')), /ADMISSION_INVALID/);
    assert.throws(() => validateAdmission(record, { ...a, guardianJournal: 'spent' }, source, instant), /BINDING_INVALID/);
  });
  it('accepts the scoped concurrency receipt without inventing a Mac idle assertion', () => {
    assert.equal('macIdle' in record.manifest.fences, false);
    assert.equal(record.manifest.scope.macRestaurantDml, 'allowed_subject_to_bounded_share_lock');
    validateAdmission(record, admission(), source, instant);
  });
  for (const key of ['projectRef', 'bundleSha256', 'sourceRevision', 'sourceTree', 'sourceFilesSha256', 'scopeSha256']) {
    it(`rejects ${key} drift`, () => {
      const a: any = admission(); a[key] = 'wrong';
      assert.throws(() => validateAdmission(record, a, source, instant), /BINDING_INVALID/);
    });
  }
  it('rejects dirty/unrelated source, altered fences and expired/future receipts', () => {
    for (const change of [{ clean: false }, { repositoryMatched: false }]) {
      assert.throws(() => validateAdmission(record, admission(), { ...source, ...change }, instant), /BINDING_INVALID/);
    }
    const a = admission(); a.fences.generalFreeze = 'cleared';
    assert.throws(() => validateAdmission(record, a, source, instant), /BINDING_INVALID/);
    assert.throws(() => validateAdmission(record, admission(), source, new Date(instant.getTime() + 300000)), /EXPIRED/);
    assert.throws(() => validateAdmission(record, admission(), source, new Date(instant.getTime() - 1)), /EXPIRED/);
  });
  it('rejects a different project or service_role target before any read or journal', () => {
    for (const bad of [databaseUrl.replace('aqlcofblfxdrjhhdmarw', 'aaaaaaaaaaaaaaaaaaaa'), databaseUrl.replace('postgres:synthetic', 'service_role:synthetic')]) {
      const f = fixture();
      assert.throws(() => executeSponsorship('preflight', { ...f.options, databaseUrl: bad }), /TARGET_INVALID/);
      assert.equal(f.calls.length, 0); assert.equal(f.journal.first, null);
    }
  });
  it('requires observed PG17/owner identity, old security and stable97 ledger', () => {
    for (const mutate of [
      (p: any) => { p.identity = false; }, (p: any) => { p.catalog = false; },
      (p: any) => { p.ledger.count = 96; }, (p: any) => { p.ledger.priorHash = '0'.repeat(64); },
      (p: any) => { p.ledger.targets[0].present = true; }, (p: any) => { p.data.businessHash = 'untrusted'; },
    ]) {
      const p = prior(); mutate(p); const f = fixture(); f.replies.push(ro(p));
      assert.throws(() => executeSponsorship('preflight', f.options), /PRIOR_DRIFT/);
      assert.equal(f.journal.first, null);
    }
    assert.equal(record.manifest.catalogBefore.functions.find((f: any) => f.name === 'admin_record_compose').volatility, 'v');
    assert.ok(record.manifest.catalogBefore.column_acls.length > 0);
    assert.ok(priorQuery(record).includes("current_setting('server_version_num')='170006'"));
  });
  it('does not accept a missing read-only flag or a fence changed after the read', () => {
    const f = fixture(); f.replies.push(JSON.stringify({ readOnly: 'off', state: prior() }));
    assert.throws(() => executeSponsorship('preflight', f.options), /READONLY_UNCONFIRMED/);
    assert.equal(f.journal.first, null);
    const g = fixture(); let reads = 0;
    g.options.readFences = () => ({ generalFreeze: ++reads === 1 ? 'active' : 'cleared', githubProducer: 'disabled_manually' });
    assert.throws(() => g.prepare(), /FENCE_DRIFT/); assert.equal(g.journal.first, null);
  });
});

describe('external protected-main admission for the DB-only rollout', () => {
  it('accepts a fresh protected DB-only main without the full-feature ancestor', () => {
    assert.equal('baseRevision' in record.manifest, false);
    assert.equal('baseTree' in record.manifest, false);
    const f = fixture(); const dbMain = { ...source, revision: 'd'.repeat(40), tree: 'e'.repeat(40) };
    f.a.sourceRevision = dbMain.revision; f.a.sourceTree = dbMain.tree; f.a.protectedMain.sha = dbMain.revision;
    f.options.readSource = () => ({ ...dbMain });
    const result = f.prepare();
    assert.equal(result.identity.sourceRevision, dbMain.revision);
    assert.equal(result.identity.protectedMainSha, dbMain.revision);
  });
  it('rejects missing, unprotected, wrong-branch, wrong-repository and stale main receipts', () => {
    for (const patch of [{ protected: false }, { sha: 'f'.repeat(40) }, { repository: 'other/tzudong' },
      { branch: 'develop' }, { observedAt: new Date(instant.getTime() - 60001).toISOString() },
      { observedAt: new Date(instant.getTime() + 1).toISOString() }]) {
      const a = admission(); Object.assign(a.protectedMain, patch);
      assert.throws(() => validateAdmission(record, a, source, instant), /PROTECTED_MAIN_RECEIPT_INVALID/);
    }
    const a: any = admission(); delete a.protectedMain;
    assert.throws(() => validateAdmission(record, a, source, instant), /ADMISSION_BINDING_INVALID/);
  });
  it('requires independent current main readback before preflight or journal creation', () => {
    const f = fixture();
    assert.throws(() => executeSponsorship('preflight', { ...f.options, readProtectedMain: undefined }), /PROTECTED_MAIN_UNVERIFIED/);
    for (const patch of [{ protected: false }, { sha: 'f'.repeat(40) },
      { observedAt: new Date(instant.getTime() - 60001).toISOString() }]) {
      const observation = { ...f.a.protectedMain, ...patch };
      assert.throws(() => validateProtectedMain(record, f.a, source, observation, instant), /PROTECTED_MAIN_DRIFT/);
    }
    f.options.readProtectedMain = () => ({ ...f.a.protectedMain, sha: 'f'.repeat(40) });
    assert.throws(() => executeSponsorship('preflight', f.options), /PROTECTED_MAIN_DRIFT/);
    assert.equal(f.calls.length, 0); assert.equal(f.journal.first, null);
  });
  it('cross-checks exact GitHub protected main with the Git remote without fetching', () => {
    const commands: string[] = [];
    const spawnImpl = (command: string, args: string[]) => {
      commands.push(command + ' ' + args.join(' '));
      return { status: 0, stdout: command === 'gh'
        ? JSON.stringify({ name: 'main', protected: true, sha: source.revision })
        : source.revision + '\trefs/heads/main\n' };
    };
    assert.deepEqual(observeProtectedMain({ spawnImpl, clock: () => instant }), admission().protectedMain);
    assert.equal(commands.length, 2);
    assert.ok(commands[0].includes('--hostname github.com') && commands[0].includes('branches/main'));
    assert.ok(commands[1].includes('ls-remote --exit-code origin refs/heads/main'));
    assert.ok(commands.every(command => !/fetch|checkout|reset|push/.test(command)));
  });
  it('stops on provider denial and rejects disagreement between API and Git tips', () => {
    let calls = 0;
    assert.throws(() => observeProtectedMain({ spawnImpl: () => { calls++; return { status: 1, stdout: '', stderr: '403' }; } }), /PROTECTED_MAIN_UNVERIFIED/);
    assert.equal(calls, 1);
    assert.throws(() => observeProtectedMain({ spawnImpl: (command: string) => ({ status: 0, stdout: command === 'gh'
      ? JSON.stringify({ name: 'main', protected: true, sha: source.revision })
      : 'f'.repeat(40) + '\trefs/heads/main\n' }) }), /PROTECTED_MAIN_DRIFT/);
  });
  it('does not send if protected main advances after durable reservation', () => {
    const f = fixture(); f.prepare(); let reads = 0;
    f.options.readProtectedMain = () => ({ ...f.a.protectedMain, sha: ++reads < 3 ? source.revision : 'f'.repeat(40) });
    const result = executeSponsorship('apply', f.options);
    assert.equal(result.status, 'unconfirmed'); assert.equal(f.journal.spent, true);
    assert.equal(f.calls.length, 1);
  });
});

describe('SQL ordering and scope preservation', () => {
  const head = (token: string) => token.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, '');
  function checkOrder(sql: string) {
    const statements = statementSpans(sql).map((s: any) => head(s.token));
    const positions = ["pg_advisory_xact_lock", 'LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE',
      'LOCK TABLE public.restaurants IN SHARE MODE', 'LOCK TABLE pipeline_control.admin_evaluation_read_index IN SHARE ROW EXCLUSIVE MODE',
      'FOR UPDATE NOWAIT',
      'MIGRATION_PRIOR_STATE_MISMATCH', 'CREATE OR REPLACE FUNCTION pipeline_control.admin_eval_valid_meta',
      'INSERT INTO supabase_migrations.schema_migrations', 'MIGRATION_TERMINAL_READBACK_FAILED'].map(x =>
        statements.findIndex((s: string) => /^(CREATE|INSERT|LOCK)/.test(x) ? s.startsWith(x) : s.includes(x)));
    assert.ok(positions.every(x => x >= 0));
    assert.ok(positions.every((x, i) => i === 0 || positions[i - 1] < x), 'all guards/locks must precede DDL and preimages');
  }
  it('serializes before all preimages and DDL, leaving the raw later SHARE lock intact', () => {
    const sql = applySql(record, admission(), prior()); checkOrder(sql);
    assert.equal(statementSpans(sql).filter((s: any) => head(s.token).startsWith('LOCK TABLE public.restaurants IN SHARE MODE')).length, 2);
    assert.ok(sql.startsWith('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;'));
    assert.ok(sql.includes("SET LOCAL lock_timeout='2s'"));
    assert.ok(sql.indexOf("SET LOCAL transaction_timeout='15s'") < sql.indexOf('pg_advisory_xact_lock'));
    assert.ok(!/CREATE\s+TEMP|\bsetval\s*\(|\bnextval\s*\(|DISABLE\s+TRIGGER/i.test(sql));
    const rowLock = statementSpans(sql).map((s: any) => head(s.token)).filter((s: string) => s.includes('FOR UPDATE NOWAIT'));
    assert.equal(rowLock.length, 1);
    assert.match(rowLock[0], /^DO .*PERFORM 1 FROM pipeline_control\.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE NOWAIT/s);
    // Negative control: moving the first SHARE lock after DDL must be detected.
    const unsafe = sql.replace('LOCK TABLE public.restaurants IN SHARE MODE;', '') + '\nLOCK TABLE public.restaurants IN SHARE MODE;';
    assert.throws(() => checkOrder(unsafe));
  });
  it('preflight/reconcile are read-only and never invoke volatile compose', () => {
    for (const sql of [preflightSql(record), reconcileSql(record, prior())]) {
      assert.ok(sql.includes('REPEATABLE READ READ ONLY'));
      const starts = statementSpans(sql).map((x: any) => x.token.trim().split(/\s+/)[0]);
      assert.ok(starts.every((x: string) => ['SET', 'SELECT'].includes(x)));
      const outsideStrings = sql.replace(/'(?:''|[^'])*'/g, "''");
      assert.ok(!outsideStrings.includes('pipeline_control.admin_record_compose('));
    }
    const t = terminalQuery(record, prior());
    assert.ok(t.indexOf('CASE WHEN') < t.indexOf('pipeline_control.admin_eval_descriptor('));
    for (const field of ['businessUnchanged', 'cohortUnchanged', 'untouchedUnchanged', 'cohortCorrect', 'indexCountCorrect']) assert.ok(t.includes(field));
  });
  it('terminal requires exact99 entries, old ledger retention and only two changed function bodies', () => {
    const before = record.manifest.catalogBefore, after = record.manifest.catalogAfter;
    const names = before.functions.filter((f: any, i: number) => f.prosrc_md5 !== after.functions[i].prosrc_md5).map((f: any) => f.name);
    assert.deepEqual(names, ['admin_eval_valid_meta', 'admin_record_compose']);
    for (let i = 0; i < before.functions.length; i++) {
      const strip = (f: any) => { const { prosrc_md5, prosrc_trimmed_md5, ...security } = f; void prosrc_md5; void prosrc_trimmed_md5; return security; };
      assert.deepEqual(strip(before.functions[i]), strip(after.functions[i]));
    }
    for (const key of ['tables', 'indexes', 'policies', 'triggers', 'schemas', 'column_acls', 'revision_relation']) assert.deepEqual(before[key], after[key]);
    assert.deepEqual(expectedTerminal(record, prior()).ledger, { count: 99, priorHash: record.manifest.priorLedger.sha256, targets: record.plans.map((p: any) => ({ version: p.version, present: true, equal: true })) });
  });
});

describe('one original operation, uncertain send and reconciliation', () => {
  it('requires preflight, persists its exact preimage and commits only on complete terminal acknowledgement', () => {
    const f = fixture();
    assert.throws(() => executeSponsorship('apply', f.options), /ORIGINAL_REQUIRED/);
    f.prepare(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].single, true);
    assert.deepEqual(f.journal.first.before, prior());
    f.replies.push(bundleReply());
    assert.equal(executeSponsorship('apply', f.options).status, 'committed');
    assert.equal(f.journal.spent, true); assert.equal(f.calls.length, 2);
    assert.equal(f.journal.events[1].event, 'commit_acknowledged');
    assert.throws(() => executeSponsorship('apply', f.options), /RECONCILE_REQUIRED/);
    assert.equal(f.calls.length, 2);
  });
  it('a Mac writer changing the preimage between preflight and locked apply cannot silently pass', () => {
    const f = fixture(); f.prepare();
    f.replies.push(new Error('MIGRATION_PRIOR_STATE_MISMATCH'));
    assert.equal(executeSponsorship('apply', f.options).status, 'unconfirmed');
    const moved = prior(); moved.data.businessHash = hash('producer committed between calls');
    f.replies.push(ro({ prior: moved, terminal: { ...expectedTerminal(record, prior()), catalog: false, ledger: moved.ledger } }));
    const result = executeSponsorship('reconcile', f.options);
    assert.equal(result.disposition, 'conflict_or_unconfirmed'); assert.equal(result.replayAllowed, false);
  });
  it('lost COMMIT acknowledgement uses the original identity, even after receipt expiry, with no second write', () => {
    const f = fixture(); f.prepare();
    f.replies.push(new Error('synthetic provider diagnostic MUST NOT ESCAPE'));
    const unknown = executeSponsorship('apply', f.options);
    assert.equal(unknown.status, 'unconfirmed'); assert.ok(!JSON.stringify(unknown).includes('diagnostic'));
    assert.equal(unknown.cacheSequenceRollbackClaimed, false);
    f.clock.value = new Date(instant.getTime() + 3600000);
    f.options.readProtectedMain = () => { throw new Error('current main has advanced; must not rebind the original'); };
    f.replies.push(ro({ prior: { ...prior(), catalog: false }, terminal: expectedTerminal(record, prior()) }));
    const observed = executeSponsorship('reconcile', f.options);
    assert.equal(observed.disposition, 'committed');
    assert.deepEqual(observed.identity, f.journal.first.identity); assert.equal(observed.replayAllowed, false);
    assert.ok(f.calls[2].sql.includes('READ ONLY')); assert.equal(f.calls.length, 3);
  });
  it('distinguishes post-commit business movement from atomic schema/ledger commitment', () => {
    const t = { ...expectedTerminal(record, prior()), businessUnchanged: false, untouchedUnchanged: false };
    assert.equal(disposition(record, { prior: prior(), terminal: t }, prior()), 'committed_schema_ledger_postcommit_data_unverified');
    assert.equal(disposition(record, { prior: { ...prior(), catalog: false }, terminal: { ...t, ledger: prior().ledger } }, prior()), 'conflict_or_unconfirmed');
  });
  it('never retries after partial/incorrect terminal, timeout, or failed terminal audit', () => {
    for (const response of [JSON.stringify({ identity: true }), '{partial', new Error('timeout'), new Error('MIGRATION_TERMINAL_READBACK_FAILED')]) {
      const f = fixture(); f.prepare(); f.replies.push(response);
      assert.equal(executeSponsorship('apply', f.options).status, 'unconfirmed');
      assert.throws(() => executeSponsorship('apply', f.options), /RECONCILE_REQUIRED/);
      assert.equal(f.calls.length, 2);
    }
  });
  it('reconciles a partial journal tail but rejects relabeling the original operation', () => {
    const f = fixture(); f.prepare(); f.journal.spent = true; f.journal.partialTail = true;
    f.replies.push(ro({ prior: prior(), terminal: { ...expectedTerminal(record, prior()), ledger: prior().ledger, catalog: false } }));
    assert.equal(executeSponsorship('reconcile', f.options).disposition, 'not_applied_no_retry');
    f.a.operationId = '22345678-1234-4234-8234-123456789abc';
    assert.throws(() => executeSponsorship('reconcile', f.options), /JOURNAL_BINDING_INVALID/);
    assert.equal(f.calls.length, 2);
  });
  it('a crash after durable reservation prohibits sending again', () => {
    const f = fixture(); f.prepare();
    f.journal.spend = () => { f.journal.spent = true; throw new Error('synthetic fsync crash'); };
    assert.throws(() => executeSponsorship('apply', f.options), /fsync crash/);
    assert.equal(f.calls.length, 1);
    assert.throws(() => executeSponsorship('apply', f.options), /RECONCILE_REQUIRED/);
  });
  it('revalidates fences after reservation and treats a post-reservation failure as spent', () => {
    const f = fixture(); f.prepare(); let reads = 0;
    f.options.readFences = () => ({ generalFreeze: ++reads < 3 ? 'active' : 'cleared', githubProducer: 'disabled_manually' });
    assert.equal(executeSponsorship('apply', f.options).status, 'unconfirmed');
    assert.equal(f.calls.length, 1); assert.equal(f.journal.spent, true);
  });
  it('retains exact identity/source/preimage binding rather than trusting mutable journal content', () => {
    const f = fixture(); f.prepare();
    assert.deepEqual(f.journal.first.identity, identityFor(record, f.a));
    f.journal.first.before.data.businessHash = hash('changed private receipt');
    assert.throws(() => executeSponsorship('apply', f.options), /SQL_BINDING_INVALID/);
    assert.equal(f.calls.length, 1);
  });
});

describe('atomic bundle revision and two-output regressions', () => {
  it('checks both server terminal states and the second preimage before the one outer commit', () => {
    const sql = applySql(record, admission(), prior());
    const statements = statementSpans(sql).map((s: any) => s.token.trim());
    const terminalSelects = statements.filter((s: string) => s.startsWith('SELECT'));
    assert.equal(terminalSelects.length, 2);
    assert.deepEqual(terminalSelects, [terminalQuery(record, prior()), terminalQuery(record, prior())]);
    const guards = statements.filter((s: string) => s.includes("RAISE EXCEPTION 'MIGRATION_TERMINAL_READBACK_FAILED'"));
    assert.equal(guards.length, 2);
    for (const [i, guard] of guards.entries()) assert.ok(guard.includes(JSON.stringify(expectedTerminal(record, prior(), i + 1))));
    const secondPrior = statements.filter((s: string) => s.includes("RAISE EXCEPTION 'MIGRATION_PRIOR_STATE_MISMATCH'"))[1];
    assert.ok(secondPrior.includes(JSON.stringify(expectedTerminal(record, prior(), 1))));
    assert.ok(sql.indexOf(guards[0]) < sql.indexOf(record.bytes[1].toString('utf8')));
    assert.ok(sql.indexOf(guards[1]) > sql.indexOf(record.bytes[1].toString('utf8')));
    assert.ok(statements.every((s: string) => !/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(s)));
    const q = priorQuery(record);
    assert.ok(q.includes("WHERE version NOT IN ('20261028195647','20261028225926')"));
    for (const p of record.plans) assert.ok(q.includes(JSON.stringify(p.originalVector).replaceAll("'", "''")));
  });
  it('closes transitive source and certificate dependencies before admission', () => {
    for (const path of Object.keys(record.manifest.dependencies)) {
      assert.throws(() => loadRecord({ read: (p: string) => p === path
        ? Buffer.from('changed dependency') : readFileSync(resolve(ROOT, p)) }), /DEPENDENCY_DRIFT/);
    }
    assert.ok(record.manifest.dependencies['backend/supabase/certificates/prod-ca-2021.crt']);
    assert.ok(record.manifest.dependencies['apps/web/scripts/privacy-safe-cli-log.mjs']);
    assert.ok(record.manifest.dependencies['apps/web/scripts/thumbnail-local-owner.mjs']);
  });
  it('binds revision metadata and explicit singleton write scope without fixing its dynamic value', () => {
    const meta = record.manifest.catalogBefore.revision_relation;
    assert.equal(meta.table.name, 'admin_evaluation_catalog_revision');
    assert.equal(meta.table.rls, true);
    assert.ok(meta.table.acl);
    assert.deepEqual(meta.columns.map((c: any) => [c.name, c.type]), [['singleton', 'boolean'], ['revision', 'bigint']]);
    assert.equal(meta.triggers, null);
    assert.ok(record.manifest.scope.catalogRevision.write.includes('exact_singleton_increment_once'));
    assert.equal('value' in meta, false);
    assert.ok(priorQuery(record).includes('min(revision)::text'));
  });
  it('uses exact bigint arithmetic beyond safe float precision and rejects unavailable/invalid revisions', () => {
    assert.equal(expectedTerminal(record, prior(), 1).revision.value, '9007199254740993');
    assert.equal(expectedTerminal(record, prior(), 2).revision.value, '9007199254740994');
    const edge = prior(); edge.revision.value = '9223372036854775806';
    assert.equal(expectedTerminal(record, edge).revision.value, '9223372036854775807');
    for (const revision of [null, { count: 0, singletonCount: 0, value: null },
      { count: 2, singletonCount: 1, value: '2' }, { count: 1, singletonCount: 0, value: '2' },
      ...[9007199254740992, '01', '-1', '1.0', '1e3', '9223372036854775807', '9223372036854775808']
        .map(value => ({ count: 1, singletonCount: 1, value }))]) {
      const f = fixture(); f.replies.push(ro({ ...prior(), revision }));
      assert.throws(() => executeSponsorship('preflight', f.options), /PRIOR_DRIFT/);
      assert.equal(f.journal.first, null);
    }
  });
  it('requires both ordered bounded JSON lines and never treats a missing160 reply as success', () => {
    const first = JSON.stringify(expectedTerminal(record, prior(), 1));
    const last = JSON.stringify(expectedTerminal(record, prior()));
    for (const output of [first, last, last + '\n' + first, first + '\n' + first,
      first + '\n\n' + last, first + '\n' + last + '\n{}', '[{} , {}]',
      first + '\n' + last + 'x', ' '.repeat(256 * 1024) + first + '\n' + last]) {
      const f = fixture(); f.prepare(); f.replies.push(output);
      assert.equal(executeSponsorship('apply', f.options).status, 'unconfirmed');
      assert.equal(f.journal.spent, true);
      assert.throws(() => executeSponsorship('apply', f.options), /RECONCILE_REQUIRED/);
      assert.equal(f.calls.length, 2);
    }
  });
  it('rejects first or final revision/ledger mismatches even with two valid JSON lines', () => {
    for (const stage of [0, 1]) {
      for (const mutate of [
        (t: any) => { t.revision.value = (BigInt(t.revision.value) + 1n).toString(); },
        (t: any) => { t.revision.count = 0; },
        (t: any) => { t.revision.count = 2; },
        (t: any) => { t.ledger.priorHash = '0'.repeat(64); },
        (t: any) => { t.ledger.targets[stage].equal = false; },
        (t: any) => { t.ledger.count--; },
      ]) {
        const f = fixture(); f.prepare();
        const states = [expectedTerminal(record, prior(), 1), expectedTerminal(record, prior())];
        mutate(states[stage]);
        f.replies.push(states.map(t => JSON.stringify(t)).join('\n'));
        assert.equal(executeSponsorship('apply', f.options).status, 'unconfirmed');
        assert.throws(() => executeSponsorship('apply', f.options), /RECONCILE_REQUIRED/);
        assert.equal(f.calls.length, 2);
      }
    }
  });
  it('keeps locks and either migration failure spent, even if the first terminal was printed', () => {
    for (const detail of ['revision lock conflict', '159 terminal failure', '160 DO failure', '160 terminal failure', 'commit connection lost']) {
      const f = fixture(); f.prepare();
      f.options.transport = createSponsorshipPsqlRunner(databaseUrl, { environment: {}, spawnImpl: () => ({
        status: 1, stdout: JSON.stringify(expectedTerminal(record, prior(), 1)), stderr: detail,
      }) });
      const result = executeSponsorship('apply', f.options);
      assert.equal(result.status, 'unconfirmed');
      assert.ok(!JSON.stringify(result).includes(detail));
      assert.throws(() => executeSponsorship('apply', f.options), /RECONCILE_REQUIRED/);
    }
  });
  it('reconciles partial bundle or revision mismatch as conflict with no replay', () => {
    for (const mutate of [
      (t: any) => { t.ledger = expectedTerminal(record, prior(), 1).ledger; },
      (t: any) => { t.ledger.targets[0].equal = false; },
      (t: any) => { t.ledger.targets[1].equal = false; },
      (t: any) => { t.revision.value = prior().revision.value; },
      (t: any) => { t.revision.value = '9007199254740995'; },
      (t: any) => { t.revision.count = 2; },
    ]) {
      const t = expectedTerminal(record, prior()); mutate(t);
      assert.equal(disposition(record, { prior: { ...prior(), catalog: false }, terminal: t }, prior()), 'conflict_or_unconfirmed');
    }
    const moved = prior(); moved.revision.value = '9007199254740995';
    assert.equal(disposition(record, { prior: moved, terminal: { catalog: false } }, prior()), 'conflict_or_unconfirmed');
  });
  it('rejects changed or dirty original source even on an expired receipt reconciliation', () => {
    for (const patch of [{ clean: false }, { revision: 'd'.repeat(40) }, { filesSha256: 'e'.repeat(64) }]) {
      const f = fixture(); f.prepare(); f.journal.spent = true;
      f.clock.value = new Date(instant.getTime() + 3600000);
      f.options.readSource = () => ({ ...source, ...patch });
      assert.throws(() => executeSponsorship('reconcile', f.options), /ADMISSION_BINDING_INVALID/);
      assert.equal(f.calls.length, 1);
    }
  });
});
