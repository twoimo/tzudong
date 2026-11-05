import React from 'react';
import { parseApprovalEligibility, type ApprovalEligibility, type ApprovalEligibilityReason } from '@/lib/admin/evaluation-approval-eligibility';

const REASON_TEXT: Record<ApprovalEligibilityReason, { label: string; remedy: string }> = {
  INVALID_RAW_RECORD: { label: '검사할 상세 데이터가 올바르지 않습니다.', remedy: '상세 다시 확인' },
  DETAIL_REQUIRED: { label: '상세 데이터가 필요합니다.', remedy: '상세 다시 확인' },
  INPUT_LIMIT_EXCEEDED: { label: '현재 상세 데이터의 검사 범위를 넘었습니다.', remedy: '상세 다시 확인' },
  STATUS_UNKNOWN: { label: '현재 처리 상태를 확인할 수 없습니다.', remedy: '상세 다시 확인' },
  STATUS_NOT_APPROVABLE: { label: '현재 상태는 수동 승인 대상이 아닙니다.', remedy: '처리 상태 확인' },
  NOT_A_TARGET: { label: '누락 또는 평가 미대상으로 표시되어 있습니다.', remedy: '누락 등록·대상 확인' },
  DATABASE_OR_IDENTITY_CONFLICT: { label: '데이터 또는 식별 정보 충돌이 남아 있습니다.', remedy: '충돌 해결·상세 확인' },
  NAME_REQUIRES_REVIEW: { label: '원본·지도·매칭 상호가 일치하지 않습니다.', remedy: '주소/이름 수정' },
  NAME_TOO_LONG: { label: '적용할 이름이 160자를 넘습니다.', remedy: '주소/이름 수정' },
  LOCATION_REQUIRES_REVIEW: { label: '주소 변환·좌표·지번 주소 확인이 필요합니다.', remedy: '주소/이름 수정' },
  LOCATION_EVIDENCE_INCOMPLETE: { label: '위치 판정이 미완료이거나 보류 사유가 남아 있습니다.', remedy: '주소/이름 수정·위치 근거 확인' },
  LOCATION_IDENTITY_MISMATCH: { label: '위치 근거의 원본 상호가 현재 원본과 다릅니다.', remedy: '주소/이름 수정·위치 근거 확인' },
  INDEPENDENT_LOCATION_EVIDENCE_REQUIRED: { label: '독립적인 위치 근거가 두 종류 이상 필요합니다.', remedy: '위치 근거 재평가 필요' },
  MISSING_EVALUATION: { label: '평가값이 없거나 형식이 올바르지 않습니다.', remedy: '근거 재평가 필요' },
  MISSING_BASIS: { label: '필수 평가 근거가 비어 있습니다.', remedy: '근거 재평가 필요' },
  EVALUATION_FAILED: { label: '평가값이 승인 기준을 통과하지 못했습니다.', remedy: '근거 재평가 필요' },
  CATEGORIES_INVALID: { label: '카테고리 목록·중복을 확인해야 합니다.', remedy: '수정 화면에서 카테고리 확인' },
  SOURCE_INCOMPLETE: { label: '원본 리뷰 또는 추적 정보가 부족합니다.', remedy: '원본 근거 재확인 필요' },
  CANONICAL_YOUTUBE_URL_REQUIRED: { label: '영상 URL이 저장 형식과 맞지 않습니다.', remedy: '수정 화면에서 영상 링크 확인' },
};

export interface EvaluationApprovalReasonsProps {
  eligibility?: ApprovalEligibility;
  id?: string;
  onRequestDetails?: () => void;
  loading?: boolean;
}

/** Fixed labels only. Native disclosure works with keyboard and touch. */
export function EvaluationApprovalReasons({ eligibility, id, onRequestDetails, loading }: EvaluationApprovalReasonsProps) {
  const checked = parseApprovalEligibility(eligibility) ?? {
    state: 'unknown', reasons: ['DETAIL_REQUIRED'], requiresFinalServerValidation: true,
  } satisfies ApprovalEligibility;
  return (
    <div id={id} role="group" aria-label="승인 사전검사" data-approval-state={checked.state} className="mt-2 min-w-0 space-y-1 text-left text-xs leading-5">
      {checked.state === 'local_checks_passed' ? (
        <p>로컬 검사 통과 · 최종 서버 검사 필요</p>
      ) : (
        <>
          <details onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
            <summary className="cursor-pointer rounded px-1 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
              {checked.state === 'blocked' ? '승인 불가' : '상세 확인 필요'} · 사유 {checked.reasons.length}개
            </summary>
            <ul className="space-y-2 break-keep border-l pl-2">
              {checked.reasons.map(reason => (
                <li key={reason}>
                  <p>{REASON_TEXT[reason].label}</p>
                  <p className="text-muted-foreground">{REASON_TEXT[reason].remedy}</p>
                </li>
              ))}
            </ul>
          </details>
          {checked.state === 'unknown' && (onRequestDetails ? (
            <button type="button" disabled={loading} className="min-h-11 rounded border px-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              onClick={event => { event.stopPropagation(); onRequestDetails(); }}>
              상세 다시 확인
            </button>
          ) : <p>상세를 다시 열어 최신 정보를 확인하세요.</p>)}
        </>
      )}
    </div>
  );
}
