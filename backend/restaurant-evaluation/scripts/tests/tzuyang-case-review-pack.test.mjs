import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCaseReviewRow,
  buildQueries,
  fetchNaverWithLimits,
  parseNaverSearch,
  spawnFileJson,
} from '../../../bin/build_tzuyang_case_review_pack.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function manualRow(overrides = {}) {
  return {
    id: 'row-1',
    video_id: 'video-1',
    youtube_link: 'https://www.youtube.com/watch?v=video-1',
    db_snapshot: {
      origin_name: '유포리막국수',
      phone: null,
      origin_address_text: '강원도 춘천시 신북읍 유포리',
      road_address: null,
      jibun_address: null,
    },
    evidence_families: ['multimodal_region', 'visual_phone', 'web_blog'],
    evidence: [
      {
        family: 'multimodal_region',
        source: 'transform:video-1',
        summary: '영상 00:25 춘천 유포리 유포리막국수 외관 간판과 지역 언급이 확인됨.',
        payload: { regions: ['강원도', '춘천시', '신북읍', '유포리'] },
        confidence: 'high',
      },
      {
        family: 'visual_phone',
        source: 'phone-hints:video-1',
        summary: '전화번호 후보 033-242-5168',
        payload: { phones: ['033-242-5168'] },
        confidence: 'medium',
      },
      {
        family: 'web_blog',
        source: 'web-context:video-1',
        summary: '영상 00:25 외관 간판에 유포리막국수와 SINCE 1966, 전화번호가 보이고 춘천 유포리라고 언급함.',
        payload: {},
        confidence: 'medium',
      },
    ],
    search_queries: [{ query: '유포리막국수 강원도 춘천시 신북읍 유포리', purpose: 'name_region_address_lookup' }],
    ...overrides,
  };
}

const naverHtml = `
  <html><body>
    <a href="https://map.naver.com/p/entry/place/30949262?lng=127.778275&lat=37.9460429&placePath=%2Fhome&searchType=place">유포리막국수 막국수</a>
    <a href="#">강원 춘천시 신북읍 맥국2길 123</a>
    <a href="https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=abc">유포리막국수 &gt; 여행지</a>
    <a href="https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=abc">문의 및 안내 033-242-5168 주소 강원특별자치도 춘천시 신북읍 맥국2길 123</a>
  </body></html>
`;
async function assertFixedRejection(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code && error.message === code);
}

function fixtureResponse(body, headers = { 'content-type': 'text/html; charset=utf-8' }) {
  return new Response(body, { status: 200, headers });
}

test('bounded Naver fetch accepts fixture HTML without a live network request', async () => {
  const calls = [];
  const fetched = await fetchNaverWithLimits('유포리막국수', {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return fixtureResponse(naverHtml);
    },
    maxResponseBytes: 8_192,
  });

  assert.equal(fetched.status, 200);
  assert.match(fetched.html, /유포리막국수/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.signal.aborted, false);
});

test('bounded Naver fetch rejects declared and chunked oversized fixture responses', async () => {
  await assertFixedRejection(
    fetchNaverWithLimits('fixture', {
      fetchImpl: async () => fixtureResponse('x', {
        'content-type': 'text/html',
        'content-length': '65',
      }),
      maxResponseBytes: 64,
    }),
    'NAVER_SEARCH_RESPONSE_TOO_LARGE',
  );

  const chunkedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(40)));
      controller.enqueue(new TextEncoder().encode('x'.repeat(40)));
      controller.close();
    },
  });
  await assertFixedRejection(
    fetchNaverWithLimits('fixture', {
      fetchImpl: async () => fixtureResponse(chunkedBody),
      maxResponseBytes: 64,
    }),
    'NAVER_SEARCH_RESPONSE_TOO_LARGE',
  );
});

test('bounded Naver fetch rejects slow, wrong-type, and malformed fixture responses', async () => {
  const slowBody = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });
  await assertFixedRejection(
    fetchNaverWithLimits('fixture', {
      fetchImpl: async () => fixtureResponse(slowBody),
      connectTimeoutMs: 20,
      totalTimeoutMs: 30,
      maxResponseBytes: 64,
    }),
    'NAVER_SEARCH_TOTAL_TIMEOUT',
  );

  await assertFixedRejection(
    fetchNaverWithLimits('fixture', {
      fetchImpl: async () => fixtureResponse('{}', { 'content-type': 'application/json' }),
      maxResponseBytes: 64,
    }),
    'NAVER_SEARCH_CONTENT_TYPE_REJECTED',
  );
  await assertFixedRejection(
    fetchNaverWithLimits('fixture', {
      fetchImpl: async () => ({
        status: 200,
        redirected: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        body: null,
      }),
      maxResponseBytes: 64,
    }),
    'NAVER_SEARCH_REDIRECT_REJECTED',
  );

  await assertFixedRejection(
    fetchNaverWithLimits('fixture', {
      fetchImpl: async () => fixtureResponse(new Uint8Array([0xc3, 0x28])),
      maxResponseBytes: 64,
    }),
    'NAVER_SEARCH_TEXT_INVALID',
  );
});

test('Scrapling JSON child bounds stdout, schema, and parent timeout without child diagnostics', async () => {
  const normalPayload = JSON.stringify({
    status: 200,
    url: 'https://search.naver.com/search.naver?query=fixture',
    html: '<html></html>',
    fetcher: 'fixture',
    blocked_reason: '',
  });
  const normal = await spawnFileJson(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(normalPayload)})`], {
    timeoutMs: 1_000,
    maxOutputBytes: 8_192,
  });
  assert.equal(normal.status, 200);

  await assertFixedRejection(
    spawnFileJson(process.execPath, ['-e', "const write = () => process.stdout.write('x'.repeat(128)); write(); setInterval(write, 1);"], {
      timeoutMs: 1_000,
      maxOutputBytes: 128,
    }),
    'SCRAPLING_FETCHER_STDOUT_TOO_LARGE',
  );

  await assertFixedRejection(
    spawnFileJson(process.execPath, ['-e', 'setInterval(() => {}, 1_000);'], {
      timeoutMs: 40,
      maxOutputBytes: 8_192,
    }),
    'SCRAPLING_FETCHER_TIMEOUT',
  );

  const invalidSchema = JSON.stringify({
    status: 200,
    url: 'https://search.naver.com/search.naver?query=fixture',
    html: '<html></html>',
    fetcher: 'fixture',
    blocked_reason: '',
    unexpected: 'not accepted',
  });
  await assertFixedRejection(
    spawnFileJson(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(invalidSchema)})`], {
      timeoutMs: 1_000,
      maxOutputBytes: 8_192,
    }),
    'SCRAPLING_FETCHER_SCHEMA_INVALID',
  );
});

test('case review queries prefer phone, name, and region evidence', () => {
  const queries = buildQueries(manualRow(), 3);
  assert.equal(queries[0], '033-242-5168');
  assert.ok(queries.some((query) => query.includes('유포리막국수')));
});

test('Naver search parser extracts place candidate coordinates and source context', () => {
  const parsed = parseNaverSearch(naverHtml, manualRow(), '유포리막국수 033-242-5168', '2026-05-31T00:00:00Z');
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.place_candidates.length, 1);
  assert.equal(parsed.place_candidates[0].provider, 'naver_map');
  assert.equal(parsed.place_candidates[0].place_id, '30949262');
  assert.equal(parsed.place_candidates[0].lat, 37.9460429);
  assert.equal(parsed.place_candidates[0].lng, 127.778275);
  assert.match(parsed.place_candidates[0].address, /춘천시/);
});

test('case review row confirms only cross-checked external place candidates', () => {
  const attempts = [
    parseNaverSearch(naverHtml, manualRow(), '유포리막국수 033-242-5168', '2026-05-31T00:00:00Z'),
    parseNaverSearch(naverHtml, manualRow(), '강원도 유포리막국수', '2026-05-31T00:00:01Z'),
  ];
  const review = buildCaseReviewRow(manualRow(), attempts, '2026-05-31T00:00:00Z');
  assert.equal(review.case_decision, 'confirmed_external_place');
  assert.equal(review.confidence, 'high');
  assert.equal(review.selected_place_candidate.place_id, '30949262');
  assert.deepEqual(review.matched_evidence.phones, ['033-242-5168']);
  assert.deepEqual(review.decision_blockers, []);
  assert.equal(review.db_write_performed, false);
});

test('single-query or unrelated map candidates cannot become confirmed places', () => {
  const oneAttempt = [parseNaverSearch(naverHtml, manualRow(), '유포리막국수 033-242-5168', '2026-05-31T00:00:00Z')];
  const oneAttemptReview = buildCaseReviewRow(manualRow(), oneAttempt, '2026-05-31T00:00:00Z');
  assert.notEqual(oneAttemptReview.case_decision, 'confirmed_external_place');
  assert.ok(oneAttemptReview.decision_blockers.includes('insufficient_confirmed_place_agreement'));

  const unrelatedHtml = `
    <html><body>
      <a href="https://map.naver.com/p/entry/place/1090397990?lng=126.970026&lat=37.5457829">상록수 헤어샵</a>
      <a href="#">서울 용산구 보광동</a>
    </body></html>
  `;
  const unrelatedAttempts = [
    parseNaverSearch(unrelatedHtml, manualRow(), '유포리막국수 033-242-5168', '2026-05-31T00:00:00Z'),
    parseNaverSearch(unrelatedHtml, manualRow(), '강원도 유포리막국수', '2026-05-31T00:00:01Z'),
  ];
  const unrelatedReview = buildCaseReviewRow(manualRow(), unrelatedAttempts, '2026-05-31T00:00:00Z');
  assert.notEqual(unrelatedReview.case_decision, 'confirmed_external_place');
  assert.ok(unrelatedReview.decision_blockers.includes('no_cross_checked_precise_map_candidate'));
});

test('masked temporary vendors stay review-only instead of becoming apply candidates', () => {
  const row = manualRow({
    db_snapshot: {
      origin_name: '[비공개] 닭강정 푸드트럭',
      origin_address_text: '대전 엑스포과학공원 한빛야시장',
    },
    evidence_families: ['multimodal_region', 'web_blog'],
    evidence: [
      {
        family: 'web_blog',
        source: 'web-context:night-market',
        summary: '특정 상호는 영상에서 식별되지 않음. 임시 푸드트럭으로 고정된 주소 및 전화번호 정보 없음.',
        payload: {},
        confidence: 'medium',
      },
    ],
  });
  const review = buildCaseReviewRow(row, [], '2026-05-31T00:00:00Z');
  assert.equal(review.case_decision, 'fixed_location_unavailable');
  assert.equal(review.db_write_performed, false);
});

test('CLI can route live search through a Scrapling-compatible helper', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tzuyang-case-review-scrapling-'));
  try {
    const manualReview = join(dir, 'manual-review.jsonl');
    const fakeScrapling = join(dir, 'fake-scrapling-fetch.mjs');
    const out = join(dir, 'out');
    writeFileSync(manualReview, `${JSON.stringify(manualRow())}\n`, 'utf8');
    writeFileSync(fakeScrapling, `#!/usr/bin/env node
const payload = {
  status: 200,
  url: 'https://search.naver.com/search.naver?query=fake',
  fetcher: 'fake_scrapling',
  html: ${JSON.stringify(naverHtml)},
  blocked_reason: '',
};
console.log(JSON.stringify(payload));
`, 'utf8');

    const run = spawnSync(process.execPath, [
      'backend/bin/build_tzuyang_case_review_pack.mjs',
      '--manual-review', manualReview,
      '--out', out,
      '--max-queries-per-row', '1',
      '--scrapling-search',
      '--scrapling-python', process.execPath,
      '--scrapling-fetcher-script', fakeScrapling,
      '--json',
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.total_case_rows, 1);
    const searchLog = readFileSync(join(out, 'search-log.jsonl'), 'utf8');
    assert.match(searchLog, /naver_search_scrapling/);
    assert.match(searchLog, /"status":"ok"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-2xx Scrapling helper responses remain review-only http_error evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tzuyang-case-review-scrapling-403-'));
  try {
    const manualReview = join(dir, 'manual-review.jsonl');
    const fakeScrapling = join(dir, 'fake-scrapling-fetch.mjs');
    const out = join(dir, 'out');
    writeFileSync(manualReview, `${JSON.stringify(manualRow())}\n`, 'utf8');
    writeFileSync(fakeScrapling, `#!/usr/bin/env node
console.log(JSON.stringify({
  status: 403,
  url: 'https://search.naver.com/search.naver?query=fake',
  fetcher: 'fake_scrapling',
  blocked_reason: 'http_status_403',
  html: ''
}));
`, 'utf8');

    const run = spawnSync(process.execPath, [
      'backend/bin/build_tzuyang_case_review_pack.mjs',
      '--manual-review', manualReview,
      '--out', out,
      '--max-queries-per-row', '1',
      '--scrapling-search',
      '--scrapling-python', process.execPath,
      '--scrapling-fetcher-script', fakeScrapling,
      '--json',
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.confirmed_external_place_rows, 0);
    const searchLog = readFileSync(join(out, 'search-log.jsonl'), 'utf8');
    assert.match(searchLog, /"status":"http_error"/);
    assert.match(searchLog, /"http_status":403/);
    assert.match(searchLog, /SCRAPLING_FETCHER_HTTP_ERROR/);
    assert.equal(searchLog.includes('http_status_403'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI fixture run is deterministic, no-network by default, and writes review files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tzuyang-case-review-'));
  try {
    const manualReview = join(dir, 'manual-review.jsonl');
    const fixtureJson = join(dir, 'fixture-search.json');
    const out = join(dir, 'out');
    const row = manualRow();
    writeFileSync(manualReview, `${JSON.stringify(row)}\n`, 'utf8');
    writeFileSync(fixtureJson, JSON.stringify({
      '033-242-5168': naverHtml,
      '유포리막국수 강원도 033-242-5168': naverHtml,
    }), 'utf8');

    const fixtureRun = spawnSync(process.execPath, [
      'backend/bin/build_tzuyang_case_review_pack.mjs',
      '--manual-review', manualReview,
      '--fixture-search-json', fixtureJson,
      '--out', out,
      '--max-queries-per-row', '2',
      '--json',
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(fixtureRun.status, 0, fixtureRun.stderr);
    const fixtureSummary = JSON.parse(fixtureRun.stdout);
    assert.equal(fixtureSummary.total_case_rows, 1);
    assert.equal(fixtureSummary.confirmed_external_place_rows, 1);

    const skippedOut = join(dir, 'skipped-out');
    const skippedRun = spawnSync(process.execPath, [
      'backend/bin/build_tzuyang_case_review_pack.mjs',
      '--manual-review', manualReview,
      '--out', skippedOut,
      '--max-queries-per-row', '1',
      '--json',
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(skippedRun.status, 0, skippedRun.stderr);
    const skippedSummary = JSON.parse(skippedRun.stdout);
    assert.equal(skippedSummary.confirmed_external_place_rows, 0);
    assert.match(readFileSync(join(skippedOut, 'search-log.jsonl'), 'utf8'), /live_search_not_enabled/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
