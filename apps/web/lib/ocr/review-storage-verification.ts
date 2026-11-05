import crypto from 'node:crypto';
import {
  OCR_REVIEW_VERIFICATION_BUCKET,
  OCR_REVIEW_VERIFICATION_MAX_BYTES,
} from '@/lib/ocr/review-verification-contract';

export { OCR_REVIEW_VERIFICATION_BUCKET, OCR_REVIEW_VERIFICATION_MAX_BYTES };
export const OCR_REVIEW_FOOD_BUCKET = 'review-photos';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ReviewStorageObject = {
  id: string;
  bucketId: string;
  name: string;
  ownerId: string | null;
  version: string | null;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
  archivedAt: string | null;
  isDeleteMarker: boolean;
};

export type ReviewStorageVerificationAdapter = {
  loadObjects(bucket: string, names: readonly string[]): Promise<ReviewStorageObject[]>;
  download(bucket: string, name: string): Promise<Blob>;
};

export type VerifiedReviewStorage = {
  verificationObjectId: string;
  verificationObjectVersion: string | null;
  verificationObjectUpdatedAt: string;
  verificationPhotoSha256: string;
};

export class ReviewStorageVerificationError extends Error {
  constructor() {
    super('REVIEW_STORAGE_VERIFICATION_FAILED');
    this.name = 'ReviewStorageVerificationError';
  }
}

function fail(): never {
  throw new ReviewStorageVerificationError();
}

function metadataSize(metadata: Record<string, unknown> | null): number | null {
  const value = metadata?.size ?? metadata?.contentLength;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isLiveOwnedObject(row: ReviewStorageObject, bucket: string, name: string, ownerId: string): boolean {
  return UUID_PATTERN.test(row.id)
    && row.bucketId === bucket
    && row.name === name
    && row.ownerId === ownerId
    && row.archivedAt === null
    && row.isDeleteMarker === false
    && Number.isFinite(Date.parse(row.updatedAt));
}

function sameObjectRevision(left: ReviewStorageObject, right: ReviewStorageObject): boolean {
  return left.id === right.id
    && left.bucketId === right.bucketId
    && left.name === right.name
    && left.ownerId === right.ownerId
    && left.version === right.version
    && left.updatedAt === right.updatedAt
    && left.archivedAt === right.archivedAt
    && left.isDeleteMarker === right.isDeleteMarker;
}

export async function verifyReviewStorageForReceipt(input: {
  ownerId: string;
  verificationPhoto: string;
  foodPhotos: readonly string[];
  adapter: ReviewStorageVerificationAdapter;
}): Promise<VerifiedReviewStorage> {
  if (!UUID_PATTERN.test(input.ownerId)
    || input.foodPhotos.length < 1
    || new Set(input.foodPhotos).size !== input.foodPhotos.length) {
    fail();
  }

  const [verificationRows, foodRows] = await Promise.all([
    input.adapter.loadObjects(OCR_REVIEW_VERIFICATION_BUCKET, [input.verificationPhoto]),
    input.adapter.loadObjects(OCR_REVIEW_FOOD_BUCKET, input.foodPhotos),
  ]);
  if (verificationRows.length !== 1 || foodRows.length !== input.foodPhotos.length) fail();
  const verification = verificationRows[0];
  if (!isLiveOwnedObject(verification, OCR_REVIEW_VERIFICATION_BUCKET, input.verificationPhoto, input.ownerId)) fail();
  const declaredSize = metadataSize(verification.metadata);
  if (declaredSize === null || declaredSize > OCR_REVIEW_VERIFICATION_MAX_BYTES) fail();

  const foodByName = new Map(foodRows.map((row) => [row.name, row]));
  for (const name of input.foodPhotos) {
    const row = foodByName.get(name);
    if (!row || !isLiveOwnedObject(row, OCR_REVIEW_FOOD_BUCKET, name, input.ownerId)) fail();
  }

  const storedBlob = await input.adapter.download(OCR_REVIEW_VERIFICATION_BUCKET, input.verificationPhoto);
  if (storedBlob.size !== declaredSize || storedBlob.size > OCR_REVIEW_VERIFICATION_MAX_BYTES) fail();
  const storedBytes = Buffer.from(await storedBlob.arrayBuffer());
  if (storedBytes.length !== declaredSize) fail();

  // Re-read after download. The SQL transaction locks and rechecks only this
  // metadata revision; it cannot lock remote object bytes. This binding relies
  // on Storage updating version/updated_at atomically whenever bytes change,
  // plus immutable verification keys: browser uploads use upsert:false,
  // authenticated UPDATE remains denied, and operators do not overwrite the
  // object through direct S3 access.
  const verificationReadback = await input.adapter.loadObjects(
    OCR_REVIEW_VERIFICATION_BUCKET,
    [input.verificationPhoto],
  );
  if (verificationReadback.length !== 1 || !sameObjectRevision(verification, verificationReadback[0])) fail();

  return {
    verificationObjectId: verification.id,
    verificationObjectVersion: verification.version,
    verificationObjectUpdatedAt: verification.updatedAt,
    verificationPhotoSha256: crypto.createHash('sha256').update(storedBytes).digest('hex'),
  };
}
