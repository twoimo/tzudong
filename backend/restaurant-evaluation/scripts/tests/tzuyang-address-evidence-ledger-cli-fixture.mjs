#!/usr/bin/env node
/** CI-only local Postgres fixture for the full Tzuyang ledger CLI chain. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const repoRoot = process.cwd();
const host = process.env.SUPABASE_DB_HOST || '';
if (process.env.TZUYANG_LEDGER_CI_FIXTURE !== '1') {
  throw new Error('Refusing to run fixture without TZUYANG_LEDGER_CI_FIXTURE=1');
}
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`Refusing to run fixture against non-local database host: ${host}`);
}

function run(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, SUPABASE_DB_SSL: 'disable', ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: node ${args.join(' ')}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function line(value) { return `${JSON.stringify(value)}\n`; }

async function writeArtifacts(root) {
  const evaluationRoot = path.join(root, 'evaluation');
  const crawlingRoot = path.join(root, 'crawling');
  await fs.mkdir(evaluationRoot, { recursive: true });
  await fs.mkdir(path.join(crawlingRoot, 'transcript'), { recursive: true });
  await fs.mkdir(path.join(crawlingRoot, 'frame-caption'), { recursive: true });
  await fs.mkdir(path.join(crawlingRoot, 'meta'), { recursive: true });
  const transform = {
    youtube_link: 'https://www.youtube.com/watch?v=abc12345',
    origin_name: '테스트식당',
    reasoning_basis: '영상 초반 서울 마포구 망원동 테스트식당 간판, 망원역 근처 골목, 블로그 리뷰와 지도 후보를 교차 확인했습니다.',
    roadAddress: '서울 마포구 망원로 1',
    jibunAddress: '서울 마포구 망원동 1-1',
    lat: 37.1,
    lng: 126.9,
    description_map_url: 'https://map.example.test/place/fixture',
    youtube_meta: { title: '망원동 테스트식당 먹방' },
    evaluation_results: {
      rb_grounding_TF: { eval_basis: '서울 마포구 망원동 지역과 테스트식당 상호가 확인됨' },
      rb_inference_score: { eval_basis: '지도 후보와 블로그 리뷰가 망원동 테스트식당 주소를 지지함' },
      location_match_TF: { eval_value: false, falseMessage: '2단계 실패' },
    },
  };
  await fs.writeFile(path.join(evaluationRoot, 'transforms.jsonl'), line(transform), 'utf8');
  await fs.writeFile(path.join(crawlingRoot, 'transcript', 'abc12345.jsonl'), line({ transcript: [{ start: 8, duration: 5, text: '오늘은 서울 마포구 망원동 테스트식당에 왔습니다.' }] }), 'utf8');
  await fs.writeFile(path.join(crawlingRoot, 'frame-caption', 'abc12345.jsonl'), line({ start_sec: 9, end_sec: 12, file_names: ['9.jpg'], raw_caption: 'The storefront sign says 테스트식당 near 망원역.' }), 'utf8');
  await fs.writeFile(path.join(crawlingRoot, 'meta', 'abc12345.jsonl'), line({ title: '망원동 테스트식당 먹방', published_at: '2024-01-01T00:00:00Z' }), 'utf8');
  return { evaluationRoot, crawlingRoot };
}

async function resetLocalDatabase() {
  const client = new pg.Client({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT),
    database: process.env.SUPABASE_DB_NAME,
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: false,
  });
  await client.connect();
  try {
    await client.query('drop table if exists public.restaurants');
    await client.query(`
      create table public.restaurants (
        id text primary key,
        status text,
        approved_name text,
        origin_name text,
        naver_name text,
        google_name text,
        youtube_link text,
        geocoding_success boolean,
        geocoding_false_stage integer,
        updated_by_admin_id text,
        is_missing boolean,
        is_not_selected boolean,
        origin_address jsonb,
        road_address text,
        jibun_address text,
        english_address text,
        lat double precision,
        lng double precision,
        evaluation_results jsonb,
        db_error_message text,
        db_error_details jsonb,
        updated_at timestamptz,
        created_at timestamptz,
        channel_name text,
        phone text,
        reasoning_basis text,
        youtube_meta jsonb,
        description_map_url text,
        trace_id_name_source text
      )
    `);
    await client.query(`
      insert into public.restaurants (
        id,status,origin_name,youtube_link,geocoding_success,geocoding_false_stage,
        updated_by_admin_id,is_missing,is_not_selected,origin_address,evaluation_results,
        updated_at,created_at,channel_name
      ) values (
        'fixture-1','pending','테스트식당','https://www.youtube.com/watch?v=abc12345',false,2,
        null,false,false,$1,$2,'2026-05-31T00:00:00Z','2026-05-30T00:00:00Z','tzuyang'
      )
    `, [
      { address: '서울 마포구 망원동 1-1' },
      { location_match_TF: { eval_value: false, falseMessage: '2단계 실패' } },
    ]);
  } finally {
    await client.end();
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function main() {
  await resetLocalDatabase();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tzuyang-ledger-cli-'));
  const { evaluationRoot, crawlingRoot } = await writeArtifacts(tmp);
  const out = path.join(tmp, 'out');

  run(['backend/bin/build_tzuyang_address_evidence_ledger.mjs', '--out', out, '--evaluation-root', evaluationRoot, '--crawling-root', crawlingRoot, '--json']);
  run(['backend/bin/validate_tzuyang_address_evidence_ledger.mjs', '--ledger-dir', out, '--json']);
  run(['backend/bin/apply_tzuyang_address_evidence_ledger.mjs', '--ledger-dir', out]);
  run(['backend/bin/apply_tzuyang_address_evidence_ledger.mjs', '--ledger-dir', out, '--apply', '--allow-db-write', '--admin-user-id', 'ci-fixture']);

  const buildSummary = await readJson(path.join(out, 'summary.json'));
  const validationSummary = await readJson(path.join(out, 'ledger-validation.json'));
  const dryRunSummary = await readJson(path.join(out, 'ledger-apply-dry-run', 'summary.json'));
  const applySummary = await readJson(path.join(out, 'ledger-apply-results', 'summary.json'));

  assert.equal(buildSummary.strict_apply_candidates, 1);
  assert.equal(validationSummary.ok, true);
  assert.equal(dryRunSummary.db_write_performed, false);
  assert.equal(dryRunSummary.applied.length, 1);
  assert.equal(applySummary.db_write_performed, true);
  assert.equal(applySummary.applied.length, 1);
  assert.equal(applySummary.applied[0].readback.geocoding_success, true);
  assert.equal(applySummary.applied[0].readback.updated_by_admin_id, 'ci-fixture');

  console.log(JSON.stringify({
    ok: true,
    output_dir: out,
    build: { total: buildSummary.total_ledger_rows, applyCandidates: buildSummary.strict_apply_candidates },
    validation: { ok: validationSummary.ok, errors: validationSummary.error_count },
    dryRun: { target: dryRunSummary.target_count, writes: dryRunSummary.db_write_performed },
    apply: { target: applySummary.target_count, writes: applySummary.db_write_performed, applied: applySummary.applied.length },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
