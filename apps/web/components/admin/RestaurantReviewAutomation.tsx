'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EvaluationRowDetails } from '@/components/admin/EvaluationRowDetails';
import { normalizeEvaluationRecord } from '@/lib/admin/normalize-evaluation-record';
import type { EvaluationRecord } from '@/types/evaluation';
import { parseReviewAutomationSnapshot, parseReviewAutomationPreview, type ReviewAutomationSnapshot as Snapshot, type ReviewAutomationPreview as Preview, type ReviewGeminiDecision, type ReviewEvidenceCode } from '@/lib/admin/restaurant-review-automation';

const REASONS: Record<string, string> = {
  all_checks_passed: '필수 조건 통과', admin_or_terminal: '관리자 수정·기존 결정 보호', not_a_target: '추출 대상 아님',
  database_or_identity_conflict: '데이터 충돌', name_requires_review: '상호 확인 필요', location_requires_review: '주소·좌표 확인 필요',
  location_evidence_incomplete: '위치 근거 부족', independent_location_evidence_required: '독립 위치 근거 부족',
  missing_evaluation: '평가값 재검수', missing_basis: '평가 근거 재검수', evaluation_failed: '평가 조건 미충족',
  source_incomplete: '원본 정보 부족', duplicate_requires_review: '중복 확인 필요', worker_lease_expired: '실행 결과 확인 필요',
  source_changed: '원본 변경으로 취소', source_unavailable: '재검수 원본 없음', evaluation_incomplete: '재검수 근거 부족',
  evaluation_failed_worker: '재검수 실패', worker_timeout: '재검수 시간 초과', result_invalid: '결과 검증 실패',
  gemini_decision_required: 'Gemini 판단 대기', gemini_approved: 'Gemini 검수 승인', gemini_hold: 'Gemini 보류 권장',
  gemini_recheck_required: '추가 근거 필요', gemini_decision_invalid: '판단 결과 확인 필요', gemini_decision_incomplete: '판단 근거 부족', daily_limit: '하루 승인 한도 도달',
};
const STATES: Record<string, string> = { applied: '분류 완료', queued: '재검수 대기', running: '재검수 중', succeeded: '재검수 완료', failed: '확인 필요', cancelled: '취소됨' };
const DECISIONS: Record<string, string> = { approve: '승인', hold: '보류', recheck: '재검수', protected: '보호', blocked: '적용 차단', deferred: '한도 대기' };
const EVIDENCE: Record<ReviewEvidenceCode, string> = { visit_supported: '방문 근거', identity_supported: '상호 일치', review_grounded: '리뷰 근거', category_supported: '카테고리 일치', location_corroborated: '위치 교차 확인', source_consistent: '원본 일치', insufficient_evidence: '근거 부족', identity_conflict: '상호 충돌', location_conflict: '위치 충돌', review_unfaithful: '리뷰 불일치', category_conflict: '카테고리 충돌', source_conflict: '원본 충돌' };
const endpoint = '/api/admin/evaluations/automation';

export function RestaurantReviewAutomation({ onApplied, controlsTarget }: { onApplied: () => void; controlsTarget?: HTMLElement | null }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batch, setBatch] = useState(50);
  const [daily, setDaily] = useState(50);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<EvaluationRecord | null>(null);
  const [detailDecision, setDetailDecision] = useState<ReviewGeminiDecision | null>(null);
  const detailRequest = useRef(0);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const lastRun = useRef<string | null | undefined>(undefined);
  const applied = useRef(onApplied);
  useEffect(() => { applied.current = onApplied; }, [onApplied]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal });
      if (!response.ok) throw new Error('unavailable');
      const value = parseReviewAutomationSnapshot(await response.json());
      if (signal?.aborted) return;
      if (lastRun.current !== undefined && lastRun.current !== value.policy.last_run_at) applied.current();
      lastRun.current = value.policy.last_run_at;
      setSnapshot(value); setError('');
    } catch {
      if (!signal?.aborted) setError('자동 운영 상태를 불러오지 못했습니다.');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => { if (document.visibilityState === 'visible') void load(controller.signal); };
    const interval = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  async function send(body: Record<string, unknown>) {
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        if (response.status === 503) {
          const result: unknown = await response.json().catch(() => null);
          if (result && typeof result === 'object' && 'error' in result && result.error === 'AUTOMATION_GEMINI_JUDGMENT_REQUIRED') throw new Error('gemini-required');
        }
        throw new Error(response.status === 409 ? 'stale' : 'failed');
      }
      const value = await response.json();
      if (String(body.action).startsWith('preview')) {
        const next = parseReviewAutomationPreview(value);
        if (body.action !== 'preview' && `preview-${next.action}` !== body.action) throw new Error('failed');
        setPreview(next);
      }
      else { const next = parseReviewAutomationSnapshot(value); lastRun.current = next.policy.last_run_at; setSnapshot(next); setPreview(null); if (body.action === 'run') requestId.current = null; applied.current(); }
    } catch (cause) {
      await load();
      setError(cause instanceof Error && cause.message === 'gemini-required' ? 'Gemini 검수 연결을 확인한 뒤 실행하세요.' : cause instanceof Error && cause.message === 'stale' ? '검수 데이터가 바뀌었습니다. 미리보기를 다시 확인하세요.' : '결과를 확인하지 못했습니다. 상태를 새로고침한 뒤 확인하세요.');
      // The run id survives an uncertain response. Subsequent attempts read the
      // same durable run, rather than creating a second mutation.
    } finally { inFlight.current = false; setBusy(false); }
  }
  const policy = snapshot?.policy;
  const recent = snapshot?.runs[0];
  async function inspect(id: string, decision?: ReviewGeminiDecision | null) {
    const sequence = ++detailRequest.current;
    try {
      const response = await fetch(`/api/admin/evaluations/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const value = await response.json();
      const record = normalizeEvaluationRecord(value.record);
      if (!record) throw new Error('invalid');
      if (sequence !== detailRequest.current) return;
      setDetailDecision(decision ?? null); setDetail(record);
    } catch { if (sequence === detailRequest.current) setError('검수 상세를 불러오지 못했습니다.'); }
  }
  const controls = <div className="admin-review-automation-controls flex flex-wrap items-center gap-x-2 gap-y-1 [&_button]:min-h-11 [&_button]:min-w-11 sm:[&_button]:min-h-9 sm:[&_button]:min-w-0" role="region" aria-label="맛집 검수 자동 운영">
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-xs font-medium">자동 운영</span>
        <span className="text-xs text-muted-foreground" role="status">{policy ? snapshot?.judgmentEngine ? policy.enabled ? 'Gemini 검수 켜짐' : '중지됨' : `${policy.enabled ? '켜짐' : '중지됨'} · 판단 연결 미확인` : '상태 확인 중'}</span>
      </span>
      {!controlsTarget && recent && <span className="text-xs tabular-nums">최근 승인 {recent.approved} · 보류 {recent.held} · 재검수 {recent.recheck} · 보호 {recent.protected}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void load(); }} aria-label="자동 운영 상태 새로고침"><RefreshCw className="h-4 w-4" /></Button>
        {policy?.enabled ? <>
          <Button variant="outline" size="sm" disabled={busy || !snapshot?.judgmentEngine} onClick={() => { void send({ action: 'preview-run' }); }}>지금 실행</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { void send({ action: 'preview-stop' }); }}><Pause className="mr-1 h-3.5 w-3.5" />중지</Button>
        </> : <Button size="sm" disabled={busy || !policy || !snapshot?.judgmentEngine} onClick={() => { setExpanded(true); }}><Play className="mr-1 h-3.5 w-3.5" />설정</Button>}
        <Button variant="ghost" size="sm" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>이력·정책</Button>
      </div>
    </div>;
  return <section className={controlsTarget
    ? "admin-review-automation-details shrink-0 bg-card [&_button]:min-h-11 [&_button]:min-w-11 sm:[&_button]:min-h-9 sm:[&_button]:min-w-0"
    : "shrink-0 border-b border-border bg-card px-3 py-2 [&_button]:min-h-11 [&_button]:min-w-11 sm:[&_button]:min-h-9 sm:[&_button]:min-w-0"} aria-label="맛집 검수 자동 운영 상세">
    {controlsTarget ? createPortal(controls, controlsTarget) : controls}
    {error && <p className="px-3 py-2 text-xs text-destructive" role="alert">{error}</p>}
    {expanded && <div className={controlsTarget ? "space-y-3 border-b border-border px-3 py-3 text-xs" : "mt-3 space-y-3 text-xs"}>
      {controlsTarget && recent && <p className="tabular-nums">최근 승인 {recent.approved} · 보류 {recent.held} · 재검수 {recent.recheck} · 보호 {recent.protected}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">회당 처리 (1–200)<Input type="number" min={1} max={200} value={batch} disabled={busy || policy?.enabled} onChange={event => setBatch(Number(event.target.value))} className="h-11 w-28 sm:h-8" /></label>
        <label className="space-y-1">하루 승인 (1–200)<Input type="number" min={1} max={200} value={daily} disabled={busy || policy?.enabled} onChange={event => setDaily(Number(event.target.value))} className="h-11 w-28 sm:h-8" /></label>
        {!policy?.enabled && <Button size="sm" disabled={busy || !policy || !snapshot?.judgmentEngine || !Number.isInteger(batch) || batch < 1 || batch > 200 || !Number.isInteger(daily) || daily < 1 || daily > 200} onClick={() => { void send({ action: 'preview', batchSize: batch, dailyLimit: daily }); }}>후보 미리보기</Button>}
        {policy?.enabled && <span>적용 정책: 회당 {policy.batch_size}건 · 하루 승인 {policy.daily_limit}건</span>}
      </div>
      {snapshot && <p>재검수 대기 {snapshot.queue.queued} · 실행 {snapshot.queue.running} · 확인 필요 {snapshot.queue.failed}</p>}
      {snapshot && snapshot.items.length > 0 && <ul className="grid gap-1 sm:grid-cols-2">{snapshot.items.slice(0,6).map(item => <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded border border-border px-2 py-1.5"><button type="button" className="min-h-9 max-w-28 shrink-0 truncate text-primary underline-offset-2 hover:underline" onClick={() => { void inspect(item.restaurant_id, item.geminiDecision); }}>{item.restaurant_name || '검수 항목'}</button><span className="min-w-0 truncate">{item.state === 'failed' && item.reason === 'evaluation_failed' ? '재검수 실패' : REASONS[item.reason] ?? '추가 확인 필요'}</span><span className="ml-auto shrink-0 text-muted-foreground">{STATES[item.state] ?? '확인 필요'}</span>{item.geminiDecision && <span className="w-full text-[11px] text-muted-foreground">Gemini 권장 {DECISIONS[item.geminiDecision.recommendation]} · 처리 {item.geminiDecision.outcome ? DECISIONS[item.geminiDecision.outcome] : '미확인'}</span>}</li>)}</ul>}
      {snapshot && snapshot.runs.length > 0 && <ol className="space-y-1 text-muted-foreground">{snapshot.runs.slice(0,3).map(run => <li key={run.id}>{new Date(run.started_at).toLocaleString('ko-KR')} · 처리 {run.scanned} · 승인 {run.approved} · 보류 {run.held} · 재검수 {run.recheck} · 보호 {run.protected}</li>)}</ol>}
    </div>}
    <AlertDialog open={Boolean(preview)} onOpenChange={open => { if (!open && !inFlight.current) { setPreview(null); requestId.current = null; } }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{preview?.action === 'stop' ? '자동 운영을 중지할까요?' : preview?.action === 'run' ? '지금 검수할까요?' : '자동 승인을 시작할까요?'}</AlertDialogTitle><AlertDialogDescription>{preview?.action === 'stop'
        ? `재검수 대기 ${preview.queue?.queued ?? 0}건과 실행 ${preview.queue?.running ?? 0}건을 취소합니다. 이미 승인된 결과는 유지합니다.`
        : <>승인 후보 {preview?.counts.approve ?? 0} · 재검수 {preview?.counts.recheck ?? 0} · 보류 {preview?.counts.hold ?? 0} · 보호 {preview?.counts.protected ?? 0}. {preview?.action === 'run' ? `하루 남은 승인 ${preview.remainingApprovals ?? 0}건.` : `회당 ${preview?.batchSize}건 · 하루 승인 ${preview?.dailyLimit}건. 새 입력도 자동 처리합니다.`}</>}
        {error && <span className="mt-2 block text-destructive" role="alert">{error}</span>}
      </AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>취소</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => {
        event.preventDefault();
        if (!preview) return;
        const action = preview.action ?? 'start';
        if (action === 'run') requestId.current ??= crypto.randomUUID();
        void send({ action, version: preview.version, previewHash: preview.previewHash, batchSize: preview.batchSize, dailyLimit: preview.dailyLimit,
          confirmation: action === 'stop' ? '자동 운영 중지' : action === 'run' ? '지금 실행' : '자동 승인 시작', ...(action === 'run' ? { requestId: requestId.current } : {}) });
      }}>{preview?.action === 'stop' ? '자동 운영 중지' : preview?.action === 'run' ? '지금 실행' : '자동 승인 시작'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open) { detailRequest.current++; setDetail(null); setDetailDecision(null); } }}><DialogContent className="max-h-[85dvh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>검수 상세</DialogTitle></DialogHeader>{detailDecision && <section className="space-y-2 rounded-md border border-border p-3 text-xs" aria-label="Gemini 판단 근거"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Gemini 판단</h3><span>권장 {DECISIONS[detailDecision.recommendation]}</span><span>처리 {detailDecision.outcome ? DECISIONS[detailDecision.outcome] : '미확인'}</span><span className="ml-auto text-muted-foreground">Gemini 3.8 Flash</span></div><ul className="flex flex-wrap gap-1.5">{detailDecision.evidenceCodes.map(code => <li key={code} className="rounded border border-border px-2 py-1">{EVIDENCE[code]}</li>)}</ul>{detailDecision.decidedAt && <p className="text-muted-foreground">{new Date(detailDecision.decidedAt).toLocaleString('ko-KR')}</p>}</section>}{detail && <EvaluationRowDetails record={detail} />}</DialogContent></Dialog>
  </section>;
}
