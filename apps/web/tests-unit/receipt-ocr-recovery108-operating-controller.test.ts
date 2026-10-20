import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { loadRecovery108ChainSource } from '../scripts/receipt-ocr-recovery108-chain-plan.mjs';
import {
  chainManifestRecord,
  createRecovery108MutationExecutor,
  runRecovery108OperatingController,
} from '../scripts/receipt-ocr-recovery108-operating-controller.mjs';

const revision = 'a'.repeat(40);
const createdAt = '2026-10-21T00:00:00.000Z';
const expiresAt = '2026-10-21T00:15:00.000Z';
const databaseUrl = () => `postgresql://postgres:${randomUUID()}@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?sslmode=require`;

function fixture() {
  const held = loadRecovery108ChainSource();
  const names = ['predecessor', 'feature', 'post105', 'acl', 'recovery'] as const;
  const records = {} as any;
  for (const name of names) {
    records[name] = { ...held[name], manifest: { ...held[name].manifest,
      launchPolicy: { ...held[name].manifest.launchPolicy, state: 'ready' } } };
  }
  records.post105.predecessor = records.feature;
  records.acl.baseRecord = records.post105;
  records.recovery.predecessorRecord = records.acl;
  const ready = loadRecovery108ChainSource({
    loadRecoveryImpl: () => records.recovery,
    loadPredecessorImpl: () => records.predecessor,
  });
  const manifestRecord = chainManifestRecord(ready);
  const stageAdmission = { predecessorAdmission: {}, featureAdmission: {},
    manifestSha256s: ready.manifestSha256s, sourceRoot: ready.sourceRoot };
  const bodySql = 'SELECT 1;\n';
  const plan = { kind: 'receipt-ocr-89-to-108-source-only-chain-plan',
    sourceRoot: ready.sourceRoot, sourceManifestSha256: ready.recovery.manifestSha256,
    sourceManifestSha256s: ready.manifestSha256s, migrationCount: 19,
    bodySql, rehearsalSql: `BEGIN;\n${bodySql}ROLLBACK;\n`,
    applySql: `BEGIN;\n${bodySql}COMMIT;\n` };
  const bundle = { createdAt, expiresAt };
  const evidence = () => ({
    input: { attemptId: 'bounded-attempt', sourceRevision: revision,
      sourceRoot: ready.sourceRoot, manifestSha256: manifestRecord.manifestSha256,
      createdAt, expiresAt,
      writerFenceReceipts: Object.fromEntries(Object.entries(manifestRecord.manifest.requiredWriterFences)
        .map(([name, state]) => [name, { state }])) },
    machine: { inFlightQuiescence: { inFlightWriters: 0 } },
  });
  return { held, ready, stageAdmission, plan, bundle, evidence };
}

function harness({ readbacks = ['settled_initial_match'], execute = () => ({ ack: 'confirmed' }) }:
  { readbacks?: string[]; execute?: (sql: string) => unknown } = {}) {
  const f = fixture();
  const sent: string[] = [];
  const custody: string[] = [];
  let reads = 0;
  let captures = 0;
  const args = { mode: 'apply', bundle: f.bundle, stageAdmission: f.stageAdmission,
    custodyDirectory: '/private/tmp/unused', environment: { GITHUB_SHA: revision } };
  const deps = {
    loadSourceImpl: () => f.ready,
    clock: () => new Date('2026-10-21T00:01:00.000Z'),
    validateBundleImpl: () => undefined,
    verifyRuntimeRollbackImpl: async () => () => f.bundle,
    attestationImpl: () => ({ runAttempt: '1', runId: '123' }),
    assembleEvidenceImpl: () => { captures++; return f.evidence(); },
    compilePlanImpl: () => f.plan,
    createCustodyImpl: () => ({ record(name: string) { custody.push(name); } }),
    readbackExecutor: async () => ({ status: readbacks[reads++] ?? 'unknown' }),
    executeSqlOnce: ({ sql }: { sql: string }) => { sent.push(sql); return execute(sql); },
  };
  return { f, args, deps, sent, custody, get reads() { return reads; },
    get captures() { return captures; } };
}

describe('held 89 to 108 operating controller', () => {
  test('sends each mutation to a bounded no-password psql client once', () => {
    const f = fixture();
    const calls: any[] = [];
    const execute = createRecovery108MutationExecutor({
      environment: {
        SUPABASE_DB_URL: databaseUrl(),
        SUCCESSOR_SERIALIZER_BACKEND_PID: '123',
        SUCCESSOR_SERIALIZER_BACKEND_START_MICROS: '1790000000000000',
      },
      spawnImpl: (_binary: string, args: string[], options: any) => {
        calls.push({ args, options });
        return { status: 0, stdout: calls.length === 1 ? 'SERIALIZER_ALIVE\n' : '', stderr: '' };
      },
    });
    expect(execute({ sql: 'BEGIN; ROLLBACK;', manifest: f.ready.recovery.manifest }))
      .toEqual({ ack: 'confirmed' });
    expect(calls).toHaveLength(2);
    expect(calls[0].options.input).toContain('pg_catalog.pg_locks');
    expect(calls[0].options.input).toContain('lock.database=activity.datid');
    expect(calls[0].options.input).toContain('activity.backend_start)*1000000)::bigint=1790000000000000');
    expect(calls[0].options.input).toContain("lock.classid::bigint=((pg_catalog.hashtextextended('tzudong:review-media-sql-successor:workflow:v1', 0) >> 32) & 4294967295::bigint)");
    expect(calls[0].options.input).toContain("lock.objid::bigint=(pg_catalog.hashtextextended('tzudong:review-media-sql-successor:workflow:v1', 0) & 4294967295::bigint)");
    expect(calls[0].options.env.PGOPTIONS).toBe('-c default_transaction_read_only=on');
    expect(calls[1].args).toContain('--no-password');
    expect(calls[1].options).toMatchObject({ timeout: 810_000, killSignal: 'SIGKILL' });
    expect(calls[1].options.env.PGCONNECT_TIMEOUT).toBe('5');
    expect(calls[1].options.env.PGOPTIONS).toBeUndefined();
    expect(calls[1].options.input).toContain('BEGIN; ROLLBACK;');
  });

  test('refuses a new mutation when the serializer DB round-trip loses its lock', () => {
    const f = fixture();
    const calls: string[] = [];
    const execute = createRecovery108MutationExecutor({
      environment: {
        SUPABASE_DB_URL: databaseUrl(),
        SUCCESSOR_SERIALIZER_BACKEND_PID: '123',
        SUCCESSOR_SERIALIZER_BACKEND_START_MICROS: '1790000000000000',
      },
      spawnImpl: (_binary: string, _args: string[], options: any) => {
        calls.push(options.input);
        return { status: 0, stdout: 'SERIALIZER_LOST\n', stderr: '' };
      },
    });
    expect(() => execute({ sql: 'BEGIN; COMMIT;', manifest: f.ready.recovery.manifest }))
      .toThrow('RECEIPT_OCR_CHAIN_SERIALIZER_UNCONFIRMED');
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('BEGIN; COMMIT;');
  });

  test('rejects a reused backend PID, another advisory key, or another database before SQL', () => {
    const f = fixture();
    const key = "pg_catalog.hashtextextended('tzudong:review-media-sql-successor:workflow:v1', 0)";
    for (const mismatch of ['key', 'backend-start', 'database']) {
      const calls: string[] = [];
      const execute = createRecovery108MutationExecutor({
        environment: {
          SUPABASE_DB_URL: databaseUrl(),
          SUCCESSOR_SERIALIZER_BACKEND_PID: '123',
          SUCCESSOR_SERIALIZER_BACKEND_START_MICROS: '1790000000000000',
        },
        spawnImpl: (_binary: string, _args: string[], options: any) => {
          calls.push(options.input);
          const sql = options.input;
          const guards = {
            key: sql.includes(`lock.classid::bigint=((${key} >> 32) & 4294967295::bigint)`)
              && sql.includes(`lock.objid::bigint=(${key} & 4294967295::bigint)`)
              && sql.includes('lock.objsubid=1'),
            'backend-start': sql.includes('activity.backend_start)*1000000)::bigint=1790000000000000'),
            database: sql.includes('lock.database=activity.datid')
              && sql.includes("activity.datname='postgres'"),
          };
          return { status: 0, stdout: guards[mismatch as keyof typeof guards]
            ? 'SERIALIZER_LOST\n' : 'SERIALIZER_ALIVE\n', stderr: '' };
        },
      });
      expect(() => execute({ sql: 'BEGIN; COMMIT;', manifest: f.ready.recovery.manifest }))
        .toThrow('RECEIPT_OCR_CHAIN_SERIALIZER_UNCONFIRMED');
      expect(calls).toHaveLength(1);
      expect(calls[0]).not.toContain('BEGIN; COMMIT;');
    }
  });

  test('stops before evidence, readback, and SQL when any constituent remains held', async () => {
    const h = harness();
    h.deps.loadSourceImpl = () => h.f.held;
    const result = await runRecovery108OperatingController(h.args as any, h.deps as any);
    expect(result.status).toBe('held');
    expect(h.sent).toHaveLength(0);
    expect(h.reads).toBe(0);
    expect(h.captures).toBe(0);
  });

  test('rehearses and applies the same bound body once each after settled readbacks', async () => {
    const h = harness({ readbacks: [
      'settled_initial_match', 'settled_initial_match', 'settled_terminal_match',
    ] });
    const result = await runRecovery108OperatingController(h.args as any, h.deps as any);
    expect(result.status).toBe('committed');
    expect(h.sent).toEqual([h.f.plan.rehearsalSql, h.f.plan.applySql]);
    expect(h.reads).toBe(3);
    expect(h.captures).toBe(2);
    expect(h.custody).toEqual(['authority', 'rehearsal', 'apply', 'settlement']);
  });

  test('unknown rehearsal ACK only reconciles and never starts apply', async () => {
    const h = harness({ readbacks: ['settled_initial_match', 'settled_initial_match'],
      execute: () => { throw new Error('ACK lost'); } });
    const result = await runRecovery108OperatingController(h.args as any, h.deps as any);
    expect(result.status).toBe('unknown');
    expect(h.sent).toEqual([h.f.plan.rehearsalSql]);
    expect(h.reads).toBe(2);
  });

  test('initial terminal observation sends no SQL and claims no attempt commit', async () => {
    const h = harness({ readbacks: ['settled_terminal_match'] });
    const result = await runRecovery108OperatingController(h.args as any, h.deps as any);
    expect(result).toMatchObject({
      status: 'terminal_observed', code: 'RECEIPT_OCR_CHAIN_TERMINAL_OBSERVED',
    });
    expect(h.sent).toHaveLength(0);
    expect(h.reads).toBe(1);
    expect(h.custody).toEqual(['authority', 'settlement']);
  });

  test('unknown apply ACK observes terminal state without claiming its own commit', async () => {
    let calls = 0;
    const h = harness({ readbacks: [
      'settled_initial_match', 'settled_initial_match', 'settled_terminal_match',
    ], execute: () => { if (++calls === 2) throw new Error('ACK lost');
      return { ack: 'confirmed' }; } });
    const result = await runRecovery108OperatingController(h.args as any, h.deps as any);
    expect(result).toMatchObject({
      status: 'terminal_observed', code: 'RECEIPT_OCR_CHAIN_TERMINAL_OBSERVED',
    });
    expect(h.sent).toHaveLength(2);
    expect(h.reads).toBe(3);
  });

  test('rejects source admission drift and fresh fence loss before apply', async () => {
    const h = harness({ readbacks: ['settled_initial_match', 'settled_initial_match'] });
    const drifted = { ...h.args, stageAdmission: { ...h.args.stageAdmission, sourceRoot: 'f'.repeat(64) } };
    await expect(runRecovery108OperatingController(drifted as any, h.deps as any))
      .rejects.toThrow('RECEIPT_OCR_CHAIN_ADMISSION_INVALID');
    expect(h.sent).toHaveLength(0);

    let captures = 0;
    h.deps.assembleEvidenceImpl = () => {
      const result = h.f.evidence();
      if (++captures === 2) result.input.writerFenceReceipts.dashboard.state = 'active';
      return result;
    };
    await expect(runRecovery108OperatingController(h.args as any, h.deps as any))
      .rejects.toThrow('RECEIPT_OCR_CHAIN_EVIDENCE_INVALID');
    expect(h.sent).toEqual([h.f.plan.rehearsalSql]);
  });
});
