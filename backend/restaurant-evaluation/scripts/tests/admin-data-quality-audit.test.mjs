import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRestaurantRows, renderAuditMarkdown } from '../admin-data-quality-audit.mjs';

const baseRow = (overrides = {}) => ({
  id: 'row-1',
  approved_name: null,
  origin_name: '만나떡볶이',
  naver_name: null,
  google_name: null,
  phone: null,
  status: 'pending',
  updated_by_admin_id: null,
  road_address: '서울 중구 세종대로 1',
  jibun_address: '서울 중구 태평로1가 1',
  lat: 37.1,
  lng: 127.1,
  youtube_link: 'https://www.youtube.com/watch?v=AwD_Nh-HwZU',
  evaluation_results: null,
  updated_at: '2026-05-01T00:00:00Z',
  created_at: '2026-05-01T00:00:00Z',
  ...overrides,
});

test('fails the gate for active exact same-video identity duplicate groups', () => {
  const report = auditRestaurantRows([
    baseRow({ id: 'a', origin_name: '만나 떡볶이' }),
    baseRow({ id: 'b', origin_name: '만나떡볶이' }),
  ]);

  assert.equal(report.ok, false);
  assert.equal(report.counts.exactDuplicateGroups, 1);
  assert.equal(report.samples.exactDuplicateGroups[0].rows.length, 2);
});

test('reports fuzzy same-video candidates as warnings without failing exact gate', () => {
  const report = auditRestaurantRows([
    baseRow({ id: 'a', origin_name: '웅진식품 공주공장 구내식당', jibun_address: '충남 공주시 유구읍 유구리 1' }),
    baseRow({ id: 'b', origin_name: '웅진식품 유구공장 구내식당', jibun_address: '충남 공주시 유구읍 유구리 1' }),
  ]);

  assert.equal(report.ok, true);
  assert.equal(report.counts.exactDuplicateGroups, 0);
  assert.equal(report.counts.fuzzyCandidatePairs, 1);
  assert.equal(report.samples.fuzzyCandidatePairs[0].evidence.rule, 'same_video_same_address_similar_name');
});

test('counts active category consistency issues but ignores deleted rows', () => {
  const report = auditRestaurantRows([
    baseRow({ id: 'active-category', evaluation_results: { category_TF: { eval_value: false }, category_validity_TF: { eval_value: false } } }),
    baseRow({ id: 'deleted-category', status: 'deleted', evaluation_results: { category_TF: { eval_value: false } } }),
  ]);

  assert.equal(report.counts.categoryTFFalseRows, 1);
  assert.equal(report.counts.categoryValidityFalseRows, 1);
  assert.match(renderAuditMarkdown(report), /category_TF=false active rows: 1/);
});

test('fails the gate for active provider-name mismatches contradicted by video evidence', () => {
  const report = auditRestaurantRows([
    baseRow({
      id: 'wrong-provider',
      origin_name: '진주식당',
      naver_name: '만나손칼국수',
      youtube_link: 'https://www.youtube.com/watch?v=CPWwPVs5Ib4',
      evaluation_results: {
        location_match_TF: { eval_value: true },
        visit_authenticity: { eval_value: 0 },
        rb_inference_score: { eval_value: 0 },
      },
    }),
  ]);

  assert.equal(report.ok, false);
  assert.equal(report.counts.identityBlockingRows, 1);
  assert.match(renderAuditMarkdown(report), /provider_name_mismatch/);
});

test('fails the gate for address-only provider-name replacement even with positive visit score', () => {
  const report = auditRestaurantRows([
    baseRow({
      id: 'jegi-wrong-provider',
      origin_name: '제기식당',
      naver_name: '소문난냉면',
      youtube_link: 'https://www.youtube.com/watch?v=aga5WvCMGZk',
      evaluation_results: {
        location_match_TF: { eval_value: true },
        visit_authenticity: { eval_value: 2 },
        rb_inference_score: { eval_value: 1 },
      },
    }),
  ]);

  assert.equal(report.ok, false);
  assert.equal(report.counts.identityBlockingRows, 1);
  assert.match(renderAuditMarkdown(report), /provider_name_mismatch/);
});

test('warns for stripped branch context without failing the hard gate', () => {
  const report = auditRestaurantRows([
    baseRow({
      id: 'branch-context',
      origin_name: '정원분식 웨이브파크점',
      naver_name: '정원분식',
      youtube_link: 'https://www.youtube.com/watch?v=G3pQQeL47wI',
      evaluation_results: { location_match_TF: { eval_value: true } },
    }),
  ]);

  assert.equal(report.ok, true);
  assert.equal(report.counts.identityWarningRows, 1);
  assert.equal(report.counts.identityBlockingRows, 0);
  assert.equal(report.samples.identityWarningRows[0].warnings[0].rule, 'missing_branch_context');
});
