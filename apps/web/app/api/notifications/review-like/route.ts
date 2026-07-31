import { NextRequest, NextResponse } from 'next/server';

import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 1_024;
const MAX_RESTAURANT_LABEL_LENGTH = 80;
const PHONE_LIKE_PATTERN = /(?:\+?82[-.\s]?)?0?1[0-9][-.\s]?\d{3,4}[-.\s]?\d{4}|0[2-6][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const REVIEW_LIKE_TITLE = '리뷰에 좋아요가 눌렸어요!';
const NOTIFICATION_READBACK_SELECT = [
  'id',
  'user_id',
  'type',
  'title',
  'message',
  'data',
  'classification',
  'channel',
  'is_read',
  'created_at',
].join(',');

type NotificationErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_REVIEW_ID'
  | 'REVIEW_NOT_FOUND'
  | 'RESTAURANT_NOT_FOUND'
  | 'SELF_NOTIFICATION_FORBIDDEN'
  | 'LIKE_NOT_FOUND'
  | 'NOTIFICATION_UNAVAILABLE';

type ParsedRequestBody =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413 };

type ReviewLikeRequest = {
  reviewId: string;
};

type ReviewRow = {
  id: string;
  user_id: string;
  restaurant_id: string;
};

type RestaurantRow = {
  approved_name: string | null;
  name: string | null;
};

type LikeRow = {
  id: string;
};

type NotificationPayload = {
  user_id: string;
  type: 'review_like';
  title: string;
  message: string;
  data: {
    reviewId: string;
    restaurantId: string;
    sourceLikeId: string;
  };
  classification: 'transactional';
  channel: 'in_app';
  is_read: false;
};
type ReviewLikeNotificationRpcArgs = {
  p_actor_user_id: string;
  p_review_id: string;
  p_like_id: string;
};
type ReviewLikeNotificationReceipt = {
  schemaVersion: 1;
  status: 'created' | 'replayed';
  notificationId: string;
  reviewId: string;
  recipientUserId: string;
};
type NotificationReadback = {
  id: string;
  user_id: string;
  type: 'review_like';
  title: string;
  message: string;
  data: {
    reviewId: string;
    restaurantId: string;
    sourceLikeId: string;
  };
  classification: 'transactional';
  channel: 'in_app';
  is_read: boolean;
  created_at: string;
};

const ERROR_MESSAGES: Record<NotificationErrorCode, string> = {
  AUTH_REQUIRED: '로그인이 필요합니다.',
  INVALID_REVIEW_ID: '리뷰 정보를 확인할 수 없습니다.',
  REVIEW_NOT_FOUND: '리뷰를 찾을 수 없습니다.',
  RESTAURANT_NOT_FOUND: '맛집 정보를 확인할 수 없습니다.',
  SELF_NOTIFICATION_FORBIDDEN: '내 리뷰에는 좋아요 알림을 보낼 수 없습니다.',
  LIKE_NOT_FOUND: '좋아요를 확인할 수 없습니다.',
  NOTIFICATION_UNAVAILABLE: '알림을 보낼 수 없습니다.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function isReviewRow(value: unknown): value is ReviewRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.user_id === 'string'
    && typeof value.restaurant_id === 'string';
}

function isRestaurantRow(value: unknown): value is RestaurantRow {
  return isRecord(value)
    && (value.approved_name === null || typeof value.approved_name === 'string')
    && (value.name === null || typeof value.name === 'string');
}

function isLikeRow(value: unknown): value is LikeRow {
  return isRecord(value) && typeof value.id === 'string';
}

function isReviewLikeRequest(value: unknown): value is ReviewLikeRequest {
  return isRecord(value)
    && Object.keys(value).length === 1
    && Object.prototype.hasOwnProperty.call(value, 'reviewId')
    && typeof value.reviewId === 'string';
}

async function readBoundedJsonBody(request: Request): Promise<ParsedRequestBody> {
  const contentLength = request.headers.get('content-length');
  if (
    contentLength !== null
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
  ) {
    return { ok: false, status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, body: null };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request is already rejected and no response content depends on cancellation.
        }
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }

    if (totalBytes === 0) return { ok: true, body: null };

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}

function sanitizeRestaurantLabel(value: unknown): string {
  if (typeof value !== 'string') return '해당 맛집';

  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RESTAURANT_LABEL_LENGTH);

  return normalized && !PHONE_LIKE_PATTERN.test(normalized) ? normalized : '해당 맛집';
}

function errorResponse(code: NotificationErrorCode, status: number) {
  return NextResponse.json(
    { error: ERROR_MESSAGES[code], code },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function hasExpectedNotificationReadback(
  value: unknown,
  expected: NotificationPayload,
): value is NotificationReadback {
  if (
    !isRecord(value)
    || !isRecord(value.data)
    || Object.keys(value.data).length !== 3
    || !Object.prototype.hasOwnProperty.call(value.data, 'reviewId')
    || !Object.prototype.hasOwnProperty.call(value.data, 'restaurantId')
    || !Object.prototype.hasOwnProperty.call(value.data, 'sourceLikeId')
  ) {
    return false;
  }

  return typeof value.id === 'string'
    && UUID_PATTERN.test(value.id)
    && value.user_id === expected.user_id
    && value.type === expected.type
    && value.title === expected.title
    && value.message === expected.message
    && value.data.reviewId === expected.data.reviewId
    && value.data.restaurantId === expected.data.restaurantId
    && value.data.sourceLikeId === expected.data.sourceLikeId
    && value.classification === expected.classification
    && value.channel === expected.channel
    && value.is_read === expected.is_read
    && typeof value.created_at === 'string'
    && !Number.isNaN(Date.parse(value.created_at));
}

function hasExpectedNotificationReceipt(
  value: unknown,
  expected: NotificationPayload,
): value is ReviewLikeNotificationReceipt {
  return isRecord(value)
    && Object.keys(value).length === 5
    && value.schemaVersion === 1
    && (value.status === 'created' || value.status === 'replayed')
    && typeof value.notificationId === 'string'
    && UUID_PATTERN.test(value.notificationId)
    && value.reviewId === expected.data.reviewId
    && value.recipientUserId === expected.user_id;
}

export async function POST(request: NextRequest) {
  const parsedBody = await readBoundedJsonBody(request);
  if (!parsedBody.ok) return errorResponse('INVALID_REVIEW_ID', parsedBody.status);

  const body = parsedBody.body;
  if (!isReviewLikeRequest(body) || !UUID_PATTERN.test(body.reviewId)) {
    return errorResponse('INVALID_REVIEW_ID', 400);
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse('AUTH_REQUIRED', 401);
    }

    const { data: review, error: reviewError } = await supabase
      .from('reviews')
      .select('id, user_id, restaurant_id')
      .eq('id', body.reviewId)
      .maybeSingle()
      .overrideTypes<ReviewRow, { merge: false }>();

    if (reviewError) return errorResponse('NOTIFICATION_UNAVAILABLE', 503);
    if (!isReviewRow(review)) return errorResponse('REVIEW_NOT_FOUND', 404);
    if (review.user_id === user.id) {
      return errorResponse('SELF_NOTIFICATION_FORBIDDEN', 403);
    }

    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('approved_name, name')
      .eq('id', review.restaurant_id)
      .maybeSingle()
      .overrideTypes<RestaurantRow, { merge: false }>();

    if (restaurantError) return errorResponse('NOTIFICATION_UNAVAILABLE', 503);
    if (!isRestaurantRow(restaurant)) return errorResponse('RESTAURANT_NOT_FOUND', 404);

    const { data: like, error: likeError } = await supabase
      .from('review_likes')
      .select('id')
      .eq('review_id', review.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .overrideTypes<LikeRow, { merge: false }>();

    if (likeError) return errorResponse('NOTIFICATION_UNAVAILABLE', 503);
    if (!isLikeRow(like)) return errorResponse('LIKE_NOT_FOUND', 409);

    const restaurantLabel = sanitizeRestaurantLabel(restaurant.approved_name ?? restaurant.name);
    const notificationPayload: NotificationPayload = {
      user_id: review.user_id,
      type: 'review_like',
      title: REVIEW_LIKE_TITLE,
      message: `회원님이 ${restaurantLabel} 리뷰에 좋아요를 눌렀습니다.`,
      data: {
        reviewId: review.id,
        restaurantId: review.restaurant_id,
        sourceLikeId: like.id,
      },
      classification: 'transactional',
      channel: 'in_app',
      is_read: false,
    };
    assertPrivacySafe([notificationPayload.title, notificationPayload.message, notificationPayload.data]);

    const rpcArgs: ReviewLikeNotificationRpcArgs = {
      p_actor_user_id: user.id,
      p_review_id: review.id,
      p_like_id: like.id,
    };
    const supabaseAdmin = createSupabaseServiceRoleClient();
    const { data: creationReceipt, error: creationError } = await supabaseAdmin
      .rpc('create_review_like_notification', rpcArgs)
      .overrideTypes<ReviewLikeNotificationReceipt, { merge: false }>();

    if (creationError || !hasExpectedNotificationReceipt(creationReceipt, notificationPayload)) {
      return errorResponse('NOTIFICATION_UNAVAILABLE', 503);
    }

    const insertedNotification = { id: creationReceipt.notificationId };

    const { data: notificationReadback, error: readbackError } = await supabaseAdmin
      .from('notifications')
      .select(NOTIFICATION_READBACK_SELECT)
      .eq('id', insertedNotification.id)
      .eq('user_id', notificationPayload.user_id)
      .eq('classification', 'transactional')
      .eq('channel', 'in_app')
      .limit(1)
      .maybeSingle()
      .overrideTypes<NotificationReadback, { merge: false }>();

    if (readbackError || !hasExpectedNotificationReadback(notificationReadback, notificationPayload)) {
      return errorResponse('NOTIFICATION_UNAVAILABLE', 503);
    }

    return NextResponse.json(
      {
        notification: {
          id: notificationReadback.id,
          reviewId: notificationPayload.data.reviewId,
          restaurantId: notificationPayload.data.restaurantId,
        },
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return errorResponse('NOTIFICATION_UNAVAILABLE', 503);
  }
}
