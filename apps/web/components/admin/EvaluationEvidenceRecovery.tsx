'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvaluationRecord } from '@/types/evaluation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getEvaluationRecoveryPlan, type EvaluationRecoveryTaskCode } from '@/lib/admin/evaluation-recovery-eligibility';
import { extractCanonicalYouTubeVideoId } from '@/lib/youtube-url';
import { RECORD_ACTION_APPLIED_EVENT, RECORD_VIEWS_INVALIDATED_EVENT } from '@/lib/admin/record-action-client';
import {
  EVALUATION_RECOVERY_ENDPOINT, RECOVERY_CONFIRMATIONS, RecoveryViewSchema, parseRecoveryJob,
  type RecoveryJob, type RecoveryRequest, type RecoveryView,
} from '@/lib/admin/evaluation-recovery';

const TASKS: Record<EvaluationRecoveryTaskCode, string> = { source_recover: '영상 원본·추출 근거', location_recover: '지점·주소 교차 근거', evaluation_recheck: '평가값·판정 근거', manual_identity_review: '상호·중복 확인', protected: '기존 결정 보호' };
const STATES: Record<RecoveryJob['state'], string> = { preview: '복구 요청 확인 대기', queued: '근거 수집 대기', running: '근거 수집 중', draft: '보강 내용 검토 대기', applied: '보강 근거 저장 완료', failed: '원본 추가 확인 필요', uncertain: '기존 처리 결과 확인 필요' };
const messages: Record<string, string> = {
  EVIDENCE_RECOVERY_NOT_ADMITTED: '관리자 변경이 보류 중입니다. 보호 설정을 유지하며 기존 이력만 확인합니다.',
  EVIDENCE_RECOVERY_POLICY_CHANGED: '검수 정책이 변경됐거나 중지됐습니다. 현재 상태를 다시 확인하세요.',
  EVIDENCE_RECOVERY_PROTECTED: '관리자 수정·기존 결정이 보호되는 항목입니다. 자동으로 덮어쓰지 않습니다.',
  EVIDENCE_RECOVERY_WORK_OUTSTANDING: '진행 중이거나 결과가 미확정인 작업이 있습니다. 기존 이력을 먼저 확인하세요.',
  EVIDENCE_RECOVERY_STALE: '원본이 변경됐습니다. 목록을 새로 조회한 뒤 다시 검토하세요.',
  EVIDENCE_RECOVERY_SOURCE_REQUIRED: '식당·영상 원본을 먼저 확인해야 합니다. 근거가 없는 상태로 승인하거나 제거하지 않습니다.',
  EVIDENCE_RECOVERY_PRIVACY_UNSAFE: '보강 내용에 공개 검수에 사용할 수 없는 정보가 있어 적용을 중단했습니다.',
};
const REASONS: Partial<Record<string, string>> = {
  source_incomplete: '원본 추출 근거를 추가로 확보해야 합니다.',
  source_original_evidence_missing: '원본 추출 근거를 추가로 확보해야 합니다.',
  source_recollect_mismatch: '기존 수집본과 원본의 버전이 달라 별도 확인이 필요합니다.',
  source_identity_mismatch: '영상·채널·식당의 출처가 일치하지 않습니다.',
  source_provider_transient: '수집 서비스의 일시적 오류로 확인을 마치지 못했습니다.',
  source_provider_unavailable: '수집 서비스에서 필요한 자료를 확인하지 못했습니다.',
  source_changed: '원본이 변경돼 수집 전 요청을 종료했습니다.',
  policy_changed: '검수 정책이 변경돼 수집 전 요청을 종료했습니다.',
  result_unconfirmed: '이전 실행 결과를 확인해야 합니다. 자동으로 재실행하지 않습니다.',
};
const errorText = (code: string) => messages[code] ?? '처리 결과를 확인하지 못했습니다. 새 요청을 만들지 말고 기존 처리 이력을 확인하세요.';
const changed = () => {
  window.dispatchEvent(new Event(RECORD_VIEWS_INVALIDATED_EVENT));
  window.dispatchEvent(new Event(RECORD_ACTION_APPLIED_EVENT));
};

/** The dialog lives beside the list, so invalidating a row never destroys its operation identity. */
export function EvaluationEvidenceRecovery({ record, onClose }: { record: EvaluationRecord | null; onClose: () => void }) {
  const [view, setView] = useState<RecoveryView | null>(null);
  const [viewReady, setViewReady] = useState(false);
  const [preview, setPreview] = useState<RecoveryJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const [unresolved, setUnresolved] = useState<RecoveryRequest | null>(null);
  const notified = useRef(new Set<string>());
  const id = record?.id;
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!id) return;
    const token = epoch.current;
    setViewReady(false);
    try {
      const response = await fetch(`${EVALUATION_RECOVERY_ENDPOINT}?restaurantId=${encodeURIComponent(id)}`, { cache: 'no-store', credentials: 'same-origin', signal });
      if (!response.ok) throw new Error('EVIDENCE_RECOVERY_UNAVAILABLE');
      const value = RecoveryViewSchema.parse(await response.json());
      if (value.restaurantId !== id || value.jobs.some(job => job.restaurantId !== id)) throw new Error('EVIDENCE_RECOVERY_UNAVAILABLE');
      if (!signal?.aborted && token === epoch.current) { setView(value); setViewReady(true); }
    } catch {
      if (!signal?.aborted && token === epoch.current) setError('근거 복구 상태를 확인하지 못했습니다. 상태를 다시 조회하세요.');
    }
  }, [id]);
  useEffect(() => {
    epoch.current++;
    setView(null); setViewReady(false); setPreview(null); setError(''); setNotice(''); setUnresolved(null);
    if (!id) return;
    const controller = new AbortController();
    void load(controller.signal);
    const interval = setInterval(() => { if (document.visibilityState === 'visible' && !inFlight.current) void load(controller.signal); }, 60_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [id, load]);

  const send = async (input: RecoveryRequest) => {
    if (inFlight.current) return;
    const token = epoch.current;
    inFlight.current = true; setBusy(true); setError('');
    if (input.phase !== 'read') setUnresolved(input);
    try {
      const response = await fetch(EVALUATION_RECOVERY_ENDPOINT, { method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const value: unknown = await response.json();
      if (!response.ok) {
        const code = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'EVIDENCE_RECOVERY_UNAVAILABLE';
        throw new Error(code);
      }
      const job = parseRecoveryJob(value, input);
      if (job.receipt?.state === 'applied' && job.receipt.action === 'restaurant.evidence_recovery.apply' && job.state === 'applied' && !notified.current.has(job.receipt.operationId)) {
        notified.current.add(job.receipt.operationId);
        changed();
      }
      if (token !== epoch.current) return;
      if (input.phase === 'preview_apply' && view?.jobs.find(item => item.jobId === job.jobId)?.resultSha256 !== job.resultSha256) throw new Error('EVIDENCE_RECOVERY_STALE');
      setUnresolved(null);
      if (job.receipt?.state === 'preview') {
        if (Date.parse(job.receipt.expiresAt) <= Date.now()) { setPreview(null); setNotice('미리보기가 만료됐습니다. 현재 원본을 새로 확인한 뒤 다시 요청하세요.'); }
        else setPreview(job);
      } else {
        setPreview(null);
        setNotice(job.state === 'applied' ? '보강 근거를 저장했습니다. 새로 조회한 원본으로 기존 승인 검사를 진행하세요.' : '처리 이력을 확인했습니다. 수집 중에도 기존 원본과 보류 상태는 유지합니다.');
      }
      await load();
    } catch (cause) {
      if (token === epoch.current) { setError(errorText(cause instanceof Error ? cause.message : '')); await load(); }
    } finally { inFlight.current = false; if (token === epoch.current) setBusy(false); }
  };

  const inspect = (job: RecoveryView['jobs'][number], apply: boolean) => {
    const operationId = apply ? job.applyOperationId : job.requestOperationId;
    if (operationId) return void send({ phase: 'read', restaurantId: job.restaurantId, jobId: job.jobId, operationId });
    if (apply) return void send({ phase: 'preview_apply', restaurantId: job.restaurantId, jobId: job.jobId, operationId: crypto.randomUUID(), policyVersion: job.policyVersion, rowSha256: job.rowSha256, inputSha256: job.inputSha256 });
  };
  const context = view?.context;
  const sameSource = Boolean(record && context && context.restaurantId === record.id && context.originName.trim() === record.origin_name?.trim()
    && context.videoId === extractCanonicalYouTubeVideoId(record.youtube_link)
    && Date.parse(context.sourceUpdatedAt) === Date.parse(record.updated_at));
  const plan = record ? getEvaluationRecoveryPlan(record) : null;
  const active = view?.jobs.some(job => ['preview', 'queued', 'running', 'draft', 'uncertain'].includes(job.state));
  const canRequest = Boolean(viewReady && record && context && sameSource && !active && !unresolved && !plan?.taskCodes.includes('protected') && record.status === 'hold');
  const draft = view?.jobs.find(job => job.state === 'draft' && job.proposal);
  const confirm = () => {
    const receipt = preview?.receipt;
    if (!preview || !receipt || receipt.state !== 'preview' || Date.parse(receipt.expiresAt) <= Date.now()) return;
    const phase = receipt.action === 'restaurant.evidence_recovery.request' ? 'request' : 'apply';
    void send({ phase, restaurantId: preview.restaurantId, jobId: preview.jobId, operationId: receipt.operationId, policyVersion: preview.policyVersion,
      rowSha256: preview.rowSha256, inputSha256: preview.inputSha256, previewHash: receipt.previewHash, confirmation: RECOVERY_CONFIRMATIONS[phase] });
  };
  return <Dialog open={Boolean(record)} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>근거 보강·처리 이력</DialogTitle><DialogDescription>{record?.origin_name || record?.name || '선택한 맛집'}의 원본을 보존하며 부족한 근거를 다시 확인합니다.</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-3 overflow-y-auto text-sm">
        {!view && !error && <p role="status">원본과 처리 이력을 확인하는 중입니다.</p>}
        {plan && <p>확인할 근거: {plan.taskCodes.length ? plan.taskCodes.map(code => TASKS[code]).join(' · ') : '현재 근거의 최종 승인 검사'}</p>}
        <p className="text-xs text-muted-foreground">요청과 수집만으로 승인·제거하지 않습니다. 보강 결과를 검토해 저장한 뒤 기존 승인·정리 절차에서 다시 확인합니다.</p>
        {view?.contextError && <p role="status">{errorText(view.contextError)}</p>}
        {context && !sameSource && <p role="alert">화면의 원본과 현재 저장된 원본이 다릅니다. 목록을 새로 조회한 뒤 요청하세요.</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {draft?.proposal && <section className="space-y-2 rounded-md border p-3" aria-label="보강 내용 미리보기">
          <h3 className="font-semibold">적용 전 보강 내용</h3>
          <dl className="space-y-1"><div><dt className="inline font-medium">주소: </dt><dd className="inline">{draft.proposal.jibun_address || draft.proposal.road_address || '미확정'}</dd></div>
            <div><dt className="inline font-medium">지도 후보: </dt><dd className="inline">{draft.proposal.naver_name || draft.proposal.google_name || '미확정'}</dd></div>
            <div><dt className="inline font-medium">좌표 확인: </dt><dd className="inline">{draft.proposal.geocoding_success ? '완료' : '미완료'}</dd></div>
            <div><dt className="inline font-medium">분류: </dt><dd className="inline">{draft.proposal.categories.join(' · ')}</dd></div></dl>
          {Object.entries(draft.proposal.evaluation_results).map(([key, metric]) => metric && typeof metric === 'object' && 'eval_basis' in metric && typeof metric.eval_basis === 'string'
            ? <p key={key} className="whitespace-pre-wrap text-xs text-muted-foreground">{metric.eval_basis}</p> : null)}
        </section>}
        {view && <ul className="space-y-2" aria-label="근거 복구 이력">{view.jobs.map(job => <li key={job.jobId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
          <div><p>{STATES[job.state]}</p>{REASONS[job.reason] && <p className="text-xs text-muted-foreground">{REASONS[job.reason]}</p>}</div><div className="flex gap-2">
            {job.state === 'preview' && <Button size="sm" variant="outline" disabled={busy} onClick={() => inspect(job, false)}>기존 요청 확인</Button>}
            {job.state === 'draft' && <Button size="sm" variant="outline" disabled={busy || !viewReady || Boolean(unresolved)} onClick={() => inspect(job, true)}>보강 내용 확인</Button>}
            {job.state === 'applied' && <Button size="sm" variant="outline" disabled={busy} onClick={() => inspect(job, true)}>적용 결과 확인</Button>}
          </div></li>)}</ul>}
        {preview?.receipt && <div className="space-y-2 rounded-md border border-primary p-3" role="region" aria-label="근거 복구 확인">
          <p>{preview.receipt.action === 'restaurant.evidence_recovery.request' ? '이 맛집의 현재 영상·원본에 한정해 근거 복구를 요청합니다. 기존 보류 상태는 유지합니다.' : '위에서 확인한 보강 근거를 저장합니다. 이 단계에서는 승인하거나 제거하지 않습니다.'}</p>
          <Button disabled={busy} onClick={confirm}>{preview.receipt.action === 'restaurant.evidence_recovery.request' ? '근거 복구 요청' : '보강 근거 저장'}</Button>
        </div>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => { setError(''); void load(); }}>상태 새로 조회</Button>
        {unresolved && <Button variant="outline" disabled={busy} onClick={() => { const prior = unresolved; if (prior) void send({ phase: 'read', restaurantId: prior.restaurantId, jobId: prior.jobId, operationId: prior.operationId }); }}>기존 처리 결과 확인</Button>}
        <Button disabled={busy || !canRequest} onClick={() => { if (!context || !record) return; void send({ phase: 'preview_request', restaurantId: record.id, jobId: crypto.randomUUID(), operationId: crypto.randomUUID(), policyVersion: context.policyVersion, rowSha256: context.rowSha256, inputSha256: context.inputSha256 }); }}>근거 복구 내용 확인</Button>
        <Button variant="ghost" disabled={busy} onClick={onClose}>닫기</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
