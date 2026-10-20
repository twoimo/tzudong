/** Source-only readback adapter for a caller-owned, single PostgreSQL connection. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  classifyRecovery108ChainReconciliation,
  compileRecovery108ChainPlan,
  loadRecovery108ChainSource,
} from './receipt-ocr-recovery108-chain-plan.mjs';

const MAX_READBACK_BYTES = 64 * 1024;
const READ_ONLY_SQL = 'SET TRANSACTION READ ONLY;';
const HEX = /^[0-9a-f]{64}$/;
const USED_LEASES = new WeakSet();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    fail('RECEIPT_OCR_CHAIN_READBACK_INPUT_INVALID');
  }
}

function oneValue(result, column) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.rows)
    || result.rows.length !== 1) return null;
  const row = result.rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).length !== 1 || !Object.hasOwn(row, column)) return null;
  const raw = row[column];
  try {
    if (typeof raw === 'string') {
      if (Buffer.byteLength(raw) > MAX_READBACK_BYTES) return null;
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    }
    const encoded = JSON.stringify(raw);
    return typeof encoded === 'string' && Buffer.byteLength(encoded) <= MAX_READBACK_BYTES
      && raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch { return null; }
}

const outcome = (status, reason) => Object.freeze({ status, reason });

function preparePlan(compilationInput) {
  // Recompile from source-bound admissions; never execute caller-supplied SQL.
  const compiled = compileRecovery108ChainPlan(compilationInput);
  const source = loadRecovery108ChainSource();
  const plan = structuredClone(compiled.reconciliation);
  const expectedLockKeys = [source.predecessor, source.feature, source.post105, source.acl, source.recovery]
    .map(record => record.manifest.advisoryLockKey).sort((a, b) => a - b);
  if (compiled.kind !== 'receipt-ocr-89-to-108-source-only-chain-plan'
    || compiled.migrationCount !== 19 || !HEX.test(compiled.sourceRoot)
    || compiled.sourceRoot !== source.sourceRoot
    || source.recovery.manifest.projectRef !== 'aqlcofblfxdrjhhdmarw'
    || source.recovery.manifest.serverMajor !== 17
    || source.recovery.manifest.databaseName !== 'postgres'
    || source.recovery.manifest.executorRole !== 'postgres'
    || typeof plan?.settlement?.openSql !== 'string'
    || typeof plan.settlement.lockSql !== 'string'
    || typeof plan.settlement.closeSql !== 'string'
    || !Array.isArray(plan.settlement.lockKeys) || plan.settlement.lockKeys.length !== 5
    || JSON.stringify(plan.settlement.lockKeys) !== JSON.stringify(expectedLockKeys)
    || !plan.settlement.openSql.startsWith('BEGIN;\n')
    || plan.settlement.closeSql !== 'ROLLBACK;\n'
    || typeof plan.availabilityQuery !== 'string' || typeof plan.identityQuery !== 'string'
    || typeof plan.initialStateQuery !== 'string' || typeof plan.terminalStateQuery !== 'string') {
    fail('RECEIPT_OCR_CHAIN_READBACK_PLAN_INVALID');
  }
  return Object.freeze({ sourceRoot: compiled.sourceRoot, plan });
}

export function prepareRecovery108ChainReadback(compilationInput) {
  const prepared = preparePlan(compilationInput);
  const plan = prepared.plan;
  const readbackCompilerSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
  return Object.freeze({
    sourceRoot: prepared.sourceRoot,
    readbackCompilerSha256,
    readbackSourceRoot: sha256(JSON.stringify({ chainSourceRoot: prepared.sourceRoot, readbackCompilerSha256 })),
    readOnlySql: READ_ONLY_SQL,
    // Inspection copy for source-only tests and the later controller. Mutating it
    // cannot change the private SQL used by execute().
    queryPlan: structuredClone(plan),
    async execute(factory) {
      // This factory must create a fresh, idle, dedicated client for this call.
      // A pool lease, active transaction, or shared client is outside this API.
      if (!factory || typeof factory !== 'object'
        || typeof factory.createDedicatedClient !== 'function'
        || typeof factory.query === 'function') {
        return outcome('unknown', 'FACTORY_INVALID');
      }
      let lease = null;
      let close = null;
      let began = false;
      let reused = false;
      let phase = 'FACTORY_FAILED';
      let result = outcome('unknown', phase);
      try {
        lease = await factory.createDedicatedClient();
        phase = 'LEASE_INVALID';
        close = lease && (typeof lease.close === 'function' ? lease.close
          : typeof lease.dispose === 'function' ? lease.dispose : null);
        if (!lease || typeof lease !== 'object' || typeof lease.query !== 'function' || !close) {
          result = outcome('unknown', phase);
        } else if (USED_LEASES.has(lease)) {
          reused = true;
          result = outcome('unknown', 'LEASE_REUSED');
        } else {
          USED_LEASES.add(lease);
          phase = 'OPEN_FAILED';
          began = true; // BEGIN may have reached the server before a rejection.
          await lease.query(plan.settlement.openSql);
          phase = 'READ_ONLY_UNAVAILABLE';
          await lease.query(READ_ONLY_SQL);
          phase = 'LOCK_UNAVAILABLE';
          await lease.query(plan.settlement.lockSql);
          phase = 'AVAILABILITY_UNAVAILABLE';
          const availability = oneValue(await lease.query(plan.availabilityQuery), 'availability');
          if (!availability) {
            result = outcome('unknown', phase);
          } else if (availability.ledgerExists !== true) {
            result = outcome('unknown', 'LEDGER_UNAVAILABLE');
          } else {
            phase = 'IDENTITY_UNAVAILABLE';
            const identity = oneValue(await lease.query(plan.identityQuery), 'identity');
            if (!identity) {
              result = outcome('unknown', phase);
            } else {
              const observation = { availability, identity, state: null };
              let classification;
              try { classification = classifyRecovery108ChainReconciliation(plan, observation); }
              catch { classification = 'unknown'; }
              if (classification === 'needs_settled_initial_state'
                || classification === 'needs_settled_terminal_state') {
                phase = 'STATE_UNAVAILABLE';
                const initial = classification === 'needs_settled_initial_state';
                const state = oneValue(await lease.query(initial
                  ? plan.initialStateQuery : plan.terminalStateQuery),
                initial ? 'state' : 'receipt_ocr_recovery108_state');
                if (!state) {
                  result = outcome('unknown', phase);
                } else {
                  try { classification = classifyRecovery108ChainReconciliation(plan,
                    { availability, identity, state }); }
                  catch { classification = 'unknown'; }
                  result = classification === 'initial_match_unsettled'
                    ? outcome('settled_initial_match', 'SETTLED_INITIAL_MATCH')
                    : classification === 'terminal_match_unsettled'
                      ? outcome('settled_terminal_match', 'SETTLED_TERMINAL_MATCH')
                      : classification === 'partial_conflict'
                        ? outcome('conflict', 'STATE_CONFLICT')
                        : outcome('unknown', 'STATE_UNAVAILABLE');
                }
              } else {
                result = classification === 'partial_conflict'
                  ? outcome('conflict', 'IDENTITY_CONFLICT')
                  : outcome('unknown', 'IDENTITY_UNAVAILABLE');
              }
            }
          }
        }
      } catch {
        result = outcome('unknown', phase);
      } finally {
        if (began) {
          try { await lease.query(plan.settlement.closeSql); }
          catch { result = outcome('unknown', 'CLEANUP_UNCONFIRMED'); }
        }
        if (lease && !reused) {
          if (close) {
            try { await close.call(lease); }
            catch { result = outcome('unknown', 'CLEANUP_UNCONFIRMED'); }
          } else {
            result = outcome('unknown', 'CLEANUP_UNCONFIRMED');
          }
        }
      }
      return result;
    },
  });
}
