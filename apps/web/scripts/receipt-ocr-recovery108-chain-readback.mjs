/** Read-only reconciliation in one newly spawned psql connection. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectDirectDatabaseTransport } from './apply-supabase-migration.mjs';
import {
  assertSuccessorDatabaseTarget,
  createSuccessorPsqlRunner,
} from './review-media-sql-successor.mjs';
import {
  compileRecovery108ChainPlan,
  loadRecovery108ChainSource,
} from './receipt-ocr-recovery108-chain-plan.mjs';

const MAX_READBACK_BYTES = 64 * 1024;
const READBACK_TIMEOUT_MS = 30_000;
const READ_ONLY_SQL = 'SET TRANSACTION READ ONLY;';
const HEX = /^[0-9a-f]{64}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const outcome = (status, reason) => Object.freeze({ status, reason });
const OUTCOMES = Object.freeze({
  SETTLED_INITIAL_MATCH: 'settled_initial_match',
  SETTLED_TERMINAL_MATCH: 'settled_terminal_match',
  STATE_CONFLICT: 'conflict',
  IDENTITY_CONFLICT: 'conflict',
  LEDGER_UNAVAILABLE: 'unknown',
  IDENTITY_UNAVAILABLE: 'unknown',
});
const emit = reason => `SELECT ${quote(JSON.stringify({ status: OUTCOMES[reason], reason }))}::jsonb;`;
const subquery = sql => sql.trim().replace(/;\s*$/, '');

function parseOutcome(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_READBACK_BYTES) return null;
  try {
    const value = JSON.parse(raw.trim());
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'reason,status'
      || !Object.hasOwn(OUTCOMES, value.reason) || value.status !== OUTCOMES[value.reason]) return null;
    return outcome(value.status, value.reason);
  } catch { return null; }
}

function stateMatchSql(query, column, expected) {
  return `SELECT coalesce(count(*)=1 AND bool_and(${column}::jsonb IS NOT DISTINCT FROM ${quote(JSON.stringify(expected))}::jsonb),false) AS matches
FROM (${subquery(query)}) AS state_readback
\\gset ocr108_state_
`;
}

function buildReadOnlyScript(plan) {
  const initial = { ledgerCount: 89, ledgerIdentityRoot: plan.initialRoot };
  const terminal = { ledgerCount: 108, ledgerIdentityRoot: plan.terminalRoot };
  return `${plan.settlement.openSql}${READ_ONLY_SQL}
${plan.settlement.lockSql}
SELECT (availability->>'ledgerExists')::boolean AS ledger_exists,
 (availability->>'initialObjectsReady')::boolean AS initial_objects,
 (availability->>'terminalObjectsReady')::boolean AS terminal_objects
FROM (${subquery(plan.availabilityQuery)}) AS available
\\gset ocr108_available_
\\if :ocr108_available_ledger_exists
SELECT identity IS NOT DISTINCT FROM ${quote(JSON.stringify(initial))}::jsonb AS initial_match,
 identity IS NOT DISTINCT FROM ${quote(JSON.stringify(terminal))}::jsonb AS terminal_match,
 (identity->>'ledgerCount')::integer BETWEEN 89 AND 108 AS known_range
FROM (${subquery(plan.identityQuery)}) AS identified
\\gset ocr108_identity_
\\if :ocr108_identity_initial_match
\\if :ocr108_available_initial_objects
${stateMatchSql(plan.initialStateQuery, 'state', plan.initialExpected)}\\if :ocr108_state_matches
${emit('SETTLED_INITIAL_MATCH')}
\\else
${emit('STATE_CONFLICT')}
\\endif
\\else
${emit('IDENTITY_CONFLICT')}
\\endif
\\elif :ocr108_identity_terminal_match
\\if :ocr108_available_terminal_objects
${stateMatchSql(plan.terminalStateQuery, 'receipt_ocr_recovery108_state', plan.terminalExpected)}\\if :ocr108_state_matches
${emit('SETTLED_TERMINAL_MATCH')}
\\else
${emit('STATE_CONFLICT')}
\\endif
\\else
${emit('IDENTITY_CONFLICT')}
\\endif
\\elif :ocr108_identity_known_range
${emit('IDENTITY_CONFLICT')}
\\else
${emit('IDENTITY_UNAVAILABLE')}
\\endif
\\else
${emit('LEDGER_UNAVAILABLE')}
\\endif
${plan.settlement.closeSql}`;
}

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
  const readOnlyScript = buildReadOnlyScript(plan);
  const readbackCompilerSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
  return Object.freeze({
    sourceRoot: prepared.sourceRoot,
    readbackCompilerSha256,
    readbackSourceRoot: sha256(JSON.stringify({ chainSourceRoot: prepared.sourceRoot, readbackCompilerSha256 })),
    readOnlyScript,
    queryPlan: structuredClone(plan),
    async execute(transport) {
      // No existing query client or transaction can be supplied to this API.
      if (!transport || typeof transport !== 'object'
        || typeof transport.runReadOnlyScript !== 'function'
        || typeof transport.query === 'function') return outcome('unknown', 'TRANSPORT_INVALID');
      try {
        const raw = await transport.runReadOnlyScript(readOnlyScript);
        return parseOutcome(raw) ?? outcome('unknown', 'READBACK_INVALID');
      } catch {
        // A partial stdout match is discarded when psql, ROLLBACK, or exit fails.
        return outcome('unknown', 'READBACK_UNAVAILABLE');
      }
    },
  });
}

export function createRecovery108PsqlReadbackExecutor({
  environment = process.env,
  psql = environment.TZUDONG_SUCCESSOR_PSQL || 'psql',
  spawnImpl = spawnSync,
} = {}) {
  let databaseUrl;
  try {
    ({ databaseUrl } = selectDirectDatabaseTransport(environment));
    assertSuccessorDatabaseTarget(databaseUrl, loadRecovery108ChainSource().recovery.manifest);
    if (!new URL(databaseUrl).password) fail('RECEIPT_OCR_CHAIN_READBACK_TARGET_INVALID');
  } catch { fail('RECEIPT_OCR_CHAIN_READBACK_TARGET_INVALID'); }
  const run = createSuccessorPsqlRunner(databaseUrl, {
    environment, psql,
    spawnImpl: (binary, args, options) => spawnImpl(binary, [...args, '--no-password'], {
      ...options,
      maxBuffer: MAX_READBACK_BYTES,
      env: { ...options.env, PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c default_transaction_read_only=on' },
    }),
  });
  return async compilationInput => {
    const prepared = prepareRecovery108ChainReadback(compilationInput);
    return prepared.execute({
      runReadOnlyScript(sql) { return run(databaseUrl, sql, false, { timeoutMs: READBACK_TIMEOUT_MS }); },
    });
  };
}
