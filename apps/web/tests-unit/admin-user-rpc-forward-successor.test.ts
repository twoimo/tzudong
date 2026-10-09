import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildForwardPriorStateQuery,
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
const rollbackIdentity = Object.freeze({
  deploymentId: 'dpl_CLEMRdaLUrai3Ph9J2czNRA64pyw',
  deploymentSha: '8257581e09f6f58f72f6e0e2c4aa7e6c72caab43',
  deploymentUrl: 'https://tzudong-a7wf62m0v-twoimos-projects.vercel.app/',
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
const canonical = (value: any): any => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const canonicalBytes = (value: any) => Buffer.from(`${JSON.stringify(canonical(value))}\n`);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function sourceDerivedM5AdminRecordActionBody() {
  const predecessorPath = baseRecord.fiveManifest.migrations[0].path;
  const m5Path = baseRecord.fiveManifest.migrations[4].path;
  const predecessorSql = readFileSync(new URL(`../../../${predecessorPath}`, import.meta.url), 'utf8');
  const m5Sql = readFileSync(new URL(`../../../${m5Path}`, import.meta.url), 'utf8');
  const bodyMatch = predecessorSql.match(
    /CREATE FUNCTION public\.admin_record_action\([\s\S]*?\) RETURNS jsonb\nLANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS \$\$([\s\S]*?)\$\$;/,
  );
  expect(bodyMatch).not.toBeNull();
  let body = bodyMatch![1];

  const actionStart = m5Sql.indexOf(
    "target := 'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure;",
  );
  const actionEnd = m5Sql.indexOf('  EXECUTE replace(definition, source, patched);', actionStart);
  expect(actionStart).toBeGreaterThanOrEqual(0);
  expect(actionEnd).toBeGreaterThan(actionStart);
  const actionPatch = m5Sql.slice(actionStart, actionEnd);
  const assignments = [...actionPatch.matchAll(
    /\b(old_text|new_text)\s*:=\s*(?:\$(?:old|new)\$([\s\S]*?)\$(?:old|new)\$|'((?:''|[^'])*)')\s*;/g,
  )].map(match => ({
    key: match[1],
    value: match[2] ?? match[3].replaceAll("''", "'"),
  }));
  expect(assignments).toHaveLength(14);
  for (let index = 0; index < assignments.length; index += 2) {
    expect(assignments[index].key).toBe('old_text');
    expect(assignments[index + 1].key).toBe('new_text');
    expect(body.includes(assignments[index].value)).toBe(true);
    body = body.replaceAll(assignments[index].value, assignments[index + 1].value);
  }
  return body;
}

const readyRecord = Object.freeze({
  ...baseRecord,
  manifest: Object.freeze({
    ...baseRecord.manifest,
    launchPolicy: Object.freeze({ ...baseRecord.manifest.launchPolicy, state: 'ready' }),
  }),
});
const heldRecord = Object.freeze({
  ...baseRecord,
  manifest: Object.freeze({
    ...baseRecord.manifest,
    launchPolicy: Object.freeze({ ...baseRecord.manifest.launchPolicy, state: 'held' }),
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
    rollback: {
      ...structuredClone(rollbackIdentity),
      readbackSha256: '6'.repeat(64),
    },
    createdAt: '2030-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:10:00.000Z',
    priorState,
    ...overrides,
  };
}

function privateAdmissionFiles(document = admission()) {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-admin-user-rpc-forward-'));
  directories.push(directory);
  chmodSync(directory, 0o700);
  const admissionPath = join(directory, 'admission.json');
  const receipt = {
    schemaVersion: 1,
    id: document.id,
    kind: 'forward-operating-readback-receipt',
    projectRef: document.projectRef,
    purpose: document.purpose,
    manifestSha256: document.manifestSha256,
    sourceRevision: document.sourceRevision,
    observedAt: document.createdAt,
    expiresAt: document.expiresAt,
    priorState: document.priorState,
  };
  const receiptBytes = canonicalBytes(receipt);
  document.operatingReadbackSha256 = digest(receiptBytes);
  const receiptPath = join(directory, 'operating-readback-receipt.json');
  writeFileSync(receiptPath, receiptBytes, { mode: 0o600 });
  chmodSync(receiptPath, 0o600);
  const rollbackReceipt = {
    schemaVersion: 1,
    id: document.id,
    kind: 'forward-rollback-readback-receipt',
    projectRef: document.projectRef,
    purpose: document.purpose,
    manifestSha256: document.manifestSha256,
    sourceRevision: document.sourceRevision,
    observedAt: document.createdAt,
    expiresAt: document.expiresAt,
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
  };
  const rollbackReceiptBytes = canonicalBytes(rollbackReceipt);
  document.rollback.readbackSha256 = digest(rollbackReceiptBytes);
  const rollbackReceiptPath = join(directory, 'forward-rollback-readback-receipt.json');
  writeFileSync(rollbackReceiptPath, rollbackReceiptBytes, { mode: 0o600 });
  chmodSync(rollbackReceiptPath, 0o600);
  writeFileSync(admissionPath, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  chmodSync(admissionPath, 0o600);
  return { admissionPath, directory, document, receipt, receiptPath, rollbackReceipt, rollbackReceiptPath };
}

function privateAdmission(document = admission()) {
  return privateAdmissionFiles(document).admissionPath;
}

function dependencies(runPsqlImpl: (...args: any[]) => string) {
  return {
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => readyRecord,
    now: () => fixedNow,
    protectedMainReadbackImpl: () => protectedBinding.readback,
    rollbackReadbackImpl: ({ expected, now }: any) => ({
      schemaVersion: 1,
      kind: 'vercel-rollback-readback',
      projectId: rollbackIdentity.projectId,
      teamId: rollbackIdentity.teamId,
      deploymentId: expected.deploymentId,
      deploymentUrl: expected.deploymentUrl,
      readyState: rollbackIdentity.readyState,
      target: rollbackIdentity.target,
      repository: rollbackIdentity.repository,
      gitSha: expected.gitSha,
      gitRef: expected.gitRef,
      productionAliases: [...rollbackIdentity.productionAliases],
      observedAt: now().toISOString(),
    }),
    runPsqlImpl,
  };
}

test('dedicated ready manifest pins the post-five chain and exact forward source/vector', () => {
  expect(baseRecord.manifest.launchPolicy).toEqual({
    state: 'ready',
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
    sha256: '3674b05d5be0091e1123a1c76709e0a53e9c7dbed3fc468c4fafd9b1a22b985d',
    sourceRoot: '15da876acc3c544fef42ca3fe00c9a260c490d683a7d33593b53aac881f273f3',
  });
  expect(baseRecord.fiveManifest.migrations.map((migration: any) => migration.id)).toEqual([
    'admin_record_guarded_actions',
    'admin_evaluation_raw_warning_groups',
    'admin_evaluation_raw_warning_invoker_contract',
    'restaurant_review_manual_preview_eligibility',
    'admin_record_private_verification_cleanup',
  ]);
  expect(baseRecord.manifest.migration).toMatchObject({
    sha256: '2067538f89c9f90d28e784672c7a1288306ba22d5ae92b087c8692503da9b1ae',
    statementCount: 2,
    statementVectorSha256: 'b8eb5902bb5996cffa5cca2f564c1c1c29593dd0a345f2ffbcaca2f86e3f7a3a',
  });
  expect(baseRecord.originalVector).toHaveLength(2);
  expect(baseRecord.manifest.runner).toEqual({
    module: 'apps/web/scripts/admin-record-sql-successor.mjs',
    export: 'createSuccessorPsqlRunner',
  });
  expect(baseRecord.manifest.toolchain).toEqual([
    {
      path: 'apps/web/scripts/admin-record-sql-successor.mjs',
      sha256: 'c9b2c3335598bc21a5a721182ae45aae0d009be8684e7a1a2a0871e0cb921466',
    },
    {
      path: 'apps/web/scripts/apply-supabase-migration.mjs',
      sha256: '02c404e0be3e81b7c8d4d7766ff29e750b1797f5ad49b5f496168170e21192d4',
    },
    {
      path: 'apps/web/scripts/supabase-migration-transaction.mjs',
      sha256: 'c67bdff4c63b1bf1b4a157863b3eb5253b5973a8fb54b7fd49351270787bed26',
    },
    {
      path: 'apps/web/scripts/vercel-rollback-readback.mjs',
      sha256: 'fa3876153f0e949d23115612cb34bc545c6c29bccb6ba2fd6042a38e70555e04',
    },
    {
      path: 'backend/supabase/scripts/g037_supabase_statement_vector.mjs',
      sha256: '398e3945c0d0fb656daef0d0a42409dbdeb45a9bb1f6f8c03445e4436d4db0bd',
    },
  ]);
});

test('post-five state query binds the admin action body derived from the exact M5 source', () => {
  const bodySha256 = digest(sourceDerivedM5AdminRecordActionBody());
  const query = buildForwardPriorStateQuery(baseRecord);
  const queryHash = query.match(
    /\('public\.admin_record_action\(uuid,text,uuid,text,uuid\[\],jsonb,text\)','([0-9a-f]{64})',ARRAY\[/,
  );
  expect(bodySha256).toBe('a18fad1f748d736371a9ab549a1ca483a5b2f321674fabe71b2411b7e58b3fc9');
  expect(queryHash?.[1]).toBe(bodySha256);
  expect(baseRecord.sourceBytes.toString('utf8')).toContain(bodySha256);
});

test('production ready manifest still rejects corrupt operating custody before checkout or transport access', () => {
  const files = privateAdmissionFiles();
  writeFileSync(files.receiptPath, '{}\n');
  let gitCalls = 0;
  let protectedReadbackCalls = 0;
  let transportCalls = 0;
  expect(() => runAdminUserRpcForward({
    admissionPath: files.admissionPath,
    environment: {},
  }, {
    now: () => fixedNow,
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
  })).toThrow('FORWARD_ADMISSION_INVALID');
  expect(gitCalls).toBe(0);
  expect(protectedReadbackCalls).toBe(0);
  expect(transportCalls).toBe(0);
});

test('in-memory held manifest rejects before admission, checkout or transport access', () => {
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
    loadManifestImpl: () => heldRecord,
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
  const files = privateAdmissionFiles();
  const document = files.document;
  expect(() => validateForwardAdmission(document, readyRecord, {
    now: fixedNow,
    receiptDirectory: files.directory,
  })).not.toThrow();
  expect(() => validateForwardAdmission(document, readyRecord, {
    now: new Date(document.expiresAt),
    receiptDirectory: files.directory,
  })).toThrow('FORWARD_ADMISSION_EXPIRED');
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
  const spans = statementSpans(plan.sql);
  const terminalGuard = spans.findIndex(span => span.token.includes('MIGRATION_TERMINAL_READBACK_FAILED'));
  expect(terminalGuard).toBeGreaterThan(1);
  expect(spans[terminalGuard - 2].token).toContain('INSERT INTO supabase_migrations.schema_migrations');
  expect(spans[terminalGuard - 1].token).toContain('MIGRATION_LEDGER_READBACK_FAILED');
  expect(spans.some(span => /^(?:BEGIN|COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION)\b/i.test(span.token.trim()))).toBe(false);
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
    const files = privateAdmissionFiles(document);
    expect(() => validateForwardAdmission(files.document, readyRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    }), label).toThrow('FORWARD_ADMISSION_INVALID');
  }
});

test('operating readback hash requires canonical private bytes bound to project, source and prior state', () => {
  expect(() => validateForwardAdmission(admission(), readyRecord, { now: fixedNow })).toThrow('FORWARD_ADMISSION_INVALID');
  {
    const files = privateAdmissionFiles();
    writeFileSync(files.receiptPath, '{}\n', { mode: 0o600 });
    expect(() => validateForwardAdmission(files.document, readyRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('FORWARD_ADMISSION_INVALID');
  }
  {
    const files = privateAdmissionFiles();
    const receipt = { ...files.receipt, projectRef: 'wrong-project' };
    const bytes = canonicalBytes(receipt);
    writeFileSync(files.receiptPath, bytes, { mode: 0o600 });
    files.document.operatingReadbackSha256 = digest(bytes);
    expect(() => validateForwardAdmission(files.document, readyRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('FORWARD_ADMISSION_INVALID');
  }
  {
    const files = privateAdmissionFiles();
    const receipt = { ...files.receipt, sourceRevision: 'b'.repeat(40) };
    const bytes = canonicalBytes(receipt);
    writeFileSync(files.receiptPath, bytes, { mode: 0o600 });
    files.document.operatingReadbackSha256 = digest(bytes);
    expect(() => validateForwardAdmission(files.document, readyRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('FORWARD_ADMISSION_INVALID');
  }
  {
    const files = privateAdmissionFiles();
    const prior = structuredClone(files.receipt.priorState);
    prior.prior.ledgerRoot = '9'.repeat(64);
    const receipt = { ...files.receipt, priorState: prior };
    const bytes = canonicalBytes(receipt);
    writeFileSync(files.receiptPath, bytes, { mode: 0o600 });
    files.document.operatingReadbackSha256 = digest(bytes);
    expect(() => validateForwardAdmission(files.document, readyRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('FORWARD_ADMISSION_INVALID');
  }
  {
    const files = privateAdmissionFiles();
    const receipt = { ...files.rollbackReceipt, projectId: 'prj_stale_web_project' };
    const bytes = canonicalBytes(receipt);
    writeFileSync(files.rollbackReceiptPath, bytes, { mode: 0o600 });
    files.document.rollback.readbackSha256 = digest(bytes);
    expect(() => validateForwardAdmission(files.document, readyRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('FORWARD_ADMISSION_INVALID');
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

test('admission expiring during preflight never issues a mutating apply', () => {
  const files = privateAdmissionFiles();
  const exactExpiry = new Date(files.document.expiresAt);
  const clock = [fixedNow, fixedNow, fixedNow, exactExpiry, exactExpiry];
  let clockCalls = 0;
  const calls: string[] = [];
  expect(() => runAdminUserRpcForward({
    admissionPath: files.admissionPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    ...dependencies((_url, sql) => {
      calls.push(sql);
      return JSON.stringify(priorState);
    }),
    now: () => clock[Math.min(clockCalls++, clock.length - 1)],
  })).toThrow('FORWARD_ADMISSION_EXPIRED');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toStartWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  expect(calls[0]).not.toContain('INSERT INTO supabase_migrations.schema_migrations');
});

test('live rollback identity is checked once before database access', () => {
  const admissionPath = privateAdmission();
  let rollbackCalls = 0;
  let transportCalls = 0;
  expect(() => runAdminUserRpcForward({
    admissionPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    ...dependencies(() => { transportCalls += 1; return ''; }),
    rollbackReadbackImpl: ({ expected, now }: any) => {
      rollbackCalls += 1;
      return {
        schemaVersion: 1,
        kind: 'vercel-rollback-readback',
        projectId: rollbackIdentity.projectId,
        teamId: rollbackIdentity.teamId,
        deploymentId: expected.deploymentId,
        deploymentUrl: expected.deploymentUrl,
        readyState: rollbackIdentity.readyState,
        target: rollbackIdentity.target,
        repository: 'other/repository',
        gitSha: expected.gitSha,
        gitRef: expected.gitRef,
        productionAliases: [...rollbackIdentity.productionAliases],
        observedAt: now().toISOString(),
      };
    },
  })).toThrow('FORWARD_ROLLBACK_READBACK_INVALID');
  expect(rollbackCalls).toBe(1);
  expect(transportCalls).toBe(0);
});

test('live rollback readback crossing exact expiry stops before database access', () => {
  const files = privateAdmissionFiles();
  const exactExpiry = new Date(files.document.expiresAt);
  const clock = [fixedNow, exactExpiry, exactExpiry];
  let clockIndex = 0;
  let rollbackCalls = 0;
  let transportCalls = 0;
  expect(() => runAdminUserRpcForward({
    admissionPath: files.admissionPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    ...dependencies(() => { transportCalls += 1; return ''; }),
    now: () => clock[Math.min(clockIndex++, clock.length - 1)],
    rollbackReadbackImpl: ({ expected, now }: any) => {
      rollbackCalls += 1;
      return {
        schemaVersion: 1,
        kind: 'vercel-rollback-readback',
        projectId: rollbackIdentity.projectId,
        teamId: rollbackIdentity.teamId,
        deploymentId: expected.deploymentId,
        deploymentUrl: expected.deploymentUrl,
        readyState: rollbackIdentity.readyState,
        target: rollbackIdentity.target,
        repository: rollbackIdentity.repository,
        gitSha: expected.gitSha,
        gitRef: expected.gitRef,
        productionAliases: [...rollbackIdentity.productionAliases],
        observedAt: now().toISOString(),
      };
    },
  })).toThrow('FORWARD_ADMISSION_EXPIRED');
  expect(rollbackCalls).toBe(1);
  expect(transportCalls).toBe(0);
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
  const protectedGitOptions: any[] = [];
  const terminal = expectedForwardTerminal(priorState);
  const dependencies = {
    gitFactsImpl: () => currentForwardGitFacts({ repositoryRoot: checkout }),
    loadManifestImpl: () => fixtureRecord,
    now: () => fixedNow,
    protectedMainReadbackImpl: (manifest: any) => currentProtectedMainReadback(manifest, {
      repositoryRoot: checkout,
      spawnImpl: (command: string, args: string[], options: any) => {
        protectedGitOptions.push(options);
        return spawnSync(command, args, options);
      },
    }),
    rollbackReadbackImpl: ({ expected, now }: any) => ({
      schemaVersion: 1,
      kind: 'vercel-rollback-readback',
      projectId: rollbackIdentity.projectId,
      teamId: rollbackIdentity.teamId,
      deploymentId: expected.deploymentId,
      deploymentUrl: expected.deploymentUrl,
      readyState: rollbackIdentity.readyState,
      target: rollbackIdentity.target,
      repository: rollbackIdentity.repository,
      gitSha: expected.gitSha,
      gitRef: expected.gitRef,
      productionAliases: [...rollbackIdentity.productionAliases],
      observedAt: now().toISOString(),
    }),
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
  expect(protectedGitOptions).toHaveLength(2);
  expect(protectedGitOptions.every(options => (
    options.timeout === 15_000
    && options.killSignal === 'SIGKILL'
    && options.maxBuffer === 1024 * 1024
  ))).toBe(true);

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
