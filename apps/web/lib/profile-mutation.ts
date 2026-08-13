import {
  classifyProfileAvatarUrl,
  getProfileAvatarVersionedReference,
  getProfileAvatarVersionedStorageKey,
} from "@/lib/profile-avatar-url";
import { readPublicProfileSummaries } from "@/lib/public-profile-read";

export const PROFILE_NICKNAME_UPDATE_RPC = "update_current_profile_nickname" as const;
export const PROFILE_AVATAR_COMPARE_AND_SET_RPC =
  "compare_and_set_current_profile_avatar" as const;
export const SIGNUP_PROFILE_READBACK_RPC = "read_signup_profile_state" as const;

export const PROFILE_MUTATION_ERROR_CODE = {
  invalidInput: "PROFILE_MUTATION_INVALID_INPUT",
  unavailable: "PROFILE_MUTATION_UNAVAILABLE",
  invalidResponse: "PROFILE_MUTATION_INVALID_RESPONSE",
  conflict: "PROFILE_MUTATION_CONFLICT",
} as const;

type ProfileMutationErrorCode =
  (typeof PROFILE_MUTATION_ERROR_CODE)[keyof typeof PROFILE_MUTATION_ERROR_CODE];

export class ProfileMutationError extends Error {
  readonly code: ProfileMutationErrorCode;

  constructor(code: ProfileMutationErrorCode) {
    super(code);
    this.name = "ProfileMutationError";
    this.code = code;
  }
}

export type CurrentProfileMutationState = Readonly<{
  userId: string;
  nickname: string;
  avatarReference: string | null;
}>;

export type ProfileNicknameMutationReceipt = Readonly<{
  schemaVersion: 1;
  status: "applied" | "unchanged";
  reasonCode: "PROFILE_NICKNAME_UPDATED" | "PROFILE_NICKNAME_UNCHANGED";
  profile: CurrentProfileMutationState;
  changes: Readonly<{ nickname: boolean }>;
  readback: Readonly<{ passed: true }>;
}>;

export type ProfileAvatarMutationReceipt = Readonly<{
  schemaVersion: 1;
  status: "applied" | "unchanged" | "conflict";
  reasonCode:
    | "PROFILE_AVATAR_UPDATED"
    | "PROFILE_AVATAR_UNCHANGED"
    | "PROFILE_VERSION_CONFLICT";
  profile: CurrentProfileMutationState;
  changes: Readonly<{ avatar: boolean }>;
  readback: Readonly<{ passed: true }>;
}>;

export type ProfileAvatarCleanupStatus =
  | "not_required"
  | "verified"
  | "pending";

export type ProfileAvatarSagaResult = Readonly<{
  receipt: ProfileAvatarMutationReceipt;
  cleanup: Readonly<{ status: ProfileAvatarCleanupStatus }>;
}>;

export type SignupProfileStateReceipt = Readonly<{
  schemaVersion: 1;
  complete: boolean;
  reasonCode: "SIGNUP_PROFILE_READY" | "SIGNUP_PROFILE_INCOMPLETE";
  nicknameMatches: boolean;
  counts: Readonly<{
    profile: number;
    ordinaryRole: number;
    adminRole: number;
    stats: number;
    activeStatus: number;
  }>;
}>;

type RpcResponse = Readonly<{
  data: unknown;
  error: unknown;
}>;

type StructuralRpcClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<RpcResponse>;
}>;

type StructuralStorageBucket = Readonly<{
  upload: (
    path: string,
    body: ArrayBuffer,
    options: Readonly<{
      upsert: false;
      contentType: "image/jpeg";
      cacheControl: "3600";
    }>,
  ) => PromiseLike<RpcResponse>;
  remove: (paths: string[]) => PromiseLike<RpcResponse>;
  exists: (path: string) => PromiseLike<RpcResponse>;
}>;

type StructuralStorageClient = Readonly<{
  from: (bucket: string) => StructuralStorageBucket;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_NICKNAME_LENGTH = 20;
const MIN_NICKNAME_LENGTH = 2;
const MAX_AVATAR_REFERENCE_LENGTH = 4_096;
const MAX_SIGNUP_STATE_COUNT = 2_147_483_647;
const PROFILE_AVATAR_BUCKET = "profile-avatars";
const MAX_STORAGE_OBJECT_ID_LENGTH = 256;
const MAX_PROFILE_AVATAR_BYTES = 2 * 1024 * 1024;

function fail(code: ProfileMutationErrorCode): never {
  throw new ProfileMutationError(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]) {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Object.keys(descriptors).sort();
    const sortedExpectedKeys = [...expectedKeys].sort();
    return actualKeys.length === sortedExpectedKeys.length
      && actualKeys.every((key, index) => key === sortedExpectedKeys[index])
      && sortedExpectedKeys.every((key) => "value" in descriptors[key]!);
  } catch {
    return false;
  }
}

function hasOwnDataProperties(value: Record<string, unknown>, keys: readonly string[]) {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return keys.every(
      (key) => Object.prototype.hasOwnProperty.call(descriptors, key)
        && "value" in descriptors[key]!,
    );
  } catch {
    return false;
  }
}

function isExactAvatarUploadData(value: unknown, expectedStorageKey: string) {
  return isPlainRecord(value)
    && hasExactKeys(value, ["id", "path", "fullPath"])
    && typeof value.id === "string"
    && value.id.length >= 1
    && value.id.length <= MAX_STORAGE_OBJECT_ID_LENGTH
    && value.path === expectedStorageKey
    && value.fullPath === `${PROFILE_AVATAR_BUCKET}/${expectedStorageKey}`;
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isCanonicalNickname(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length < MIN_NICKNAME_LENGTH
    || value.length > MAX_NICKNAME_LENGTH
    || value === "탈퇴한 사용자"
  ) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }

  try {
    return new TextEncoder().encode(value).byteLength <= 80;
  } catch {
    return false;
  }
}

function isBoundedLegacyNickname(value: unknown): value is string {
  if (typeof value !== "string" || value === "탈퇴한 사용자") return false;

  try {
    const characterLength = Array.from(value).length;
    return characterLength >= MIN_NICKNAME_LENGTH
      && characterLength <= MAX_NICKNAME_LENGTH;
  } catch {
    return false;
  }
}

function isBoundedRawAvatarReference(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;

  try {
    return new TextEncoder().encode(value).byteLength <= MAX_AVATAR_REFERENCE_LENGTH;
  } catch {
    return false;
  }
}

function getRpcClient(client: unknown): StructuralRpcClient {
  if (
    typeof client !== "object"
    || client === null
    || typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }

  return client as StructuralRpcClient;
}

function getStorageBucket(client: unknown): StructuralStorageBucket {
  if (typeof client !== "object" || client === null) {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }

  const storage = (client as { storage?: unknown }).storage;
  if (
    typeof storage !== "object"
    || storage === null
    || typeof (storage as { from?: unknown }).from !== "function"
  ) {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }

  let bucket: StructuralStorageBucket;
  try {
    bucket = (storage as StructuralStorageClient).from(PROFILE_AVATAR_BUCKET);
  } catch {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }
  if (
    typeof bucket !== "object"
    || bucket === null
    || typeof bucket.upload !== "function"
    || typeof bucket.remove !== "function"
    || typeof bucket.exists !== "function"
  ) {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }

  return bucket;
}

async function invokeRpc(
  client: unknown,
  functionName:
    | typeof PROFILE_NICKNAME_UPDATE_RPC
    | typeof PROFILE_AVATAR_COMPARE_AND_SET_RPC
    | typeof SIGNUP_PROFILE_READBACK_RPC,
  args: Readonly<Record<string, unknown>>,
) {
  let response: RpcResponse;
  try {
    response = await getRpcClient(client).rpc(functionName, args);
  } catch {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }

  try {
    if (!isPlainRecord(response) || !hasOwnDataProperties(response, ["data", "error"])) {
      fail(PROFILE_MUTATION_ERROR_CODE.invalidResponse);
    }
    if (response.error !== null) {
      fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
    }
    return response.data;
  } catch (error) {
    if (error instanceof ProfileMutationError) throw error;
    fail(PROFILE_MUTATION_ERROR_CODE.invalidResponse);
  }
}

function parseCurrentProfileState(
  value: unknown,
  expectedUserId: string,
  nicknameValidator: (nickname: unknown) => nickname is string,
): CurrentProfileMutationState | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["userId", "nickname", "avatarReference"])
    || value.userId !== expectedUserId
    || !nicknameValidator(value.nickname)
    || !isBoundedRawAvatarReference(value.avatarReference)
  ) {
    return null;
  }

  return {
    userId: value.userId,
    nickname: value.nickname,
    avatarReference: value.avatarReference,
  };
}

function hasPassedReadback(value: unknown): value is Readonly<{ passed: true }> {
  return isPlainRecord(value)
    && hasExactKeys(value, ["passed"])
    && value.passed === true;
}

function parseNicknameMutationReceipt(
  value: unknown,
  expectedUserId: string,
  expectedNickname: string,
): ProfileNicknameMutationReceipt | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      "schemaVersion",
      "status",
      "reasonCode",
      "profile",
      "changes",
      "readback",
    ])
    || value.schemaVersion !== 1
    || !isPlainRecord(value.changes)
    || !hasExactKeys(value.changes, ["nickname"])
    || typeof value.changes.nickname !== "boolean"
    || !hasPassedReadback(value.readback)
  ) {
    return null;
  }

  const profile = parseCurrentProfileState(
    value.profile,
    expectedUserId,
    isCanonicalNickname,
  );
  if (!profile || profile.nickname !== expectedNickname) return null;

  const applied = value.status === "applied"
    && value.reasonCode === "PROFILE_NICKNAME_UPDATED"
    && value.changes.nickname === true;
  const unchanged = value.status === "unchanged"
    && value.reasonCode === "PROFILE_NICKNAME_UNCHANGED"
    && value.changes.nickname === false;
  if (!applied && !unchanged) return null;

  return {
    schemaVersion: 1,
    status: value.status as ProfileNicknameMutationReceipt["status"],
    reasonCode: value.reasonCode as ProfileNicknameMutationReceipt["reasonCode"],
    profile,
    changes: { nickname: value.changes.nickname },
    readback: { passed: true },
  };
}

function parseAvatarMutationReceipt(
  value: unknown,
  expectedUserId: string,
  expectedAvatarReference: string | null,
  nextOperationId: string | null,
): ProfileAvatarMutationReceipt | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      "schemaVersion",
      "status",
      "reasonCode",
      "profile",
      "changes",
      "readback",
    ])
    || value.schemaVersion !== 1
    || !isPlainRecord(value.changes)
    || !hasExactKeys(value.changes, ["avatar"])
    || typeof value.changes.avatar !== "boolean"
    || !hasPassedReadback(value.readback)
  ) {
    return null;
  }

  const profile = parseCurrentProfileState(
    value.profile,
    expectedUserId,
    isBoundedLegacyNickname,
  );
  if (!profile) return null;

  const expectedNextReference = nextOperationId === null
    ? null
    : getProfileAvatarVersionedReference(expectedUserId, nextOperationId);
  if (expectedNextReference === null && nextOperationId !== null) return null;

  const applied = value.status === "applied"
    && value.reasonCode === "PROFILE_AVATAR_UPDATED"
    && value.changes.avatar === true
    && expectedAvatarReference !== expectedNextReference
    && profile.avatarReference === expectedNextReference;
  const unchanged = value.status === "unchanged"
    && value.reasonCode === "PROFILE_AVATAR_UNCHANGED"
    && value.changes.avatar === false
    && expectedAvatarReference === expectedNextReference
    && profile.avatarReference === expectedNextReference;
  const conflict = value.status === "conflict"
    && value.reasonCode === "PROFILE_VERSION_CONFLICT"
    && value.changes.avatar === false
    && profile.avatarReference !== expectedAvatarReference;
  if (!applied && !unchanged && !conflict) return null;

  return {
    schemaVersion: 1,
    status: value.status as ProfileAvatarMutationReceipt["status"],
    reasonCode: value.reasonCode as ProfileAvatarMutationReceipt["reasonCode"],
    profile,
    changes: { avatar: value.changes.avatar },
    readback: { passed: true },
  };
}

export async function updateCurrentProfileNickname(
  client: unknown,
  authenticatedUserId: string,
  nickname: string,
): Promise<ProfileNicknameMutationReceipt> {
  if (!isCanonicalUuid(authenticatedUserId) || !isCanonicalNickname(nickname)) {
    fail(PROFILE_MUTATION_ERROR_CODE.invalidInput);
  }

  const data = await invokeRpc(client, PROFILE_NICKNAME_UPDATE_RPC, {
    p_nickname: nickname,
  });
  const receipt = parseNicknameMutationReceipt(data, authenticatedUserId, nickname);
  if (!receipt) fail(PROFILE_MUTATION_ERROR_CODE.invalidResponse);
  return receipt;
}

export async function compareAndSetCurrentProfileAvatar(
  client: unknown,
  authenticatedUserId: string,
  expectedAvatarReference: string | null,
  nextAvatarOperationId: string | null,
): Promise<ProfileAvatarMutationReceipt> {
  if (
    !isCanonicalUuid(authenticatedUserId)
    || !isBoundedRawAvatarReference(expectedAvatarReference)
    || (nextAvatarOperationId !== null && !isCanonicalUuid(nextAvatarOperationId))
  ) {
    fail(PROFILE_MUTATION_ERROR_CODE.invalidInput);
  }

  const data = await invokeRpc(client, PROFILE_AVATAR_COMPARE_AND_SET_RPC, {
    p_expected_avatar_reference: expectedAvatarReference,
    p_next_avatar_operation_id: nextAvatarOperationId,
  });
  const receipt = parseAvatarMutationReceipt(
    data,
    authenticatedUserId,
    expectedAvatarReference,
    nextAvatarOperationId,
  );
  if (!receipt) fail(PROFILE_MUTATION_ERROR_CODE.invalidResponse);
  return receipt;
}

function isSignupStateCount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_SIGNUP_STATE_COUNT;
}

export async function readSignupProfileState(
  client: unknown,
  userId: string,
  expectedNickname: string,
): Promise<SignupProfileStateReceipt> {
  if (!isCanonicalUuid(userId) || !isCanonicalNickname(expectedNickname)) {
    fail(PROFILE_MUTATION_ERROR_CODE.invalidInput);
  }

  const data = await invokeRpc(client, SIGNUP_PROFILE_READBACK_RPC, {
    p_user_id: userId,
    p_expected_nickname: expectedNickname,
  });
  if (
    !isPlainRecord(data)
    || !hasExactKeys(data, [
      "schemaVersion",
      "complete",
      "reasonCode",
      "nicknameMatches",
      "counts",
    ])
    || data.schemaVersion !== 1
    || typeof data.complete !== "boolean"
    || typeof data.nicknameMatches !== "boolean"
    || !isPlainRecord(data.counts)
    || !hasExactKeys(data.counts, [
      "profile",
      "ordinaryRole",
      "adminRole",
      "stats",
      "activeStatus",
    ])
    || !isSignupStateCount(data.counts.profile)
    || !isSignupStateCount(data.counts.ordinaryRole)
    || !isSignupStateCount(data.counts.adminRole)
    || !isSignupStateCount(data.counts.stats)
    || !isSignupStateCount(data.counts.activeStatus)
    || (data.complete && data.reasonCode !== "SIGNUP_PROFILE_READY")
    || (!data.complete && data.reasonCode !== "SIGNUP_PROFILE_INCOMPLETE")
  ) {
    fail(PROFILE_MUTATION_ERROR_CODE.invalidResponse);
  }

  return {
    schemaVersion: 1,
    complete: data.complete,
    reasonCode: data.reasonCode as SignupProfileStateReceipt["reasonCode"],
    nicknameMatches: data.nicknameMatches,
    counts: {
      profile: data.counts.profile,
      ordinaryRole: data.counts.ordinaryRole,
      adminRole: data.counts.adminRole,
      stats: data.counts.stats,
      activeStatus: data.counts.activeStatus,
    },
  };
}

export function isSignupProfileStateReady(receipt: SignupProfileStateReceipt): boolean {
  return receipt.complete === true
    && receipt.reasonCode === "SIGNUP_PROFILE_READY"
    && receipt.nicknameMatches === true
    && receipt.counts.profile === 1
    && receipt.counts.ordinaryRole === 1
    && receipt.counts.adminRole === 0
    && receipt.counts.stats === 1
    && receipt.counts.activeStatus === 1;
}

async function verifyAvatarObjectAbsent(
  bucket: StructuralStorageBucket,
  storageKey: string,
) {
  try {
    const response = await bucket.exists(storageKey);
    return isPlainRecord(response)
      && hasExactKeys(response, ["data", "error"])
      && response.data === false
      && response.error !== null
      && response.error !== undefined;
  } catch {
    return false;
  }
}

async function removeAvatarObject(
  client: unknown,
  storageKey: string,
): Promise<"verified" | "pending"> {
  let bucket: StructuralStorageBucket;
  try {
    bucket = getStorageBucket(client);
  } catch {
    return "pending";
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await bucket.remove([storageKey]);
      if (
        !isPlainRecord(response)
        || !hasExactKeys(response, ["data", "error"])
        || response.error !== null
        || !Array.isArray(response.data)
      ) {
        // An exact-path absence readback below remains authoritative.
      }
    } catch {
      // An exact-path absence readback below remains authoritative.
    }

    if (await verifyAvatarObjectAbsent(bucket, storageKey)) return "verified";
  }

  return "pending";
}

async function readCurrentProfileMutationState(
  client: unknown,
  authenticatedUserId: string,
): Promise<CurrentProfileMutationState | null> {
  try {
    const rows = await readPublicProfileSummaries(client, [authenticatedUserId]);
    const row = rows.length === 1 ? rows[0] : null;
    if (!row || row.user_id !== authenticatedUserId) return null;
    return {
      userId: row.user_id,
      nickname: row.nickname,
      avatarReference: row.avatar_url,
    };
  } catch {
    return null;
  }
}

function recoveredAvatarReceipt(
  profile: CurrentProfileMutationState,
): ProfileAvatarMutationReceipt {
  return {
    schemaVersion: 1,
    status: "unchanged",
    reasonCode: "PROFILE_AVATAR_UNCHANGED",
    profile,
    changes: { avatar: false },
    readback: { passed: true },
  };
}

function createAvatarOperationId() {
  try {
    const operationId = globalThis.crypto?.randomUUID();
    return isCanonicalUuid(operationId) ? operationId : null;
  } catch {
    return null;
  }
}

export async function uploadCurrentProfileAvatar(
  client: unknown,
  authenticatedUserId: string,
  expectedAvatarReference: string | null,
  content: Blob,
): Promise<ProfileAvatarSagaResult> {
  if (
    !isCanonicalUuid(authenticatedUserId)
    || !isBoundedRawAvatarReference(expectedAvatarReference)
    || !(content instanceof Blob)
    || content.type !== "image/jpeg"
    || content.size < 1
    || content.size > MAX_PROFILE_AVATAR_BYTES
  ) {
    fail(PROFILE_MUTATION_ERROR_CODE.invalidInput);
  }

  const operationId = createAvatarOperationId();
  const stagedStorageKey = getProfileAvatarVersionedStorageKey(
    authenticatedUserId,
    operationId,
  );
  if (!operationId || !stagedStorageKey) {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }

  const previousAvatar = expectedAvatarReference === null
    ? null
    : classifyProfileAvatarUrl(expectedAvatarReference, authenticatedUserId);
  const nextAvatarReference = getProfileAvatarVersionedReference(
    authenticatedUserId,
    operationId,
  );
  if (!nextAvatarReference) {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }

  let uploadBody: ArrayBuffer;
  try {
    uploadBody = await content.arrayBuffer();
  } catch {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }
  if (uploadBody.byteLength !== content.size) {
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }

  try {
    const uploadResponse = await getStorageBucket(client).upload(
      stagedStorageKey,
      uploadBody,
      { upsert: false, contentType: "image/jpeg", cacheControl: "3600" },
    );
    if (
      !isPlainRecord(uploadResponse)
      || !hasExactKeys(uploadResponse, ["data", "error"])
      || uploadResponse.error !== null
      || !isExactAvatarUploadData(uploadResponse.data, stagedStorageKey)
    ) {
      fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
    }
  } catch (error) {
    // The database cannot reference this operation before CAS begins, so cleanup is safe.
    await removeAvatarObject(client, stagedStorageKey);
    if (error instanceof ProfileMutationError) throw error;
    fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
  }

  let rpcReceipt: ProfileAvatarMutationReceipt;
  try {
    rpcReceipt = await compareAndSetCurrentProfileAvatar(
      client,
      authenticatedUserId,
      expectedAvatarReference,
      operationId,
    );
  } catch {
    // Replaying the exact expected reference and operation ID serializes with a
    // delayed first transaction. A second ambiguous transport must never cause
    // the staged object to be deleted because either request may still commit it.
    try {
      rpcReceipt = await compareAndSetCurrentProfileAvatar(
        client,
        authenticatedUserId,
        expectedAvatarReference,
        operationId,
      );
    } catch {
      const readback = await readCurrentProfileMutationState(
        client,
        authenticatedUserId,
      );
      if (readback?.avatarReference !== nextAvatarReference) {
        fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
      }
      rpcReceipt = recoveredAvatarReceipt(readback);
    }
  }

  let receipt: ProfileAvatarMutationReceipt;
  if (rpcReceipt.status === "conflict") {
    if (rpcReceipt.profile.avatarReference === nextAvatarReference) {
      receipt = recoveredAvatarReceipt(rpcReceipt.profile);
    } else {
      const cleanupStatus = await removeAvatarObject(client, stagedStorageKey);
      if (cleanupStatus !== "verified") {
        fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
      }
      fail(PROFILE_MUTATION_ERROR_CODE.conflict);
    }
  } else {
    receipt = rpcReceipt;
  }

  if (
    previousAvatar?.kind === "owned_storage"
    && previousAvatar.storageKey !== stagedStorageKey
  ) {
    return {
      receipt,
      cleanup: {
        status: await removeAvatarObject(client, previousAvatar.storageKey),
      },
    };
  }

  return { receipt, cleanup: { status: "not_required" } };
}

export async function clearCurrentProfileAvatar(
  client: unknown,
  authenticatedUserId: string,
  expectedAvatarReference: string,
): Promise<ProfileAvatarSagaResult> {
  if (
    !isCanonicalUuid(authenticatedUserId)
    || !isBoundedRawAvatarReference(expectedAvatarReference)
  ) {
    fail(PROFILE_MUTATION_ERROR_CODE.invalidInput);
  }

  const previousAvatar = classifyProfileAvatarUrl(
    expectedAvatarReference,
    authenticatedUserId,
  );
  let rpcReceipt: ProfileAvatarMutationReceipt;
  try {
    rpcReceipt = await compareAndSetCurrentProfileAvatar(
      client,
      authenticatedUserId,
      expectedAvatarReference,
      null,
    );
  } catch {
    try {
      rpcReceipt = await compareAndSetCurrentProfileAvatar(
        client,
        authenticatedUserId,
        expectedAvatarReference,
        null,
      );
    } catch {
      const readback = await readCurrentProfileMutationState(
        client,
        authenticatedUserId,
      );
      if (readback?.avatarReference !== null) {
        fail(PROFILE_MUTATION_ERROR_CODE.unavailable);
      }
      rpcReceipt = recoveredAvatarReceipt(readback);
    }
  }

  let receipt: ProfileAvatarMutationReceipt;
  if (rpcReceipt.status === "conflict") {
    if (rpcReceipt.profile.avatarReference === null) {
      receipt = recoveredAvatarReceipt(rpcReceipt.profile);
    } else {
      fail(PROFILE_MUTATION_ERROR_CODE.conflict);
    }
  } else {
    receipt = rpcReceipt;
  }

  if (previousAvatar.kind === "owned_storage") {
    return {
      receipt,
      cleanup: {
        status: await removeAvatarObject(client, previousAvatar.storageKey),
      },
    };
  }

  return { receipt, cleanup: { status: "not_required" } };
}
