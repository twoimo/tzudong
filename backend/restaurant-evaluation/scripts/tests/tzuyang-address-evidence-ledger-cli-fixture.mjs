#!/usr/bin/env node
/** CI-only local Postgres fixture for the full Tzuyang ledger CLI chain. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { canonicalEnvelopeBytes, canonicalizeIJson } from '../../../bin/address_evidence_trust.mjs';
import { logSafeError } from '../../../utils/privacy-log.mjs';

const repoRoot = process.cwd();

function fixtureDatabaseUrl() {
  const host = process.env.SUPABASE_DB_HOST || '';
  const port = process.env.SUPABASE_DB_PORT || '';
  const database = process.env.SUPABASE_DB_NAME || '';
  const user = process.env.SUPABASE_DB_USER || '';
  const password = process.env.SUPABASE_DB_PASSWORD || '';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

function run(step, args, env = {}) {
  const { SUPABASE_DB_SSL, ...parentEnv } = process.env;
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...parentEnv,
      NODE_ENV: 'test',
      SUPABASE_DB_URL: fixtureDatabaseUrl(),
      SUPABASE_PG_ALLOW_PLAINTEXT_LOCAL: '1',
      ...env,
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const error = new Error('tzuyang_ledger_fixture_command_failed');
    const childCode = /(?:^|\s)code=((?:[A-Z][A-Z0-9_]{1,79}|[a-z][a-z0-9_]{2,79}))(?:\s|$)/m.exec(result.stderr)?.[1];
    const diagnosticHash = createHash('sha256')
      .update(`${result.error?.code ?? ''}\n${result.signal ?? ''}\n${result.stderr ?? ''}`)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();
    error.code = childCode ?? `TZUYANG_CHILD_${diagnosticHash}`;
    throw error;
  }
  return result.stdout.trim();
}

function line(value) { return `${JSON.stringify(value)}\n`; }
function canonicalLine(value) { return `${canonicalizeIJson(value)}\n`; }
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function signedArtifact(domain, envelope, signerId, pair) {
  const envelopeBytes = canonicalEnvelopeBytes(domain, envelope);
  return Buffer.from(canonicalizeIJson({
    envelope,
    envelope_sha256: digest(envelopeBytes),
    signer_id: signerId,
    signature_algorithm: 'ed25519',
    signature: sign(null, envelopeBytes, pair.privateKey).toString('base64'),
  }), 'utf8');
}

function publicAnchor(pair) {
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  return {
    algorithm: 'ed25519',
    public_key_spki_sha256: digest(der),
    public_key_spki_der_base64: der.toString('base64'),
  };
}

export async function writeEvidenceBundle(root) {
  const roots = {
    crawl: path.join(root, 'evidence-crawl'),
    providerA: path.join(root, 'evidence-provider-a'),
    providerB: path.join(root, 'evidence-provider-b'),
  };
  await Promise.all(Object.values(roots).map((entry) => fs.mkdir(entry, { recursive: true })));

  const generatedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const candidatePlace = {
    name: '테스트식당',
    road_address: '서울 마포구 망원로 1',
    jibun_address: '서울 마포구 망원동 1-1',
    lat: 37.1,
    lng: 126.9,
  };
  const querySha256 = 'a'.repeat(64);
  const recordSelectorSha256 = 'b'.repeat(64);
  const videoSigner = generateKeyPairSync('ed25519');
  const providerASigner = generateKeyPairSync('ed25519');
  const providerBSigner = generateKeyPairSync('ed25519');

  const videoBytes = Buffer.from(canonicalizeIJson({ transcript: '서울 마포구 망원동 테스트식당' }), 'utf8');
  await fs.writeFile(path.join(roots.crawl, 'transcript.json'), videoBytes);
  const manifestBytes = signedArtifact('tzudong.address.video-manifest.v2', {
    schema_version: 2,
    manifest_id: 'manifest-1',
    source_root_id: 'crawl',
    generated_at: generatedAt,
    expires_at: expiresAt,
    entries: [{
      artifact_id: 'video-artifact-1',
      kind: 'transcript',
      relative_path: 'transcript.json',
      byte_length: videoBytes.length,
      sha256: digest(videoBytes),
      source_identity: { video_id: 'dQw4w9WgXcQ', record_selector_sha256: recordSelectorSha256 },
    }],
  }, 'video-signer-1', videoSigner);
  await fs.writeFile(path.join(roots.crawl, 'manifest.json'), manifestBytes);

  const providers = [];
  for (const [suffix, providerId, producerId, sourceId, rootId, signer, providerRoot] of [
    ['a', 'provider-a', 'producer-a', 'source-a', 'provider-a-root', providerASigner, roots.providerA],
    ['b', 'provider-b', 'producer-b', 'source-b', 'provider-b-root', providerBSigner, roots.providerB],
  ]) {
    const selected = { place: candidatePlace, response_id: suffix };
    const rawBytes = Buffer.from(canonicalizeIJson(selected), 'utf8');
    const rawPath = `response-${suffix}.json`;
    await fs.writeFile(path.join(providerRoot, rawPath), rawBytes);
    const receiptBytes = signedArtifact('tzudong.address.provider-receipt.v2', {
      schema_version: 2,
      receipt_id: `receipt-${suffix}`,
      provider_id: providerId,
      producer_id: producerId,
      source_id: sourceId,
      source_root_id: rootId,
      artifact: { artifact_id: `provider-artifact-${suffix}`, relative_path: rawPath, byte_length: rawBytes.length, sha256: digest(rawBytes) },
      subject: { restaurant_id: 'fixture-1', video_id: 'dQw4w9WgXcQ', query_sha256: querySha256 },
      fetched_at: generatedAt,
      expires_at: expiresAt,
      content: { media_type: 'application/json', canonical_sha256: digest(rawBytes), place: candidatePlace },
      nonce: Buffer.from(`fixture-nonce-${suffix}`).toString('base64'),
    }, `provider-signer-${suffix}`, signer);
    const receiptPath = `receipt-${suffix}.json`;
    await fs.writeFile(path.join(providerRoot, receiptPath), receiptBytes);
    providers.push({
      trusted: {
        receipt_relative_path: receiptPath,
        receipt_byte_length: receiptBytes.length,
        receipt_sha256: digest(receiptBytes),
        receipt_signer_id: `provider-signer-${suffix}`,
        receipt_id: `receipt-${suffix}`,
        artifact_id: `provider-artifact-${suffix}`,
      },
      source: {
        root_id: rootId,
        artifact_id: `provider-artifact-${suffix}`,
        kind: 'provider_response',
        relative_path: rawPath,
        byte_length: rawBytes.length,
        sha256: digest(rawBytes),
      },
    });
  }

  const bundle = {
    restaurant_id: 'fixture-1',
    address_evidence: {
      schema_version: 2,
      query_sha256: querySha256,
      record_selector_sha256: recordSelectorSha256,
      candidate_place: candidatePlace,
      trusted_evidence: {
        video: {
          manifest_relative_path: 'manifest.json',
          manifest_byte_length: manifestBytes.length,
          manifest_sha256: digest(manifestBytes),
          manifest_signer_id: 'video-signer-1',
          entry_artifact_id: 'video-artifact-1',
        },
        providers: providers.map((provider) => provider.trusted),
      },
      source_artifacts: [{
        root_id: 'crawl',
        artifact_id: 'video-artifact-1',
        kind: 'transcript',
        relative_path: 'transcript.json',
        byte_length: videoBytes.length,
        sha256: digest(videoBytes),
      }, ...providers.map((provider) => provider.source)],
    },
  };
  const bundlePath = path.join(root, 'address-evidence-bundles.jsonl');
  await fs.writeFile(bundlePath, line(bundle), 'utf8');
  return {
    bundlePath,
    sourceRoots: [
      `crawl=${roots.crawl}`,
      `provider-a-root=${roots.providerA}`,
      `provider-b-root=${roots.providerB}`,
    ],
    environment: {
      TZUYANG_ADDRESS_SOURCE_ROOTS_JSON: JSON.stringify({
        crawl: { kind: 'crawling', path: roots.crawl },
        'provider-a-root': { kind: 'provider', path: roots.providerA },
        'provider-b-root': { kind: 'provider', path: roots.providerB },
      }),
      TZUYANG_ADDRESS_VIDEO_SIGNERS_JSON: JSON.stringify({ 'video-signer-1': publicAnchor(videoSigner) }),
      TZUYANG_ADDRESS_PROVIDER_SIGNERS_JSON: JSON.stringify({
        'provider-signer-a': { ...publicAnchor(providerASigner), provider_id: 'provider-a', producer_id: 'producer-a' },
        'provider-signer-b': { ...publicAnchor(providerBSigner), provider_id: 'provider-b', producer_id: 'producer-b' },
      }),
    },
  };
}

async function prepareReviewedArtifacts(out) {
  const privateDir = path.join(out, 'operator-private');
  const privatePath = path.join(privateDir, 'operator-ledger-private.jsonl');
  const reviewedPath = path.join(out, 'operator-ledger-private.jsonl');
  const candidatePath = path.join(out, 'apply-candidates.jsonl');
  const reviewed = JSON.parse(await fs.readFile(privatePath, 'utf8'));
  assert.equal(reviewed.decision, 'apply_candidate');
  reviewed.operator_decision = 'apply';
  const reviewedBytes = Buffer.from(canonicalLine(reviewed), 'utf8');
  await fs.writeFile(privatePath, reviewedBytes);
  await fs.writeFile(reviewedPath, reviewedBytes);
  await fs.writeFile(candidatePath, reviewedBytes);

  const manifest = {
    schema_version: 1,
    artifacts: [
      { name: 'apply-candidates.jsonl', byte_length: reviewedBytes.length, sha256: digest(reviewedBytes), identity: 'regular_file' },
      { name: 'operator-ledger-private.jsonl', byte_length: reviewedBytes.length, sha256: digest(reviewedBytes), identity: 'regular_file' },
    ],
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
  const manifestName = 'review-manifest.json';
  await fs.writeFile(path.join(out, manifestName), manifestBytes);
  return { manifestName, manifestSha256: digest(manifestBytes) };
}

export async function writeArtifacts(root) {
  const evaluationRoot = path.join(root, 'evaluation');
  const crawlingRoot = path.join(root, 'crawling');
  await fs.mkdir(evaluationRoot, { recursive: true });
  await fs.mkdir(path.join(crawlingRoot, 'transcript'), { recursive: true });
  await fs.mkdir(path.join(crawlingRoot, 'frame-caption'), { recursive: true });
  await fs.mkdir(path.join(crawlingRoot, 'meta'), { recursive: true });
  const transform = {
    youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    origin_name: '테스트식당',
    reasoning_basis: '영상 초반 서울 마포구 망원동 테스트식당 간판, 망원역 근처 골목, 블로그 리뷰와 지도 후보를 교차 확인했습니다.',
    roadAddress: '서울 마포구 망원로 1',
    jibunAddress: '서울 마포구 망원동 1-1',
    lat: 37.1,
    lng: 126.9,
    description_map_url: 'https://map.naver.com/p/entry/place/1003598680?lng=126.9&lat=37.1',
    youtube_meta: { title: '망원동 테스트식당 먹방' },
    evaluation_results: {
      rb_grounding_TF: { eval_basis: '서울 마포구 망원동 지역과 테스트식당 상호가 확인됨' },
      rb_inference_score: { eval_basis: '지도 후보와 블로그 리뷰가 망원동 테스트식당 주소를 지지함' },
      location_match_TF: { eval_value: false, falseMessage: '2단계 실패' },
    },
  };
  await fs.writeFile(path.join(evaluationRoot, 'transforms.jsonl'), line(transform), 'utf8');
  await fs.writeFile(path.join(crawlingRoot, 'transcript', 'dQw4w9WgXcQ.jsonl'), line({ transcript: [{ start: 8, duration: 5, text: '오늘은 서울 마포구 망원동 테스트식당에 왔습니다.' }] }), 'utf8');
  await fs.writeFile(path.join(crawlingRoot, 'frame-caption', 'dQw4w9WgXcQ.jsonl'), line({ start_sec: 9, end_sec: 12, file_names: ['9.jpg'], raw_caption: 'The storefront sign says 테스트식당 near 망원역.' }), 'utf8');
  await fs.writeFile(path.join(crawlingRoot, 'meta', 'dQw4w9WgXcQ.jsonl'), line({ title: '망원동 테스트식당 먹방', published_at: '2024-01-01T00:00:00Z' }), 'utf8');
  return { evaluationRoot, crawlingRoot };
}

async function resetLocalDatabase() {
  const { default: pg } = await import('pg');
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
        'fixture-1','pending','테스트식당','https://www.youtube.com/watch?v=dQw4w9WgXcQ',false,2,
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
  const host = process.env.SUPABASE_DB_HOST || '';
  if (process.env.TZUYANG_LEDGER_CI_FIXTURE !== '1') {
    throw new Error('Refusing to run fixture without TZUYANG_LEDGER_CI_FIXTURE=1');
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run fixture against non-local database host: ${host}`);
  }
  await resetLocalDatabase();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tzuyang-ledger-cli-'));
  const { evaluationRoot, crawlingRoot } = await writeArtifacts(tmp);
  const evidence = await writeEvidenceBundle(tmp);
  const out = path.join(tmp, 'out');

  run('BUILD', [
    'backend/bin/build_tzuyang_address_evidence_ledger.mjs',
    '--out', out,
    '--evaluation-root', evaluationRoot,
    '--crawling-root', crawlingRoot,
    '--evidence-bundles', evidence.bundlePath,
    ...evidence.sourceRoots.flatMap((sourceRoot) => ['--source-root', sourceRoot]),
    '--json',
  ], evidence.environment);
  run('VALIDATE', ['backend/bin/validate_tzuyang_address_evidence_ledger.mjs', '--ledger-dir', out, '--json'], evidence.environment);
  const reviewArtifacts = await prepareReviewedArtifacts(out);
  run('DRY_RUN', [
    'backend/bin/apply_tzuyang_address_evidence_ledger.mjs',
    '--ledger-dir', out,
    '--review-manifest', reviewArtifacts.manifestName,
    '--confirm-manifest-sha256', reviewArtifacts.manifestSha256,
    '--fixture-dry-run',
  ], evidence.environment);

  const buildSummary = await readJson(path.join(out, 'summary.json'));
  const validationSummary = await readJson(path.join(out, 'ledger-validation.json'));
  const dryRunSummary = await readJson(path.join(out, 'ledger-apply-dry-run', 'summary.json'));

  assert.equal(buildSummary.strict_apply_candidates, 1);
  assert.equal(validationSummary.ok, true);
  assert.equal(dryRunSummary.db_write_performed, false);
  assert.equal(dryRunSummary.fixture_dry_run, true);
  assert.equal(dryRunSummary.applied.length, 1);

  console.log(JSON.stringify({
    ok: true,
    output_dir: out,
    build: { total: buildSummary.total_ledger_rows, applyCandidates: buildSummary.strict_apply_candidates },
    validation: { ok: validationSummary.ok, errors: validationSummary.error_count },
    dryRun: { target: dryRunSummary.target_count, writes: dryRunSummary.db_write_performed, applied: dryRunSummary.applied.length },
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    logSafeError(error, (line) => process.stderr.write(`tzuyang_address_evidence_ledger_fixture_failed ${line}`));
    process.exitCode = 1;
  });
}
