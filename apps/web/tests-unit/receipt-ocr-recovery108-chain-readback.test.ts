import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

import { prepareRecovery108ChainReadback } from '../scripts/receipt-ocr-recovery108-chain-readback.mjs';
import { loadRecovery108ChainSource } from '../scripts/receipt-ocr-recovery108-chain-plan.mjs';
import { ledgerIdentityRoot } from '../scripts/review-media-evidence-prefixed-sql-successors.mjs';
import { elevenMigrationBundleSuffixRoot, fiveMigrationBundleSuffixRoot } from '../scripts/supabase-migration-bundle.mjs';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

// Operating-shaped synthetic source fixture. No DB state or receipt is inferred.
function stages(record: any) {
  const predecessor = record.manifest.phase === 'predecessor';
  const size = predecessor ? 11 : 5;
  const suffix = predecessor
    ? elevenMigrationBundleSuffixRoot(record.targetRecord.manifest.migrations)
    : fiveMigrationBundleSuffixRoot(record.targetRecord.manifest.migrations);
  const legacyPrefix = predecessor ? '1'.repeat(64) : '8'.repeat(64);
  const roots = record.manifest.operatingIdentity;
  const priorPredecessorRoot = ledgerIdentityRoot(record.predecessorRows);
  return Array.from({ length: size + 1 }, (_, index) => {
    const legacyBundle = {
      ledgerCount: (predecessor ? 89 : 100) + index,
      prefixRoot: legacyPrefix,
      priorCount: predecessor ? 89 : 100,
      suffixRoot: index === size ? suffix : null,
      targetCount: index,
    };
    const legacyState = predecessor ? {
      activeReviewItems: 0, currentUser: 'postgres', databaseName: 'postgres',
      finishCleanupBodySha256: index === 10
        ? record.targetRecord.manifest.terminalContract.finishPreimageSha256
        : index === 11 ? record.targetRecord.manifest.terminalContract.finishPostimageSha256
          : index === 0 ? null : sha(`finish-${index}`),
      g014Root: index < 3 ? '2'.repeat(64) : '3'.repeat(64),
      ledgerRoot: index === 0 ? legacyPrefix : sha(`predecessor-ledger-${index}`),
      ownerAuthorityReady: true, reviewItems: 0, reviewPolicyEnabled: false, reviewRuns: 0,
      schemaRoot: sha(`predecessor-schema-${index}`), serverMajor: 17,
      sessionUser: 'postgres', storageRoot: sha(`predecessor-storage-${index}`),
      terminalContractReady: index === 11,
    } : {
      activeReviewItems: 0, baseReviewReady: true,
      catalogRoot: sha(`feature-catalog-${index}`), currentUser: 'postgres',
      databaseName: 'postgres', featureRuntimeReady: index >= 5, g014Ready: index >= 3,
      g014Root: index < 3 ? sha('feature-g014-before') : sha('feature-g014-after'),
      immutableReady: index >= 4,
      ledgerRoot: index === 0 ? legacyPrefix : sha(`feature-ledger-${index}`),
      ocrReady: index >= 2, predecessorReady: true, reviewPolicyEnabled: false, reviewRuns: 0,
      roleRoot: sha('feature-role-root'), runtimePredicateReady: index >= 5,
      serverMajor: 17, sessionUser: 'postgres',
      storageRoot: index < 4 ? sha('feature-storage-before') : sha('feature-storage-after'),
      storyboardReady: index >= 1,
      storyboardRoot: index === 0 ? sha('feature-storyboard-before') : sha('feature-storyboard-after'),
    };
    return {
      bundle: {
        ledgerCount: record.manifest.operatingTransition.before + index,
        prefixRoot: roots.prefixIdentityRoot,
        priorCount: record.manifest.operatingTransition.before,
        suffixRoot: legacyBundle.suffixRoot,
        targetCount: index,
      },
      state: {
        baseIdentityRoot: record.manifest.baseMapping.baseIdentityRoot,
        baseRowCount: 86, evidenceCount: 3, evidenceIdentityRoot: roots.evidenceIdentityRoot,
        evidenceReady: true, featureCount: predecessor ? 0 : index,
        featureIdentityRoot: predecessor ? sha('') : roots.targetStageRoots[index],
        featureReady: !predecessor && index === 5,
        historicalAppliedVariantReady: true,
        ledgerIdentityRoot: roots.ledgerStageRoots[index],
        legacyBundle, legacyState, operatingBaseReady: true,
        predecessorCount: predecessor ? index : 11,
        predecessorIdentityRoot: predecessor ? roots.targetStageRoots[index] : priorPredecessorRoot,
        predecessorReady: predecessor ? index === 11 : true,
        targetIdentityRoot: roots.targetStageRoots[index], targetStageIndex: index,
      },
    };
  });
}

function syntheticInput() {
  const source = loadRecovery108ChainSource();
  const admission = (record: any) => ({
    kind: 'evidence-prefixed-successor-local-admission', phase: record.manifest.phase,
    baseMappingSha256: record.manifest.baseMapping.sha256,
    manifestSha256: record.manifestSha256, stageStates: stages(record),
  });
  return {
    predecessorAdmission: admission(source.predecessor),
    featureAdmission: admission(source.feature),
    now: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-20T00:10:00.000Z',
  };
}

function fakeConnection(queryPlan: any, options: {
  terminal?: boolean; busy?: boolean; failAt?: string; failReadOnly?: boolean; cleanupFails?: boolean;
  identityCount?: number; stateMismatch?: boolean; ledgerExists?: boolean;
  factoryFails?: boolean; invalidLease?: boolean; closeFails?: boolean; openFails?: boolean;
} = {}) {
  const calls: string[] = [];
  const closes = { count: 0 };
  const factoryCalls = { count: 0 };
  const close = async () => {
    closes.count++;
    if (options.closeFails) throw new Error('private close detail');
  };
  const connection = { close, async query(sql: string) {
    calls.push(sql);
    if (options.openFails && sql === queryPlan.settlement.openSql) throw new Error('private open detail');
    if (options.cleanupFails && sql === queryPlan.settlement.closeSql) throw new Error('private cleanup detail');
    if (options.busy && sql === queryPlan.settlement.lockSql) throw new Error('private lock detail');
    if (options.failReadOnly && sql === 'SET TRANSACTION READ ONLY;') throw new Error('private read-only detail');
    if (options.failAt && sql === (queryPlan as any)[options.failAt]) throw new Error('private connection detail');
    if (sql === queryPlan.availabilityQuery) return { rows: [{ availability: {
      ledgerExists: options.ledgerExists ?? true,
      initialObjectsReady: true, terminalObjectsReady: true,
    } }] };
    if (sql === queryPlan.identityQuery) return { rows: [{ identity: {
      ledgerCount: options.identityCount ?? (options.terminal ? 108 : 89),
      ledgerIdentityRoot: options.terminal ? queryPlan.terminalRoot : queryPlan.initialRoot,
    } }] };
    if (sql === queryPlan.initialStateQuery) return { rows: [{ state: JSON.stringify(
      options.stateMismatch ? { wrong: true } : queryPlan.initialExpected,
    ) }] };
    if (sql === queryPlan.terminalStateQuery) return { rows: [{ receipt_ocr_recovery108_state:
      options.stateMismatch ? { wrong: true } : queryPlan.terminalExpected }] };
    return { rows: [] };
  } };
  const factory = { async createDedicatedClient() {
    factoryCalls.count++;
    if (options.factoryFails) throw new Error('private factory detail');
    return options.invalidLease ? { close } : connection;
  } };
  return { factory, connection, calls, closes, factoryCalls };
}

describe('source-only OCR full-chain readback adapter', () => {
  test('settles exact 89 and 108 only after ordered same-connection queries and rollback', async () => {
    const prepared = prepareRecovery108ChainReadback(syntheticInput());
    const q = prepared.queryPlan;
    expect(prepared.readbackCompilerSha256).toBe(sha(readFileSync(
      new URL('../scripts/receipt-ocr-recovery108-chain-readback.mjs', import.meta.url)).toString()));
    expect(prepared.readbackSourceRoot).toMatch(/^[0-9a-f]{64}$/);
    for (const terminal of [false, true]) {
      const { factory, calls, closes, factoryCalls } = fakeConnection(q, { terminal });
      expect(await prepared.execute(factory)).toEqual({
        status: terminal ? 'settled_terminal_match' : 'settled_initial_match',
        reason: terminal ? 'SETTLED_TERMINAL_MATCH' : 'SETTLED_INITIAL_MATCH',
      });
      expect(calls).toEqual([q.settlement.openSql, prepared.readOnlySql, q.settlement.lockSql,
        q.availabilityQuery, q.identityQuery,
        terminal ? q.terminalStateQuery : q.initialStateQuery, q.settlement.closeSql]);
      expect(factoryCalls.count).toBe(1);
      expect(closes.count).toBe(1);
    }
    const originalLockSql = q.settlement.lockSql;
    q.settlement.lockSql = 'SELECT 1;';
    const tamperedCopy = fakeConnection(q);
    expect((await prepared.execute(tamperedCopy.factory)).status).toBe('settled_initial_match');
    expect(tamperedCopy.calls[2]).toBe(originalLockSql);
  }, 30000);

  test('busy lock and connection loss stay unknown and attempt cleanup once', async () => {
    const prepared = prepareRecovery108ChainReadback(syntheticInput());
    const q = prepared.queryPlan;
    const busy = fakeConnection(q, { busy: true });
    expect(await prepared.execute(busy.factory)).toEqual({ status: 'unknown', reason: 'LOCK_UNAVAILABLE' });
    expect(busy.calls).toEqual([q.settlement.openSql, prepared.readOnlySql,
      q.settlement.lockSql, q.settlement.closeSql]);
    const readOnlyFailed = fakeConnection(q, { failReadOnly: true });
    expect(await prepared.execute(readOnlyFailed.factory)).toEqual({ status: 'unknown', reason: 'READ_ONLY_UNAVAILABLE' });
    expect(readOnlyFailed.calls).toEqual([q.settlement.openSql, prepared.readOnlySql,
      q.settlement.closeSql]);
    const lost = fakeConnection(q, { failAt: 'identityQuery' });
    expect(await prepared.execute(lost.factory)).toEqual({ status: 'unknown', reason: 'IDENTITY_UNAVAILABLE' });
    expect(lost.calls.at(-1)).toBe(q.settlement.closeSql);
  }, 30000);

  test('cleanup failure overrides a matching state; mismatches never settle', async () => {
    const prepared = prepareRecovery108ChainReadback(syntheticInput());
    const q = prepared.queryPlan;
    const cleanup = fakeConnection(q, { cleanupFails: true });
    expect(await prepared.execute(cleanup.factory)).toEqual({ status: 'unknown', reason: 'CLEANUP_UNCONFIRMED' });
    const state = fakeConnection(q, { stateMismatch: true });
    expect(await prepared.execute(state.factory)).toEqual({ status: 'conflict', reason: 'STATE_CONFLICT' });
    const identity = fakeConnection(q, { identityCount: 107 });
    expect(await prepared.execute(identity.factory)).toEqual({ status: 'conflict', reason: 'IDENTITY_CONFLICT' });
    expect(identity.calls).not.toContain(q.initialStateQuery);
    expect(identity.calls).not.toContain(q.terminalStateQuery);
    const absent = fakeConnection(q, { ledgerExists: false });
    expect(await prepared.execute(absent.factory)).toEqual({ status: 'unknown', reason: 'LEDGER_UNAVAILABLE' });
    expect(absent.calls).not.toContain(q.identityQuery);
  }, 30000);

  test('rejects caller settlement flags and never exposes provider diagnostics', async () => {
    expect(() => prepareRecovery108ChainReadback({ ...syntheticInput(), settled: true }))
      .toThrow('RECEIPT_OCR_CHAIN_INPUT_INVALID');
    const prepared = prepareRecovery108ChainReadback(syntheticInput());
    const q = prepared.queryPlan;
    const { factory, connection, calls } = fakeConnection(q, { busy: true, cleanupFails: true });
    const result = await prepared.execute(factory);
    expect(result).toEqual({ status: 'unknown', reason: 'CLEANUP_UNCONFIRMED' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(await prepared.execute(connection)).toEqual({ status: 'unknown', reason: 'FACTORY_INVALID' });
    expect(calls).toHaveLength(4);
    expect(await prepared.execute(null)).toEqual({ status: 'unknown', reason: 'FACTORY_INVALID' });
  }, 30000);

  test('factory and lease failures never reach BEGIN and close an acquired lease once', async () => {
    const prepared = prepareRecovery108ChainReadback(syntheticInput());
    const q = prepared.queryPlan;
    const factoryFailure = fakeConnection(q, { factoryFails: true });
    expect(await prepared.execute(factoryFailure.factory)).toEqual({ status: 'unknown', reason: 'FACTORY_FAILED' });
    expect(factoryFailure.calls).toEqual([]);
    expect(factoryFailure.closes.count).toBe(0);
    const invalid = fakeConnection(q, { invalidLease: true });
    expect(await prepared.execute(invalid.factory)).toEqual({ status: 'unknown', reason: 'LEASE_INVALID' });
    expect(invalid.calls).toEqual([]);
    expect(invalid.closes.count).toBe(1);
    const unclosable = fakeConnection(q);
    expect(await prepared.execute({ createDedicatedClient: async () => ({ query: unclosable.connection.query }) }))
      .toEqual({ status: 'unknown', reason: 'CLEANUP_UNCONFIRMED' });
    expect(unclosable.calls).toEqual([]);
    const openFailure = fakeConnection(q, { openFails: true });
    expect(await prepared.execute(openFailure.factory)).toEqual({ status: 'unknown', reason: 'OPEN_FAILED' });
    expect(openFailure.calls).toEqual([q.settlement.openSql, q.settlement.closeSql]);
    expect(openFailure.closes.count).toBe(1);
    const borrowed = fakeConnection(q);
    const queryObjectWithFactory = { ...borrowed.factory, query: borrowed.connection.query, idle: true };
    expect(await prepared.execute(queryObjectWithFactory)).toEqual({ status: 'unknown', reason: 'FACTORY_INVALID' });
    expect(borrowed.factoryCalls.count).toBe(0);
    expect(borrowed.calls).toEqual([]);
  }, 30000);

  test('close failure overrides a match and a factory cannot reuse a prior lease', async () => {
    const prepared = prepareRecovery108ChainReadback(syntheticInput());
    const q = prepared.queryPlan;
    const closing = fakeConnection(q, { closeFails: true });
    expect(await prepared.execute(closing.factory)).toEqual({ status: 'unknown', reason: 'CLEANUP_UNCONFIRMED' });
    expect(closing.closes.count).toBe(1);
    const reused = fakeConnection(q);
    expect((await prepared.execute(reused.factory)).status).toBe('settled_initial_match');
    const before = reused.calls.length;
    expect(await prepared.execute(reused.factory)).toEqual({ status: 'unknown', reason: 'LEASE_REUSED' });
    expect(reused.calls).toHaveLength(before);
    expect(reused.closes.count).toBe(1);
    const disposable = fakeConnection(q);
    let disposed = 0;
    const disposeFactory = { createDedicatedClient: async () => ({
      query: disposable.connection.query,
      dispose: async () => { disposed++; },
    }) };
    expect((await prepared.execute(disposeFactory)).status).toBe('settled_initial_match');
    expect(disposed).toBe(1);
  }, 30000);
});
