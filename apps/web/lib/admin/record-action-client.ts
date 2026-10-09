import {
  isRecordActionReceipt, parseRecordActionRequest, RECORD_ACTION_CONFIRMATION, RECORD_ACTION_ENDPOINT,
  type RecordActionRequest, type RecordActionReceipt,
} from './record-action-contract';

export const RECORD_VIEWS_INVALIDATED_EVENT = 'admin:record-views-invalidated';
export const RECORD_ACTION_APPLIED_EVENT = 'admin:record-action-applied';

export type RecordActionInput = Pick<RecordActionRequest, 'action' | 'targetIds' | 'payload'>;
export type RecordActionClientState = {
  phase: 'idle' | 'previewing' | 'confirming' | 'applying' | 'checking' | 'uncertain' | 'failed';
  request: RecordActionRequest | null;
  receipt: RecordActionReceipt | null;
  message: string;
  nextAction: 'review-duplicates' | null;
};
const messages: Record<string, string> = {
  RECORD_ACTION_MAINTENANCE: '관리자 변경이 일시 중지되어 있습니다. 유지보수가 끝난 뒤 새로 검토하세요.',
  RECORD_ACTION_PENDING: '이전 작업의 결과를 먼저 확인하세요.',
  RECORD_ACTION_FORBIDDEN: '관리자 권한을 확인한 뒤 다시 시도하세요.',
  RECORD_ACTION_NOT_FOUND: '대상 또는 작업을 찾지 못했습니다. 목록을 새로 조회하세요.',
  RECORD_ACTION_LIMIT: '한 번에 처리할 수 있는 수를 초과했습니다.',
  RECORD_ACTION_INVALID_PAYLOAD: '입력값과 선택한 항목을 확인하세요.',
  RECORD_ACTION_INVALID_RESTAURANT: '맛집 이름·주소·좌표·분류를 확인하세요.',
  RECORD_ACTION_DUPLICATE: '중복 후보가 있습니다. 기존 맛집을 확인하세요.',
  RECORD_ACTION_DUPLICATE_REVIEW: '비슷한 주소의 기존 맛집이 있습니다. 중복 후보를 검토한 뒤 다시 처리하세요.',
  RECORD_ACTION_MEDIA_RETIRED: '사용할 수 없는 사진입니다. 사진을 다시 선택하세요.',
  RECORD_ACTION_STATE_CONFLICT: '현재 상태에서는 처리할 수 없습니다. 목록을 새로 조회하세요.',
  RECORD_ACTION_IDEMPOTENCY_CONFLICT: '작업 정보가 일치하지 않습니다. 목록을 새로 조회하세요.',
  RECORD_ACTION_PREVIEW_MISMATCH: '확인한 내용과 요청이 다릅니다. 새로 검토하세요.',
  RECORD_ACTION_PREVIEW_EXPIRED: '확인 시간이 만료되었습니다. 새로 검토하세요.',
  RECORD_ACTION_PREVIEW_REQUIRED: '변경 내용을 먼저 확인하세요.',
  RECORD_ACTION_STALE: '다른 변경이 먼저 반영되었습니다. 목록을 새로 조회하고 다시 검토하세요.',
  RECORD_ACTION_EVIDENCE_REQUIRED: '승인에 필요한 평가 또는 영상 근거가 부족합니다.',
  RECORD_ACTION_DISTINCT_VIDEO: '서로 다른 영상의 맛집은 병합할 수 없습니다.',
  RECORD_ACTION_SUBMISSION_CONFLICT: '제보 항목 또는 중복 후보를 다시 확인하세요.',
  RECORD_ACTION_PRIVACY_UNSAFE: '메모에서 개인정보를 제거하세요.',
  RECORD_ACTION_MEDIA_PATH_INVALID: '리뷰 삭제는 확인됐지만 사진 정리를 확인하지 못했습니다.',
};
export class RecordActionClientError extends Error {
  constructor(public readonly code: string) { super(messages[code] ?? '결과를 확인하지 못했습니다. 기존 작업의 결과를 조회하세요.'); }
}
export const isRecordActionCancelled = (error: unknown) => error instanceof RecordActionClientError && error.code === 'CANCELLED';
export function recordActionErrorMessage(error: unknown) {
  return error instanceof RecordActionClientError ? error.message : '입력값을 확인하고 목록을 새로 조회하세요.';
}
/** A confirmed DB deletion can have both managed jobs and untouched external/shared photos. */
export function recordActionMediaNotice(receipt: RecordActionReceipt): string {
  if (receipt.action !== 'review.delete') return '';
  return [
    receipt.mediaCleanupPending ? '사진 정리가 아직 완료되지 않았습니다.' : '',
    receipt.mediaCleanupUnmanaged ? '자동 삭제 대상에서 제외된 사진이 있습니다.' : '',
  ].filter(Boolean).join(' ');
}
const empty: RecordActionClientState = { phase: 'idle', request: null, receipt: null, message: '', nextAction: null };
const pendingKey = 'admin:record-action-pending:v1';
type Identity = Pick<RecordActionRequest, 'operationId' | 'action' | 'targetIds' | 'previewHash'>;
const sameIds = (left: string[], right: string[]) => left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index]);

/** One immutable preview and at most one apply POST. Uncertainty can only issue GETs. */
export function createRecordActionClient(options: {
  fetch?: typeof fetch;
  uuid?: () => string;
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  onRecovered?: (receipt: RecordActionReceipt) => void;
  onInvalidate?: () => void;
  onApplied?: (receipt: RecordActionReceipt) => void;
} = {}) {
  const transport = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let onRecovered = options.onRecovered;
  let state = empty;
  let identity: Identity | null = null;
  let epoch = 0, appliedAttempt = false, cleanupAttempt = false;
  let resolve: ((receipt: RecordActionReceipt) => void) | null = null;
  let reject: ((error: RecordActionClientError) => void) | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<RecordActionClientState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const fail = (code: string) => {
    const error = new RecordActionClientError(code);
    if (['RECORD_ACTION_STALE', 'RECORD_ACTION_STATE_CONFLICT', 'RECORD_ACTION_SUBMISSION_CONFLICT'].includes(code)) options.onInvalidate?.();
    publish({ phase: 'failed', message: error.message, nextAction: code === 'RECORD_ACTION_DUPLICATE_REVIEW' ? 'review-duplicates' : null }); reject?.(error); resolve = null; reject = null;
  };
  const uncertain = () => publish({ phase: 'uncertain', message: appliedAttempt
    ? '적용 여부를 아직 확인하지 못했습니다. 결과 조회만 가능하며 다시 전송하지 않습니다.'
    : '변경 내용을 확인하지 못했습니다. 결과를 조회하거나 취소 후 다시 확인하세요.' });
  function matches(value: unknown): value is RecordActionReceipt {
    if (!identity || !isRecordActionReceipt(value) || value.operationId !== identity.operationId || value.action !== identity.action
      || (identity.previewHash && value.previewHash !== identity.previewHash) || !Number.isFinite(Date.parse(value.expiresAt))) return false;
    if (value.targetIds.length > 25) return false;
    const permitsAddedIds = value.state === 'applied' && ['restaurant.edit', 'restaurant.create'].includes(identity.action);
    if (permitsAddedIds ? identity.targetIds.some(id => !value.targetIds.includes(id)) : !sameIds(value.targetIds, identity.targetIds)) return false;
    if (value.state === 'applied' ? !value.auditId : value.auditId !== null) return false;
    if (value.state === 'applied' && identity.action === 'restaurant.create') {
      const additions = state.request && 'additions' in state.request.payload ? state.request.payload.additions : [];
      if (value.targetIds.length < 1 || value.targetIds.length > 25 || (state.request && value.targetIds.length !== 1 + (Array.isArray(additions) ? additions.length : 0))) return false;
    }
    const keys = value.readback.map(row => `${row.kind}:${row.id}`);
    if (new Set(keys).size !== keys.length || new Set(value.targetIds).size !== value.targetIds.length) return false;
    const kind = identity.action.split('.')[0];
    return value.targetIds.every(id => value.readback.some(row => row.id === id && row.kind === kind))
      && value.readback.every(row => ['restaurant', 'submission', 'item', 'review', 'recommendation'].includes(row.kind)
        && ['pending', 'hold', 'approved', 'partially_approved', 'rejected', 'deleted'].includes(row.status)
        && (row.fingerprint === null ? row.status === 'deleted' : /^[a-f0-9]{64}$/.test(row.fingerprint)));
  }
  async function request(method: 'POST' | 'GET', body?: RecordActionRequest, cleanup = false) {
    const url = cleanup ? `${RECORD_ACTION_ENDPOINT}/media-cleanup` : method === 'GET'
      ? `${RECORD_ACTION_ENDPOINT}?operationId=${encodeURIComponent(identity!.operationId)}` : RECORD_ACTION_ENDPOINT;
    const response = await transport(url, { method, signal: AbortSignal.timeout(15000), cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(cleanup ? { operationId: identity!.operationId } : body) } : {}) });
    if (response.status === 401 || response.status === 403) throw new RecordActionClientError('RECORD_ACTION_FORBIDDEN');
    const value: unknown = await response.json();
    if (response.ok && value && typeof value === 'object' && 'success' in value && value.success === true && 'receipt' in value && matches(value.receipt)) return value.receipt;
    if (!response.ok && response.status < 500 && value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' && Object.hasOwn(messages, value.code)) throw new RecordActionClientError(value.code);
    throw new RecordActionClientError('RECORD_ACTION_UNCERTAIN');
  }
  async function complete(receipt: RecordActionReceipt) {
    // Deletion/audit are already confirmed. Media cleanup is separate and never changes that result.
    if (receipt.action === 'review.delete' && receipt.mediaCleanupPending && !cleanupAttempt) {
      cleanupAttempt = true;
      try {
        const cleaned = await request('POST', undefined, true);
        if (cleaned.state === 'applied') receipt = cleaned;
      } catch { /* GET below observes an uncertain cleanup; no retry. */ }
      try { const checked = await request('GET'); if (checked.state === 'applied') receipt = checked; } catch { receipt = { ...receipt, mediaCleanupPending: true }; }
    }
    options.storage?.removeItem(pendingKey);
    const finish = resolve; resolve = null; reject = null;
    publish({ ...empty }); identity = null;
    options.onApplied?.(receipt);
    if (finish) finish(receipt); else onRecovered?.(receipt);
  }
  async function readback() {
    if (!identity || state.phase === 'checking' || state.phase === 'applying' || state.phase === 'previewing') return;
    const token = epoch;
    publish({ phase: 'checking', message: '' });
    try {
      const receipt = await request('GET');
      if (epoch !== token) return;
      publish({ receipt });
      if (receipt.state === 'applied') await complete(receipt);
      else if (!appliedAttempt && state.request) publish({ phase: 'confirming' });
      else { options.onInvalidate?.(); uncertain(); }
    } catch (error) {
      if (epoch === token) {
        options.onInvalidate?.();
        uncertain();
        if (error instanceof RecordActionClientError && error.code === 'RECORD_ACTION_FORBIDDEN') publish({ message: '관리자 권한을 확인한 뒤 기존 작업 결과를 조회하세요. 다시 전송하지 않습니다.' });
      }
    }
  }
  async function recover() {
    if (state.phase !== 'idle' || !options.storage) return;
    try {
      const saved = options.storage.getItem(pendingKey);
      if (!saved) return;
      appliedAttempt = true;
      options.onInvalidate?.();
      publish({ ...empty, phase: 'uncertain' });
      const parsed: unknown = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object' || !('operationId' in parsed) || !('action' in parsed) || !('targetIds' in parsed) || !('previewHash' in parsed)) throw Error('INVALID_PENDING_IDENTITY');
      // Only the original identity is persisted; recovery never reconstructs an apply payload.
      const candidate = { ...parsed, state: 'preview', auditId: null, expiresAt: new Date(now()).toISOString(), readback: [], mediaCleanupPending: false };
      if (!isRecordActionReceipt(candidate)) throw Error('INVALID_PENDING_IDENTITY');
      identity = candidate; cleanupAttempt = true;
      await readback();
    } catch {
      appliedAttempt = true; options.onInvalidate?.(); uncertain();
      if (!identity) publish({ message: '이전 작업 정보를 읽지 못했습니다. 다시 적용하지 말고 관리자에게 확인을 요청하세요.' });
    }
  }
  return {
    getSnapshot: () => state,
    canCancel: () => !appliedAttempt || state.phase === 'failed',
    setOnRecovered: (callback: (receipt: RecordActionReceipt) => void) => { onRecovered = callback; },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    run(input: RecordActionInput): Promise<RecordActionReceipt> {
      if (state.phase !== 'idle') return Promise.reject(new RecordActionClientError('RECORD_ACTION_PREVIEW_REQUIRED'));
      try {
        if (options.storage?.getItem(pendingKey)) { void recover(); return Promise.reject(new RecordActionClientError('RECORD_ACTION_PENDING')); }
      } catch { return Promise.reject(new RecordActionClientError('RECORD_ACTION_UNCERTAIN')); }
      const parsed = parseRecordActionRequest({ ...input, phase: 'preview', operationId: (options.uuid ?? (() => crypto.randomUUID()))() });
      if (!parsed) return Promise.reject(new RecordActionClientError('RECORD_ACTION_INVALID_PAYLOAD'));
      // Parsing also copies/normalizes nested fields. Caller edits cannot change the reviewed payload.
      const original = structuredClone(parsed), token = ++epoch;
      identity = original; appliedAttempt = false; cleanupAttempt = false;
      const result = new Promise<RecordActionReceipt>((yes, no) => { resolve = yes; reject = no; });
      publish({ phase: 'previewing', request: original, receipt: null, message: '' });
      void (async () => {
        try {
          const receipt = await request('POST', original);
          if (token !== epoch) return;
          identity = { ...original, previewHash: receipt.previewHash };
          if (receipt.state !== 'preview') { publish({ phase: 'uncertain' }); await readback(); return; }
          publish({ phase: 'confirming', receipt });
        } catch (error) {
          if (token !== epoch) return;
          if (error instanceof RecordActionClientError && error.code !== 'RECORD_ACTION_UNCERTAIN') fail(error.code);
          else { publish({ phase: 'uncertain' }); await readback(); }
        }
      })();
      return result;
    },
    async apply(confirmation: string) {
      if (state.phase !== 'confirming' || !state.request || !state.receipt || confirmation !== RECORD_ACTION_CONFIRMATION || appliedAttempt) return;
      if (Date.parse(state.receipt.expiresAt) <= now()) { fail('RECORD_ACTION_PREVIEW_EXPIRED'); return; }
      const body = { ...state.request, phase: 'apply' as const, previewHash: state.receipt.previewHash, confirmation: RECORD_ACTION_CONFIRMATION };
      identity = { ...body };
      try {
        if (options.storage?.getItem(pendingKey)) { fail('RECORD_ACTION_PENDING'); return; }
        options.storage?.setItem(pendingKey, JSON.stringify({ operationId: body.operationId, action: body.action, targetIds: body.targetIds, previewHash: body.previewHash })); }
      catch { fail('RECORD_ACTION_UNCERTAIN'); return; }
      appliedAttempt = true; options.onInvalidate?.(); publish({ phase: 'applying', message: '' });
      try {
        const receipt = await request('POST', body);
        if (receipt.state !== 'applied') throw new RecordActionClientError('RECORD_ACTION_UNCERTAIN');
        publish({ receipt, phase: 'uncertain' }); await readback();
      } catch (error) {
        if (error instanceof RecordActionClientError && error.code !== 'RECORD_ACTION_UNCERTAIN') {
          options.storage?.removeItem(pendingKey); fail(error.code);
        } else { publish({ phase: 'uncertain' }); await readback(); }
      }
    },
    cancel() {
      if (appliedAttempt && state.phase !== 'failed') return;
      ++epoch; reject?.(new RecordActionClientError('CANCELLED')); resolve = null; reject = null; identity = null;
      publish({ ...empty });
    },
    readback,
    recover,
  };
}
