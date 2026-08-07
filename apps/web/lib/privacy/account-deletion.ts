import { isSupabaseAuthSessionStorageKey } from '@/lib/supabase-auth-session-hints';
import {
  deleteDraftsByUser as deleteEditRequestDraftsByUser,
} from '@/lib/editRequestDraftDB';
import {
  deleteDraftsByUser as deleteReviewDraftsByUser,
} from '@/lib/reviewDraftDB';
import {
  deleteDraftsByUser as deleteSubmissionDraftsByUser,
} from '@/lib/submissionDraftDB';

type PrimitiveRecord = Record<string, unknown>;

type ServerReadback = PrimitiveRecord | null;

type StorageLike = {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
};

export const ACCOUNT_DELETION_BROWSER_CLEANUP_QUERY_PARAM = 'deleteCleanup';
export const ACCOUNT_DELETION_BROWSER_CLEANUP_QUERY_VALUE = 'required';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toTrimmedString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function isNonEmptyString(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.trim().length > 0;
}

function normalizeUserId(raw: unknown): string {
  return isNonEmptyString(raw) ? raw.trim() : '';
}

function isUuid(value: string): boolean {
  return UUID_V4_RE.test(value);
}

function asRecord(raw: unknown): PrimitiveRecord | null {
  return typeof raw === 'object' && raw !== null ? (raw as PrimitiveRecord) : null;
}

function extractReceiptUserId(receipt: PrimitiveRecord): string {
  const payload = asRecord(receipt.payload);
  const readback = asRecord(receipt.readback);

  const candidates = [
    receipt.userId,
    receipt.targetUserId,
    receipt.deletedUserId,
    receipt.accountId,
    receipt.appliedUserId,
    payload?.userId,
    readback?.userId,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUserId(candidate);
    if (normalized && isUuid(normalized)) {
      return normalized;
    }
  }

  return '';
}

function extractReadback(receipt: PrimitiveRecord): ServerReadback {
  return asRecord(receipt.readback);
}

function hasBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isAppliedReceipt(receipt: unknown, expectedUserId: string): boolean {
  const raw = asRecord(receipt);
  if (!raw || raw.success !== true) return false;

  const readback = extractReadback(raw);

  const isApplied = raw.applied === true || (readback?.applied === true);
  if (!isApplied) return false;

  if (hasBoolean(raw.applied) && raw.applied !== true) return false;
  if (readback && hasBoolean(readback.applied) && readback.applied !== true) return false;

  const receiptUserId = extractReceiptUserId(raw);
  if (!receiptUserId || receiptUserId !== expectedUserId) return false;

  const readbackUserId = normalizeUserId(readback?.userId);
  if (readbackUserId && readbackUserId !== expectedUserId) return false;

  return true;
}

function clearStorageAuthKeys(storage: StorageLike | null | undefined): number {
  if (!storage) {
    return 0;
  }

  const keys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isSupabaseAuthSessionStorageKey(key)) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    storage.removeItem(key);
  }

  return keys.length;
}

function clearLocalAuthStorageKeys(): number {
  return clearStorageAuthKeys(window.localStorage);
}

function clearSessionAuthStorageKeys(): number {
  return clearStorageAuthKeys(window.sessionStorage);
}

function clearAuthCookies(): number {
  const cookieParts = document.cookie.split(';');
  const names: string[] = [];

  for (const cookiePart of cookieParts) {
    const [rawName] = cookiePart.trim().split('=');
    const key = toTrimmedString(rawName);

    if (!key || !isSupabaseAuthSessionStorageKey(key)) continue;
    names.push(key);
  }

  const expires = 'Thu, 01 Jan 1970 00:00:00 GMT';
  for (const name of names) {
    document.cookie = `${name}=; expires=${expires}; max-age=0; path=/`;
  }

  return names.length;
}

export type AccountDeletionBrowserCleanupFailureReason =
  | 'complete'
  | 'invalid-user-id'
  | 'invalid-receipt'
  | 'unsupported-environment'
  | 'auth-key-cleanup-failed'
  | 'submission-draft-cleanup-failed'
  | 'review-draft-cleanup-failed'
  | 'edit-request-draft-cleanup-failed';

export type AccountDeletionBrowserCleanupReadback = {
  draftCleanup: {
    submission: number;
    review: number;
    editRequest: number;
    total: number;
  };
  authKeysRemoved: {
    localStorage: number;
    cookie: number;
  };
};

export type AccountDeletionBrowserCleanupResult = {
  status: 'completed' | 'failed';
  failureReason: AccountDeletionBrowserCleanupFailureReason;
  readback: AccountDeletionBrowserCleanupReadback;
};

function createResult(
  status: AccountDeletionBrowserCleanupResult['status'],
  failureReason: AccountDeletionBrowserCleanupFailureReason,
  draftCleanup: AccountDeletionBrowserCleanupReadback['draftCleanup'],
  localStorageKeysRemoved: number,
  cookieKeysRemoved: number,
): AccountDeletionBrowserCleanupResult {
  return {
    status,
    failureReason,
    readback: {
      draftCleanup,
      authKeysRemoved: {
        localStorage: localStorageKeysRemoved,
        cookie: cookieKeysRemoved,
      },
    },
  };
}

function buildFailed(
  failureReason: Exclude<AccountDeletionBrowserCleanupFailureReason, 'complete'>,
  localStorageKeysRemoved: number,
  cookieKeysRemoved: number,
  draftCleanup: AccountDeletionBrowserCleanupReadback['draftCleanup'],
): AccountDeletionBrowserCleanupResult {
  return createResult(
    'failed',
    failureReason,
    draftCleanup,
    localStorageKeysRemoved,
    cookieKeysRemoved,
  );
}

function emptyDraftReadback(): AccountDeletionBrowserCleanupReadback['draftCleanup'] {
  return {
    submission: 0,
    review: 0,
    editRequest: 0,
    total: 0,
  };
}

export async function clearAccountDeletionBrowserStores(
  deletedUserId: string,
  appliedServerReceipt: unknown,
): Promise<AccountDeletionBrowserCleanupResult> {
  const userId = normalizeUserId(deletedUserId);

  if (!isUuid(userId)) {
    return buildFailed('invalid-user-id', 0, 0, emptyDraftReadback());
  }

  if (!isAppliedReceipt(appliedServerReceipt, userId)) {
    return buildFailed('invalid-receipt', 0, 0, emptyDraftReadback());
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return buildFailed('unsupported-environment', 0, 0, emptyDraftReadback());
  }

  const draftCleanup = emptyDraftReadback();
  let localStorageKeysRemoved = 0;
  let cookieKeysRemoved = 0;
  let failureReason: Exclude<AccountDeletionBrowserCleanupFailureReason, 'complete'> | null = null;

  try {
    localStorageKeysRemoved += clearLocalAuthStorageKeys();
  } catch {
    failureReason = 'auth-key-cleanup-failed';
  }

  try {
    localStorageKeysRemoved += clearSessionAuthStorageKeys();
  } catch {
    if (!failureReason) {
      failureReason = 'auth-key-cleanup-failed';
    }
  }

  try {
    cookieKeysRemoved = clearAuthCookies();
  } catch {
    if (!failureReason) {
      failureReason = 'auth-key-cleanup-failed';
    }
  }

  try {
    draftCleanup.submission = await deleteSubmissionDraftsByUser(userId);
  } catch {
    failureReason = failureReason ?? 'submission-draft-cleanup-failed';
  }

  try {
    draftCleanup.review = await deleteReviewDraftsByUser(userId);
  } catch {
    failureReason = failureReason ?? 'review-draft-cleanup-failed';
  }

  try {
    draftCleanup.editRequest = await deleteEditRequestDraftsByUser(userId);
  } catch {
    failureReason = failureReason ?? 'edit-request-draft-cleanup-failed';
  }

  draftCleanup.total =
    draftCleanup.submission + draftCleanup.review + draftCleanup.editRequest;

  if (failureReason) {
    return buildFailed(
      failureReason,
      localStorageKeysRemoved,
      cookieKeysRemoved,
      draftCleanup,
    );
  }

  return createResult(
    'completed',
    'complete',
    draftCleanup,
    localStorageKeysRemoved,
    cookieKeysRemoved,
  );
}

export function buildDataDeletionGuidanceUrlWithCleanupFlag(dataDeletionPath: string): string {
  const params = new URLSearchParams();
  params.set(
    ACCOUNT_DELETION_BROWSER_CLEANUP_QUERY_PARAM,
    ACCOUNT_DELETION_BROWSER_CLEANUP_QUERY_VALUE,
  );

  return `${dataDeletionPath}?${params.toString()}`;
}
