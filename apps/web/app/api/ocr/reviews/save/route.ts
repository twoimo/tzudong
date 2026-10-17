import { NextResponse } from 'next/server';
import { getCanonicalReviewPhotoObjectPath } from '@/lib/review-photo-url';
import { authenticateOcrRequest } from '@/lib/ocr/request-security';
import {
  type ReviewStorageObject,
  ReviewStorageVerificationError,
  verifyReviewStorageForReceipt,
} from '@/lib/ocr/review-storage-verification';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { FEATURE_DATABASE_HELD_CODE, FEATURE_DATABASE_HELD_MESSAGE } from '@/lib/runtime-feature-readiness-contract';
import { readFeatureDatabaseReadiness } from '@/lib/server/runtime-feature-readiness';

export const runtime = 'nodejs';

const MAX_REQUEST_BYTES = 32 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set([
  '치킨', '중식', '돈까스·회', '피자', '패스트푸드', '찜·탕', '족발·보쌈', '분식',
  '카페·디저트', '한식', '고기', '양식', '아시안', '야식', '도시락',
]);

type ReviewSaveBody = {
  reviewId: string;
  restaurantId: string;
  title: string;
  content: string;
  visitedAt: string;
  verificationPhoto: string;
  foodPhotos: string[];
  categories: string[];
  ocrResultRef: string;
  ocrResultRevision: string;
};

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseStorageObject(value: unknown): ReviewStorageObject | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.bucket_id !== 'string'
    || typeof value.name !== 'string'
    || (value.owner_id !== null && typeof value.owner_id !== 'string')
    || (value.version !== null && typeof value.version !== 'string')
    || typeof value.updated_at !== 'string'
    || (value.archived_at !== null && typeof value.archived_at !== 'string')
    || typeof value.is_delete_marker !== 'boolean'
    || (value.metadata !== null && !isRecord(value.metadata))) {
    return null;
  }
  return {
    id: value.id,
    bucketId: value.bucket_id,
    name: value.name,
    ownerId: value.owner_id,
    version: value.version,
    updatedAt: value.updated_at,
    metadata: value.metadata,
    archivedAt: value.archived_at,
    isDeleteMarker: value.is_delete_marker,
  };
}

function parseBody(value: unknown): ReviewSaveBody | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  const expected = [
    'reviewId', 'restaurantId', 'title', 'content', 'visitedAt', 'verificationPhoto',
    'foodPhotos', 'categories', 'ocrResultRef', 'ocrResultRevision',
  ];
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) return null;
  if (!UUID_PATTERN.test(String(value.reviewId))
    || !UUID_PATTERN.test(String(value.restaurantId))
    || !UUID_PATTERN.test(String(value.ocrResultRef))
    || !UUID_PATTERN.test(String(value.ocrResultRevision))
    || typeof value.title !== 'string'
    || !value.title.trim()
    || value.title.length > 200
    || typeof value.content !== 'string'
    || value.content.trim().length < 20
    || value.content.length > 4_000
    || typeof value.visitedAt !== 'string'
    || !Number.isFinite(Date.parse(value.visitedAt))
    || typeof value.verificationPhoto !== 'string'
    || !Array.isArray(value.foodPhotos)
    || value.foodPhotos.length < 1
    || value.foodPhotos.length > 20
    || !value.foodPhotos.every((path) => typeof path === 'string')
    || !Array.isArray(value.categories)
    || value.categories.length < 1
    || value.categories.length > CATEGORIES.size
    || !value.categories.every((category) => typeof category === 'string' && CATEGORIES.has(category))
    || new Set(value.categories).size !== value.categories.length) {
    return null;
  }
  return value as ReviewSaveBody;
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson({ error: '요청을 처리할 수 없습니다.' }, { status: 403 });
  }
  const auth = await authenticateOcrRequest(request);
  if (!auth.ok) return noStoreJson({ error: auth.error }, { status: auth.status });
  if ((await readFeatureDatabaseReadiness({ ownerId: auth.user.id })).status !== 'ready') {
    return noStoreJson(
      { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE },
      { status: 409 },
    );
  }

  const parsed = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  const body = parsed.ok ? parseBody(parsed.value) : null;
  if (!body) {
    return noStoreJson({ error: '리뷰 저장 정보를 확인할 수 없습니다.' }, { status: parsed.ok ? 400 : parsed.code === 'BODY_TOO_LARGE' ? 413 : 400 });
  }

  const verification = getCanonicalReviewPhotoObjectPath(body.verificationPhoto, {
    ownerId: auth.user.id,
    reviewId: body.reviewId,
    purpose: 'verification',
  });
  const food = body.foodPhotos.map((path) => getCanonicalReviewPhotoObjectPath(path, {
    ownerId: auth.user.id,
    reviewId: body.reviewId,
    purpose: 'food',
  }));
  if (!verification || food.some((path) => !path)) {
    return noStoreJson({ error: '리뷰 사진 경로를 확인할 수 없습니다.' }, { status: 400 });
  }

  try {
    const service = createSupabaseServiceRoleClient();
    const verifiedStorage = await verifyReviewStorageForReceipt({
      ownerId: auth.user.id,
      verificationPhoto: verification,
      foodPhotos: food as string[],
      adapter: {
        async loadObjects(bucket, names) {
          const purpose = bucket === 'review-verifications' ? 'verification' : bucket === 'review-photos' ? 'food' : null;
          if (!purpose) throw new ReviewStorageVerificationError();
          const lookup = await service.rpc('get_owned_review_storage_objects' as never, {
            p_user_id: auth.user.id,
            p_review_id: body.reviewId,
            p_purpose: purpose,
            p_names: names,
          } as never) as unknown as { data: unknown; error: unknown };
          const { data, error } = lookup;
          if (error || !Array.isArray(data)) throw new ReviewStorageVerificationError();
          const rows = data.map(parseStorageObject);
          if (rows.some((row) => row === null)) throw new ReviewStorageVerificationError();
          return rows as ReviewStorageObject[];
        },
        async download(bucket, name) {
          const { data, error } = await service.storage.from(bucket).download(name);
          if (error || !data) throw new ReviewStorageVerificationError();
          return data;
        },
      },
    });
    const { data, error } = await service.rpc('create_review_with_receipt_ocr' as never, {
      p_review_id: body.reviewId,
      p_user_id: auth.user.id,
      p_restaurant_id: body.restaurantId,
      p_title: body.title.trim(),
      p_content: body.content.trim(),
      p_visited_at: body.visitedAt,
      p_verification_photo: verification,
      p_food_photos: food,
      p_categories: body.categories,
      p_ocr_result_id: body.ocrResultRef,
      p_ocr_result_revision: body.ocrResultRevision,
      p_verification_object_id: verifiedStorage.verificationObjectId,
      p_verification_object_version: verifiedStorage.verificationObjectVersion,
      p_verification_object_updated_at: verifiedStorage.verificationObjectUpdatedAt,
      p_verification_photo_sha256: verifiedStorage.verificationPhotoSha256,
      p_user_corrections: {
        restaurant_id: body.restaurantId,
        visited_at: body.visitedAt,
        categories: body.categories,
      },
    } as never);

    if (error) {
      const code = (error as { code?: string }).code;
      return noStoreJson(
        { error: 'OCR 검증 결과와 함께 리뷰를 저장하지 못했습니다.' },
        { status: code === '23505' ? 409 : code === '42501' || code === '22023' ? 422 : 503 },
      );
    }
    if (data !== body.reviewId) {
      return noStoreJson({ error: '리뷰 저장 결과를 확인하지 못했습니다.' }, { status: 503 });
    }

    const { data: readback, error: readbackError } = await service
      .from('reviews')
      .select('id, user_id, restaurant_id, verification_photo, food_photos, receipt_data, ocr_processed_at')
      .eq('id', body.reviewId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    const receiptData = isRecord(readback?.receipt_data) ? readback.receipt_data : null;
    if (readbackError
      || readback?.id !== body.reviewId
      || readback?.restaurant_id !== body.restaurantId
      || readback?.verification_photo !== verification
      || !Array.isArray(readback?.food_photos)
      || readback.food_photos.length !== food.length
      || !readback.food_photos.every((path, index) => path === food[index])
      || receiptData?.ocr_result_id !== body.ocrResultRef
      || receiptData?.ocr_result_revision !== body.ocrResultRevision
      || typeof readback?.ocr_processed_at !== 'string') {
      return noStoreJson({ error: '리뷰 저장 결과를 확인하지 못했습니다.' }, { status: 503 });
    }

    return noStoreJson({
      success: true,
      reviewId: body.reviewId,
      ocrResultRef: body.ocrResultRef,
      ocrResultRevision: body.ocrResultRevision,
    });
  } catch {
    return noStoreJson({ error: 'OCR 검증 결과와 함께 리뷰를 저장하지 못했습니다.' }, { status: 503 });
  }
}
