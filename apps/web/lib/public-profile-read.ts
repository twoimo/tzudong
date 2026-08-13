export const PUBLIC_PROFILE_SUMMARIES_RPC = "read_public_profile_summaries" as const;
export const PUBLIC_PROFILE_LEADERBOARD_RPC = "read_public_profile_leaderboard" as const;
export const PUBLIC_PROFILE_LEADERBOARD_PAGE_RPC =
  "read_public_profile_leaderboard_page" as const;

export const PUBLIC_PROFILE_READ_ERROR_CODE = {
  invalidInput: "PUBLIC_PROFILE_READ_INVALID_INPUT",
  unavailable: "PUBLIC_PROFILE_READ_UNAVAILABLE",
  invalidResponse: "PUBLIC_PROFILE_READ_INVALID_RESPONSE",
  invalidSession: "PUBLIC_PROFILE_READ_INVALID_SESSION",
} as const;

type PublicProfileReadErrorCode =
  (typeof PUBLIC_PROFILE_READ_ERROR_CODE)[keyof typeof PUBLIC_PROFILE_READ_ERROR_CODE];

export class PublicProfileReadError extends Error {
  readonly code: PublicProfileReadErrorCode;

  constructor(code: PublicProfileReadErrorCode) {
    super(code);
    this.name = "PublicProfileReadError";
    this.code = code;
  }
}

export type PublicProfileSummary = Readonly<{
  user_id: string;
  nickname: string;
  avatar_url: string | null;
}>;

export type PublicProfileLeaderboardPeriod = "all" | "monthly";

export type PublicProfileLeaderboardRow = Readonly<{
  user_id: string;
  nickname: string;
  review_count: number;
  verified_review_count: number;
  total_likes: number;
  avg_likes_per_review: number;
  quality_score: number;
}>;

export type PublicProfileLeaderboardCursor = Readonly<{
  qualityScore: number;
  userId: string;
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROFILE_ROWS = 100;
export const PUBLIC_PROFILE_LEADERBOARD_PAGE_SIZE = MAX_PROFILE_ROWS;
const MAX_NICKNAME_LENGTH = 100;
const MAX_AVATAR_REFERENCE_BYTES = 4_096;

function fail(code: PublicProfileReadErrorCode): never {
  throw new PublicProfileReadError(code);
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

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Object.keys(descriptors).sort();
    const expectedKeys = [...keys].sort();
    return (
      actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) => key === expectedKeys[index]) &&
      expectedKeys.every((key) => "value" in descriptors[key]!)
    );
  } catch {
    return false;
  }
}

function hasOwnDataProperties(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return keys.every((key) =>
      Object.prototype.hasOwnProperty.call(descriptors, key) &&
      "value" in descriptors[key]!,
    );
  } catch {
    return false;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isBoundedNickname(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NICKNAME_LENGTH &&
    value !== "탈퇴한 사용자"
  );
}

function isBoundedAvatarUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;

  try {
    return new TextEncoder().encode(value).byteLength <= MAX_AVATAR_REFERENCE_BYTES;
  } catch {
    return false;
  }
}

function isBoundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isBoundedMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isInvalidSessionProviderError(value: unknown) {
  if (!isPlainRecord(value)) return false;

  try {
    const code = typeof value.code === "string" ? value.code : "";
    if (code === "PGRST303" || code === "refresh_token_not_found") return true;

    const name = typeof value.name === "string" ? value.name : "";
    if (name === "AuthSessionMissingError") return true;

    const message =
      typeof value.message === "string" ? value.message.toLowerCase() : "";
    return (
      message.includes("jwt expired") ||
      message.includes("invalid jwt") ||
      message.includes("invalid refresh token") ||
      message.includes("refresh token not found") ||
      message.includes("auth session missing")
    );
  } catch {
    return false;
  }
}

function getRpcClient(client: unknown): StructuralRpcClient {
  if (
    typeof client !== "object" ||
    client === null ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.unavailable);
  }

  return client as StructuralRpcClient;
}

async function invokeRpc(
  client: unknown,
  functionName:
    | typeof PUBLIC_PROFILE_SUMMARIES_RPC
    | typeof PUBLIC_PROFILE_LEADERBOARD_RPC
    | typeof PUBLIC_PROFILE_LEADERBOARD_PAGE_RPC,
  args: Readonly<Record<string, unknown>>,
) {
  let response: RpcResponse;
  try {
    response = await getRpcClient(client).rpc(functionName, args);
  } catch {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.unavailable);
  }

  try {
    if (!isPlainRecord(response) || !hasOwnDataProperties(response, ["data", "error"])) {
      fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
    }
    if (response.error) {
      fail(
        isInvalidSessionProviderError(response.error)
          ? PUBLIC_PROFILE_READ_ERROR_CODE.invalidSession
          : PUBLIC_PROFILE_READ_ERROR_CODE.unavailable,
      );
    }

    return response.data;
  } catch (error) {
    if (error instanceof PublicProfileReadError) throw error;
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
  }
}

export function isPublicProfileInvalidSessionError(error: unknown) {
  return (
    error instanceof PublicProfileReadError &&
    error.code === PUBLIC_PROFILE_READ_ERROR_CODE.invalidSession
  );
}

export async function readPublicProfileSummaries(
  client: unknown,
  userIds: readonly string[],
): Promise<PublicProfileSummary[]> {
  if (!Array.isArray(userIds)) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput);
  }
  if (userIds.length === 0) return [];
  if (userIds.length > MAX_PROFILE_ROWS) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput);
  }

  if (userIds.some((userId) => typeof userId !== "string")) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput);
  }
  const requestedIds = userIds.map((userId) => userId.toLowerCase());
  if (
    requestedIds.some((userId) => !isUuid(userId)) ||
    new Set(requestedIds).size !== requestedIds.length
  ) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput);
  }

  const data = await invokeRpc(client, PUBLIC_PROFILE_SUMMARIES_RPC, {
    p_user_ids: requestedIds,
  });
  if (!Array.isArray(data) || data.length > requestedIds.length) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
  }

  const requestedOrdinals = new Map(
    requestedIds.map((userId, index) => [userId, index]),
  );
  const seenIds = new Set<string>();
  let previousOrdinal = -1;

  return data.map((value) => {
    if (
      !isPlainRecord(value) ||
      !hasExactKeys(value, ["user_id", "nickname", "avatar_url"]) ||
      !isUuid(value.user_id) ||
      !isBoundedNickname(value.nickname) ||
      !isBoundedAvatarUrl(value.avatar_url)
    ) {
      fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
    }

    const userId = value.user_id.toLowerCase();
    const ordinal = requestedOrdinals.get(userId);
    if (
      ordinal === undefined ||
      ordinal <= previousOrdinal ||
      seenIds.has(userId)
    ) {
      fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
    }
    previousOrdinal = ordinal;
    seenIds.add(userId);

    return {
      user_id: userId,
      nickname: value.nickname,
      avatar_url: value.avatar_url,
    };
  });
}

export async function readPublicProfileLeaderboard(
  client: unknown,
  period: PublicProfileLeaderboardPeriod,
  limit: number,
): Promise<PublicProfileLeaderboardRow[]> {
  if (
    (period !== "all" && period !== "monthly") ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PROFILE_ROWS
  ) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput);
  }

  const data = await invokeRpc(client, PUBLIC_PROFILE_LEADERBOARD_RPC, {
    p_period: period,
    p_limit: limit,
  });
  if (!Array.isArray(data) || data.length > limit) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
  }

  return parsePublicProfileLeaderboardRows(data, limit, null);
}

function isStrictlyAfterLeaderboardCursor(
  row: Pick<PublicProfileLeaderboardRow, "quality_score" | "user_id">,
  cursor: Pick<PublicProfileLeaderboardRow, "quality_score" | "user_id">,
) {
  return row.quality_score < cursor.quality_score || (
    row.quality_score === cursor.quality_score && row.user_id > cursor.user_id
  );
}

function parsePublicProfileLeaderboardRows(
  data: unknown,
  limit: number,
  after: Pick<PublicProfileLeaderboardRow, "quality_score" | "user_id"> | null,
): PublicProfileLeaderboardRow[] {
  if (!Array.isArray(data) || data.length > limit) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
  }

  const seenIds = new Set<string>();
  let previous = after;

  return data.map((value) => {
    if (
      !isPlainRecord(value) ||
      !hasExactKeys(value, [
        "user_id",
        "nickname",
        "review_count",
        "verified_review_count",
        "total_likes",
        "avg_likes_per_review",
        "quality_score",
      ]) ||
      !isUuid(value.user_id) ||
      !isBoundedNickname(value.nickname) ||
      !isBoundedCount(value.review_count) ||
      !isBoundedCount(value.verified_review_count) ||
      !isBoundedCount(value.total_likes) ||
      !isBoundedMetric(value.avg_likes_per_review) ||
      !isBoundedMetric(value.quality_score)
    ) {
      fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
    }

    const row: PublicProfileLeaderboardRow = {
      user_id: value.user_id.toLowerCase(),
      nickname: value.nickname,
      review_count: value.review_count,
      verified_review_count: value.verified_review_count,
      total_likes: value.total_likes,
      avg_likes_per_review: value.avg_likes_per_review,
      quality_score: value.quality_score,
    };

    if (
      seenIds.has(row.user_id) ||
      (previous !== null && !isStrictlyAfterLeaderboardCursor(row, previous))
    ) {
      fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
    }

    seenIds.add(row.user_id);
    previous = row;
    return row;
  });
}

export async function readPublicProfileLeaderboardPage(
  client: unknown,
  period: PublicProfileLeaderboardPeriod,
  limit: number,
  cursor: PublicProfileLeaderboardCursor | null,
): Promise<PublicProfileLeaderboardRow[]> {
  if (
    (period !== "all" && period !== "monthly") ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PROFILE_ROWS ||
    (cursor !== null && (
      !isPlainRecord(cursor) ||
      !hasExactKeys(cursor, ["qualityScore", "userId"]) ||
      !isBoundedMetric(cursor.qualityScore) ||
      !isUuid(cursor.userId)
    ))
  ) {
    fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput);
  }

  const normalizedCursor = cursor === null
    ? null
    : {
        quality_score: cursor.qualityScore,
        user_id: cursor.userId.toLowerCase(),
      };
  const data = await invokeRpc(client, PUBLIC_PROFILE_LEADERBOARD_PAGE_RPC, {
    p_period: period,
    p_limit: limit,
    p_after_quality_score: normalizedCursor?.quality_score ?? null,
    p_after_user_id: normalizedCursor?.user_id ?? null,
  });

  return parsePublicProfileLeaderboardRows(data, limit, normalizedCursor);
}

export async function readCompletePublicProfileLeaderboard(
  client: unknown,
  period: PublicProfileLeaderboardPeriod,
): Promise<PublicProfileLeaderboardRow[]> {
  const rows: PublicProfileLeaderboardRow[] = [];
  const seenIds = new Set<string>();
  let cursor: PublicProfileLeaderboardCursor | null = null;
  let previous: PublicProfileLeaderboardRow | null = null;

  for (;;) {
    const page = await readPublicProfileLeaderboardPage(
      client,
      period,
      PUBLIC_PROFILE_LEADERBOARD_PAGE_SIZE,
      cursor,
    );
    if (page.length === 0) return rows;

    for (const row of page) {
      if (
        seenIds.has(row.user_id) ||
        (previous !== null && !isStrictlyAfterLeaderboardCursor(row, previous))
      ) {
        fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
      }
      seenIds.add(row.user_id);
      rows.push(row);
      previous = row;
    }

    const tail = page.at(-1)!;
    const nextCursor = {
      qualityScore: tail.quality_score,
      userId: tail.user_id,
    };
    if (
      cursor !== null &&
      nextCursor.qualityScore === cursor.qualityScore &&
      nextCursor.userId === cursor.userId
    ) {
      fail(PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse);
    }
    cursor = nextCursor;

    if (page.length < PUBLIC_PROFILE_LEADERBOARD_PAGE_SIZE) return rows;
  }
}
