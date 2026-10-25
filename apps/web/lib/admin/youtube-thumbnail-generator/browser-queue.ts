import { z } from 'zod';
import { thumbnailBrief, thumbnailEnqueue, thumbnailJob, thumbnailSummary, thumbnailUuid,
  THUMBNAIL_REFERENCE_BYTES, thumbnailEditorDocument, type ThumbnailEditorDocument, type ThumbnailJob } from './queue-contract';

type Reference = { file: File; role: z.infer<typeof thumbnailEnqueue>['roles'][number] };
export type ThumbnailBrowserDraft = {
  model: z.infer<typeof thumbnailEnqueue>['model'];
  brief: z.infer<typeof thumbnailBrief>;
  references: readonly Reference[];
  editor?: ThumbnailEditorDocument;
};
const handleSchema = z.object({ requestId: thumbnailUuid, model: thumbnailEnqueue.shape.model,
  editorSessionId: thumbnailUuid, editorRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  cancelRequested: z.boolean() }).strict();
export type ThumbnailBrowserHandle = z.infer<typeof handleSchema>;
export type ThumbnailBrowserState = {
  handle: ThumbnailBrowserHandle | null; job: ThumbnailJob | null;
  phase: 'idle' | 'submitting' | 'unconfirmed' | 'tracking' | 'settled';
};
type ReceiptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Admission = <T>(work: () => Promise<T>) => Promise<T>;
const base = '/api/admin/youtube-thumbnail-generator/jobs';
const settled = (job: ThumbnailJob) => job.state === 'succeeded' || job.state === 'cancelled';
export class ThumbnailBrowserQueueError extends Error {
  constructor(readonly code: 'invalid_input' | 'invalid_response' | 'unconfirmed' | 'unresolved_request'
    | 'busy' | 'receipt_unavailable' | 'request_rejected' | 'rejected_input' | 'not_succeeded') { super(code); }
}

export async function thumbnailBrowserRequest(owner: string, requestFetch: typeof fetch, path: string, init: RequestInit = {}) {
    try {
      const headers = new Headers(init.headers); headers.set('X-Thumbnail-Owner', owner);
      const response = await requestFetch(path, { ...init, credentials: 'same-origin',
        headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
      // The server returns bounded jobs; cap even a misconfigured intermediary before JSON buffering.
      if (!response.body) throw new ThumbnailBrowserQueueError('invalid_response');
      const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > 262_144) { void reader.cancel().catch(() => undefined); throw new ThumbnailBrowserQueueError('invalid_response'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
      catch { throw new ThumbnailBrowserQueueError('invalid_response'); }
      if (!response.ok) {
        const rejection = z.object({ ok: z.literal(false), error: z.string() }).strict().safeParse(value);
        // These fixed API codes are emitted before queue insertion. A 409, 5xx, missing/malformed
        // body or transport failure cannot authorize discarding the original receipt.
        if (rejection.success && ((response.status === 400 && rejection.data.error === 'invalid_request')
          || (response.status === 413 && rejection.data.error === 'request_too_large')
          || (response.status === 403 && ['origin_forbidden', 'owner_forbidden'].includes(rejection.data.error)))) {
          throw new ThumbnailBrowserQueueError('rejected_input');
        }
        throw new ThumbnailBrowserQueueError(response.status >= 500 ? 'unconfirmed' : 'request_rejected');
      }
      return value;
    } catch (error) {
      if (error instanceof ThumbnailBrowserQueueError) throw error;
      throw new ThumbnailBrowserQueueError('unconfirmed');
    }
}

/** Stores only scoped request identity and cancellation intent, never prompt, file, key or session bytes. */
export class ThumbnailBrowserQueue {
  private readonly owner: string;
  private readonly storageKey: string;
  // A restored tab does not contain the old editor document, even if its local revision counter matches.
  private readonly editorSessionId = crypto.randomUUID();
  private busy = false;
  private autoApplyRequestId: string | null = null;
  private current: ThumbnailBrowserState;
  constructor(private readonly options: { ownerId: string; storage: ReceiptStorage; fetch?: typeof fetch;
    changed?: (state: ThumbnailBrowserState) => void; admission?: Admission }) {
    this.owner = thumbnailUuid.parse(options.ownerId);
    this.storageKey = `thumbnail-gemini-request:${this.owner}`;
    let stored: string | null;
    try { stored = options.storage.getItem(this.storageKey); } catch { throw new ThumbnailBrowserQueueError('receipt_unavailable'); }
    let handle: ThumbnailBrowserHandle | null = null;
    if (stored !== null) {
      try { handle = handleSchema.parse(JSON.parse(stored)); } catch { throw new ThumbnailBrowserQueueError('receipt_unavailable'); }
    }
    this.current = { handle, job: null, phase: handle ? 'unconfirmed' : 'idle' };
  }
  get state(): ThumbnailBrowserState { return structuredClone(this.current); }
  private change(next: ThumbnailBrowserState) {
    this.current = structuredClone(next); this.options.changed?.(this.state);
  }
  private remember(handle: ThumbnailBrowserHandle) {
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
    let handle: ThumbnailBrowserHandle | null = null;
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
  private accept(value: unknown, handle: ThumbnailBrowserHandle) {
    const parsed = z.object({ job: thumbnailJob }).strict().safeParse(value);
    if (!parsed.success || parsed.data.job.ownerId !== this.owner
      || parsed.data.job.requestId !== handle.requestId || parsed.data.job.model !== handle.model
      || (this.current.job && parsed.data.job.id !== this.current.job.id)) {
      throw new ThumbnailBrowserQueueError('invalid_response');
    }
    const job = parsed.data.job;
    this.change({ handle, job, phase: settled(job) ? 'settled' : 'tracking' });
    return job;
  }
  /** A user action may submit a new request only after the previous request's terminal state is read back. */
  async enqueue(draft: ThumbnailBrowserDraft, editorRevision: number, requestId = crypto.randomUUID()) {
  const parsed = thumbnailEnqueue.safeParse({ requestId, model: draft.model, brief: draft.brief,
    roles: draft.references.map((ref) => ref.role), ...(draft.editor ? { editor: draft.editor } : {}) });
  const handle = handleSchema.safeParse({ requestId, model: draft.model, editorSessionId: this.editorSessionId,
    editorRevision, cancelRequested: false });
  if (!parsed.success || !handle.success || draft.references.some((ref) => !(ref.file instanceof File)
    || ref.file.size < 16 || ref.file.size > THUMBNAIL_REFERENCE_BYTES
    || !['image/png', 'image/jpeg', 'image/webp'].includes(ref.file.type))
    || draft.references.reduce((sum, ref) => sum + ref.file.size, 0) > 16 * 1024 * 1024) {
    throw new ThumbnailBrowserQueueError('invalid_input');
  }
  // File is an immutable Blob. Snapshot before the first await; later form edits cannot alter this POST.
  const form = new FormData(); form.set('request', JSON.stringify(parsed.data));
  draft.references.forEach((ref, index) => form.set(`reference${index}`, ref.file, `reference-${index}`));
    return await this.exclusive(async () => {
      if (this.current.handle && (!this.current.job || !settled(this.current.job))) {
        throw new ThumbnailBrowserQueueError('unresolved_request');
      }
      if (this.current.handle?.requestId === parsed.data.requestId) throw new ThumbnailBrowserQueueError('invalid_input');
      this.remember(handle.data);
      this.autoApplyRequestId = null;
      this.change({ handle: handle.data, job: null, phase: 'submitting' });
      try {
        const job = this.accept(await this.request(base, { method: 'POST', body: form }), handle.data);
        this.autoApplyRequestId = handle.data.requestId; return job;
      }
      catch (error) {
        if (error instanceof ThumbnailBrowserQueueError && error.code === 'rejected_input') {
          // Read back removal as well. If storage cannot confirm it, retain the in-memory hold.
          try {
            this.assertReceipt();
            this.options.storage.removeItem(this.storageKey);
            if (this.options.storage.getItem(this.storageKey) !== null) throw new Error();
          } catch {
            this.change({ handle: handle.data, job: null, phase: 'unconfirmed' });
            throw new ThumbnailBrowserQueueError('receipt_unavailable');
          }
          this.change({ handle: null, job: null, phase: 'idle' }); throw error;
        }
        this.change({ handle: handle.data, job: null, phase: 'unconfirmed' });
        // No POST retry and no replacement request ID, even after a rejection or missing lookup.
        throw error;
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
      const parsed = z.object({ job: thumbnailJob.nullable() }).strict().safeParse(value);
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
      const parsed = z.object({ job: thumbnailJob.nullable() }).strict().safeParse(found);
      if (!parsed.success) throw new ThumbnailBrowserQueueError('invalid_response');
      if (!parsed.data.job) { this.change({ handle, job: null, phase: 'unconfirmed' }); return null; }
      const job = this.accept(found, handle);
      if (settled(job)) return job;
      return this.accept(await this.request(`${base}/${job.id}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) }), handle);
    });
  }
  canAutoApply(jobId: string, editorRevision: number) {
    try { this.assertReceipt(); } catch { return false; }
    return this.current.job?.id === jobId && this.current.job.state === 'succeeded'
      && !this.current.job.cancelRequested && !this.current.handle?.cancelRequested
      && this.current.handle?.editorSessionId === this.editorSessionId && this.current.handle.editorRevision === editorRevision
      && this.autoApplyRequestId === this.current.handle.requestId;
  }
  async history(cursor?: { beforeCreatedAt: string; beforeId: string }) {
    const query = cursor ? `?${new URLSearchParams(cursor)}` : '';
    const value = await this.request(`${base}${query}`);
    const parsed = z.object({ jobs: z.array(thumbnailSummary).max(32) }).strict().safeParse(value);
    if (!parsed.success) throw new ThumbnailBrowserQueueError('invalid_response');
    return parsed.data.jobs;
  }
  async read(jobId: string) {
    const id = thumbnailUuid.safeParse(jobId);
    if (!id.success) throw new ThumbnailBrowserQueueError('invalid_input');
    const result = z.object({ job: thumbnailJob }).strict().safeParse(await this.request(`${base}/${id.data}`));
    if (!result.success || result.data.job.id !== id.data || result.data.job.ownerId !== this.owner) {
      throw new ThumbnailBrowserQueueError('invalid_response');
    }
    return result.data.job;
  }
  async editor(jobId: string) {
    const id = thumbnailUuid.safeParse(jobId); if (!id.success) throw new ThumbnailBrowserQueueError('invalid_input');
    const result = z.object({ document: thumbnailEditorDocument.nullable() }).strict()
      .safeParse(await this.request(`${base}/${id.data}?document=1`));
    if (!result.success) throw new ThumbnailBrowserQueueError('invalid_response');
    return result.data.document;
  }
  resultUrls(job: ThumbnailJob) {
    const parsed = thumbnailJob.safeParse(job);
    if (!parsed.success || parsed.data.ownerId !== this.owner || parsed.data.state !== 'succeeded') {
      throw new ThumbnailBrowserQueueError('not_succeeded');
    }
    return { original: `${base}/${parsed.data.id}?variant=original`,
      normalized: `${base}/${parsed.data.id}?variant=normalized`, provenance: structuredClone(parsed.data.result!.provenance) };
  }
}
