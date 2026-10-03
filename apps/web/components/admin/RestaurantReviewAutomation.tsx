'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EvaluationRowDetails } from '@/components/admin/EvaluationRowDetails';
import { normalizeEvaluationRecord } from '@/lib/admin/normalize-evaluation-record';
import type { EvaluationRecord } from '@/types/evaluation';
import { parseReviewAutomationSnapshot, parseReviewAutomationPreview, type ReviewAutomationSnapshot as Snapshot, type ReviewAutomationPreview as Preview } from '@/lib/admin/restaurant-review-automation';

const REASONS: Record<string, string> = {
  all_checks_passed: '필수 조건 통과', admin_or_terminal: '관리자 수정·기존 결정 보호', not_a_target: '추출 대상 아님',
  database_or_identity_conflict: '데이터 충돌', name_requires_review: '상호 확인 필요', location_requires_review: '주소·좌표 확인 필요',
  location_evidence_incomplete: '위치 근거 부족', independent_location_evidence_required: '독립 위치 근거 부족',
  missing_evaluation: '평가값 재검수', missing_basis: '평가 근거 재검수', evaluation_failed: '평가 조건 미충족',
  source_incomplete: '원본 정보 부족', duplicate_requires_review: '중복 확인 필요', worker_lease_expired: '실행 결과 확인 필요',
  source_changed: '원본 변경으로 취소', source_unavailable: '재검수 원본 없음', evaluation_incomplete: '재검수 근거 부족',
  evaluation_failed_worker: '재검수 실패', worker_timeout: '재검수 시간 초과', result_invalid: '결과 검증 실패',
};
const STATES: Record<string, string> = { applied: '분류 완료', queued: '재검수 대기', running: '재검수 중', succeeded: '재검수 완료', failed: '확인 필요', cancelled: '취소됨' };
const endpoint = '/api/admin/evaluations/automation';

export function RestaurantReviewAutomation({ onApplied }: { onApplied: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batch, setBatch] = useState(50);
  const [daily, setDaily] = useState(50);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<EvaluationRecord | null>(null);
  const requestId = useRef<string | null>(null);
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
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(response.status === 409 ? 'stale' : 'failed');
      const value = await response.json();
      if (body.action === 'preview') setPreview(parseReviewAutomationPreview(value));
      else { const next = parseReviewAutomationSnapshot(value); lastRun.current = next.policy.last_run_at; setSnapshot(next); setPreview(null); if (body.action === 'run') requestId.current = null; applied.current(); }
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'stale' ? '검수 데이터가 바뀌었습니다. 미리보기를 다시 확인하세요.' : '결과를 확인하지 못했습니다. 상태를 새로고침한 뒤 확인하세요.');
      // The run id survives an uncertain response. Subsequent attempts read the
      // same durable run, rather than creating a second mutation.
      void load();
    } finally { setBusy(false); }
  }
  const policy = snapshot?.policy;
  const recent = snapshot?.runs[0];
  async function inspect(id: string) {
    try {
      const response = await fetch(`/api/admin/evaluations/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const value = await response.json();
      const record = normalizeEvaluationRecord(value.record);
      if (!record) throw new Error('invalid');
      setDetail(record);
    } catch { setError('검수 상세를 불러오지 못했습니다.'); }
  }
  return <section className="shrink-0 border-b border-border bg-card px-3 py-2 [&_button]:min-h-11 [&_button]:min-w-11 sm:[&_button]:min-h-9 sm:[&_button]:min-w-0" aria-label="맛집 검수 자동 운영">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
      <span className="text-sm font-semibold">자동 운영</span>
      <span className="text-xs text-muted-foreground">{policy ? policy.enabled ? '자동 승인 켜짐' : '중지됨' : '상태 확인 중'}</span>
      {recent && <span className="text-xs tabular-nums">최근 승인 {recent.approved} · 보류 {recent.held} · 재검수 {recent.recheck} · 보호 {recent.protected}</span>}
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void load(); }} aria-label="자동 운영 상태 새로고침"><RefreshCw className="h-4 w-4" /></Button>
        {policy?.enabled ? <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { requestId.current ??= crypto.randomUUID(); void send({ action: 'run', requestId: requestId.current }); }}>지금 실행</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { void send({ action: 'stop', version: String(policy.version) }); }}><Pause className="mr-1 h-3.5 w-3.5" />중지</Button>
        </> : <Button size="sm" disabled={busy || !policy} onClick={() => { setExpanded(true); }}><Play className="mr-1 h-3.5 w-3.5" />설정</Button>}
        <Button variant="ghost" size="sm" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>이력·정책</Button>
      </div>
    </div>
    {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    {expanded && <div className="mt-3 space-y-3 text-xs">
      <p className="text-muted-foreground">평가와 위치 근거를 모두 통과한 항목만 승인합니다. 관리자 수정·중복·충돌은 보호하거나 보류합니다. 정기 승인과 재검수는 일일 크롤러에서 처리합니다.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">회당 처리 (1–200)<Input type="number" min={1} max={200} value={batch} disabled={busy || policy?.enabled} onChange={event => setBatch(Number(event.target.value))} className="h-11 w-28 sm:h-8" /></label>
        <label className="space-y-1">하루 승인 (1–200)<Input type="number" min={1} max={200} value={daily} disabled={busy || policy?.enabled} onChange={event => setDaily(Number(event.target.value))} className="h-11 w-28 sm:h-8" /></label>
        {!policy?.enabled && <Button size="sm" disabled={busy || !policy || !Number.isInteger(batch) || batch < 1 || batch > 200 || !Number.isInteger(daily) || daily < 1 || daily > 200} onClick={() => { void send({ action: 'preview', batchSize: batch, dailyLimit: daily }); }}>후보 미리보기</Button>}
        {policy?.enabled && <span>적용 정책: 회당 {policy.batch_size}건 · 하루 승인 {policy.daily_limit}건</span>}
      </div>
      {snapshot && <p>재검수 대기 {snapshot.queue.queued} · 실행 {snapshot.queue.running} · 확인 필요 {snapshot.queue.failed}</p>}
      {snapshot && snapshot.items.length > 0 && <ul className="grid gap-1 sm:grid-cols-2">{snapshot.items.slice(0,6).map(item => <li key={item.id} className="flex min-w-0 items-center gap-2 rounded border border-border px-2 py-1.5"><button type="button" className="min-h-9 max-w-28 shrink-0 truncate text-primary underline-offset-2 hover:underline" onClick={() => { void inspect(item.restaurant_id); }}>{item.restaurant_name || '검수 항목'}</button><span className="truncate">{item.state === 'failed' && item.reason === 'evaluation_failed' ? '재검수 실패' : REASONS[item.reason] ?? '추가 확인 필요'}</span><span className="ml-auto shrink-0 text-muted-foreground">{STATES[item.state] ?? '확인 필요'}</span></li>)}</ul>}
      {snapshot && snapshot.runs.length > 0 && <ol className="space-y-1 text-muted-foreground">{snapshot.runs.slice(0,3).map(run => <li key={run.id}>{new Date(run.started_at).toLocaleString('ko-KR')} · 처리 {run.scanned} · 승인 {run.approved} · 보류 {run.held} · 재검수 {run.recheck} · 보호 {run.protected}</li>)}</ol>}
    </div>}
    <AlertDialog open={Boolean(preview)} onOpenChange={open => { if (!open && !busy) setPreview(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>맛집 자동 승인을 시작할까요?</AlertDialogTitle><AlertDialogDescription>현재 후보: 승인 가능 {preview?.counts.approve ?? 0} · 재검수 {preview?.counts.recheck ?? 0} · 보류 {preview?.counts.hold ?? 0} · 보호 {preview?.counts.protected ?? 0}. 회당 {preview?.batchSize}건, 하루 승인 {preview?.dailyLimit}건입니다. 이후 새 입력도 같은 정책으로 처리하며 언제든 중지할 수 있습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>취소</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); if (preview) void send({ action: 'start', version: preview.version, previewHash: preview.previewHash, batchSize: preview.batchSize, dailyLimit: preview.dailyLimit, confirmation: '자동 승인 시작' }); }}>자동 승인 시작</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="max-h-[85dvh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>검수 상세</DialogTitle></DialogHeader>{detail && <EvaluationRowDetails record={detail} />}</DialogContent></Dialog>
  </section>;
}
