import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvalFailures,
  buildFallbackQueries,
  candidateRiskFlags,
} from '../../../bin/build_tzuyang_operator_review_package.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function confirmedRow(overrides = {}) {
  return {
    schema_version: 1,
    id: 'confirmed-1',
    video_id: 'video-1',
    youtube_link: 'https://youtu.be/video-1',
    origin_name: '틈새라면 이천점',
    origin_address_text: '경기도 이천시 창전동',
    case_decision: 'confirmed_external_place',
    confidence: 'medium',
    local_evidence_families: ['multimodal_region', 'visual_signage'],
    local_evidence: [
      { family: 'multimodal_region', confidence: 'high', summary: '영상에서 이천시와 틈새라면 간판 확인' },
    ],
    search_queries_attempted: ['이천시 틈새라면 이천점', '틈새라면 이천점 주소'],
    search_attempts: [
      {
        query: '이천시 틈새라면 이천점',
        top_results: [{ url: 'https://map.naver.com/p/entry/place/1003598680', title: '틈새라면 이천점' }],
      },
    ],
    matched_evidence: {
      phones: [],
      regions: ['이천시'],
      names: ['틈새라면 이천점', '틈새라면'],
      local_video_family_count: 2,
      external_source_count: 24,
      map_place_candidate_count: 12,
      exact_map_candidate_count: 12,
      agreed_place_ids: ['1003598680'],
      high_confidence_local_video_evidence_count: 1,
    },
    selected_place_candidate: {
      provider: 'naver_map',
      place_id: '1003598680',
      name: '틈새라면 이천점',
      address: '',
      lat: 37.2793985,
      lng: 127.446171,
      url: 'https://map.naver.com/p/entry/place/1003598680?lng=127.446171&lat=37.2793985',
    },
    decision_blockers: [],
    db_write_performed: false,
    ...overrides,
  };
}

function supportedRow() {
  return {
    ...confirmedRow({
      id: 'supported-1',
      case_decision: 'externally_supported_needs_operator_review',
      decision_blockers: ['no_cross_checked_precise_map_candidate'],
    }),
  };
}

test('fallback queries include Google/blog manual review URLs', () => {
  const queries = buildFallbackQueries(supportedRow());
  assert.ok(queries.length >= 4);
  assert.ok(queries.every((row) => row.google_search_url.startsWith('https://www.google.com/search?q=')));
  assert.ok(queries.some((row) => row.purpose === 'google_business_state'));
});

test('candidate risk flags keep missing candidate address visible', () => {
  assert.ok(candidateRiskFlags(confirmedRow()).includes('candidate_address_missing_or_not_precise'));
});

test('approval guard rejects missing approval metadata and place mismatch', () => {
  const row = confirmedRow();
  assert.deepEqual(approvalFailures({
    id: row.id,
    approved: true,
    approved_by: 'operator',
    approved_at: '2026-05-31T00:00:00Z',
    place_id: '1003598680',
    road_address: '경기 이천시 어딘가 1',
    lat: 37.2793985,
    lng: 127.446171,
    operator_notes: '영상과 지도 확인',
  }, row), []);
  assert.ok(approvalFailures({ id: row.id, approved: true, place_id: 'other' }, row).includes('place_id_mismatch'));
});

test('CLI writes review package and creates no apply candidates without approvals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tzuyang-operator-review-'));
  try {
    const caseDir = join(dir, 'case');
    const ledgerDir = join(dir, 'ledger');
    const out = join(dir, 'out');
    const mkdir = spawnSync('mkdir', ['-p', caseDir, ledgerDir]);
    assert.equal(mkdir.status, 0);
    writeFileSync(join(caseDir, 'case-review.jsonl'), `${JSON.stringify(confirmedRow())}\n${JSON.stringify(supportedRow())}\n`, 'utf8');
    writeFileSync(join(ledgerDir, 'manual-review-queue.jsonl'), `${JSON.stringify({
      id: 'confirmed-1',
      db_snapshot: { origin_name: '틈새라면 이천점', updated_at: '2026-05-31T00:00:00Z' },
    })}\n`, 'utf8');
    const run = spawnSync(process.execPath, [
      'backend/bin/build_tzuyang_operator_review_package.mjs',
      '--case-review-dir', caseDir,
      '--ledger-dir', ledgerDir,
      '--out', out,
      '--json',
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.confirmed_operator_review_rows, 1);
    assert.equal(summary.supported_operator_review_rows, 1);
    assert.equal(summary.strict_apply_candidates, 0);
    assert.equal(readFileSync(join(out, 'apply-candidates.jsonl'), 'utf8'), '');
    assert.match(readFileSync(join(out, 'fallback-queries.jsonl'), 'utf8'), /google_business_state/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI creates strict apply candidate only with explicit valid approval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tzuyang-operator-review-approval-'));
  try {
    const caseDir = join(dir, 'case');
    const ledgerDir = join(dir, 'ledger');
    const out = join(dir, 'out');
    spawnSync('mkdir', ['-p', caseDir, ledgerDir]);
    writeFileSync(join(caseDir, 'case-review.jsonl'), `${JSON.stringify(confirmedRow())}\n`, 'utf8');
    writeFileSync(join(ledgerDir, 'manual-review-queue.jsonl'), `${JSON.stringify({
      id: 'confirmed-1',
      db_snapshot: { origin_name: '틈새라면 이천점', updated_at: '2026-05-31T00:00:00Z' },
    })}\n`, 'utf8');
    const approval = join(dir, 'approval.json');
    writeFileSync(approval, JSON.stringify({
      approvals: [{
        id: 'confirmed-1',
        approved: true,
        approved_by: 'operator@example.com',
        approved_at: '2026-05-31T00:00:00Z',
        place_id: '1003598680',
        confirmed_name: '틈새라면 이천점',
        road_address: '경기 이천시 영창로 1',
        lat: 37.2793985,
        lng: 127.446171,
        operator_notes: '영상 외관과 네이버 지도 후보를 수동 확인',
      }],
    }), 'utf8');
    const run = spawnSync(process.execPath, [
      'backend/bin/build_tzuyang_operator_review_package.mjs',
      '--case-review-dir', caseDir,
      '--ledger-dir', ledgerDir,
      '--operator-approval-json', approval,
      '--out', out,
      '--json',
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.strict_apply_candidates, 1);
    const candidate = JSON.parse(readFileSync(join(out, 'apply-candidates.jsonl'), 'utf8').trim());
    assert.equal(candidate.decision, 'apply_candidate');
    assert.equal(candidate.candidate_places[0].derived_from_current_evidence, true);
    assert.equal(candidate.operator_approval.approved_by, 'operator@example.com');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
