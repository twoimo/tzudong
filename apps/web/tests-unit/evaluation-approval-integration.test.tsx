import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React, { type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvaluationApprovalReasons } from '@/components/admin/EvaluationApprovalReasons';
import { EvaluationTable } from '@/components/admin/EvaluationTableNew';
import { EvaluationSlideView } from '@/components/admin/EvaluationSlideView';
import { EvaluationDetailView } from '@/components/admin/EvaluationDetailView';
import {
  APPROVAL_ELIGIBILITY_REASONS, evaluateApprovalEligibility, getRecordApprovalEligibility, parseApprovalEligibility,
  type ApprovalEligibility,
} from '@/lib/admin/evaluation-approval-eligibility';
import { normalizeEvaluationRecord } from '@/lib/admin/normalize-evaluation-record';
import { summarizeEvaluationRecord } from '@/lib/admin/evaluation-summary';
import type { EvaluationRecord } from '@/types/evaluation';

// Synthetic source JSON, not a normalized EvaluationRecord or an actual DB row.
function rawFixture() {
  return {
    id: '00000000-0000-4000-8000-000000000066', name: '합성 강남점', status: 'pending',
    approved_name: null, origin_name: '합성 강남점', naver_name: '합성 강남점', google_name: null,
    is_missing: false, is_not_selected: false, source_type: 'crawler',
    updated_by_admin_id: null, created_by: null, db_error_message: null, db_error_details: null,
    lat: 37, lng: 127, geocoding_success: true, jibun_address: '합성동 1', road_address: '합성로 1',
    categories: ['한식'], tzuyang_review: '보존할 합성 리뷰', trace_id: 'synthetic-trace', reasoning_basis: '보존할 합성 근거',
    youtube_link: 'https://www.youtube.com/watch?v=abcdefgh_-1',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    evaluation_results: {
      location_match_TF: { eval_value: true, match_status: 'matched', origin_name: '합성 강남점', matched_name: '합성 강남점',
        pending_reason: null as unknown, falseMessage: null as unknown, evidence_families: ['provider_candidate', 'source_geo'] },
      visit_authenticity: { eval_value: 1, eval_basis: '합성 방문 근거' },
      rb_inference_score: { eval_value: 1, eval_basis: '합성 추론 근거' },
      rb_grounding_TF: { eval_value: true, eval_basis: '합성 근거 일치' },
      review_faithfulness_score: { eval_value: 1, eval_basis: '합성 리뷰 근거' },
      category_validity_TF: { eval_value: true }, category_TF: { eval_value: true },
    },
  };
}
const passed: ApprovalEligibility = { state: 'local_checks_passed', reasons: [], requiresFinalServerValidation: true };
const detailRequired: ApprovalEligibility = { state: 'unknown', reasons: ['DETAIL_REQUIRED'], requiresFinalServerValidation: true };
const failure: ApprovalEligibility = { state: 'blocked', reasons: ['EVALUATION_FAILED'], requiresFinalServerValidation: true };
function normalized(raw: unknown): EvaluationRecord {
  const record = normalizeEvaluationRecord(raw);
  if (!record) throw new Error('SYNTHETIC_RECORD_INVALID');
  return record;
}

describe('strict approval DTO transport', () => {
  test('accepts only canonical complete shapes and clones the bounded reason list', () => {
    for (const dto of [passed, detailRequired, failure]) {
      const parsed = parseApprovalEligibility(dto);
      expect(parsed).toEqual(dto); expect(parsed).not.toBe(dto); expect(parsed?.reasons).not.toBe(dto.reasons);
    }
  });
  test('rejects unknown keys/states/codes, duplicates, overlong arrays and inconsistent states', () => {
    for (const dto of [null, [], 'PRIVATE', {}, { ...passed, raw: 'PRIVATE' }, { ...passed, state: 'approved' },
      { ...passed, requiresFinalServerValidation: false }, { state: passed.state, reasons: [] },
      { ...passed, reasons: ['FINAL_SERVER_CHECK_REQUIRED'] }, { ...failure, reasons: ['EVALUATION_FAILED', 'EVALUATION_FAILED'] },
      { ...failure, reasons: Array(20).fill('EVALUATION_FAILED') }, { ...failure, reasons: Array(1) },
      { ...failure, reasons: [null] }, { ...failure, reasons: ['PRIVATE'] }, { ...failure, reasons: [] },
      { ...passed, reasons: ['EVALUATION_FAILED'] }, { ...detailRequired, reasons: [] },
      { ...detailRequired, reasons: ['EVALUATION_FAILED'] }, { ...failure, reasons: ['DETAIL_REQUIRED'] },
      { ...passed, [Symbol('private')]: 'PRIVATE' }]) expect(parseApprovalEligibility(dto)).toBeNull();
    const getter = { ...passed };
    Object.defineProperty(getter, 'state', { get() { throw new Error('PRIVATE'); } });
    expect(parseApprovalEligibility(getter)).toBeNull();
  });
  test('all emitted reason codes round-trip in their correct state', () => {
    for (const reason of APPROVAL_ELIGIBILITY_REASONS) {
      const state = ['INVALID_RAW_RECORD', 'DETAIL_REQUIRED', 'INPUT_LIMIT_EXCEEDED', 'STATUS_UNKNOWN'].includes(reason) ? 'unknown' : 'blocked';
      const dto = { state, reasons: [reason], requiresFinalServerValidation: true };
      expect(parseApprovalEligibility(dto)).toEqual(dto);
    }
  });
});

describe('raw -> DTO -> summary/full normalization', () => {
  test('full and summary produce the same preflight before removing evidence', () => {
    for (const status of ['pending', 'hold', 'approved', 'deleted']) {
      const raw = { ...rawFixture(), status, created_by: 'synthetic-owner', updated_by_admin_id: 'synthetic-admin' };
      const before = structuredClone(raw);
      const full = normalized(raw);
      const summary = summarizeEvaluationRecord(raw, full);
      const list = normalized(summary);
      expect(full.approval_eligibility).toEqual(evaluateApprovalEligibility(raw));
      expect(summary.approval_eligibility).toEqual(full.approval_eligibility);
      expect(list.approval_eligibility).toEqual(full.approval_eligibility);
      expect(summary).not.toHaveProperty('tzuyang_review');
      expect(summary.evaluation_results).not.toHaveProperty('visit_authenticity.eval_basis');
      expect(full.restaurant_info?.tzuyang_review).toBe(raw.tzuyang_review);
      expect(raw).toEqual(before);
    }
  });
  test('unknown pending reason and removed falseMessage still block the DTO', () => {
    for (const key of ['pending_reason', 'falseMessage'] as const) {
      const raw = rawFixture(); raw.evaluation_results.location_match_TF[key] = 'PRIVATE_UNKNOWN_PROVIDER_REASON';
      const full = normalized(raw); const summary = summarizeEvaluationRecord(raw, full);
      expect(full.approval_eligibility?.reasons).toEqual(['LOCATION_EVIDENCE_INCOMPLETE']);
      expect(normalized(summary).approval_eligibility).toEqual(full.approval_eligibility);
      expect(JSON.stringify(full.approval_eligibility)).not.toContain('PRIVATE');
      if (key === 'falseMessage') expect(summary.evaluation_results).not.toHaveProperty('location_match_TF.falseMessage');
    }
  });
  test('zero/false remain failed rather than missing through summary transport', () => {
    const raw = rawFixture(); raw.evaluation_results.visit_authenticity.eval_value = 0; raw.evaluation_results.rb_grounding_TF.eval_value = false;
    const full = normalized(raw); const summary = summarizeEvaluationRecord(raw, full);
    expect(full.approval_eligibility).toEqual(failure);
    expect(normalized(summary).approval_eligibility).toEqual(failure);
    expect(summary.read_summary.evaluation_issues).toEqual([]);
  });
  test('summary-only or invalid DTO is unknown, never fabricated missing basis', () => {
    const full = normalized(rawFixture()); const summary = summarizeEvaluationRecord(rawFixture(), full);
    const { approval_eligibility: omitted, ...legacySummary } = summary;
    void omitted;
    for (const raw of [legacySummary, { ...legacySummary, approval_eligibility: { ...passed, private: 'PRIVATE' } },
      { ...legacySummary, approval_eligibility: { ...failure, reasons: ['PRIVATE'] } }]) {
      expect(normalized(raw).approval_eligibility).toEqual(detailRequired);
      const again = summarizeEvaluationRecord(raw, normalized(raw));
      expect(again.approval_eligibility).toEqual(detailRequired);
      expect(again.read_summary.evaluation_issues).toEqual([]);
    }
    const missingRawFields = { ...rawFixture() } as Record<string, unknown>;
    delete missingRawFields.tzuyang_review; delete missingRawFields.db_error_details;
    expect(normalized(missingRawFields).approval_eligibility).toEqual(detailRequired);
    expect(normalized({ ...missingRawFields, approval_eligibility: passed }).approval_eligibility).toEqual(passed);
    expect(normalized({ ...rawFixture(), read_summary: {}, approval_eligibility: undefined }).approval_eligibility).toEqual(detailRequired);
  });
  test('full raw recomputes instead of trusting a contradictory pass DTO', () => {
    const raw = rawFixture(); raw.evaluation_results.visit_authenticity.eval_value = 0;
    expect(normalized({ ...raw, approval_eligibility: passed }).approval_eligibility).toEqual(failure);
    expect(normalized({ ...raw, approval_eligibility: { ...passed, requiresFinalServerValidation: false } }).approval_eligibility).toEqual(detailRequired);
  });
  test('unknown raw status cannot become a healthy approval through legacy status normalization', () => {
    expect(normalized({ ...rawFixture(), status: 'future-status' }).approval_eligibility).toEqual({ state: 'unknown', reasons: ['STATUS_UNKNOWN'], requiresFinalServerValidation: true });
    expect(getRecordApprovalEligibility(new Proxy({}, { getPrototypeOf() { throw new Error('PRIVATE'); } }))).toEqual({ state: 'unknown', reasons: ['INVALID_RAW_RECORD'], requiresFinalServerValidation: true });
  });
  test('SQL spaced and explicitly requested compact sentinels stay blocked locally', () => {
    for (const sentinel of ['평가 근거 없음', '평가근거없음']) {
      const raw = rawFixture(); raw.evaluation_results.visit_authenticity.eval_basis = sentinel;
      const summary = summarizeEvaluationRecord(raw, normalized(raw));
      expect(summary.approval_eligibility.reasons).toContain('MISSING_BASIS');
      expect(normalized(summary).approval_eligibility).toEqual(summary.approval_eligibility);
    }
  });
});

const noop = () => {};
function table(record: EvaluationRecord) {
  return renderToStaticMarkup(<EvaluationTable records={[record]} onApprove={noop} onDelete={noop} onEdit={noop}
    evalFilters={{}} onFilterChange={noop} onResetFilters={noop} onRequestDetails={async () => true} />);
}
function slide(record: EvaluationRecord) {
  return renderToStaticMarkup(<EvaluationSlideView records={[record]} currentIndex={0} onNavigate={noop} onApprove={noop} onDelete={noop} onEdit={noop} onRequestDetails={async () => true} />);
}

describe('shared approval reasons and minimal component rendering', () => {
  test('fixed reason text has native keyboard/touch disclosure and no pretend rerun action', () => {
    const html = renderToStaticMarkup(<EvaluationApprovalReasons id="synthetic-reasons" eligibility={failure} />);
    expect(html).toContain('<details>'); expect(html).toContain('<summary'); expect(html).toContain('승인 불가');
    expect(html).toContain('근거 재평가 필요'); expect(html).toContain('평가값이 승인 기준을 통과하지 못했습니다.');
    expect(html).not.toContain('평가값이 없거나'); expect(html).not.toContain('<button');
    const pass = renderToStaticMarkup(<EvaluationApprovalReasons eligibility={passed} />);
    expect(pass).toContain('최종 서버 검사 필요'); expect(pass).not.toContain('승인완료'); expect(pass).not.toContain('중복 없음');
  });
  test('unknown has an explicit detail callback; arbitrary DTO fields never render', () => {
    let requests = 0, stopped = 0;
    const element = EvaluationApprovalReasons({ eligibility: detailRequired, onRequestDetails: () => { requests++; } });
    const walk = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
      if (!React.isValidElement(node)) return [];
      const element = node as ReactElement<Record<string, unknown>>;
      return [element, ...React.Children.toArray(element.props.children as ReactNode).flatMap(walk)];
    };
    const button = walk(element).find(node => node.type === 'button');
    expect(button).toBeDefined();
    (button!.props.onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation() { stopped++; } });
    expect(requests).toBe(1); expect(stopped).toBe(1);
    const html = renderToStaticMarkup(<EvaluationApprovalReasons eligibility={{ ...passed, private: 'PRIVATE' } as ApprovalEligibility} onRequestDetails={noop} />);
    expect(html).toContain('상세 다시 확인'); expect(html).not.toContain('PRIVATE');
  });
  test('table and slide block known failed approval for pending and hold', () => {
    for (const status of ['pending', 'hold']) {
      const raw = { ...rawFixture(), status }; raw.evaluation_results.visit_authenticity.eval_value = 0;
      const record = normalized(raw);
      for (const html of [table(record), slide(record)]) {
        const buttons = html.match(/<button\b[^>]*title="승인 불가 사유 확인"[^>]*>/g) ?? [];
        expect(buttons.length).toBeGreaterThan(0);
        for (const button of buttons) expect(button).toMatch(/\bdisabled=""/);
        expect(html).toContain('평가값이 승인 기준을 통과하지 못했습니다.');
      }
    }
  });
  test('actual table/slide callbacks cannot invoke approval for blocked or unknown input', () => {
    const tableSource = ts.createSourceFile('table.tsx', readFileSync(new URL('../components/admin/EvaluationTableNew.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const slideSource = ts.createSourceFile('slide.tsx', readFileSync(new URL('../components/admin/EvaluationSlideView.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const callbacks: string[] = [];
    const visitsApproval = (node: ts.Node): boolean => (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'onApprove')
      || Boolean(ts.forEachChild(node, child => visitsApproval(child) || undefined));
    const visit = (node: ts.Node, source: ts.SourceFile) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onClick' && node.initializer && ts.isJsxExpression(node.initializer)
        && node.initializer.expression && ts.isArrowFunction(node.initializer.expression) && visitsApproval(node.initializer.expression)) callbacks.push(node.initializer.expression.getText(source));
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleApproveCurrent' && node.initializer) callbacks.push(node.initializer.getText(source));
      ts.forEachChild(node, child => visit(child, source));
    };
    visit(tableSource, tableSource); visit(slideSource, slideSource);
    expect(callbacks).toHaveLength(3); // Desktop table, mobile table, shared slide callback.
    for (const source of callbacks) for (const state of ['blocked', 'unknown', 'local_checks_passed']) {
      let approved = 0, refreshed = 0;
      const record = normalized(rawFixture());
      const compiled = new Bun.Transpiler({ loader: 'tsx' }).transformSync(`const callback = ${source};`);
      const callback = new Function('approvalUnknown', 'canApprove', 'canApproveCurrent', 'requestDetails', 'onApprove', 'record', 'currentRecord',
        `${compiled}; return callback;`)(state === 'unknown', state === 'local_checks_passed', state === 'local_checks_passed',
        () => { refreshed++; }, () => { approved++; }, record, record) as (event: { stopPropagation: () => void }) => void;
      callback({ stopPropagation: noop });
      expect(approved).toBe(state === 'local_checks_passed' ? 1 : 0);
      expect(refreshed).toBe(state === 'unknown' ? 1 : 0);
    }
  });
  test('unknown offers enabled detail path; passing preflight keeps final-server language', () => {
    const record = normalized(rawFixture());
    for (const html of [table({ ...record, approval_eligibility: detailRequired }), slide({ ...record, approval_eligibility: detailRequired })]) {
      expect(html).toContain('상세 다시 확인');
      const buttons = html.match(/<button\b[^>]*title="승인 전 상세 확인"[^>]*>/g) ?? [];
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) expect(button).not.toMatch(/\bdisabled=""/);
    }
    for (const html of [table(record), slide(record)]) expect(html).toContain('최종 서버 검사 필요');
  });
  test('approved/deleted branches keep terminal actions and hide preflight rejection', () => {
    for (const status of ['approved', 'deleted']) {
      const record = normalized({ ...rawFixture(), status });
      for (const html of [table(record), slide(record)]) {
        expect(html).not.toContain('data-approval-state=');
        expect(html).not.toContain('title="승인 불가 사유 확인"');
        if (status === 'deleted') expect(html).toMatch(/복원|되돌리기/);
      }
    }
  });
  test('detail keeps existing evidence content alongside the shared reasons', () => {
    const record = normalized(rawFixture());
    const html = renderToStaticMarkup(<EvaluationDetailView record={record} autoHeight />);
    expect(html).toContain('검수 결과'); expect(html).toContain('음식점 상세');
    expect(html).toContain('합성 방문 근거'); expect(html).toContain('보존할 합성 리뷰');
    expect(html).toContain('최종 서버 검사 필요');
    const unknown = { ...record, approval_eligibility: detailRequired };
    const summary = renderToStaticMarkup(<EvaluationDetailView record={unknown} onRequestDetails={noop} />);
    expect(summary).toContain('상세 다시 확인'); expect(summary).not.toContain('평가값 또는 근거가 비어 있습니다.');
  });
});
