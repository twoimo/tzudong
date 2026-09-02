import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PRIMARY_STATUS_FILTER_OPTIONS,
  sanitizePrimaryStatusFilterValue,
} from '@/components/admin/evaluation-status-filter-options';
import {
  isAdminEvaluationRecordMissing,
  isAdminEvaluationRecordNotSelected,
  isAdminEvaluationRecordReadyForApproval,
  isAdminEvaluationRecordUnconfirmedMapLocation,
} from '@/lib/admin/evaluation-records';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('PRIMARY_STATUS_FILTER_OPTIONS', () => {
  test('keeps the visible primary status menu in the approved order', () => {
    expect(PRIMARY_STATUS_FILTER_OPTIONS.map(({ value }) => value)).toEqual([
      'all',
      'pending',
      'approved',
      'deleted',
      'ready_for_approval',
      'unconfirmed_map',
      'missing',
      'not_selected',
    ]);

    expect(PRIMARY_STATUS_FILTER_OPTIONS.map(({ label }) => label)).toEqual([
      '전체',
      '미처리',
      '승인됨',
      '삭제됨',
      '승인 대기',
      '미확정 좌표',
      'Missing',
      '평가 미대상',
    ]);
  });

  test('sanitizes only visible primary status values', () => {
    expect(sanitizePrimaryStatusFilterValue('all')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('pending')).toBe('pending');
    expect(sanitizePrimaryStatusFilterValue('approved')).toBe('approved');
    expect(sanitizePrimaryStatusFilterValue('deleted')).toBe('deleted');
    expect(sanitizePrimaryStatusFilterValue('ready_for_approval')).toBe('ready_for_approval');
    expect(sanitizePrimaryStatusFilterValue('unconfirmed_map')).toBe('unconfirmed_map');
    expect(sanitizePrimaryStatusFilterValue('evaluation_incomplete')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('missing')).toBe('missing');
    expect(sanitizePrimaryStatusFilterValue('not_selected')).toBe('not_selected');
    expect(sanitizePrimaryStatusFilterValue('geocoding_failed')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('address_review_geocode_recovered')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('hold')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('db_conflict')).toBeUndefined();
  });

  test('classifies lifecycle and data-quality filters from the full admin DB record set', () => {
    expect(isAdminEvaluationRecordMissing({
      status: 'deleted',
      is_missing: true,
      is_not_selected: false,
      geocoding_success: false,
      evaluation_results: null,
    })).toBe(true);

    expect(isAdminEvaluationRecordNotSelected({
      status: 'approved',
      is_missing: false,
      is_not_selected: true,
      geocoding_success: false,
      evaluation_results: null,
    })).toBe(true);

    expect(isAdminEvaluationRecordReadyForApproval({
      status: 'pending',
      is_missing: false,
      is_not_selected: false,
      geocoding_success: true,
      evaluation_results: {
        visit_authenticity: { name: '방문', eval_value: 1, eval_basis: '직접 방문' },
        rb_inference_score: { name: '추론', eval_value: 1, eval_basis: '명확' },
        rb_grounding_TF: { name: '근거', eval_value: true, eval_basis: '확인' },
        review_faithfulness_score: { name: '리뷰', eval_value: 1, eval_basis: '충실' },
        category_validity_TF: { name: '카테고리 유효', eval_value: true },
        category_TF: { name: '카테고리', eval_value: true, category_revision: null },
        location_match_TF: null,
      },
    })).toBe(true);
    expect(isAdminEvaluationRecordReadyForApproval({
      status: 'pending',
      is_missing: false,
      is_not_selected: false,
      geocoding_success: true,
      evaluation_results: {
        visit_authenticity: { name: '방문', eval_value: 1, eval_basis: '직접 방문' },
        rb_inference_score: { name: '추론', eval_value: 1, eval_basis: '명확' },
        rb_grounding_TF: { name: '근거', eval_value: true, eval_basis: '확인' },
        review_faithfulness_score: { name: '리뷰', eval_value: 1, eval_basis: '충실' },
        category_validity_TF: { name: '카테고리 유효', eval_value: true },
        category_TF: { name: '카테고리', eval_value: true, category_revision: null },
        location_match_TF: { pending_reason: 'ambiguous_chain', eval_value: false },
      },
    })).toBe(false);
    expect(isAdminEvaluationRecordUnconfirmedMapLocation({
      status: 'pending',
      is_missing: false,
      is_not_selected: false,
      geocoding_success: false,
      evaluation_results: {
        location_match_TF: { pending_reason: 'ambiguous_chain', eval_value: false },
      },
    })).toBe(true);
    expect(isAdminEvaluationRecordUnconfirmedMapLocation({
      status: 'pending',
      is_missing: false,
      is_not_selected: false,
      geocoding_success: false,
      evaluation_results: {
        location_match_TF: { pending_reason: 'insufficient_evidence', eval_value: false },
      },
    })).toBe(true);
    expect(isAdminEvaluationRecordUnconfirmedMapLocation({
      status: 'pending',
      is_missing: false,
      is_not_selected: false,
      geocoding_success: false,
      evaluation_results: {
        location_match_TF: { pending_reason: 'multi_candidate', eval_value: false },
      },
    })).toBe(true);
    expect(isAdminEvaluationRecordUnconfirmedMapLocation({
      status: 'pending',
      is_missing: false,
      is_not_selected: false,
      geocoding_success: true,
      evaluation_results: {
        location_match_TF: { pending_reason: null, match_status: 'confirmed_from_video', eval_value: true },
      },
    })).toBe(false);
    expect(isAdminEvaluationRecordReadyForApproval({
      status: 'pending',
      is_missing: false,
      is_not_selected: false,
      geocoding_success: true,
      evaluation_results: {
        visit_authenticity: { name: '방문', eval_value: 1, eval_basis: '직접 방문' },
        rb_inference_score: { name: '추론', eval_value: 1, eval_basis: '명확' },
        rb_grounding_TF: { name: '근거', eval_value: true, eval_basis: '확인' },
        review_faithfulness_score: { name: '리뷰', eval_value: 1, eval_basis: '충실' },
        category_validity_TF: { name: '카테고리 유효', eval_value: true },
        category_TF: { name: '카테고리', eval_value: true, category_revision: null },
        location_match_TF: { pending_reason: 'insufficient_evidence', eval_value: false },
      },
    })).toBe(false);
  });
  test('queues geo-true insufficient_evidence from the shared reason set, not a leftover literal', () => {
    const classifierSource = source('lib/admin/evaluation-records.ts');
    expect(classifierSource).toContain('GEO_TRUE_UNCONFIRMED_MAP_REASONS.has(reason)');
    expect(classifierSource).not.toMatch(/reason === 'insufficient_evidence'/);
  });

  test('keeps table and slide approval gates on the shared address-consistency helper', () => {
    const tableSource = source('components/admin/EvaluationTableNew.tsx');
    const slideSource = source('components/admin/EvaluationSlideView.tsx');

    expect(tableSource).toContain('canApproveAddressConsistencyRecord');
    expect(slideSource).toContain('canApproveAddressConsistencyRecord');
    expect(tableSource).not.toContain('const canApprove =');
    expect(tableSource).not.toMatch(/disabled=\{loading \|\| !record\.geocoding_success\}/);
    expect(slideSource).not.toMatch(/disabled=\{loading \|\| !currentRecord\.geocoding_success\}/);
  });

  test('keeps mobile status filters clickable and view toggles icon-only', () => {
    const tableSource = source('components/admin/EvaluationTableNew.tsx');
    const pageSource = source('app/admin/evaluations/admin-evaluation-page.tsx');
    const categorySidebarSource = source('components/admin/CategorySidebar.tsx');
    const adminOverviewSource = source('components/admin/AdminConsoleOverview.tsx');
    const evaluationApiRouteSource = source('app/api/admin/evaluations/route.ts');
    const evaluationRecordHelperSource = source('lib/admin/evaluation-records.ts');

    expect(tableSource).toContain('data-admin-evaluation-mobile-status-filter="true"');
    expect(tableSource).toContain('data-admin-evaluation-mobile-toolbar="two-row"');
    expect(tableSource).toContain('data-admin-evaluation-mobile-status-filter-option={filter.value || \'all\'}');
    expect(tableSource).toContain('handleMobileStatusQuickFilterChange(filter.value)');
    expect(tableSource).toContain('aria-pressed={isActive}');
    expect(tableSource).toContain('data-admin-evaluation-mobile-controls="borderless"');
    expect(tableSource).toContain('data-layout-primitives="stack wrap-row"');
    expect(tableSource).toContain('space-y-2 bg-transparent p-0 shadow-none');
    expect(tableSource).not.toContain('space-y-2 rounded-lg border bg-card p-3 shadow-sm');
    expect(tableSource).not.toContain('style={shouldRenderMobile ? { touchAction: \'pan-y\' } : undefined}');
    expect(tableSource).not.toContain('onPointerDown={handleMobileFilterPointerStart}');
    expect(tableSource).not.toContain('onTouchStart={handleMobileFilterTouchStart}');
    expect(tableSource).toContain('sticky top-0 z-30 -mx-2 bg-background/95 px-2 pb-2 pt-1 backdrop-blur lg:hidden');
    expect(tableSource).toContain('grid grid-cols-3 gap-1.5');
    expect(tableSource).toContain('<div className="min-w-0 truncate px-0.5 text-xs text-muted-foreground">');
    expect(tableSource).toContain('<span>검수 항목</span>');
    expect(tableSource).toContain('loading && records.length === 0');
    expect(tableSource).toContain('<strong className="ml-1 text-sm font-bold text-foreground">{records.length}개</strong>');
    expect(tableSource).toContain('필터 {activeFilterCount}개');
    expect(tableSource).toContain('data-admin-evaluation-mobile-filter-actions="true"');
    expect(tableSource).toContain('data-layout-primitives="cluster"');
    expect(tableSource).toContain('aria-label="필터 초기화"');
    expect(tableSource).toContain('{hasActiveFilters && (');
    expect(tableSource).toContain('variant="ghost"');
    expect(tableSource).toContain('h-8 min-w-0 rounded-full px-2 text-xs font-medium');
    expect(tableSource).toContain('rounded-2xl border border-border/70 bg-card/95 p-3 shadow-sm');
    expect(tableSource).toContain('data-admin-evaluation-mobile-card="true"');
    expect(tableSource).toContain('data-layout-primitives="stack frame"');
    expect(tableSource).toContain('<article');
    expect(tableSource).toContain('flex min-w-max flex-nowrap gap-1.5');
    expect(tableSource).toContain('rounded-xl bg-muted/35 p-2.5 text-[11px]');
    expect(pageSource).toContain('data-admin-evaluation-view-actions="top-right"');
    expect(pageSource).toContain('data-admin-evaluation-title-icon="true"');
    expect(pageSource).toContain('inline-flex h-6 w-6 shrink-0 items-center justify-center text-primary');
    expect(pageSource).not.toContain('rounded-xl bg-primary/10 text-primary');
    expect(pageSource).not.toContain('place-items-center rounded-xl bg-primary/10');
    expect(pageSource).toContain('<AdminEvaluationTitleIcon embedded={embedded} />');
    expect(pageSource).not.toContain('<ClipboardCheck className={embedded ? "h-5 w-5 text-primary" : "h-6 w-6 text-primary"} />');
    expect(pageSource).toContain('data-admin-evaluation-view-toggle="list"');
    expect(pageSource).toContain('data-admin-evaluation-view-toggle="slide"');
    expect(pageSource).toContain('<span className="sr-only">리스트</span>');
    expect(pageSource).toContain('<span className="sr-only">슬라이드</span>');
    expect(pageSource).not.toContain('<span className="lg:hidden">리스트</span>');
    expect(pageSource).not.toContain('<span className="lg:hidden">슬라이드</span>');
    expect(pageSource).toContain('data-admin-evaluation-static-loading-controls="true"');
    expect(pageSource).toContain('ADMIN_EVALUATION_STATIC_STATUS_FILTERS');
    expect(pageSource).toContain('isInitialEvaluationDataLoading');
    expect(pageSource).toContain('pendingQueueSummaryContent');
    expect(pageSource).toContain('필터링: 집계 중 | 현 레코드 집계 중 | 삭제한 레코드 집계 중');
    expect(pageSource).not.toContain('필터링: <Skeleton');
    expect(tableSource).toContain('<span className="ml-1 font-medium">집계 중</span>');
    expect(adminOverviewSource).toContain('필터링: 집계 중 | 현 레코드 집계 중 | 삭제한 레코드 집계 중');
    expect(adminOverviewSource).not.toContain('필터링: <Skeleton');
    expect(adminOverviewSource).toContain('data-admin-evaluation-dynamic-loading-shell="true"');
    expect(adminOverviewSource).toContain('loading: () => <AdminEvaluationModuleStaticShell />');
    expect(adminOverviewSource).toContain('정적인 관리자 데이터 검수 컨트롤은 바로 표시하고, 동적인 검수 데이터만 불러오는 중입니다.');
    expect(adminOverviewSource).toContain('data-admin-evaluation-static-loading-controls="true"');
    expect(pageSource).toContain("fetch('/api/admin/evaluations'");
    expect(pageSource).toContain('브라우저 Supabase 클라이언트는 RLS 때문에 승인된 공개 레코드만 보일 수 있다.');
    expect(pageSource).not.toContain('.select(RESTAURANT_MERGE_SELECT)');
    expect(pageSource).toContain('missing: typedRecords.filter(isAdminEvaluationRecordMissing).length');
    expect(pageSource).toContain('not_selected: typedRecords.filter(isAdminEvaluationRecordNotSelected).length');
    expect(pageSource).toContain('ready_for_approval: typedRecords.filter(isAdminEvaluationRecordReadyForApproval).length');
    expect(pageSource).toContain('unconfirmed_map: typedRecords.filter(isAdminEvaluationRecordUnconfirmedMapLocation).length');
    expect(pageSource).toContain("case 'unconfirmed_map':");
    expect(categorySidebarSource).toContain("label: '미확정 좌표'");
    expect(evaluationRecordHelperSource).toContain('export function isAdminEvaluationRecordUnconfirmedMapLocation');
    expect(pageSource).toContain("isDeletedFilterActive={evalFilters.status === 'deleted'}");
    expect(evaluationApiRouteSource).toContain('requireAdmin()');
    expect(evaluationApiRouteSource).toContain('createSupabaseServiceRoleClient');
    expect(evaluationApiRouteSource).toContain('ADMIN_EVALUATION_RECORD_SELECT');
    expect(evaluationApiRouteSource).toContain('range(from, from + PAGE_LIMIT - 1)');
    expect(evaluationRecordHelperSource).toContain('export function isAdminEvaluationRecordMissing');
    expect(evaluationRecordHelperSource).toContain("record.is_missing === true || record.status === 'missing' || record.status === 'geocoding_failed'");
    expect(evaluationRecordHelperSource).toContain('export function isAdminEvaluationRecordNotSelected');
    expect(evaluationRecordHelperSource).toContain("record.is_not_selected === true || record.status === 'not_selected'");
    expect(categorySidebarSource).toContain('justify-end overflow-x-auto');
    expect(categorySidebarSource).not.toContain('통계 펼치기');
  });
});
