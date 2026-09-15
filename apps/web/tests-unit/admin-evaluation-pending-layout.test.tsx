import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvaluationTable } from '../components/admin/EvaluationTableNew';

const noop = () => {};
const render = (loading: boolean) => renderToStaticMarkup(
  <EvaluationTable records={[]} loading={loading} evalFilters={{}} onApprove={noop} onDelete={noop} onFilterChange={noop} onResetFilters={noop} />
);

test('initial evaluation read keeps real table headers and filters, without an empty result', () => {
  const html = render(true);
  expect(html).toContain('<thead');
  expect(html).toContain('필터 초기화');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('role="status"');
  expect(html).not.toContain('표시할 데이터가 없습니다');
  expect(html).not.toContain('animate-pulse');
});

test('resolved empty evaluation result keeps the same table frame and reports empty', () => {
  const html = render(false);
  expect(html).toContain('<thead');
  expect(html).toContain('표시할 데이터가 없습니다');
  expect(html).not.toContain('data-admin-data-pending="true"');
});

test('failed initial evaluation read is not presented as a successful empty result', () => {
  const html = renderToStaticMarkup(<EvaluationTable records={[]} loadError evalFilters={{}} onApprove={noop} onDelete={noop} onFilterChange={noop} onResetFilters={noop} />);
  expect(html).toContain('<thead');
  expect(html).toContain('검수 데이터를 불러오지 못했습니다');
  expect(html).not.toContain('표시할 데이터가 없습니다');
});

test('refresh keeps a previously read evaluation row visible', () => {
  const record: import('../types/evaluation').EvaluationRecord = {
    id: 'pending-layout-fixture', name: '기존 검수 맛집', phone: null, categories: [], lat: null, lng: null,
    road_address: null, jibun_address: null, english_address: null, address_elements: {}, origin_address: {},
    youtube_links: [], youtube_meta: null, unique_id: null, tzuyang_reviews: [], reasoning_basis: null,
    evaluation_results: null, source_type: null, geocoding_success: false, geocoding_false_stage: null,
    status: 'pending', is_missing: false, is_not_selected: false, review_count: 0, created_by: null,
    updated_by_admin_id: null, created_at: '2026-09-08', updated_at: '2026-09-08',
  };
  const html = renderToStaticMarkup(<EvaluationTable records={[record]} loading evalFilters={{}} onApprove={noop} onDelete={noop} onFilterChange={noop} onResetFilters={noop} />);
  expect(html).toContain('기존 검수 맛집');
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain('data-admin-data-pending="true"');
});
