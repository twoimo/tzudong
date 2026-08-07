import { clearBrowserDraftsForUser } from '@/lib/privacy/browser-draft-cleanup';

export const ACCOUNT_DELETION_CONFIRMATION_TEXT = '계정 삭제' as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_HASH_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_MANIFEST_HASH_PATTERN = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const RECEIPT_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
const AUTH_RECEIPT_REFERENCE_PATTERN = RECEIPT_REFERENCE_PATTERN;
export const MAX_ACCOUNT_DELETION_STORAGE_RECEIPT_REFS = 100;

export type AccountDeletionCounts = Readonly<{
  delete: number;
  anonymize: number;
  separate: number;
  retain: number;
}>;

export type AccountDeletionPreview = Readonly<{
  requestId: string;
  previewHash: string;
  expiresAt: string;
  policyVersion: string;
  sourceManifestHash: string;
  counts: AccountDeletionCounts;
}>;
export type AccountDeletionStorageWorkItem = Readonly<{
  bucketId: string;
  objectName: string;
  objectLocatorHash: string;
  objectVersionHash: string;
}>;
export type AccountDeletionStorageReceiptRef = Readonly<{
  objectLocatorHash: string;
  objectVersionHash: string;
  providerReceiptRef: string;
  providerReceiptHash: string;
}>;
export type AccountDeletionReceipt = Readonly<{
  requestId: string;
  status: 'applied';
  reasonCode: 'APPLIED';
  sourceManifestHash: string;
  counts: AccountDeletionCounts;
  readback: Readonly<{
    database: true;
    storage: true;
    sessions: true;
    auth: true;
  }>;
  storageReceiptRefs: readonly AccountDeletionStorageReceiptRef[];
  authReceiptRef: string;
}>;

export type AccountDeletionInProgressStatus = Readonly<{
  status: 'in_progress';
}>;
export type AccountDeletionAppliedStatus = Readonly<{
  status: 'applied';
  reasonCode: 'APPLIED';
  counts: AccountDeletionCounts;
  receipt: AccountDeletionReceipt;
}>;
export type AccountDeletionIncompleteStatus = Readonly<{
  status: 'partial' | 'failed';
  reasonCode: string;
  counts: AccountDeletionCounts;
}>;
export type AccountDeletionStatus =
  | AccountDeletionInProgressStatus
  | AccountDeletionAppliedStatus
  | AccountDeletionIncompleteStatus;
export type AccountDeletionBrowserCleanupReadback = Readonly<{
  auth: boolean;
  submissionDrafts: boolean;
  reviewDrafts: boolean;
  editRequestDrafts: boolean;
}>;

export type AccountDeletionBrowserCleanupResult = Readonly<{
  status: 'complete' | 'failed';
  readback: AccountDeletionBrowserCleanupReadback;
}>;


type RecordValue = Record<string, unknown>;
export type AccountDeletionProviderAttestationInput = Readonly<{
  actorUserId: string;
  targetUserId: string;
  requestId: string;
  previewHash: string;
  idempotencyKey: string;
  sourceManifestHash: string;
  leaseToken: string;
}>;
export type AccountDeletionVerifiedStorageReceipt =
  AccountDeletionProviderAttestationInput & Readonly<{
    objectLocatorHash: string;
    objectVersionHash: string;
    providerReceiptRef: string;
    providerReceiptHash: string;
  }>;
export type AccountDeletionVerifiedAuthReceipt =
  AccountDeletionProviderAttestationInput & Readonly<{
    authReceiptRef: string;
  }>;
export type AccountDeletionProviderAttestation = Readonly<{
  getVerifiedStorageReceipts: (
    input: AccountDeletionProviderAttestationInput & Readonly<{
      workItems: readonly AccountDeletionStorageWorkItem[];
    }>,
  ) => Promise<readonly AccountDeletionVerifiedStorageReceipt[] | null>;
  getVerifiedAuthReceipt: (
    input: AccountDeletionProviderAttestationInput & Readonly<{
      storageReceiptRefs: readonly AccountDeletionStorageReceiptRef[];
    }>,
  ) => Promise<AccountDeletionVerifiedAuthReceipt | null>;
}>;
export type AccountDeletionProviderAttestationFactory = () => AccountDeletionProviderAttestation | null;

/**
 * Source-pinned production dependency. It remains unavailable until an
 * independent verifier publishes owner-only proof records it can read.
 */
export const createAccountDeletionProviderAttestation = (): AccountDeletionProviderAttestation | null =>
  null;

let accountDeletionProviderAttestationFactory: AccountDeletionProviderAttestationFactory =
  createAccountDeletionProviderAttestation;

export const getAccountDeletionProviderAttestation = () =>
  accountDeletionProviderAttestationFactory();

export const setAccountDeletionProviderAttestationFactoryForTests = (
  factory: AccountDeletionProviderAttestationFactory,
) => {
  accountDeletionProviderAttestationFactory = factory;
};

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: RecordValue, keys: readonly string[]) =>
  Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));
const isBoundedPolicyVersion = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= 128
  && !/[\u0000-\u001f\u007f]/.test(value);

const isSafeCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isCounts = (value: unknown): value is AccountDeletionCounts =>
  isRecord(value)
  && hasExactKeys(value, ['delete', 'anonymize', 'separate', 'retain'])
  && isSafeCount(value.delete)
  && isSafeCount(value.anonymize)
  && isSafeCount(value.separate)
  && isSafeCount(value.retain);

const isReadback = (value: unknown): value is AccountDeletionReceipt['readback'] =>
  isRecord(value)
  && hasExactKeys(value, ['database', 'storage', 'sessions', 'auth'])
  && value.database === true
  && value.storage === true
  && value.sessions === true
  && value.auth === true;

const isStorageReceiptRefs = (
  value: unknown,
): value is readonly AccountDeletionStorageReceiptRef[] => {
  if (!Array.isArray(value) || value.length > MAX_ACCOUNT_DELETION_STORAGE_RECEIPT_REFS) return false;

  const objectLocators = new Set<string>();
  const providerReceiptRefs = new Set<string>();
  return value.every((receipt) => {
    if (
      !isRecord(receipt)
      || !hasExactKeys(receipt, [
        'objectLocatorHash',
        'objectVersionHash',
        'providerReceiptRef',
        'providerReceiptHash',
      ])
      || !isAccountDeletionSourceManifestHash(receipt.objectLocatorHash)
      || !isAccountDeletionSourceManifestHash(receipt.objectVersionHash)
      || typeof receipt.providerReceiptRef !== 'string'
      || !RECEIPT_REFERENCE_PATTERN.test(receipt.providerReceiptRef)
      || !isAccountDeletionSourceManifestHash(receipt.providerReceiptHash)
      || objectLocators.has(receipt.objectLocatorHash)
      || providerReceiptRefs.has(receipt.providerReceiptRef)
    ) {
      return false;
    }

    objectLocators.add(receipt.objectLocatorHash);
    providerReceiptRefs.add(receipt.providerReceiptRef);
    return true;
  });
};

export const isAccountDeletionConfirmation = (
  value: unknown,
): value is typeof ACCOUNT_DELETION_CONFIRMATION_TEXT =>
  value === ACCOUNT_DELETION_CONFIRMATION_TEXT;

export const isAccountDeletionRequestId = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

export const isAccountDeletionPreviewHash = (value: unknown): value is string =>
  typeof value === 'string' && PREVIEW_HASH_PATTERN.test(value);

export const isAccountDeletionSourceManifestHash = (value: unknown): value is string =>
  typeof value === 'string' && SOURCE_MANIFEST_HASH_PATTERN.test(value);

export const isAccountDeletionIdempotencyKey = (value: unknown): value is string =>
  typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value);

export const createAccountDeletionIdempotencyKey = () => crypto.randomUUID();

export const parseAccountDeletionPreview = (value: unknown): AccountDeletionPreview | null => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'requestId',
      'previewHash',
      'expiresAt',
      'policyVersion',
      'sourceManifestHash',
      'counts',
    ])
    || !isRecord(value.counts)
  ) {
    return null;
  }
  if (
    !isAccountDeletionRequestId(value.requestId)
    || !isAccountDeletionPreviewHash(value.previewHash)
    || typeof value.expiresAt !== 'string'
    || !isBoundedPolicyVersion(value.policyVersion)
    || !isAccountDeletionSourceManifestHash(value.sourceManifestHash)
    || !isCounts(value.counts)
  ) {
    return null;
  }

  const expiresAt = new Date(value.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return null;

  return {
    requestId: value.requestId,
    previewHash: value.previewHash,
    expiresAt: expiresAt.toISOString(),
    policyVersion: value.policyVersion,
    sourceManifestHash: value.sourceManifestHash,
    counts: value.counts,
  };
};

export const isAccountDeletionPreviewFresh = (
  preview: AccountDeletionPreview,
  now = new Date(),
) => new Date(preview.expiresAt).getTime() > now.getTime();

export const parseAccountDeletionReceipt = (value: unknown): AccountDeletionReceipt | null => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'requestId',
      'status',
      'reasonCode',
      'sourceManifestHash',
      'counts',
      'readback',
      'storageReceiptRefs',
      'authReceiptRef',
    ])
    || !isRecord(value.counts)
    || !isRecord(value.readback)
  ) {
    return null;
  }
  if (
    !isAccountDeletionRequestId(value.requestId)
    || value.status !== 'applied'
    || value.reasonCode !== 'APPLIED'
    || !isAccountDeletionSourceManifestHash(value.sourceManifestHash)
    || !isCounts(value.counts)
    || !isReadback(value.readback)
    || !isStorageReceiptRefs(value.storageReceiptRefs)
    || typeof value.authReceiptRef !== 'string'
    || !AUTH_RECEIPT_REFERENCE_PATTERN.test(value.authReceiptRef)
  ) {
    return null;
  }

  return {
    requestId: value.requestId,
    status: 'applied',
    reasonCode: 'APPLIED',
    sourceManifestHash: value.sourceManifestHash,
    counts: value.counts,
    readback: value.readback,
    storageReceiptRefs: value.storageReceiptRefs,
    authReceiptRef: value.authReceiptRef,
  };
};


export const parseAccountDeletionStatus = (value: unknown): AccountDeletionStatus | null => {
  if (!isRecord(value) || typeof value.status !== 'string') return null;

  if (value.status === 'in_progress') {
    return hasExactKeys(value, ['status']) ? { status: 'in_progress' } : null;
  }

  if (value.status === 'applied') {
    if (
      !hasExactKeys(value, ['status', 'reasonCode', 'counts', 'receipt'])
      || value.reasonCode !== 'APPLIED'
      || !isCounts(value.counts)
    ) {
      return null;
    }

    const receipt = parseAccountDeletionReceipt(value.receipt);
    return receipt
      && receipt.reasonCode === value.reasonCode
      && receipt.counts.delete === value.counts.delete
      && receipt.counts.anonymize === value.counts.anonymize
      && receipt.counts.separate === value.counts.separate
      && receipt.counts.retain === value.counts.retain
      ? { status: 'applied', reasonCode: 'APPLIED', counts: value.counts, receipt }
      : null;
  }

  if (
    (value.status !== 'partial' && value.status !== 'failed')
    || !hasExactKeys(value, ['status', 'reasonCode', 'counts'])
    || typeof value.reasonCode !== 'string'
    || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reasonCode)
    || !isCounts(value.counts)
  ) {
    return null;
  }

  return { status: value.status, reasonCode: value.reasonCode, counts: value.counts };
};

const SUPABASE_AUTH_STORAGE_KEY_PATTERN = /^(?:sb-[a-z0-9-]+-auth-token(?:-code-verifier)?|supabase\.auth(?:\.[a-z0-9-]+)?)$/i;

const failedBrowserCleanup = (): AccountDeletionBrowserCleanupResult => ({
  status: 'failed',
  readback: {
    auth: false,
    submissionDrafts: false,
    reviewDrafts: false,
    editRequestDrafts: false,
  },
});

const isSupabaseAuthStorageKey = (key: string): boolean =>
  SUPABASE_AUTH_STORAGE_KEY_PATTERN.test(key);

const clearSupabaseAuthStorage = (): boolean => {
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let index = store.length - 1; index >= 0; index -= 1) {
        const key = store.key(index);
        if (key && isSupabaseAuthStorageKey(key)) {
          store.removeItem(key);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
};

const hasSupabaseAuthStorageKeys = (): boolean => {
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (key && isSupabaseAuthStorageKey(key)) return true;
      }
    }
    return false;
  } catch {
    return true;
  }
};

/**
 * Clears Supabase auth keys and the deleted user's drafts only after a fully
 * validated applied receipt. The result contains a bounded local readback.
 */
export const clearAccountDeletionBrowserStores = async (
  deletedUserId: string,
  receipt: AccountDeletionReceipt,
): Promise<AccountDeletionBrowserCleanupResult> => {
  if (
    typeof window === 'undefined'
    || !isAccountDeletionRequestId(deletedUserId)
    || !parseAccountDeletionReceipt(receipt)
  ) {
    return failedBrowserCleanup();
  }

  try {
    const authCleared = clearSupabaseAuthStorage();
    const { submissionDrafts, reviewDrafts, editRequestDrafts } =
      await clearBrowserDraftsForUser(deletedUserId);
    const readback: AccountDeletionBrowserCleanupReadback = {
      auth: authCleared && !hasSupabaseAuthStorageKeys(),
      submissionDrafts,
      reviewDrafts,
      editRequestDrafts,
    };

    return {
      status: readback.auth
        && readback.submissionDrafts
        && readback.reviewDrafts
        && readback.editRequestDrafts
        ? 'complete'
        : 'failed',
      readback,
    };
  } catch {
    return failedBrowserCleanup();
  }
};
