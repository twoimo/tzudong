import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compileForwardPlan,
  currentForwardGitFacts,
  currentProtectedMainReadback,
  expectedForwardTerminal,
  loadForwardManifest,
  protectedSourceReadbackBinding,
  runAdminUserRpcForward,
  validateForwardAdmission,
} from '../scripts/admin-user-rpc-forward-successor.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const baseRecord = loadForwardManifest();
const revision = 'a'.repeat(40);
const fixedNow = new Date('2030-01-01T00:05:00.000Z');
const databaseUrl = 'postgresql://postgres.aqlcofblfxdrjhhdmarw:private-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const directories: string[] = [];

const readyRecord = Object.freeze({
  ...baseRecord,
  manifest: Object.freeze({
    ...baseRecord.manifest,
    launchPolicy: Object.freeze({ ...baseRecord.manifest.launchPolicy, state: 'ready' }),
  }),
});
const protectedBinding = protectedSourceReadbackBinding(readyRecord.manifest, revision);

const priorState = Object.freeze({
  prior: Object.freeze({
    serverVersionNum: 170006,
    databaseName: 'postgres',
    currentUser: 'postgres',
    sessionUser: 'postgres',
    ledgerCount: 85,
    prefixCount: 80,
    prefixRoot: '1'.repeat(64),
    ledgerRoot: '2'.repeat(64),
    fiveLedgerRows: 5,
    fiveExact: true,
    forwardLedgerRows: 0,
    targetState: 'absent',
    postFiveContract: true,
    membershipContract: true,
    protectedRoot: '3'.repeat(64),
  }),
});

afterAll(() => {
  for (const directory of directories) rmSync(directory, { force: true, recursive: true });
});

function admission(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: readyRecord.manifest.id,
    purpose: readyRecord.manifest.purpose,
    projectRef: readyRecord.manifest.projectRef,
    manifestSha256: readyRecord.manifestSha256,
    sourceRevision: revision,
    protectedSourceReadbackSha256: protectedBinding.sha256,
    operatingReadbackSha256: '5'.repeat(64),
    createdAt: '2030-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:10:00.000Z',
    priorState,
    ...overrides,
  };
}

function privateAdmission(document = admission()) {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-admin-user-rpc-forward-'));
  directories.push(directory);
  chmodSync(directory, 0o700);
  const admissionPath = join(directory, 'admission.json');
  writeFileSync(admissionPath, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  chmodSync(admissionPath, 0o600);
  return admissionPath;
}

function dependencies(runPsqlImpl: (...args: any[]) => string) {
  return {
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => readyRecord,
    now: () => fixedNow,
    protectedMainReadbackImpl: () => protectedBinding.readback,
    runPsqlImpl,
  };
}

test('dedicated held manifest pins the post-five chain and exact forward source/vector', () => {
  expect(baseRecord.manifest.launchPolicy).toEqual({
    state: 'held',
    code: 'FORWARD_LAUNCH_HELD',
    reason: 'fresh-protected-source-and-operating-readback-required',
  });
  expect(baseRecord.manifest).not.toHaveProperty('protectedRevision');
  expect(baseRecord.manifest.protectedSource).toEqual({
    remote: 'origin',
    repositoryUrl: 'https://github.com/twoimo/tzudong.git',
    ref: 'refs/heads/main',
  });
  expect(baseRecord.manifest.operatingTransition).toEqual({ beforeFive: 80, afterFive: 85, afterForward: 86 });
  expect(baseRecord.manifest.fiveStage).toMatchObject({
    entries: 5,
    sha256: 'a7ed53ed124576039e1d49ae62f46626e9747c2c2a0d4711e93c4fc5f1b24140',
    sourceRoot: 'fecccabd16de11d37e54d28517331ba8fcd7fa177859844d8490af7a221cc732',
  });
  expect(baseRecord.fiveManifest.migrations.map((migration: any) => migration.id)).toEqual([
    'admin_record_guarded_actions',
    'admin_evaluation_raw_warning_groups',
    'admin_evaluation_raw_warning_invoker_contract',
    'restaurant_review_manual_preview_eligibility',
    'admin_record_private_verification_cleanup',
  ]);
  expect(baseRecord.manifest.migration).toMatchObject({
    sha256: 'b96126240399e580ed6b7198edbd3d0af44b26ec5cab66073c037b331ec8eb26',
    statementCount: 2,
    statementVectorSha256: '949cbb0862da3e62c190cdeafd23051198178440584b9ebf3f96cec1f062d9c6',
  });
  expect(baseRecord.originalVector).toHaveLength(2);
  expect(baseRecord.manifest.runner).toEqual({
    module: 'apps/web/scripts/admin-record-sql-successor.mjs',
    export: 'createSuccessorPsqlRunner',
  });
  expect(baseRecord.manifest.toolchain).toEqual([
    {
      path: 'apps/web/scripts/admin-record-sql-successor.mjs',
      sha256: '18975e2a80eae230bb461f3d77fab4eb2e3f4846dc8c1a3c1def83e363207b35',
    },
    {
      path: 'apps/web/scripts/apply-supabase-migration.mjs',
      sha256: '02c404e0be3e81b7c8d4d7766ff29e750b1797f5ad49b5f496168170e21192d4',
    },
    {
      path: 'apps/web/scripts/supabase-migration-transaction.mjs',
      sha256: '9268c882d1cb128d798f65faeb87ac3b1cc1fc3d52e843f8695b0c2ab3aa5b53',
    },
    {
      path: 'backend/supabase/scripts/g037_supabase_statement_vector.mjs',
      sha256: '398e3945c0d0fb656daef0d0a42409dbdeb45a9bb1f6f8c03445e4436d4db0bd',
    },
  ]);
});

test('production manifest launch hold rejects before admission, checkout or transport access', () => {
  let gitCalls = 0;
  let protectedReadbackCalls = 0;
  let transportCalls = 0;
  expect(() => runAdminUserRpcForward({
    admissionPath: '/definitely/missing/admin-user-rpc-forward-admission.json',
    environment: {},
  }, {
    gitFactsImpl: () => {
      gitCalls += 1;
      return { clean: true, detached: true, revision };
    },
    loadManifestImpl: () => baseRecord,
    protectedMainReadbackImpl: () => {
      protectedReadbackCalls += 1;
      return protectedBinding.readback;
    },
    runPsqlImpl: () => {
      transportCalls += 1;
      return '';
    },
  })).toThrow('FORWARD_LAUNCH_HELD');
  expect(gitCalls).toBe(0);
  expect(protectedReadbackCalls).toBe(0);
  expect(transportCalls).toBe(0);
});

test('fresh admission and compiled plan bind exact 85 preimage, shared lock and one 85 to 86 ledger insert', () => {
  const document = admission();
  expect(() => validateForwardAdmission(document, readyRecord, { now: fixedNow })).not.toThrow();
  const plan = compileForwardPlan(readyRecord, document);
  expect(plan.envelope.sourceSha256).toBe(readyRecord.manifest.migration.sha256);
  expect(plan.envelope.vectorSha256).toBe(readyRecord.manifest.migration.statementVectorSha256);
  expect(plan.sql).toContain('pg_advisory_xact_lock(7311754282260165::bigint)');
  expect(plan.sql.match(/LOCK TABLE supabase_migrations\.schema_migrations IN EXCLUSIVE MODE/g)).toHaveLength(1);
  expect(plan.sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(1);
  expect(plan.envelope.originalVector).toEqual(baseRecord.originalVector);
  expect(plan.migration.expectedPriorState.query).toContain("'ledgerCount',ledger_all.row_count");
  expect(plan.migration.expectedPriorState.query).toContain("'prefixCount',ledger_prefix.row_count");
  expect(plan.migration.expectedPriorState.query).toContain("'targetState'");
  expect(statementSpans(plan.sql).some(span => /^(?:BEGIN|COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION)\b/i.test(span.token.trim()))).toBe(false);
});

test('wrong version, count, five-stage state, target state and protected revision fail closed', () => {
  const mutations: Array<[string, (value: any) => void]> = [
    ['server version', value => { value.priorState.prior.serverVersionNum = 170005; }],
    ['ledger below 85', value => { value.priorState.prior.ledgerCount = 84; }],
    ['ledger above 85', value => { value.priorState.prior.ledgerCount = 86; }],
    ['prefix count', value => { value.priorState.prior.prefixCount = 79; }],
    ['five exact', value => { value.priorState.prior.fiveExact = false; }],
    ['forward present', value => { value.priorState.prior.forwardLedgerRows = 1; }],
    ['target conflict', value => { value.priorState.prior.targetState = 'conflict'; }],
    ['protected revision', value => { value.sourceRevision = 'b'.repeat(40); }],
  ];
  for (const [label, mutate] of mutations) {
    const document = structuredClone(admission());
    mutate(document);
    expect(() => validateForwardAdmission(document, readyRecord, { now: fixedNow }), label).toThrow('FORWARD_ADMISSION_INVALID');
  }
});

test('wrong project target and fresh preflight mismatch stop before mutation', () => {
  {
    const admissionPath = privateAdmission();
    let calls = 0;
    expect(() => runAdminUserRpcForward({
      admissionPath,
      environment: {
        SUPABASE_DB_URL: 'postgresql://postgres.otherproject:private-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
      },
    }, dependencies(() => {
      calls += 1;
      return '';
    }))).toThrow('SUCCESSOR_DATABASE_TARGET_INVALID');
    expect(calls).toBe(0);
  }
  {
    const admissionPath = privateAdmission();
    const mismatch = structuredClone(priorState);
    mismatch.prior.ledgerRoot = '9'.repeat(64);
    const calls: string[] = [];
    expect(() => runAdminUserRpcForward({
      admissionPath,
      environment: { SUPABASE_DB_URL: databaseUrl },
    }, dependencies((_url, sql) => {
      calls.push(sql);
      return JSON.stringify(mismatch);
    }))).toThrow('FORWARD_PREFLIGHT_MISMATCH');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
    expect(calls[0]).not.toContain('INSERT INTO supabase_migrations.schema_migrations');
  }
});

test('wrong or stale protected main revision fails before database transport', () => {
  const admissionPath = privateAdmission();
  let calls = 0;
  expect(() => runAdminUserRpcForward({
    admissionPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    ...dependencies(() => {
      calls += 1;
      return '';
    }),
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(
      readyRecord.manifest,
      'b'.repeat(40),
    ).readback,
  })).toThrow('FORWARD_PROTECTED_SOURCE_MISMATCH');
  expect(calls).toBe(0);
});

test('a real frozen detached checkout can prepare admission after commit without manifest hash self-reference', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-forward-frozen-checkout-'));
  directories.push(directory);
  const origin = join(directory, 'origin.git');
  const checkout = join(directory, 'checkout');
  mkdirSync(checkout);
  const git = (cwd: string, args: string[]) => {
    const result = spawnSync('/usr/bin/git', args, { cwd, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`git fixture failed: ${args.join(' ')}`);
    return result.stdout.trim();
  };
  git(directory, ['init', '--bare', '--initial-branch=main', origin]);
  git(checkout, ['init', '--initial-branch=main']);
  git(checkout, ['config', 'user.name', 'Forward Fixture']);
  git(checkout, ['config', 'user.email', 'forward-fixture@example.invalid']);
  git(checkout, ['remote', 'add', 'origin', origin]);

  const fixtureManifest = {
    ...readyRecord.manifest,
    protectedSource: {
      remote: 'origin',
      repositoryUrl: origin,
      ref: 'refs/heads/main',
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(fixtureManifest, null, 2)}\n`);
  mkdirSync(join(checkout, '.github'));
  writeFileSync(join(checkout, '.github', 'forward.json'), manifestBytes);
  git(checkout, ['add', '.github/forward.json']);
  git(checkout, ['commit', '-m', 'freeze revision-independent forward manifest']);
  const frozenRevision = git(checkout, ['rev-parse', 'HEAD']);
  git(checkout, ['push', '--set-upstream', 'origin', 'main']);
  git(checkout, ['checkout', '--detach', frozenRevision]);
  expect(manifestBytes.toString()).not.toContain(frozenRevision);
  expect(currentForwardGitFacts({ repositoryRoot: checkout })).toEqual({
    clean: true,
    detached: true,
    revision: frozenRevision,
  });

  const fixtureRecord = Object.freeze({
    ...baseRecord,
    manifest: Object.freeze(fixtureManifest),
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  });
  const binding = protectedSourceReadbackBinding(fixtureRecord.manifest, frozenRevision);
  const document = admission({
    manifestSha256: fixtureRecord.manifestSha256,
    sourceRevision: frozenRevision,
    protectedSourceReadbackSha256: binding.sha256,
  });
  const admissionPath = privateAdmission(document);
  const calls: string[] = [];
  const terminal = expectedForwardTerminal(priorState);
  const dependencies = {
    gitFactsImpl: () => currentForwardGitFacts({ repositoryRoot: checkout }),
    loadManifestImpl: () => fixtureRecord,
    now: () => fixedNow,
    protectedMainReadbackImpl: (manifest: any) => currentProtectedMainReadback(
      manifest,
      { repositoryRoot: checkout },
    ),
    runPsqlImpl: (_url: string, sql: string) => {
      calls.push(sql);
      return JSON.stringify(calls.length === 1 ? priorState : terminal);
    },
  };
  expect(runAdminUserRpcForward({
    admissionPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, dependencies)).toMatchObject({ sourceRevision: frozenRevision, status: 'committed' });
  expect(calls).toHaveLength(2);

  git(checkout, ['switch', '-c', 'advance-main']);
  writeFileSync(join(checkout, 'advance.txt'), 'new protected main\n');
  git(checkout, ['add', 'advance.txt']);
  git(checkout, ['commit', '-m', 'advance protected main']);
  const advancedRevision = git(checkout, ['rev-parse', 'HEAD']);
  git(checkout, ['push', 'origin', 'HEAD:refs/heads/main']);
  git(checkout, ['checkout', '--detach', frozenRevision]);
  expect(advancedRevision).not.toBe(frozenRevision);
  const callsBeforeStaleAttempt = calls.length;
  expect(() => runAdminUserRpcForward({
    admissionPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, dependencies)).toThrow('FORWARD_PROTECTED_SOURCE_MISMATCH');
  expect(calls).toHaveLength(callsBeforeStaleAttempt);
});

test('success uses one read-only preflight and one atomic apply through the successor runner contract', () => {
  const admissionPath = privateAdmission();
  const calls: Array<{ sql: string, singleTransaction: boolean }> = [];
  const terminal = expectedForwardTerminal(priorState);
  const result = runAdminUserRpcForward({
    admissionPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, dependencies((_url, sql, singleTransaction) => {
    calls.push({ sql, singleTransaction });
    return JSON.stringify(calls.length === 1 ? priorState : terminal);
  }));
  expect(result).toEqual({ code: 'FORWARD_COMMITTED', sourceRevision: revision, status: 'committed', terminal });
  expect(calls).toHaveLength(2);
  expect(calls[0].sql).toStartWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  expect(calls[0].sql).not.toContain('INSERT INTO supabase_migrations.schema_migrations');
  expect(calls[1].sql).toContain('pg_advisory_xact_lock(7311754282260165::bigint)');
  expect(calls[1].sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(1);
  expect(calls.every(call => call.singleTransaction)).toBe(true);
});

test('lost acknowledgement never resends and returns only bounded unconfirmed outcome after readonly reconciliation', () => {
  const admissionPath = privateAdmission();
  const marker = 'private-provider-diagnostic';
  const calls: string[] = [];
  const terminal = expectedForwardTerminal(priorState);
  let caught: unknown;
  try {
    runAdminUserRpcForward({
      admissionPath,
      environment: { SUPABASE_DB_URL: databaseUrl },
    }, dependencies((_url, sql) => {
      calls.push(sql);
      if (calls.length === 1) return JSON.stringify(priorState);
      if (calls.length === 2) throw new Error(marker, { cause: new Error(marker) });
      return JSON.stringify({ ledger_exists: true, ledger_equal: true, prior: null, terminal });
    }));
  } catch (error) {
    caught = error;
  }
  expect((caught as Error).message).toBe('FORWARD_OUTCOME_UNCONFIRMED');
  expect((caught as Error).message).not.toContain(marker);
  expect((caught as Error).cause).toBeUndefined();
  expect(calls).toHaveLength(3);
  expect(calls.filter(sql => sql.includes('INSERT INTO supabase_migrations.schema_migrations'))).toHaveLength(1);
  expect(calls[2]).toContain('SET TRANSACTION READ ONLY');
  expect(calls[2]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
});
