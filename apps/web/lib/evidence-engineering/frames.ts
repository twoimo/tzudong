import { buildCanonicalYouTubeWatchUrl } from "../youtube-url";
import {
  FRAME_SAMPLING,
  LEVEL1_FRAME_TYPES,
} from "./constants";
import { formatStorageObjectKey } from "./storage-key.mjs";
import { EvidenceContractCodes, EvidenceContractError } from "./errors";
import {
  assertNoForbiddenPayloadKeys,
  isConfidenceLevel,
  isEvidenceFrameType,
  isEvidenceLevel,
  isModerationStatus,
  parseMember,
  requireContentSha256,
  requireDetectedName,
  requireFrameId,
  requireImageUrl,
  requireTimestampMs,
  requireYouTubeVideoId,
} from "./guards";
import type {
  EvidenceFrameDraft,
  FrameSamplingPlan,
  RestaurantEvidenceFrame,
} from "./types";

const FRAME_PAYLOAD_KEYS = [
  "frame_id",
  "content_sha256",
  "video_id",
  "timestamp_ms",
  "storage_object_key",
  "youtube_seek_url",
  "frame_type",
  "evidence_level",
  "confidence_level",
  "moderation_status",
  "detected_shop_name",
  "detected_branch_name",
  "image_url",
] as const;

export function buildEvidenceSeekUrl(videoId: string, timestampMs: number): string {
  const id = requireYouTubeVideoId(videoId);
  const timestamp = requireTimestampMs(timestampMs);
  const watchUrl = buildCanonicalYouTubeWatchUrl(id);
  if (!watchUrl) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidVideoId);
  }
  return `${watchUrl}&t=${Math.floor(timestamp / 1000)}`;
}

export function buildStorageObjectKey(videoId: string, timestampMs: number, contentSha256: string): string {
  const id = requireYouTubeVideoId(videoId);
  const timestamp = requireTimestampMs(timestampMs);
  const hash = requireContentSha256(contentSha256);
  return formatStorageObjectKey(id, timestamp, hash);
}

export function planFrameSamplingWindow(videoId: string, targetTimestampMs: number): FrameSamplingPlan {
  const id = requireYouTubeVideoId(videoId);
  const target = requireTimestampMs(targetTimestampMs);
  const end = requireTimestampMs(target + FRAME_SAMPLING.windowMs);
  return {
    video_id: id,
    target_timestamp_ms: target,
    window_start_ms: Math.max(0, target - FRAME_SAMPLING.windowMs),
    window_end_ms: end,
    sample_fps: FRAME_SAMPLING.sampleFpsAfterDecode,
    keyframe_role: FRAME_SAMPLING.keyframeRole,
    loads_full_video_in_node: false,
  };
}

export function isLevel1SourceObserved(
  frame: Pick<RestaurantEvidenceFrame, "evidence_level" | "frame_type" | "moderation_status">,
): boolean {
  return (
    frame.moderation_status === "approved" &&
    frame.evidence_level === "SOURCE_OBSERVED" &&
    (LEVEL1_FRAME_TYPES as readonly string[]).includes(frame.frame_type)
  );
}

export function buildEvidenceFrame(draft: EvidenceFrameDraft): RestaurantEvidenceFrame {
  const videoId = requireYouTubeVideoId(draft.video_id);
  const timestampMs = requireTimestampMs(draft.timestamp_ms);
  const contentSha256 = requireContentSha256(draft.content_sha256);
  const frame: RestaurantEvidenceFrame = {
    frame_id: requireFrameId(draft.frame_id),
    content_sha256: contentSha256,
    video_id: videoId,
    timestamp_ms: timestampMs,
    storage_object_key: buildStorageObjectKey(videoId, timestampMs, contentSha256),
    youtube_seek_url: buildEvidenceSeekUrl(videoId, timestampMs),
    frame_type: parseMember(draft.frame_type, isEvidenceFrameType, EvidenceContractCodes.invalidFrameType),
    evidence_level: parseMember(draft.evidence_level, isEvidenceLevel, EvidenceContractCodes.invalidEvidenceLevel),
    confidence_level: parseMember(draft.confidence_level, isConfidenceLevel, EvidenceContractCodes.invalidConfidence),
    moderation_status: parseMember(draft.moderation_status, isModerationStatus, EvidenceContractCodes.invalidModeration),
    detected_shop_name: requireDetectedName(draft.detected_shop_name),
    detected_branch_name: requireDetectedName(draft.detected_branch_name),
    image_url: requireImageUrl(draft.image_url),
  };
  return frame;
}

export function parseEvidenceFrame(input: unknown): RestaurantEvidenceFrame {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidFrame);
  }
  assertNoForbiddenPayloadKeys(input);
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(FRAME_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      throw new EvidenceContractError(EvidenceContractCodes.invalidFrame);
    }
  }
  const frame = buildEvidenceFrame({
    frame_id: readString(record.frame_id, EvidenceContractCodes.invalidFrameId),
    content_sha256: readString(record.content_sha256, EvidenceContractCodes.invalidContentSha256),
    video_id: readString(record.video_id, EvidenceContractCodes.invalidVideoId),
    timestamp_ms: readTimestamp(record.timestamp_ms),
    frame_type: record.frame_type as EvidenceFrameDraft["frame_type"],
    evidence_level: record.evidence_level as EvidenceFrameDraft["evidence_level"],
    confidence_level: record.confidence_level as EvidenceFrameDraft["confidence_level"],
    moderation_status: record.moderation_status as EvidenceFrameDraft["moderation_status"],
    detected_shop_name: readNullableString(record.detected_shop_name, EvidenceContractCodes.invalidDetectedName),
    detected_branch_name: readNullableString(record.detected_branch_name, EvidenceContractCodes.invalidDetectedName),
    image_url: readNullableString(record.image_url, EvidenceContractCodes.invalidImageUrl),
  });
  if (typeof record.storage_object_key === "string" && record.storage_object_key !== frame.storage_object_key) {
    throw new EvidenceContractError(EvidenceContractCodes.storageKeyMismatch);
  }
  if (typeof record.youtube_seek_url === "string" && record.youtube_seek_url !== frame.youtube_seek_url) {
    throw new EvidenceContractError(EvidenceContractCodes.seekIntegrityMismatch);
  }
  if ("storage_object_key" in record && typeof record.storage_object_key !== "string") {
    throw new EvidenceContractError(EvidenceContractCodes.storageKeyMismatch);
  }
  if ("youtube_seek_url" in record && typeof record.youtube_seek_url !== "string") {
    throw new EvidenceContractError(EvidenceContractCodes.seekIntegrityMismatch);
  }
  return frame;
}

function readString(value: unknown, code: EvidenceContractError["code"]): string {
  if (typeof value !== "string") throw new EvidenceContractError(code);
  return value;
}

function readNullableString(value: unknown, code: EvidenceContractError["code"]): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new EvidenceContractError(code);
  return value;
}

function readTimestamp(value: unknown): number {
  if (typeof value !== "number") {
    throw new EvidenceContractError(EvidenceContractCodes.invalidTimestampMs);
  }
  return value;
}

function sameIdentity(left: RestaurantEvidenceFrame, right: RestaurantEvidenceFrame): boolean {
  return (
    left.content_sha256 === right.content_sha256 &&
    left.video_id === right.video_id &&
    left.timestamp_ms === right.timestamp_ms &&
    left.storage_object_key === right.storage_object_key &&
    left.youtube_seek_url === right.youtube_seek_url &&
    left.frame_type === right.frame_type &&
    left.evidence_level === right.evidence_level &&
    left.confidence_level === right.confidence_level &&
    left.detected_shop_name === right.detected_shop_name &&
    left.detected_branch_name === right.detected_branch_name
  );
}

// Public detail rendering must fail closed without taking down the restaurant panel.
export function approvedEvidenceFramesOrEmpty(groups: readonly RestaurantEvidenceFrame[][]): RestaurantEvidenceFrame[] {
  try {
    return unionApprovedEvidenceFrames(groups);
  } catch (error) {
    if (error instanceof EvidenceContractError) return [];
    throw error;
  }
}

export function unionApprovedEvidenceFrames(groups: readonly RestaurantEvidenceFrame[][]): RestaurantEvidenceFrame[] {
  const grouped = new Map<string, RestaurantEvidenceFrame[]>();
  for (const group of groups) {
    for (const frame of group) {
      const validated = parseEvidenceFrame(frame);
      const existing = grouped.get(validated.frame_id);
      if (existing) existing.push(validated);
      else grouped.set(validated.frame_id, [validated]);
    }
  }

  const approved: RestaurantEvidenceFrame[] = [];
  for (const copies of grouped.values()) {
    const anchor = copies[0];
    if (copies.some((copy) => !sameIdentity(anchor, copy))) {
      throw new EvidenceContractError(EvidenceContractCodes.duplicateFrameConflict);
    }
    const hasApproved = copies.some((copy) => copy.moderation_status === "approved");
    const hasRejected = copies.some((copy) => copy.moderation_status === "rejected");
    if (hasApproved && hasRejected) {
      throw new EvidenceContractError(EvidenceContractCodes.moderationConflict);
    }
    if (!hasApproved) continue;
    const approvedCopies = copies.filter((copy) => copy.moderation_status === "approved");
    const imageUrls = new Set(approvedCopies.map((copy) => copy.image_url));
    const imageUrl = imageUrls.size === 1 ? approvedCopies[0].image_url : null;
    approved.push(buildEvidenceFrame({ ...approvedCopies[0], image_url: imageUrl, moderation_status: "approved" }));
  }

  approved.sort((left, right) => (
    left.timestamp_ms - right.timestamp_ms || left.frame_id.localeCompare(right.frame_id)
  ));
  const storageKeys = new Set<string>();
  for (const frame of approved) {
    if (storageKeys.has(frame.storage_object_key)) {
      throw new EvidenceContractError(EvidenceContractCodes.duplicateFrameConflict);
    }
    storageKeys.add(frame.storage_object_key);
  }
  return approved;
}
