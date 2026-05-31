import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildLedgerRows, strictPredicate } from '../../../bin/build_tzuyang_address_evidence_ledger.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const artifacts = {
  transformsByVideo: new Map([['abc12345', [{
    youtube_link: 'https://www.youtube.com/watch?v=abc12345',
    origin_name: '테스트식당',
    reasoning_basis: '영상 00:10 서울 마포구 망원동 테스트식당 간판과 망원역 근처 골목이 보입니다.',
    roadAddress: '서울 마포구 망원로 1',
    jibunAddress: '서울 마포구 망원동 1-1',
    lat: 37.1,
    lng: 126.9,
    youtube_meta: { title: '망원동 테스트식당 먹방' },
    evaluation_results: {
      rb_grounding_TF: { eval_basis: '서울 마포구 망원동 지역과 테스트식당 상호가 확인됨' },
      rb_inference_score: { eval_basis: '망원동과 상호를 근거로 특정함' },
      location_match_TF: { eval_value: false, falseMessage: '2단계 실패' },
    },
  }]]]),
  transcriptByVideo: new Map([['abc12345', [{ transcript: [{ start: 8, duration: 5, text: '오늘은 서울 마포구 망원동 테스트식당에 왔습니다.' }] }]]]),
  frameCaptionByVideo: new Map([['abc12345', [{ start_sec: 9, end_sec: 12, file_names: ['9.jpg'], raw_caption: 'The storefront sign says 테스트식당 near 망원역.' }]]]),
  metaByVideo: new Map([['abc12345', { title: '망원동 테스트식당 먹방', published_at: '2024-01-01T00:00:00Z' }]]),
};

function row(overrides = {}) {
  return {
    id: 'r1',
    status: 'pending',
    channel_name: 'tzuyang',
    origin_name: '테스트식당',
    approved_name: null,
    naver_name: null,
    google_name: null,
    youtube_link: 'https://www.youtube.com/watch?v=abc12345',
    geocoding_success: false,
    geocoding_false_stage: 2,
    updated_by_admin_id: null,
    is_missing: false,
    is_not_selected: false,
    origin_address: { address: '서울 마포구 망원동 1-1', lat: 37.1, lng: 126.9 },
    road_address: '서울 마포구 망원로 1',
    jibun_address: '서울 마포구 망원동 1-1',
    lat: 37.1,
    lng: 126.9,
    evaluation_results: { location_match_TF: { eval_value: false, falseMessage: '2단계 실패' } },
    updated_at: '2026-05-31T00:00:00Z',
    created_at: '2026-05-30T00:00:00Z',
    ...overrides,
  };
}

test('strict predicate requires three families, video evidence, external evidence, and no blockers', () => {
  assert.equal(strictPredicate([
    { family: 'transcript_region' },
    { family: 'visual_signage' },
    { family: 'map_provider' },
  ], []).pass, true);
  assert.equal(strictPredicate([{ family: 'legacy_location_match' }, { family: 'same_origin_history' }, { family: 'map_provider' }], []).pass, false);
  assert.equal(strictPredicate([{ family: 'transcript_region' }, { family: 'visual_signage' }, { family: 'map_provider' }], ['deleted_or_admin_touched']).pass, false);
});

test('ledger records target rows with canonical schema and strict apply candidate only when safe', () => {
  const ledger = buildLedgerRows([row()], artifacts, '2026-05-31T00:00:00Z');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].schema_version, 1);
  assert.equal(ledger[0].scope_status, 'target');
  assert.equal(ledger[0].decision, 'apply_candidate');
  assert.deepEqual(new Set(ledger[0].evidence_families).has('transcript_region'), true);
  assert.equal(ledger[0].strict_predicate_result.pass, true);
  assert.equal(ledger[0].candidate_places[0].derived_from_current_evidence, true);
  assert.equal(ledger[0].candidate_places[0].evidence_source, 'transform_place');
  assert.ok(ledger[0].search_queries.some((item) => item.query.includes('테스트식당')));
});


test('row snapshot-only place data cannot become an apply candidate', () => {
  const sparseArtifacts = {
    ...artifacts,
    transformsByVideo: new Map([['abc12345', [{
      youtube_link: 'https://www.youtube.com/watch?v=abc12345',
      origin_name: '테스트식당',
      reasoning_basis: '영상 00:10 서울 마포구 망원동 테스트식당 간판과 망원역 근처 골목이 보입니다.',
      youtube_meta: { title: '망원동 테스트식당 먹방' },
      evaluation_results: artifacts.transformsByVideo.get('abc12345')[0].evaluation_results,
    }]]]),
  };
  const ledger = buildLedgerRows([row()], sparseArtifacts, '2026-05-31T00:00:00Z');
  assert.equal(ledger[0].decision, 'manual_review');
  assert.equal(ledger[0].candidate_places[0].derived_from_current_evidence, false);
  assert.ok(ledger[0].risk_flags.includes('candidate_place_not_evidence_derived'));
});

test('ledger excludes deleted/admin touched rows even when evidence is strong', () => {
  const ledger = buildLedgerRows([row({ updated_by_admin_id: 'admin-1' })], artifacts, '2026-05-31T00:00:00Z');
  assert.equal(ledger[0].scope_status, 'excluded');
  assert.equal(ledger[0].decision, 'excluded');
  assert.ok(ledger[0].risk_flags.includes('deleted_or_admin_touched'));
  assert.equal(ledger[0].strict_predicate_result.pass, false);
});

test('ledger apply script is fail-closed for real writes without explicit write flag', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [
    'backend/bin/apply_tzuyang_address_evidence_ledger.mjs',
    '--ledger-dir',
    'backend/restaurant-evaluation/reports/does-not-matter',
    '--apply',
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--apply requires explicit --allow-db-write/);
});
