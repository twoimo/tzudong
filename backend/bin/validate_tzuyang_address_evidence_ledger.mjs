#!/usr/bin/env node
/** Validate Tzuyang address evidence ledger schema and strict predicate output. */
import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_FIELDS = [
  'schema_version', 'generated_at', 'id', 'scope_status', 'scope_reason',
  'exclusion_reason', 'db_snapshot', 'video_id', 'youtube_link', 'evidence',
  'evidence_families', 'evidence_classes', 'candidate_places', 'search_queries',
  'cross_checks', 'risk_flags', 'strict_predicate_result', 'decision',
  'decision_reason_ko', 'source_artifacts',
];
const VIDEO_FAMILIES = new Set(['transcript_region', 'multimodal_region', 'visual_signage', 'visual_phone', 'neighbor_street']);
const EXTERNAL_FAMILIES = new Set(['map_provider', 'web_blog']);
const BLOCKING_FLAGS = new Set([
  'conflicting_high_precedence_evidence', 'insufficient_video_evidence',
  'insufficient_external_evidence', 'insufficient_family_count', 'stale_db_row',
  'same_youtube_duplicate', 'deleted_or_admin_touched', 'missing_or_not_selected',
  'stage0_not_applyable', 'provider_blocked', 'rate_limited',
  'ambiguous_candidates', 'no_precise_address', 'missing_all_evidence_inputs',
  'candidate_place_not_precise', 'candidate_place_not_evidence_derived',
]);

function parseArgs(argv) {
  const args = { ledgerDir: '', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ledger-dir') args.ledgerDir = argv[++i] || '';
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bin/validate_tzuyang_address_evidence_ledger.mjs --ledger-dir DIR [--json]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.ledgerDir) throw new Error('--ledger-dir is required');
  return args;
}

async function readJsonl(file) {
  const text = await fs.readFile(file, 'utf8');
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

function distinct(items) { return [...new Set(items)]; }
function arr(value) { return Array.isArray(value) ? value : []; }

function isPresent(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }
function candidateHasPrecisePlace(candidate) { return (isPresent(candidate.road_address) || isPresent(candidate.jibun_address)) && isPresent(candidate.lat) && isPresent(candidate.lng); }


function expectedPredicate(row) {
  const families = distinct(arr(row.evidence).map((item) => item.family).filter(Boolean));
  const hasVideo = families.some((family) => VIDEO_FAMILIES.has(family));
  const hasExternal = families.some((family) => EXTERNAL_FAMILIES.has(family));
  const blocking = arr(row.risk_flags).filter((flag) => BLOCKING_FLAGS.has(flag));
  const pass = families.length >= 3 && hasVideo && hasExternal && blocking.length === 0 && row.scope_status === 'target';
  return { families, hasVideo, hasExternal, blocking, pass };
}

function validateRow(row, index) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in row)) errors.push(`row ${index}: missing required field ${field}`);
  }
  if (row.schema_version !== 1) errors.push(`row ${index}: schema_version must be 1`);
  if (!['target', 'excluded'].includes(row.scope_status)) errors.push(`row ${index}: invalid scope_status ${row.scope_status}`);
  if (!['apply_candidate', 'manual_review', 'excluded'].includes(row.decision)) errors.push(`row ${index}: invalid decision ${row.decision}`);
  if (!Array.isArray(row.evidence)) errors.push(`row ${index}: evidence must be array`);
  if (!Array.isArray(row.evidence_families)) errors.push(`row ${index}: evidence_families must be array`);
  if (!Array.isArray(row.candidate_places) || row.candidate_places.length < 1) errors.push(`row ${index}: candidate_places must be non-empty array`);
  for (const item of arr(row.evidence)) {
    if (!item.family || !item.source || !item.summary) errors.push(`row ${index}: evidence items require family/source/summary`);
  }
  const predicate = expectedPredicate(row);
  const actual = row.strict_predicate_result || {};
  if (actual.pass !== predicate.pass) errors.push(`row ${index}: strict pass mismatch expected=${predicate.pass} actual=${actual.pass}`);
  if (row.decision === 'apply_candidate' && !predicate.pass) errors.push(`row ${index}: apply_candidate without strict predicate pass`);
  const candidate = arr(row.candidate_places)[0] || {};
  if (row.decision === 'apply_candidate' && !candidateHasPrecisePlace(candidate)) errors.push(`row ${index}: apply_candidate requires precise candidate place`);
  if (row.decision === 'apply_candidate' && candidate.derived_from_current_evidence !== true) errors.push(`row ${index}: apply_candidate requires current evidence-derived candidate place`);
  if (row.decision === 'excluded' && row.scope_status !== 'excluded') errors.push(`row ${index}: excluded decision requires excluded scope`);
  if (row.scope_status === 'excluded' && row.decision !== 'excluded') errors.push(`row ${index}: excluded scope requires excluded decision`);
  if (row.evidence_classes?.video_derived !== predicate.hasVideo) errors.push(`row ${index}: video evidence class mismatch`);
  if (row.evidence_classes?.external_provider !== predicate.hasExternal) errors.push(`row ${index}: external evidence class mismatch`);
  return errors;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ledgerPath = path.join(args.ledgerDir, 'ledger.jsonl');
  const rows = await readJsonl(ledgerPath);
  const errors = rows.flatMap((row, index) => validateRow(row, index + 1));
  const summary = {
    generated_at: new Date().toISOString(),
    mode: 'read_only_ledger_validation',
    db_write_performed: false,
    ledger_path: ledgerPath,
    row_count: rows.length,
    ok: errors.length === 0,
    error_count: errors.length,
    errors: errors.slice(0, 100),
    decision_counts: rows.reduce((acc, row) => { acc[row.decision] = (acc[row.decision] || 0) + 1; return acc; }, {}),
  };
  await fs.writeFile(path.join(args.ledgerDir, 'ledger-validation.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(args.json ? summary : { ...summary, errors: undefined }, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
