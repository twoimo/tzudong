"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ThumbnailChatBrowserQueue, type ThumbnailChatBrowserState } from '@/lib/admin/youtube-thumbnail-generator/chat-browser-queue';
import { ThumbnailBrowserQueueError } from '@/lib/admin/youtube-thumbnail-generator/browser-queue';
import { thumbnailUuid } from '@/lib/admin/youtube-thumbnail-generator/queue-contract';
import { thumbnailChatContext } from '@/lib/admin/youtube-thumbnail-generator/chat-contract';
import { thumbnailGeminiMessage } from './useThumbnailGeminiQueue';

const idle: ThumbnailChatBrowserState = { handle: null, job: null, phase: 'idle' };
const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); resolve(); };
  const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(new ThumbnailBrowserQueueError('unconfirmed')); };
  const timer = setTimeout(finish, 2000);
  signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted();
});
export function useThumbnailChatQueue() {
  const { user, isAdmin } = useAuth(), owner = user?.id;
  const ownerRef = useRef(owner); useLayoutEffect(() => { ownerRef.current = owner; }, [owner]);
  const queue = useRef<ThumbnailChatBrowserQueue | null>(null), active = useRef<ThumbnailChatBrowserQueue | null>(null);
  const [state, setState] = useState(idle), [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const q = queue.current; if (!q || active.current === q) return null;
    try { const job = await q.resume(); if (queue.current === q) setError(null); return job; }
    catch (failure) { if (queue.current === q) setError(thumbnailGeminiMessage(failure)); return null; }
  }, []);
  useEffect(() => {
    queue.current = null; setState(idle); setError(null); setReady(false);
    if (!isAdmin || !thumbnailUuid.safeParse(owner).success) return;
    let live = true;
    const changed = (event: StorageEvent) => { if (event.key === `thumbnail-gemini-chat-request:${owner}`) void refresh(); };
    window.addEventListener('storage', changed);
    try {
      const q = new ThumbnailChatBrowserQueue({ ownerId: owner!, storage: window.localStorage, changed: (next) => { if (live) setState(next); } });
      queue.current = q; setState(q.state); setReady(true); if (q.state.handle) void refresh();
    } catch (failure) { setError(thumbnailGeminiMessage(failure)); }
    return () => { live = false; queue.current = null; window.removeEventListener('storage', changed); };
  }, [owner, isAdmin, refresh]);
  const pendingRequestId = state.phase === 'unconfirmed' || state.phase === 'tracking' ? state.handle?.requestId : undefined;
  useEffect(() => {
    const q = queue.current;
    if (!q || !isAdmin || !pendingRequestId) return;
    let live = true, inFlight = false;
    let timer: number | undefined;
    const canObserve = () => {
      if (!live || queue.current !== q || ownerRef.current !== owner) return false;
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
      // Fixed errors need not change state. refresh also skips an active submit;
      // retain the timer so observation resumes when that non-reactive ref clears.
      finally { inFlight = false; schedule(); }
    };
    const visible = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === 'visible') void poll();
    };
    schedule(); document.addEventListener('visibilitychange', visible);
    return () => { live = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [pendingRequestId, owner, isAdmin, refresh]);
  const submit = useCallback(async (rawContext: unknown, editorRevision: number, signal: AbortSignal) => {
    if (owner !== ownerRef.current || !isAdmin) throw new ThumbnailBrowserQueueError('request_rejected');
    const q = queue.current, requestedOwner = ownerRef.current;
    if (!q || !requestedOwner || active.current === q) throw new ThumbnailBrowserQueueError('receipt_unavailable');
    const context = thumbnailChatContext.parse(rawContext), deadline = Date.now() + 300_000;
    const current = () => {
      signal.throwIfAborted();
      if (q !== queue.current || requestedOwner !== ownerRef.current) throw new ThumbnailBrowserQueueError('request_rejected');
    };
    active.current = q;
    try {
      current(); let job = await q.enqueue(context, editorRevision); current();
      while (job.state !== 'succeeded' && job.state !== 'cancelled') {
        if (Date.now() >= deadline) throw new ThumbnailBrowserQueueError('unconfirmed');
        await wait(signal); current();
        const found = await q.resume(); current();
        if (found) job = found;
      }
      if (job.state !== 'succeeded') throw new ThumbnailBrowserQueueError('request_rejected');
      const result = await q.output(job.id); current(); setError(null);
      return { ...result, job, consume: (revision: number, thread: string, run: string) => {
        if (q !== queue.current || requestedOwner !== ownerRef.current || signal.aborted) return null;
        return q.consume(job.id, revision, thread, run);
      } };
    } catch (failure) { if (queue.current === q) setError(thumbnailGeminiMessage(failure)); throw failure; }
    finally {
      if (signal.aborted) {
        try { const job = await q.cancel(); if (job && queue.current === q) setError(null); }
        catch (failure) { if (queue.current === q) setError(thumbnailGeminiMessage(failure)); }
      }
      if (active.current === q) active.current = null;
    }
  }, [owner, isAdmin]);
  const cancel = useCallback(async () => {
    if (owner !== ownerRef.current || !isAdmin) return null;
    const q = queue.current; if (!q || active.current === q) return null;
    try { const job = await q.cancel(); if (job && queue.current === q) setError(null); return job; }
    catch (failure) { if (queue.current === q) setError(thumbnailGeminiMessage(failure)); return null; }
  }, [owner, isAdmin]);
  const output = useCallback(async () => {
    if (owner !== ownerRef.current || !isAdmin) throw new ThumbnailBrowserQueueError('request_rejected');
    const q = queue.current; if (!q?.state.job) throw new ThumbnailBrowserQueueError('not_succeeded');
    const result = await q.output(q.state.job.id);
    if (q !== queue.current) throw new ThumbnailBrowserQueueError('request_rejected');
    return result;
  }, [owner, isAdmin]);
  return { state, error, ready, submit, cancel, refresh, output };
}
