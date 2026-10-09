'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRecordActionClient, RECORD_VIEWS_INVALIDATED_EVENT, RECORD_ACTION_APPLIED_EVENT } from './record-action-client';
import { RECORD_ACTION_CONFIRMATION, type RecordActionReceipt } from './record-action-contract';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';

const labels: Record<string, string> = {
  restaurant: '맛집', submission: '제보', item: '영상 항목', review: '리뷰', recommendation: '추천',
  approve: '승인', reject: '반려', delete: '삭제', restore: '복원', edit: '수정', create: '등록', register_missing: '누락 등록', merge: '병합', hold: '보류',
  pending: '대기', hold_status: '보류', approved: '승인', partially_approved: '일부 승인', rejected: '반려', deleted: '삭제',
  reason: '사유', note: '메모', changes: '변경 내용', items: '항목', itemChanges: '영상 변경', decision: '처리', id: '항목 ID',
  perTargetChanges: '영상별 수정', removeIds: '제외할 영상', additions: '추가할 영상', mergeTargetId: '병합 대상', incomingChanges: '새 영상 변경',
  approved_name: '맛집 이름', restaurant_name: '맛집 이름', phone: '전화', restaurant_phone: '전화', categories: '분류', restaurant_categories: '분류',
  youtube_link: '영상 링크', tzuyang_review: '영상 리뷰', road_address: '도로명 주소', jibun_address: '지번 주소', english_address: '영문 주소', restaurant_address: '주소',
  address_elements: '주소 정보', lat: '위도', lng: '경도', geocoding_success: '주소 확인', youtube_meta: '영상 정보', title: '영상 제목',
  published_at: '게시일', duration: '길이(초)', is_shorts: '쇼츠', is_ads: '광고', what_ads: '광고 내용',
};
function ProposedValue({ value }: { value: unknown }) {
  if (value === null) return <span>비움</span>;
  if (typeof value === 'boolean') return <span>{value ? '예' : '아니오'}</span>;
  if (Array.isArray(value) && value.length === 0) return <span>없음</span>;
  if (Array.isArray(value)) return <ol className="space-y-2">{value.map((item, index) => <li key={index}><ProposedValue value={item} /></li>)}</ol>;
  if (value && typeof value === 'object') return <dl className="space-y-1">{Object.entries(value).map(([key, item]) => <div key={key} className="min-w-0 border-l pl-2"><dt className="text-xs text-muted-foreground">{labels[key] ?? key}</dt><dd className="whitespace-pre-wrap break-all text-sm"><ProposedValue value={item} /></dd></div>)}</dl>;
  return <span>{typeof value === 'string' ? labels[value] ?? value : String(value)}</span>;
}

export function useRecordAction(onRecovered: (receipt: RecordActionReceipt) => void, options: { recover?: boolean } = {}) {
  const { user, isAdmin } = useAuth();
  const [binding, setBinding] = useState<string | null>(null);
  const [client] = useState(() => createRecordActionClient({
    actor: null,
    onInvalidate: () => window.dispatchEvent(new Event(RECORD_VIEWS_INVALIDATED_EVENT)),
    onApplied: () => window.dispatchEvent(new Event(RECORD_ACTION_APPLIED_EVENT)),
    storage: {
      getItem: key => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
      removeItem: key => window.sessionStorage.removeItem(key),
    },
  }));
  useEffect(() => { client.setOnRecovered(onRecovered); }, [client, onRecovered]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => {
    let current = true;
    client.setActor(null); setBinding(null);
    if (user?.id && isAdmin) {
      // Domain-separated opaque binding; no email, session token or payload enters WebStorage.
      void crypto.subtle.digest('SHA-256', new TextEncoder().encode(`admin-record-recovery:v2:${user.id}`)).then(bytes => {
        if (!current) return;
        const value = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
        client.setActor(value); setBinding(value);
      }).catch(() => { /* No usable binding means fail closed. */ });
    }
    return () => { current = false; client.setActor(null); };
  }, [client, user?.id, isAdmin]);
  useEffect(() => { if (binding && options.recover) void client.recover(); }, [client, binding, options.recover]);
  useEffect(() => { setConfirmation(''); }, [state.request?.operationId]);
  const parts = (state.request?.action ?? state.receipt?.action ?? '').split('.');
  const canCancel = client.canCancel() && !['checking', 'applying'].includes(state.phase);
  return {
    run: client.run,
    busy: state.phase !== 'idle',
    dialog: <Dialog open={state.phase !== 'idle'} onOpenChange={open => { if (!open && canCancel) client.cancel(); }}>
      <DialogContent className={`flex max-h-[90dvh] max-w-xl flex-col overflow-hidden ${canCancel ? '' : '[&>button:last-child]:hidden'}`} onEscapeKeyDown={event => { if (!canCancel) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()} aria-busy={['previewing', 'applying', 'checking'].includes(state.phase)}>
        <DialogHeader><DialogTitle className="text-base font-semibold leading-6">{parts.map(part => labels[part] ?? part).join(' ') || '이전 작업'} 확인</DialogTitle>
          <DialogDescription>현재 상태와 변경 내용을 확인한 뒤 “{RECORD_ACTION_CONFIRMATION}”을 입력하세요.</DialogDescription></DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto text-sm" data-record-action-preview>
          {state.phase === 'previewing' && <p role="status">현재 상태 확인 중…</p>}
          {state.receipt && <section aria-label="서버 확인 상태"><div className="font-medium">현재 상태</div><ul className="mt-1 space-y-1">{state.receipt.readback.map(row => <li key={`${row.kind}:${row.id}`} className="flex flex-wrap items-center gap-x-2 border-b py-1"><span>{labels[row.kind] ?? '항목'}</span><code className="break-all text-xs">{row.id}</code><span>{labels[row.status] ?? '미확인'}</span></li>)}</ul></section>}
          {state.request && Object.keys(state.request.payload).length > 0 && <section aria-label="적용할 변경"><div className="mb-1 font-medium">적용할 변경</div><ProposedValue value={state.request.payload} /></section>}
          {state.receipt?.auditId && <p className="break-all text-xs text-muted-foreground">감사 ID: {state.receipt.auditId}</p>}
          {state.message && <p role="alert" className="text-destructive">{state.message}</p>}
          {state.phase === 'confirming' && <Input aria-label="변경 적용 확인 문구" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={RECORD_ACTION_CONFIRMATION} />}
          {['applying', 'checking'].includes(state.phase) && <p role="status">{state.phase === 'applying' ? '적용 중…' : '기존 작업 결과 조회 중…'}</p>}
        </div>
        <DialogFooter>
          {canCancel && <Button variant="outline" onClick={client.cancel}>{state.phase === 'failed' ? '닫기' : '취소'}</Button>}
          {state.phase === 'confirming' && <Button disabled={confirmation !== RECORD_ACTION_CONFIRMATION} onClick={() => void client.apply(confirmation)}>변경 적용</Button>}
          {state.phase === 'failed' && state.nextAction === 'review-duplicates' && <Button asChild><a href="/admin?module=restaurants" onClick={client.cancel}>중복 후보 검토</a></Button>}
          {state.phase === 'uncertain' && <Button onClick={() => void client.readback()}>기존 작업 결과 조회</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  };
}
