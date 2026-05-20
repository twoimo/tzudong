#!/usr/bin/env node
/**
 * Guarded Supabase updater for address consistency candidates validated by
 * validate_supabase_same_origin_candidates.mjs.
 *
 * Defaults to dry-run. Requires --apply for writes. Approval requires --approve;
 * when --approve is used without --admin-user-id, the script proceeds only if
 * exactly one admin user exists in public.user_roles.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

function parseArgs(argv) {
  const args = { reportDir: '', apply: false, approve: false, adminUserId: '', ids: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report-dir') args.reportDir = argv[++i] || '';
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--approve') args.approve = true;
    else if (arg === '--admin-user-id') args.adminUserId = argv[++i] || '';
    else if (arg === '--ids') args.ids = (argv[++i] || '').split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bin/apply_supabase_address_consistency_candidates.mjs --report-dir DIR [--apply] [--approve] [--admin-user-id UUID] [--ids id1,id2]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.reportDir) throw new Error('--report-dir is required');
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getPgClient() {
  return new pg.Client({
    host: requireEnv('SUPABASE_DB_HOST'),
    port: Number(requireEnv('SUPABASE_DB_PORT')),
    database: requireEnv('SUPABASE_DB_NAME'),
    user: requireEnv('SUPABASE_DB_USER'),
    password: requireEnv('SUPABASE_DB_PASSWORD'),
    ssl: { rejectUnauthorized: false },
  });
}

function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function sameInstant(a, b) {
  if (!a || !b) return false;
  return new Date(a).toISOString() === new Date(b).toISOString();
}

function coreSignalsPass(evaluationResults) {
  if (!evaluationResults || typeof evaluationResults !== 'object') return false;
  const bools = [
    evaluationResults.category_validity_TF?.eval_value ?? evaluationResults.category_TF?.eval_value,
    evaluationResults.rb_grounding_TF?.eval_value,
  ];
  const nums = [
    evaluationResults.visit_authenticity?.eval_value,
    evaluationResults.review_faithfulness_score?.eval_value,
    evaluationResults.rb_inference_score?.eval_value,
  ];
  return bools.every((value) => value === true) && nums.every((value) => Number(value) >= 0.8);
}

function patchEvaluationResults(row, candidate, validation, nowIso) {
  const current = row.evaluation_results && typeof row.evaluation_results === 'object' ? row.evaluation_results : {};
  const top = validation.suggested_geocode_top || {};
  return {
    ...current,
    location_match_TF: {
      ...(current.location_match_TF && typeof current.location_match_TF === 'object' ? current.location_match_TF : {}),
      eval_value: true,
      origin_name: row.origin_name || candidate.origin_name,
      naver_name: row.naver_name || null,
      google_name: row.google_name || null,
      falseMessage: null,
      origin_address: validation.origin_address_text || candidate.origin_address_text,
      naver_address: [
        {
          x: String(candidate.suggested_lng),
          y: String(candidate.suggested_lat),
          distance: validation.source_to_suggested_distance_m ?? 0,
          roadAddress: candidate.suggested_road_address || top.roadAddress || null,
          jibunAddress: candidate.suggested_jibun_address || top.jibunAddress || null,
          englishAddress: top.englishAddress || null,
        },
      ],
      matched_address: {
        x: String(candidate.suggested_lng),
        y: String(candidate.suggested_lat),
        roadAddress: candidate.suggested_road_address || top.roadAddress || null,
        jibunAddress: candidate.suggested_jibun_address || top.jibunAddress || null,
        englishAddress: top.englishAddress || null,
      },
      match_status: 'matched',
      matched_provider: validation.naver_local_status === 'ok' ? 'naver' : 'ncp_geocode',
      matched_name: row.origin_name || candidate.origin_name,
      matched_at: nowIso,
      pending_reason: null,
      evidence_families: ['source_geo', validation.naver_local_status === 'ok' ? 'provider_candidate' : 'geocode_provider'],
      evidence_summary: [
        validation.reason_ko,
        `원본 주소: ${validation.origin_address_text || candidate.origin_address_text}`,
        `확정 주소: ${candidate.suggested_road_address || candidate.suggested_jibun_address}`,
        `검증 거리: ${validation.source_to_suggested_distance_m ?? 0}m`,
      ],
      second_pass: {
        attempted: true,
        provider: validation.naver_local_status === 'ok' ? 'naver+ncp' : 'ncp',
        timed_out: false,
        rate_limited: false,
        duration_ms: 0,
      },
    },
  };
}

async function getAdminUserId(client, requested) {
  if (requested) return requested;
  const { rows } = await client.query("select user_id from user_roles where role = 'admin' order by created_at asc");
  const unique = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  if (unique.length !== 1) throw new Error(`--approve requires --admin-user-id because admin user count is ${unique.length}`);
  return unique[0];
}

async function duplicateSummary(client, row, approvedName, jibunAddress, roadAddress) {
  const { rows } = await client.query(
    `select id,status,approved_name,road_address,jibun_address,youtube_link
     from restaurants
     where id <> $1 and status = 'approved'
       and (approved_name = $2 or origin_name = $2 or naver_name = $2)
       and (jibun_address = $3 or road_address = $4)
     order by updated_at desc nulls last`,
    [row.id, approvedName, jibunAddress, roadAddress],
  );
  const sameYoutube = rows.filter((item) => item.youtube_link && row.youtube_link && item.youtube_link === row.youtube_link);
  return { approved_duplicate_count: rows.length, same_youtube_duplicate_count: sameYoutube.length, matches: rows.slice(0, 5) };
}

function line(row) {
  return JSON.stringify(row) + '\n';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const validationPayload = JSON.parse(await fs.readFile(path.join(args.reportDir, 'same-origin-live-validation.json'), 'utf8'));
  const candidateRows = (await fs.readFile(path.join(args.reportDir, 'same-origin-known-coordinate-candidates.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map(JSON.parse);
  const byId = new Map(candidateRows.map((row) => [row.id, row]));
  let targets = validationPayload.results.filter((row) => row.verdict === 'apply_ready');
  if (args.ids.length) targets = targets.filter((row) => args.ids.includes(row.id));
  const outputDir = path.join(args.reportDir, args.apply ? 'apply-results' : 'apply-dry-run');
  await fs.mkdir(outputDir, { recursive: true });

  const client = getPgClient();
  await client.connect();
  const result = { generated_at: new Date().toISOString(), mode: args.apply ? 'apply' : 'dry_run', approve: args.approve, output_dir: outputDir, target_count: targets.length, applied: [], skipped: [], db_write_performed: false };
  const backups = [];
  const readbacks = [];
  try {
    const adminUserId = args.approve ? await getAdminUserId(client, args.adminUserId) : null;
    for (const validation of targets) {
      const candidate = byId.get(validation.id);
      if (!candidate) {
        result.skipped.push({ id: validation.id, reason: 'missing_candidate_payload' });
        continue;
      }
      await client.query('begin');
      try {
        const { rows } = await client.query('select * from restaurants where id = $1 for update', [validation.id]);
        const row = rows[0];
        if (!row) throw new Error('row_not_found');
        backups.push(row);
        const guardFailures = [];
        if (row.status === 'deleted') guardFailures.push('deleted_status');
        if (row.updated_by_admin_id) guardFailures.push('admin_touched');
        if (row.geocoding_success !== false) guardFailures.push('not_currently_geocoding_false');
        if (row.is_missing || row.is_not_selected) guardFailures.push('missing_or_not_selected');
        if (!sameInstant(row.updated_at, candidate.updated_at)) guardFailures.push('stale_updated_at');
        if (!coreSignalsPass(row.evaluation_results)) guardFailures.push('core_evaluation_signals_not_passed');
        if (!isPresent(candidate.suggested_lat) || !isPresent(candidate.suggested_lng) || !(candidate.suggested_road_address || candidate.suggested_jibun_address)) guardFailures.push('missing_suggested_geocode');
        if (validation.verdict !== 'apply_ready') guardFailures.push('validation_not_apply_ready');
        const approvedName = row.origin_name || candidate.origin_name;
        const dupes = args.approve ? await duplicateSummary(client, row, approvedName, candidate.suggested_jibun_address, candidate.suggested_road_address) : null;
        if (dupes?.same_youtube_duplicate_count) guardFailures.push('same_youtube_duplicate');

        if (guardFailures.length) {
          result.skipped.push({ id: row.id, origin_name: row.origin_name, guardFailures, duplicate_summary: dupes });
          await client.query('rollback');
          continue;
        }

        const nowIso = new Date().toISOString();
        const evaluationResults = patchEvaluationResults(row, candidate, validation, nowIso);
        const payload = {
          road_address: candidate.suggested_road_address || validation.suggested_geocode_top?.roadAddress || null,
          jibun_address: candidate.suggested_jibun_address || validation.suggested_geocode_top?.jibunAddress || null,
          english_address: validation.suggested_geocode_top?.englishAddress || row.english_address || null,
          lat: Number(candidate.suggested_lat),
          lng: Number(candidate.suggested_lng),
          geocoding_success: true,
          geocoding_false_stage: null,
          evaluation_results: evaluationResults,
          db_error_message: null,
          db_error_details: null,
          updated_at: nowIso,
        };
        if (args.approve) {
          payload.status = 'approved';
          payload.approved_name = approvedName;
          payload.updated_by_admin_id = adminUserId;
        }

        if (args.apply) {
          const assignments = Object.keys(payload).map((key, idx) => `${key} = $${idx + 2}`).join(', ');
          const values = [row.id, ...Object.values(payload)];
          await client.query(`update restaurants set ${assignments} where id = $1`, values);
          const { rows: afterRows } = await client.query('select id,status,approved_name,road_address,jibun_address,lat,lng,geocoding_success,geocoding_false_stage,updated_by_admin_id,updated_at,evaluation_results from restaurants where id = $1', [row.id]);
          readbacks.push(afterRows[0]);
          result.applied.push({ id: row.id, origin_name: row.origin_name, approved_name: payload.approved_name || null, status: payload.status || row.status, duplicate_summary: dupes, before_updated_at: row.updated_at, after_updated_at: afterRows[0]?.updated_at });
          result.db_write_performed = true;
        } else {
          result.applied.push({ id: row.id, origin_name: row.origin_name, dry_run_payload: payload, duplicate_summary: dupes });
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        result.skipped.push({ id: validation.id, reason: error.message });
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
