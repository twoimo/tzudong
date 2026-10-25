"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ThumbnailBrowserQueue, ThumbnailBrowserQueueError, type ThumbnailBrowserDraft,
  type ThumbnailBrowserState } from '@/lib/admin/youtube-thumbnail-generator/browser-queue';
import { prepareThumbnailBrowserReferences, ThumbnailReferencePreparationError } from '@/lib/admin/youtube-thumbnail-generator/browser-references';
import { thumbnailUuid, thumbnailBrief, thumbnailEditorDocument, type ThumbnailJob } from '@/lib/admin/youtube-thumbnail-generator/queue-contract';
import type { z } from 'zod';
import type { thumbnailSummary } from '@/lib/admin/youtube-thumbnail-generator/queue-contract';

export type ThumbnailGeminiHistory = z.infer<typeof thumbnailSummary>;
const idle: ThumbnailBrowserState = { handle: null, job: null, phase: 'idle' };
export function thumbnailGeminiMessage(error: unknown) {
  if (error instanceof ThumbnailReferencePreparationError) return error.code === 'host_reference_required'
    ? '쯔양 참고 영상을 찾지 못했습니다. 인물 참고 이미지를 첨부하거나 수집 상태를 확인해 주세요.'
    : '참고 이미지를 확인해 주세요. 최대 8개, 합계 16MB까지 사용할 수 있습니다.';
  if (error instanceof ThumbnailBrowserQueueError) {
    if (error.code === 'busy') return '작업 상태를 확인 중입니다. 잠시 후 다시 확인해 주세요.';
    if (error.code === 'unresolved_request') return '이전 요청을 먼저 확인해 주세요. 접수 결과를 확인하기 전에는 다시 생성하지 않습니다.';
    if (error.code === 'receipt_unavailable') return '작업 기록 또는 브라우저 잠금을 사용할 수 없습니다. 브라우저 설정을 확인해 주세요.';
    if (error.code === 'invalid_input' || error.code === 'rejected_input') return '주제·문구·참고 이미지를 확인해 주세요.';
  }
  return '작업 상태를 확인하지 못했습니다. 다시 확인해 주세요. 생성 요청을 재전송하지는 않습니다.';
}

export function useThumbnailGeminiQueue() {
  const { user, isAdmin } = useAuth(); const owner = user?.id;
  const queue = useRef<ThumbnailBrowserQueue | null>(null);
  const ownerRef = useRef(owner);
  useLayoutEffect(() => { ownerRef.current = owner; }, [owner]);
  const [state, setState] = useState<ThumbnailBrowserState>(idle);
  const [history, setHistory] = useState<ThumbnailGeminiHistory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [available, setAvailable] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyRead = useRef(0);

  const refreshHistory = useCallback(async (more = false) => {
    const q = queue.current; if (!q) return;
    const read = ++historyRead.current; setHistoryLoading(true);
    const last = more ? history.at(-1) : undefined;
    try {
      const page = await q.history(last ? { beforeCreatedAt: last.createdAt, beforeId: last.id } : undefined);
      if (queue.current !== q || read !== historyRead.current) return;
      setHistory((old) => more ? [...old, ...page.filter((row) => !old.some((entry) => entry.id === row.id))] : page);
      setHasMore(page.length === 32); setHistoryError(null); setAvailable(true);
    } catch (failure) { if (queue.current === q && read === historyRead.current) { setHistoryError(thumbnailGeminiMessage(failure)); setAvailable(false); } }
    finally { if (queue.current === q && read === historyRead.current) setHistoryLoading(false); }
  }, [history]);

  const refresh = useCallback(async () => {
    const q = queue.current; if (!q) return null;
    try { const job = await q.resume(); if (queue.current === q) setError(null); return job; }
    catch (failure) { if (queue.current === q) setError(thumbnailGeminiMessage(failure)); return null; }
  }, []);

  useEffect(() => {
    queue.current = null;
    setState(idle); setHistory([]); setError(null); setHistoryError(null); setAvailable(false); setHistoryLoading(false);
    if (!isAdmin || !thumbnailUuid.safeParse(owner).success) return;
    let current = true;
    const storageChanged = (event: StorageEvent) => {
      if (event.key === `thumbnail-gemini-request:${owner}`) void refresh();
    };
    window.addEventListener('storage', storageChanged);
    try {
      const q = new ThumbnailBrowserQueue({ ownerId: owner!, storage: window.localStorage,
        changed: (next) => { if (current) setState(next); } });
      queue.current = q; setState(q.state);
      const read = ++historyRead.current; setHistoryLoading(true);
      void q.history().then((page) => {
        if (!current || read !== historyRead.current) return; setHistory(page); setHasMore(page.length === 32); setAvailable(true);
      }, (failure: unknown) => { if (current && read === historyRead.current) setHistoryError(thumbnailGeminiMessage(failure)); })
        .finally(() => { if (current && read === historyRead.current) setHistoryLoading(false); });
      if (q.state.handle) void refresh();
    } catch (failure) { setError(thumbnailGeminiMessage(failure)); }
    return () => { current = false; queue.current = null; window.removeEventListener('storage', storageChanged); };
  }, [owner, isAdmin, refresh]);

  const pendingRequestId = state.phase === 'unconfirmed' || state.phase === 'tracking' ? state.handle?.requestId : undefined;
  useEffect(() => {
    const q = queue.current;
    if (!q || !isAdmin || !pendingRequestId) return;
    let current = true, inFlight = false;
    let timer: number | undefined;
    const canObserve = () => {
      if (!current || queue.current !== q || ownerRef.current !== owner) return false;
      const next = q.state;
      return next.handle?.requestId === pendingRequestId && (next.phase === 'unconfirmed' || next.phase === 'tracking');
    };
    const schedule = () => {
      if (canObserve() && document.visibilityState === 'visible') timer = window.setTimeout(() => { void poll(); }, 5000);
    };
    const poll = async () => {
      if (!canObserve() || document.visibilityState !== 'visible' || inFlight) return;
      window.clearTimeout(timer); inFlight = true;
      try { await refresh(); }
      // A failed GET may leave queue state unchanged. Rearm independently of a
      // React state change, after this observation completes; never enqueue here.
      finally { inFlight = false; schedule(); }
    };
    const visible = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === 'visible') void poll();
    };
    schedule();
    document.addEventListener('visibilitychange', visible);
    return () => { current = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [pendingRequestId, owner, isAdmin, refresh]);

  const submit = useCallback(async (draft: ThumbnailBrowserDraft, editorRevision: number, signal: AbortSignal, requestId?: string) => {
    const q = queue.current; const requestedOwner = ownerRef.current;
    if (!q || !requestedOwner) throw new ThumbnailBrowserQueueError('receipt_unavailable');
    const snapshot = { model: draft.model, brief: thumbnailBrief.parse(draft.brief),
      references: draft.references.map((ref) => ({ ...ref })), editor: draft.editor ? thumbnailEditorDocument.parse(draft.editor) : undefined };
    const prepared = await prepareThumbnailBrowserReferences(snapshot.brief, snapshot.references, { signal, ownerId: requestedOwner });
    signal.throwIfAborted();
    if (q !== queue.current || requestedOwner !== ownerRef.current) throw new ThumbnailBrowserQueueError('request_rejected');
    try {
      const job = await q.enqueue({ ...snapshot, references: prepared.references }, editorRevision, requestId);
      if (q !== queue.current || requestedOwner !== ownerRef.current) throw new ThumbnailBrowserQueueError('request_rejected');
      setError(null); void refreshHistory(); return job;
    } finally {
      // Enqueue ACK can arrive after an abort or an account switch. Reconcile only
      // the captured owner/request, never whichever queue the new render owns.
      if (signal.aborted) {
        try { await q.cancel(); }
        catch (failure) { if (queue.current === q) setError(thumbnailGeminiMessage(failure)); }
      }
    }
  }, [refreshHistory]);

  const cancel = useCallback(async () => {
    if (owner !== ownerRef.current || !isAdmin) return null;
    const q = queue.current; if (!q) return null;
    try { const job = await q.cancel(); if (queue.current === q) setError(null); return job; }
    catch (failure) { if (queue.current === q) setError(thumbnailGeminiMessage(failure)); return null; }
  }, [owner, isAdmin]);
  const read = useCallback(async (id: string) => {
    const q = queue.current; if (!q) throw new ThumbnailBrowserQueueError('receipt_unavailable');
    const job = await q.read(id);
    if (q !== queue.current) throw new ThumbnailBrowserQueueError('request_rejected');
    const document = await q.editor(job.id);
    if (q !== queue.current) throw new ThumbnailBrowserQueueError('request_rejected');
    return { job, document, urls: q.resultUrls(job) };
  }, []);
  const result = useCallback((job: ThumbnailJob, editorRevision: number) => {
    const q = queue.current;
    return q?.canAutoApply(job.id, editorRevision) ? q.resultUrls(job) : null;
  }, []);
  return { state, history, error, historyError, historyLoading, available, hasMore, submit, cancel, refresh, refreshHistory, read, result };
}
