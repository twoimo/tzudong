type Job = { owner: object; run(): Promise<boolean>; isCurrent?(): boolean };
type Queue = { pending: Job | null; running: Job | null; complete: Promise<boolean>; resolve(result: boolean): void };
// Only in-flight work is shared. No draft text or account fields survive a
// completed queue. One writer and at most one newer snapshot exist per scope.
const writes = new Map<string, Queue>();
// A document can disappear while an admitted save is still waiting, including
// after its composer has unmounted. Keep only a native navigation warning here;
// never start asynchronous writes during unload or force a reload.
export function blockDraftUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = 'true';
}
function onPendingDraftUnload(event: BeforeUnloadEvent) {
  for (const queue of writes.values()) {
    if ([queue.running, queue.pending].some(job => job && (!job.isCurrent || job.isCurrent()))) {
      blockDraftUnload(event);
      return;
    }
  }
}
function updateUnloadListener() {
  if (typeof window === 'undefined') return;
  if (writes.size) window.addEventListener('beforeunload', onPendingDraftUnload);
  else window.removeEventListener('beforeunload', onPendingDraftUnload);
}
async function drain(scope: string, queue: Queue) {
  let saved = true;
  while (queue.pending) {
    const job = queue.pending; queue.pending = null; queue.running = job;
    try { saved = await job.run(); } catch { saved = false; }
    finally { queue.running = null; }
  }
  if (writes.get(scope) === queue) writes.delete(scope);
  updateUnloadListener();
  queue.resolve(saved);
}
export function enqueueDraftWrite(scope: string, job: Job) {
  let queue = writes.get(scope);
  if (queue) { queue.pending = job; return queue.complete; }
  let resolve!: (saved: boolean) => void;
  const complete = new Promise<boolean>(done => { resolve = done; });
  queue = { pending: job, running: null, complete, resolve };
  writes.set(scope, queue);
  updateUnloadListener();
  void drain(scope, queue);
  return complete;
}
export async function waitForDraftAutosave(scope: string) { await writes.get(scope)?.complete; }

export function draftWriteCompletion(scope: string) { return writes.get(scope)?.complete; }
export function cancelPendingDraftWrite(scope: string, owner: object) {
  const queue = writes.get(scope);
  if (queue?.pending?.owner === owner) queue.pending = null;
}

