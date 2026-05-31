#!/usr/bin/env node
/** Guarded dry-run/apply boundary for Tzuyang address evidence ledger. */
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(__filename), '..');
dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), override: false });

const BLOCKING_FLAGS = new Set([
  'conflicting_high_precedence_evidence', 'insufficient_video_evidence', 'insufficient_external_evidence',
  'insufficient_family_count', 'stale_db_row', 'same_youtube_duplicate', 'deleted_or_admin_touched',
  'missing_or_not_selected', 'stage0_not_applyable', 'provider_blocked', 'rate_limited',
  'ambiguous_candidates', 'no_precise_address', 'missing_all_evidence_inputs',
  'candidate_place_not_precise', 'candidate_place_not_evidence_derived',
]);

function parseArgs(argv) {
  const args = { ledgerDir: '', apply: false, allowDbWrite: false, adminUserId: '', ids: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ledger-dir') args.ledgerDir = argv[++i] || '';
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--allow-db-write') args.allowDbWrite = true;
    else if (arg === '--admin-user-id') args.adminUserId = argv[++i] || '';
    else if (arg === '--ids') args.ids = (argv[++i] || '').split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bin/apply_tzuyang_address_evidence_ledger.mjs --ledger-dir DIR [--apply --allow-db-write --admin-user-id UUID] [--ids id1,id2]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.ledgerDir) throw new Error('--ledger-dir is required');
  if (args.apply && !args.allowDbWrite) throw new Error('--apply requires explicit --allow-db-write');
  if (args.apply && !args.adminUserId) throw new Error('--apply requires --admin-user-id');
  return args;
}
function requireEnv(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function pgSslConfig() { return /^(0|false|disable)$/i.test(process.env.SUPABASE_DB_SSL || '') ? false : { rejectUnauthorized: false }; }
function getPgClient() { return new pg.Client({ host: requireEnv('SUPABASE_DB_HOST'), port: Number(requireEnv('SUPABASE_DB_PORT')), database: requireEnv('SUPABASE_DB_NAME'), user: requireEnv('SUPABASE_DB_USER'), password: requireEnv('SUPABASE_DB_PASSWORD'), ssl: pgSslConfig() }); }
async function readJsonl(file) { const text = await fs.readFile(file, 'utf8'); return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line)); }
function line(row) { return `${JSON.stringify(row)}\n`; }
function isPresent(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }
function sameInstant(a, b) { if (!a || !b) return false; return new Date(a).toISOString() === new Date(b).toISOString(); }
function hasBlockingRisk(row) { return (row.risk_flags || []).some((flag) => BLOCKING_FLAGS.has(flag)); }
function firstCandidate(row) { return Array.isArray(row.candidate_places) ? row.candidate_places[0] || {} : {}; }
function candidateHasPrecisePlace(candidate) { return (isPresent(candidate.road_address) || isPresent(candidate.jibun_address)) && isPresent(candidate.lat) && isPresent(candidate.lng); }
function candidateIsEvidenceDerived(candidate) { return candidate.derived_from_current_evidence === true; }
function buildPayload(row, nowIso, adminUserId) {
  const candidate = firstCandidate(row);
  return {
    road_address: candidate.road_address || null,
    jibun_address: candidate.jibun_address || null,
    lat: Number(candidate.lat),
    lng: Number(candidate.lng),
    geocoding_success: true,
    geocoding_false_stage: null,
    db_error_message: null,
    db_error_details: {
      address_evidence_ledger: {
        schema_version: row.schema_version,
        generated_at: row.generated_at,
        decision: row.decision,
        evidence_families: row.evidence_families,
        source_artifacts: row.source_artifacts,
        applied_by_script: 'apply_tzuyang_address_evidence_ledger.mjs',
        applied_at: nowIso,
      },
    },
    updated_by_admin_id: adminUserId,
    updated_at: nowIso,
  };
}
function localGuardFailures(ledgerRow) {
  const failures = [];
  if (ledgerRow.decision !== 'apply_candidate') failures.push('ledger_decision_not_apply_candidate');
  if (ledgerRow.scope_status !== 'target') failures.push('ledger_scope_not_target');
  if (!ledgerRow.strict_predicate_result?.pass) failures.push('strict_predicate_not_passed');
  if (hasBlockingRisk(ledgerRow)) failures.push('blocking_risk_flags_present');
  const candidate = firstCandidate(ledgerRow);
  if (!candidateHasPrecisePlace(candidate)) failures.push('candidate_place_not_precise');
  if (!candidateIsEvidenceDerived(candidate)) failures.push('candidate_place_not_evidence_derived');
  return failures;
}
function dbGuardFailures(dbRow, ledgerRow) {
  const failures = [];
  const snap = ledgerRow.db_snapshot || {};
  if (!dbRow) return ['row_not_found'];
  if (dbRow.status === 'deleted') failures.push('deleted_status');
  if (dbRow.updated_by_admin_id) failures.push('admin_touched');
  if (dbRow.geocoding_success !== false) failures.push('not_currently_geocoding_false');
  if (dbRow.is_missing || dbRow.is_not_selected || dbRow.status === 'missing' || dbRow.status === 'not_selected') failures.push('missing_or_not_selected');
  if (dbRow.geocoding_false_stage === 0) failures.push('stage0_not_applyable');
  if (!sameInstant(dbRow.updated_at, snap.updated_at)) failures.push('stale_updated_at');
  return failures;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.join(args.ledgerDir, args.apply ? 'ledger-apply-results' : 'ledger-apply-dry-run');
  await fs.mkdir(outputDir, { recursive: true });
  let ledgerRows = await readJsonl(path.join(args.ledgerDir, 'apply-candidates.jsonl'));
  if (args.ids.length) ledgerRows = ledgerRows.filter((row) => args.ids.includes(row.id));
  const client = getPgClient();
  await client.connect();
  const result = { generated_at: new Date().toISOString(), mode: args.apply ? 'apply' : 'dry_run', db_write_performed: false, output_dir: outputDir, target_count: ledgerRows.length, applied: [], skipped: [] };
  const backups = [];
  const readbacks = [];
  try {
    for (const ledgerRow of ledgerRows) {
      const localFailures = localGuardFailures(ledgerRow);
      await client.query('begin');
      try {
        const { rows } = await client.query('select * from restaurants where id = $1 for update', [ledgerRow.id]);
        const dbRow = rows[0] || null;
        if (dbRow) backups.push(dbRow);
        const guardFailures = [...localFailures, ...dbGuardFailures(dbRow, ledgerRow)];
        if (guardFailures.length) {
          result.skipped.push({ id: ledgerRow.id, origin_name: ledgerRow.db_snapshot?.origin_name, guardFailures });
          await client.query('rollback');
          continue;
        }
        const nowIso = new Date().toISOString();
        const payload = buildPayload(ledgerRow, nowIso, args.adminUserId || null);
        if (args.apply) {
          const assignments = Object.keys(payload).map((key, idx) => `${key} = $${idx + 2}`).join(', ');
          await client.query(`update restaurants set ${assignments} where id = $1`, [ledgerRow.id, ...Object.values(payload)]);
          const { rows: afterRows } = await client.query('select id,status,road_address,jibun_address,lat,lng,geocoding_success,geocoding_false_stage,updated_by_admin_id,updated_at,db_error_details from restaurants where id = $1', [ledgerRow.id]);
          readbacks.push(afterRows[0]);
          result.db_write_performed = true;
          result.applied.push({ id: ledgerRow.id, mode: 'apply', payload, readback: afterRows[0] });
        } else {
          result.applied.push({ id: ledgerRow.id, mode: 'dry_run', dry_run_payload: payload });
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        result.skipped.push({ id: ledgerRow.id, guardFailures: ['exception'], reason: error.message });
      }
    }
  } finally {
    await client.end();
  }
  await fs.writeFile(path.join(outputDir, 'pre-apply-backup.jsonl'), backups.map(line).join(''), 'utf8');
  await fs.writeFile(path.join(outputDir, 'readback.jsonl'), readbacks.map(line).join(''), 'utf8');
  await fs.writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
