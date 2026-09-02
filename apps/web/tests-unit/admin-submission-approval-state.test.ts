import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getSubmissionApprovalState, type SubmissionApprovalStateInput } from '../lib/admin/submission-approval-state';

const webRoot = path.resolve(import.meta.dir, '..');

function source(relativePath: string) {
  return readFileSync(path.join(webRoot, relativePath), 'utf8');
}

const allClearInput = (overrides: Partial<SubmissionApprovalStateInput> = {}): SubmissionApprovalStateInput => ({
  requestState: 'pending',
  submissionType: 'new',
  forceApprove: false,
  editableName: '한추',
  editableAddress: '서울 강남구 논현로175길 68',
  selectedGeocodingIndex: 0,
  geocodingResults: [{
    road_address: '서울 강남구 논현로175길 68',
    jibun_address: '서울 강남구 신사동 549-9',
    x: '127.027621',
    y: '37.524312',
  }],
  approvalData: {
    lat: '37.524312',
    lng: '127.027621',
    road_address: '서울 강남구 논현로175길 68',
    jibun_address: '서울 강남구 신사동 549-9',
  },
  localSearchEvidence: [{
    title: '한추',
    address: '서울 강남구 신사동 549-9',
    roadAddress: '서울 강남구 논현로175길 68',
    isMatch: true,
  }],
  items: [{ id: 'item-1', item_status: 'pending' }],
  itemDecisions: {
    'item-1': {
      approved: true,
      metaFetched: true,
      metaData: { title: 'video' },
    },
  },
  ...overrides,
});

describe('submission approval state contract', () => {
  test('blocks missing geocode selection and approval coordinates', () => {
    const state = getSubmissionApprovalState(allClearInput({
      selectedGeocodingIndex: null,
      approvalData: { lat: '', lng: '', road_address: '', jibun_address: '' },
    }));

    expect(state.canApprove).toBe(false);
    expect(state.blockers).toContain('지오코딩 결과를 선택해야 합니다.');
    expect(state.blockers).toContain('선택한 지오코딩 결과의 승인 좌표가 필요합니다.');
    expect(state.nextAction).toBe('지오코딩을 실행하고 주소 후보를 선택하세요.');
  });

  test('blocks when no pending item is selected for approval', () => {
    const state = getSubmissionApprovalState(allClearInput({
      itemDecisions: { 'item-1': { approved: false, metaFetched: true } },
    }));

    expect(state.canApprove).toBe(false);
    expect(state.blockers).toEqual(['승인할 항목을 하나 이상 선택해야 합니다.']);
  });
  test('blocks when the submission has no pending items left to approve', () => {
    const state = getSubmissionApprovalState(allClearInput({
      items: [{ id: 'item-1', item_status: 'approved' }],
    }));

    expect(state.canApprove).toBe(false);
    expect(state.blockers).toEqual(['승인할 대기 항목이 없습니다.']);
    expect(state.nextAction).toBe('대기 중인 항목이 있는 제보를 선택하세요.');
  });

  test('blocks missing YouTube metadata for approved items', () => {
    const state = getSubmissionApprovalState(allClearInput({
      itemDecisions: { 'item-1': { approved: true, metaFetched: false, metaData: null } },
    }));

    expect(state.canApprove).toBe(false);
    expect(state.blockers).toContain('승인 항목의 YouTube 메타데이터가 필요합니다.');
  });

  test('blocks missing editable name and address', () => {
    const state = getSubmissionApprovalState(allClearInput({
      editableName: ' ',
      editableAddress: '',
    }));

    expect(state.canApprove).toBe(false);
    expect(state.blockers).toContain('맛집명을 입력해야 합니다.');
    expect(state.blockers).toContain('주소를 입력해야 합니다.');
    expect(state.nextAction).toBe('맛집명을 입력하세요.');
  });

  test('blocks missing Naver local-search match', () => {
    const state = getSubmissionApprovalState(allClearInput({
      localSearchEvidence: [{ title: '다른 식당', address: '서울 어딘가', isMatch: false }],
    }));

    expect(state.canApprove).toBe(false);
    expect(state.blockers).toContain('네이버 로컬 검색 일치 증거가 필요합니다.');
    expect(state.nextAction).toBe('네이버 검색 검증을 실행하고 일치 결과를 확보하세요.');
  });

  test('force approve converts missing local-search match to an audit hint', () => {
    const state = getSubmissionApprovalState(allClearInput({
      forceApprove: true,
      localSearchEvidence: [],
    }));

    expect(state.canApprove).toBe(true);
    expect(state.blockers).toEqual([]);
    expect(state.auditHints).toEqual(['무시승인: 네이버 로컬 검색 일치 증거 없이 관리자 확인으로 승인합니다.']);
  });

  test('blocks rejected and non-pending request states', () => {
    const rejected = getSubmissionApprovalState(allClearInput({ requestState: 'rejected' }));
    const approved = getSubmissionApprovalState(allClearInput({ requestState: 'approved' }));

    expect(rejected.canApprove).toBe(false);
    expect(approved.canApprove).toBe(false);
    expect(rejected.blockers).toContain('대기 중인 제보만 승인할 수 있습니다.');
    expect(approved.blockers).toContain('대기 중인 제보만 승인할 수 있습니다.');
  });

  test('recommendation approvals require confirmation and skip item/geocode evidence', () => {
    const missingConfirmation = getSubmissionApprovalState({
      requestState: 'pending',
      submissionType: 'recommend',
      recommendationApprovalConfirmed: false,
    });
    const confirmed = getSubmissionApprovalState({
      requestState: 'pending',
      submissionType: 'recommend',
      recommendationApprovalConfirmed: true,
    });

    expect(missingConfirmation.canApprove).toBe(false);
    expect(missingConfirmation.blockers).toEqual(['추천 승인 확인 문구가 필요합니다.']);
    expect(confirmed.canApprove).toBe(true);
    expect(confirmed.blockers).toEqual([]);
  });

  test('allows all-clear approval when every evidence input is present', () => {
    const state = getSubmissionApprovalState(allClearInput());

    expect(state).toEqual({
      canApprove: true,
      blockers: [],
      nextAction: '승인할 수 있습니다.',
      auditHints: [],
    });
  });

  test('submission approval audit notes preserve force and browser evidence provenance', () => {
    const listSource = source('components/admin/SubmissionListView.tsx');
    const pageSource = source('app/admin/evaluations/admin-evaluation-page.tsx');

    expect(listSource).toContain('submission-approval-state:v1');
    expect(listSource).toContain('browser-local-search-evidence:not-backend-truth');
    expect(listSource).toContain('buildApprovalAuditNote()');
    expect(pageSource).not.toContain('void forceApprove');
    expect(pageSource).toContain('admin_notes: approvalAuditNote');
    expect(pageSource).toContain('forceApprove=true');
    expect(pageSource).toContain('itemRejectionError');
  });
});
