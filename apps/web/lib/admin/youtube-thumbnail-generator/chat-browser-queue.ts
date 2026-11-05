import { z } from 'zod';
import { thumbnailUuid } from './queue-contract';
import { thumbnailChatJob, type ThumbnailChatJob } from './execution-contract';
import { THUMBNAIL_CHAT_MODEL, thumbnailChatContext, thumbnailChatResponse, thumbnailChatProvenance } from './chat-contract';
import { thumbnailBrowserRequest, ThumbnailBrowserQueueError } from './browser-queue';
const handleSchema = z.object({ requestId: thumbnailUuid, model: z.literal(THUMBNAIL_CHAT_MODEL),
  editorSessionId: thumbnailUuid, editorRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), cancelRequested: z.boolean(),
  chatThreadId: thumbnailChatContext.shape.chatThreadId.unwrap(), chatRunId: thumbnailChatContext.shape.chatRunId.unwrap(), imageRequestId: thumbnailUuid }).strict();
export type ThumbnailChatBrowserHandle = z.infer<typeof handleSchema>;
export type ThumbnailChatBrowserState = { handle: ThumbnailChatBrowserHandle | null; job: ThumbnailChatJob | null;
  phase: 'idle' | 'submitting' | 'unconfirmed' | 'tracking' | 'settled' };
type ReceiptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Admission = <T>(work: () => Promise<T>) => Promise<T>;
const base = '/api/admin/youtube-thumbnail-generator/chat/jobs';
const settled = (job: ThumbnailChatJob) => job.state === 'succeeded' || job.state === 'cancelled';
/** Independent chat receipt. No prompt, key, response body or editor document is persisted in the browser. */
export class ThumbnailChatBrowserQueue {
  private readonly owner: string;
  private readonly storageKey: string;
  // A restored tab does not contain the old editor document, even if its local revision counter matches.
  private readonly editorSessionId = crypto.randomUUID();
  private busy = false;
  private autoApplyRequestId: string | null = null;
  private current: ThumbnailChatBrowserState;
  constructor(private readonly options: { ownerId: string; storage: ReceiptStorage; fetch?: typeof fetch;
    changed?: (state: ThumbnailChatBrowserState) => void; admission?: Admission }) {
    this.owner = thumbnailUuid.parse(options.ownerId);
    this.storageKey = `thumbnail-gemini-chat-request:${this.owner}`;
    let stored: string | null;
    try { stored = options.storage.getItem(this.storageKey); } catch { throw new ThumbnailBrowserQueueError('receipt_unavailable'); }
    let handle: ThumbnailChatBrowserHandle | null = null;
    if (stored !== null) {
      try { handle = handleSchema.parse(JSON.parse(stored)); } catch { throw new ThumbnailBrowserQueueError('receipt_unavailable'); }
    }
    this.current = { handle, job: null, phase: handle ? 'unconfirmed' : 'idle' };
  }
  get state(): ThumbnailChatBrowserState { return structuredClone(this.current); }
  private change(next: ThumbnailChatBrowserState) {
    this.current = structuredClone(next); this.options.changed?.(this.state);
  }
  private remember(handle: ThumbnailChatBrowserHandle) {
    const text = JSON.stringify(handleSchema.parse(handle));
    this.assertReceipt();
    try {
      this.options.storage.setItem(this.storageKey, text);
      if (this.options.storage.getItem(this.storageKey) !== text) throw new Error();
    } catch { throw new ThumbnailBrowserQueueError('receipt_unavailable'); }
  }
  private assertReceipt() {
    let actual: string | null;
    try { actual = this.options.storage.getItem(this.storageKey); }
    catch { throw new ThumbnailBrowserQueueError('receipt_unavailable'); }
    if (actual !== (this.current.handle ? JSON.stringify(this.current.handle) : null)) {
      throw new ThumbnailBrowserQueueError('unresolved_request');
    }
  }
  private syncReceipt() {
    let actual: string | null;
    try { actual = this.options.storage.getItem(this.storageKey); }
    catch { throw new ThumbnailBrowserQueueError('receipt_unavailable'); }
    if (actual === (this.current.handle ? JSON.stringify(this.current.handle) : null)) return;
    // A different tab's handle can be observed without permission to enqueue. Never discard
    // our own unresolved request merely because another script changed storage.
    if (this.current.handle && (!this.current.job || !settled(this.current.job))) return;
    let handle: ThumbnailChatBrowserHandle | null = null;
    try { handle = actual === null ? null : handleSchema.parse(JSON.parse(actual)); }
    catch { throw new ThumbnailBrowserQueueError('receipt_unavailable'); }
    this.autoApplyRequestId = null;
    this.change({ handle, job: null, phase: handle ? 'unconfirmed' : 'idle' });
  }
  private async exclusive<T>(work: () => Promise<T>) {
    if (this.busy) throw new ThumbnailBrowserQueueError('busy');
    this.busy = true;
    try {
      if (this.options.admission) return await this.options.admission(work);
      // Without cross-context admission, do not silently fall back to a per-instance mutex.
      if (typeof navigator === 'undefined' || !navigator.locks) throw new ThumbnailBrowserQueueError('receipt_unavailable');
      return await navigator.locks.request(this.storageKey, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) throw new ThumbnailBrowserQueueError('busy');
        return await work();
      });
    } finally { this.busy = false; }
  }
  private request(path: string, init: RequestInit = {}) {
    return thumbnailBrowserRequest(this.owner, this.options.fetch ?? fetch, path, init);
  }
  private accept(value: unknown, handle: ThumbnailChatBrowserHandle) {
    const parsed = z.object({ job: thumbnailChatJob }).strict().safeParse(value);
    if (!parsed.success || parsed.data.job.ownerId !== this.owner
      || parsed.data.job.requestId !== handle.requestId || parsed.data.job.model !== handle.model
      || (this.current.job && parsed.data.job.id !== this.current.job.id)) {
      throw new ThumbnailBrowserQueueError('invalid_response');
    }
    const job = parsed.data.job;
    this.change({ handle, job, phase: settled(job) ? 'settled' : 'tracking' });
    return job;
  }
  async enqueue(rawContext: unknown, editorRevision: number, requestId = crypto.randomUUID()) {
    const context = thumbnailChatContext.parse(rawContext);
    const handle = handleSchema.parse({ requestId, model: THUMBNAIL_CHAT_MODEL, editorSessionId: this.editorSessionId,
      editorRevision, cancelRequested: false, chatRunId: context.chatRunId, chatThreadId: context.chatThreadId,
      imageRequestId: crypto.randomUUID() });
    return await this.exclusive(async () => {
      if (this.current.handle && (!this.current.job || !settled(this.current.job))) throw new ThumbnailBrowserQueueError('unresolved_request');
      if (this.current.handle?.requestId === requestId) throw new ThumbnailBrowserQueueError('invalid_input');
      this.remember(handle); this.autoApplyRequestId = null;
      this.change({ handle, job: null, phase: 'submitting' });
      try {
        const job = this.accept(await this.request(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, context }) }), handle);
        this.autoApplyRequestId = handle.requestId; return job;
      } catch (error) {
        if (error instanceof ThumbnailBrowserQueueError && error.code === 'rejected_input') {
          try {
            this.assertReceipt(); this.options.storage.removeItem(this.storageKey);
            if (this.options.storage.getItem(this.storageKey) !== null) throw new Error();
          } catch { this.change({ handle, job: null, phase: 'unconfirmed' }); throw new ThumbnailBrowserQueueError('receipt_unavailable'); }
          this.change({ handle: null, job: null, phase: 'idle' }); throw error;
        }
        this.change({ handle, job: null, phase: 'unconfirmed' }); throw error;
      }
    });
  }
  /** Recovery reads the original request and may deliver its persisted cancel intent.
   * A null response never authorizes a new paid request. */
  async resume() {
    this.syncReceipt();
    return await this.exclusive(async () => {
      const handle = this.current.handle; if (!handle) return null;
      const value = await this.request(`${base}?requestId=${encodeURIComponent(handle.requestId)}`);
      const parsed = z.object({ job: thumbnailChatJob.nullable() }).strict().safeParse(value);
      if (!parsed.success) throw new ThumbnailBrowserQueueError('invalid_response');
      if (!parsed.data.job) { this.change({ handle, job: null, phase: 'unconfirmed' }); return null; }
      const job = this.accept(value, handle);
      if (handle.cancelRequested && !job.cancelRequested && !settled(job)) {
        return this.accept(await this.request(`${base}/${job.id}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) }), handle);
      }
      return job;
    });
  }
  /** Aborting observation/unmounting is not cancellation. Cancellation requires its own persisted server readback. */
  cancel() {
    return this.exclusive(async () => {
      const old = this.current.handle; if (!old) return null;
      const handle = { ...old, cancelRequested: true }; this.remember(handle);
      this.change({ ...this.current, handle });
      const found = await this.request(`${base}?requestId=${encodeURIComponent(handle.requestId)}`);
      const parsed = z.object({ job: thumbnailChatJob.nullable() }).strict().safeParse(found);
      if (!parsed.success) throw new ThumbnailBrowserQueueError('invalid_response');
      if (!parsed.data.job) { this.change({ handle, job: null, phase: 'unconfirmed' }); return null; }
      const job = this.accept(found, handle);
      if (settled(job)) return job;
      return this.accept(await this.request(`${base}/${job.id}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) }), handle);
    });
  }
  private consumed = new Set<string>();
  consume(jobId: string, editorRevision: number, chatThreadId: string, chatRunId: string) {
    try { this.assertReceipt(); } catch { return null; }
    const handle = this.current.handle;
    if (this.consumed.has(jobId) || this.current.job?.id !== jobId || this.current.job.state !== 'succeeded'
      || this.current.job.cancelRequested || !handle || handle.cancelRequested || handle.editorSessionId !== this.editorSessionId
      || handle.editorRevision !== editorRevision || handle.chatThreadId !== chatThreadId || handle.chatRunId !== chatRunId
      || this.autoApplyRequestId !== handle.requestId) return null;
    this.consumed.add(jobId); return handle.imageRequestId;
  }
  async output(jobId: string) {
    const job = this.current.job;
    if (!job || job.id !== jobId || job.state !== 'succeeded' || !job.result) throw new ThumbnailBrowserQueueError('not_succeeded');
    const parsed = z.object({ response: thumbnailChatResponse, provenance: thumbnailChatProvenance }).strict()
      .safeParse(await this.request(`${base}/${job.id}?output=1`));
    if (!parsed.success || JSON.stringify(parsed.data.provenance) !== JSON.stringify(job.result.provenance)) throw new ThumbnailBrowserQueueError('invalid_response');
    return parsed.data;
  }
}
