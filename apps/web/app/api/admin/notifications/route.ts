import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { assertPrivacySafe } from "@/lib/privacy/sanitize";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { readBoundedJsonRequest } from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";

export const runtime = "nodejs";

type TransactionalNotificationType =
  | "submission_approved"
  | "submission_rejected"
  | "review_approved"
  | "review_rejected"
  | "user_ranking";

const TRANSACTIONAL_NOTIFICATION_TYPE_VALUES: readonly TransactionalNotificationType[] = [
  "submission_approved",
  "submission_rejected",
  "review_approved",
  "review_rejected",
  "user_ranking",
];
const TRANSACTIONAL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(TRANSACTIONAL_NOTIFICATION_TYPE_VALUES);
const MARKETING_NOTIFICATION_TYPES = new Set([
  "admin_announcement",
  "new_restaurant",
  "new_restaurants_batch",
]);
const MARKETING_CAMPAIGN_REQUIRED = "marketing_campaign_required";
const MAX_REQUEST_BYTES = 8_192;
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 500;
const MAX_PERIOD_LENGTH = 40;
const MAX_RANKING = 1_000_000;
const NOTIFICATION_READBACK_SELECT = [
  "id",
  "user_id",
  "type",
  "title",
  "message",
  "data",
  "classification",
  "channel",
  "is_read",
  "created_at",
].join(",");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scalar = string | number | boolean | null;
type NotificationData = Record<string, Scalar>;
type NotificationRequest = {
  recipientUserId: string;
  type: TransactionalNotificationType;
  title: string;
  message: string;
  data: NotificationData;
};
type NotificationReadback = {
  id: string;
  user_id: string;
  type: TransactionalNotificationType;
  title: string;
  message: string;
  data: NotificationData;
  classification: "transactional";
  channel: "in_app";
  is_read: boolean;
  created_at: string;
};
type AdminTransactionalNotificationRpcArgs = {
  p_actor_user_id: string;
  p_recipient_user_id: string;
  p_type: TransactionalNotificationType;
  p_title: string;
  p_message: string;
  p_data: NotificationData;
};
type AdminTransactionalNotificationReceipt = {
  schemaVersion: 1;
  status: "created";
  notificationId: string;
  actorUserId: string;
  recipientUserId: string;
  type: TransactionalNotificationType;
};

const DATA_KEYS_BY_TYPE: Readonly<Record<TransactionalNotificationType, readonly string[]>> = {
  submission_approved: [],
  submission_rejected: [],
  review_approved: [],
  review_rejected: [],
  user_ranking: ["ranking", "period"],
};

class NotificationPayloadError extends Error {}

function invalidPayloadResponse() {
  return NextResponse.json(
    { success: false, code: "invalid_notification_payload", message: "알림 요청 내용을 확인해 주세요." },
    { status: 400 },
  );
}
function untrustedMutationResponse() {
  return NextResponse.json(
    { success: false, code: "untrusted_mutation_origin", message: "요청을 처리할 수 없습니다." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

function marketingCampaignRequiredResponse() {
  return NextResponse.json(
    {
      success: false,
      code: MARKETING_CAMPAIGN_REQUIRED,
      message: "공지 및 신규 맛집 알림은 수신 동의 기반 마케팅 캠페인으로 전송해 주세요.",
    },
    { status: 422 },
  );
}

function isTransactionalNotificationType(value: unknown): value is TransactionalNotificationType {
  return typeof value === "string" && TRANSACTIONAL_NOTIFICATION_TYPES.has(value);
}

function isMarketingNotificationType(value: unknown): boolean {
  return typeof value === "string" && MARKETING_NOTIFICATION_TYPES.has(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new NotificationPayloadError();
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (!normalized || normalized.length > maxLength) throw new NotificationPayloadError();
  return normalized;
}

function assertNotificationPrivacy(value: unknown): void {
  try {
    assertPrivacySafe(value);
  } catch {
    throw new NotificationPayloadError();
  }
}

function parseNotificationData(type: TransactionalNotificationType, value: unknown): NotificationData {
  if (type !== "user_ranking") {
    if (!hasExactKeys(value, DATA_KEYS_BY_TYPE[type])) throw new NotificationPayloadError();
    assertNotificationPrivacy([]);
    return {};
  }

  if (!isPlainObject(value)) throw new NotificationPayloadError();
  if (Object.keys(value).length === 0) {
    assertNotificationPrivacy([]);
    return {};
  }
  if (!hasExactKeys(value, DATA_KEYS_BY_TYPE.user_ranking)) throw new NotificationPayloadError();

  const ranking = value.ranking;
  const period = normalizeText(value.period, MAX_PERIOD_LENGTH);
  if (typeof ranking !== "number" || !Number.isInteger(ranking) || ranking < 1 || ranking > MAX_RANKING) {
    throw new NotificationPayloadError();
  }

  const data = { ranking, period };
  assertNotificationPrivacy([data]);
  return data;
}

function parseNotificationRequest(value: unknown): NotificationRequest {
  if (!hasExactKeys(value, ["recipientUserId", "type", "title", "message", "data"])) {
    throw new NotificationPayloadError();
  }
  if (!isTransactionalNotificationType(value.type)) throw new NotificationPayloadError();

  const recipientUserId = normalizeText(value.recipientUserId, 36);
  if (!UUID_PATTERN.test(recipientUserId)) throw new NotificationPayloadError();

  const title = normalizeText(value.title, MAX_TITLE_LENGTH);
  const message = normalizeText(value.message, MAX_MESSAGE_LENGTH);
  const data = parseNotificationData(value.type, value.data);
  assertNotificationPrivacy([recipientUserId, value.type, title, message, data]);

  return { recipientUserId, type: value.type, title, message, data };
}


function stableData(value: NotificationData): string {
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(",")}}`;
}

function isExpectedReadback(value: unknown, request: NotificationRequest): value is NotificationReadback {
  if (!hasExactKeys(value, ["id", "user_id", "type", "title", "message", "data", "classification", "channel", "is_read", "created_at"])) {
    return false;
  }
  if (!UUID_PATTERN.test(String(value.id)) || value.user_id !== request.recipientUserId || value.type !== request.type) return false;
  if (value.title !== request.title || value.message !== request.message) return false;
  if (value.classification !== "transactional" || value.channel !== "in_app" || typeof value.is_read !== "boolean") return false;
  if (typeof value.created_at !== "string" || Number.isNaN(Date.parse(value.created_at))) return false;

  try {
    const data = parseNotificationData(request.type, value.data);
    assertNotificationPrivacy([value.id, value.user_id, value.type, value.title, value.message, value.data, value.classification, value.channel, value.is_read, value.created_at]);
    return stableData(data) === stableData(request.data);
  } catch {
    return false;
  }
}
function isExpectedCreationReceipt(
  value: unknown,
  request: NotificationRequest,
  actorUserId: string,
): value is AdminTransactionalNotificationReceipt {
  if (!hasExactKeys(value, ["schemaVersion", "status", "notificationId", "actorUserId", "recipientUserId", "type"])) {
    return false;
  }

  return value.schemaVersion === 1
    && value.status === "created"
    && typeof value.notificationId === "string"
    && UUID_PATTERN.test(value.notificationId)
    && value.actorUserId === actorUserId
    && value.recipientUserId === request.recipientUserId
    && value.type === request.type;
}


export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    if (!isTrustedSameOriginMutation(request)) return untrustedMutationResponse();

    const bodyResult = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
    if (!bodyResult.ok) return invalidPayloadResponse();
    const body = bodyResult.value;
    if (!isPlainObject(body)) return invalidPayloadResponse();

    if (isMarketingNotificationType(body.type)) {
      if (!hasExactKeys(body, ["recipientUserId", "type", "title", "message", "data"])) return invalidPayloadResponse();
      return marketingCampaignRequiredResponse();
    }

    const notificationRequest = parseNotificationRequest(body);
    const rpcArgs: AdminTransactionalNotificationRpcArgs = {
      p_actor_user_id: auth.userId,
      p_recipient_user_id: notificationRequest.recipientUserId,
      p_type: notificationRequest.type,
      p_title: notificationRequest.title,
      p_message: notificationRequest.message,
      p_data: notificationRequest.data,
    };
    const supabase = createSupabaseServiceRoleClient();
    const { data: creationReceipt, error: creationError } = await supabase
      .rpc("create_admin_transactional_notification", rpcArgs)
      .overrideTypes<AdminTransactionalNotificationReceipt, { merge: false }>();

    if (creationError || !isExpectedCreationReceipt(creationReceipt, notificationRequest, auth.userId)) {
      return NextResponse.json(
        { success: false, code: "notification_send_failed", message: "알림을 전송하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }

    const inserted = { id: creationReceipt.notificationId };

    const { data: notification, error: readbackError } = await supabase
      .from("notifications")
      .select(NOTIFICATION_READBACK_SELECT)
      .eq("id", inserted.id)
      .eq("user_id", notificationRequest.recipientUserId)
      .eq("classification", "transactional")
      .eq("channel", "in_app")
      .limit(1)
      .maybeSingle()
      .overrideTypes<NotificationReadback, { merge: false }>();

    if (readbackError || !isExpectedReadback(notification, notificationRequest)) {
      return NextResponse.json(
        { success: false, code: "notification_readback_failed", message: "알림 전송 결과를 확인하지 못했습니다. 다시 확인해 주세요." },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, notification });
  } catch (error) {
    if (error instanceof NotificationPayloadError) return invalidPayloadResponse();
    return NextResponse.json(
      { success: false, code: "notification_send_failed", message: "알림을 전송하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
