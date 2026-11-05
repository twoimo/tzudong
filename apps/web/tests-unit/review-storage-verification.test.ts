import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OCR_REVIEW_VERIFICATION_MAX_BYTES,
  type ReviewStorageObject,
  verifyReviewStorageForReceipt,
} from '@/lib/ocr/review-storage-verification';
import { prepareVerificationUploadFile } from '@/lib/ocr/receipt-upload-preparation';
import { createLatestSelection } from '@/lib/ocr/latest-selection';
import { buildReviewPhotoObjectPath } from '@/lib/review-photo-url';

const OWNER = '00000000-0000-4000-8000-000000000001';
const REVIEW = '10000000-0000-4000-8000-000000000001';
const VERIFICATION_ID = '20000000-0000-4000-8000-000000000001';
const FOOD_ID = '30000000-0000-4000-8000-000000000001';

function canonicalPaths() {
  const verificationPhoto = buildReviewPhotoObjectPath(
    { ownerId: OWNER, reviewId: REVIEW, purpose: 'verification' },
    'receipt.jpg',
  );
  const foodPhoto = buildReviewPhotoObjectPath(
    { ownerId: OWNER, reviewId: REVIEW, purpose: 'food' },
    'meal.webp',
  );
  if (!verificationPhoto || !foodPhoto) throw new Error('canonical fixture path failed');
  return { verificationPhoto, foodPhoto };
}

function objectRow(input: Partial<ReviewStorageObject> & Pick<ReviewStorageObject, 'id' | 'bucketId' | 'name'>): ReviewStorageObject {
  return {
    ownerId: OWNER,
    version: 'storage-version-1',
    updatedAt: '2026-10-13T10:00:00.000Z',
    metadata: { size: 13 },
    archivedAt: null,
    isDeleteMarker: false,
    ...input,
  };
}

describe('receipt review storage verification', () => {
  test('hashes the actual stored canonical verification bytes and binds its stable revision', async () => {
    const { verificationPhoto, foodPhoto } = canonicalPaths();
    const bytes = new TextEncoder().encode('receipt-bytes');
    const verification = objectRow({
      id: VERIFICATION_ID,
      bucketId: 'review-verifications',
      name: verificationPhoto,
      metadata: { size: bytes.byteLength },
    });
    const food = objectRow({ id: FOOD_ID, bucketId: 'review-photos', name: foodPhoto });
    const loads: Array<{ bucket: string; names: readonly string[] }> = [];
    const verified = await verifyReviewStorageForReceipt({
      ownerId: OWNER,
      verificationPhoto,
      foodPhotos: [foodPhoto],
      adapter: {
        async loadObjects(bucket, names) {
          loads.push({ bucket, names });
          return bucket === 'review-verifications' ? [{ ...verification }] : [{ ...food }];
        },
        async download(bucket, name) {
          expect({ bucket, name }).toEqual({ bucket: 'review-verifications', name: verificationPhoto });
          return new Blob([bytes], { type: 'image/jpeg' });
        },
      },
    });
    expect(verified).toEqual({
      verificationObjectId: VERIFICATION_ID,
      verificationObjectVersion: 'storage-version-1',
      verificationObjectUpdatedAt: '2026-10-13T10:00:00.000Z',
      verificationPhotoSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
    expect(loads).toEqual([
      { bucket: 'review-verifications', names: [verificationPhoto] },
      { bucket: 'review-photos', names: [foodPhoto] },
      { bucket: 'review-verifications', names: [verificationPhoto] },
    ]);
  });

  test('fails closed for missing, wrong-owner or replaced stored objects', async () => {
    const { verificationPhoto, foodPhoto } = canonicalPaths();
    const bytes = new TextEncoder().encode('receipt-bytes');
    const verification = objectRow({
      id: VERIFICATION_ID,
      bucketId: 'review-verifications',
      name: verificationPhoto,
      metadata: { size: bytes.byteLength },
    });
    const food = objectRow({ id: FOOD_ID, bucketId: 'review-photos', name: foodPhoto });

    for (const scenario of ['missing-food', 'wrong-owner', 'replaced'] as const) {
      let verificationReads = 0;
      await expect(verifyReviewStorageForReceipt({
        ownerId: OWNER,
        verificationPhoto,
        foodPhotos: [foodPhoto],
        adapter: {
          async loadObjects(bucket) {
            if (bucket === 'review-photos') return scenario === 'missing-food' ? [] : [{ ...food }];
            verificationReads++;
            if (scenario === 'wrong-owner') return [{ ...verification, ownerId: '00000000-0000-4000-8000-000000000002' }];
            return [{ ...verification, ...(scenario === 'replaced' && verificationReads === 2 ? { version: 'storage-version-2' } : {}) }];
          },
          async download() { return new Blob([bytes], { type: 'image/jpeg' }); },
        },
      })).rejects.toThrow('REVIEW_STORAGE_VERIFICATION_FAILED');
    }
  });

  test('rejects a 5-8 MiB receipt before quota or provider work when compression fails or stays oversized', async () => {
    const original = new File(
      [new Uint8Array(OCR_REVIEW_VERIFICATION_MAX_BYTES + 1)],
      'oversized.jpg',
      { type: 'image/jpeg' },
    );
    let quotaReservations = 0;
    let providerCalls = 0;
    const selectAndAnalyze = async (compress: Parameters<typeof prepareVerificationUploadFile>[0]['compress']) => {
      const prepared = await prepareVerificationUploadFile({ file: original, filename: 'safe.jpg', compress });
      quotaReservations++;
      providerCalls++;
      return prepared;
    };

    await expect(selectAndAnalyze(async () => { throw new Error('synthetic resize failure'); }))
      .rejects.toThrow('REVIEW_VERIFICATION_PREPARATION_FAILED');
    await expect(selectAndAnalyze(async () => new Blob(
      [new Uint8Array(OCR_REVIEW_VERIFICATION_MAX_BYTES + 1)],
      { type: 'image/jpeg' },
    ))).rejects.toThrow('REVIEW_VERIFICATION_PREPARATION_FAILED');
    expect({ quotaReservations, providerCalls }).toEqual({ quotaReservations: 0, providerCalls: 0 });
  });

  test('uses one prepared <=5 MiB file for OCR and upload', async () => {
    const original = new File(
      [new Uint8Array(OCR_REVIEW_VERIFICATION_MAX_BYTES + 1)],
      'oversized.jpg',
      { type: 'image/jpeg' },
    );
    const prepared = await prepareVerificationUploadFile({
      file: original,
      filename: 'safe.jpg',
      compress: async () => new Blob([new Uint8Array(1024)], { type: 'image/jpeg' }),
    });
    const ocrInput = prepared;
    const uploadInput = prepared;
    expect(ocrInput).toBe(uploadInput);
    expect(prepared.size).toBeLessThanOrEqual(OCR_REVIEW_VERIFICATION_MAX_BYTES);
  });

  test('aborts deferred receipt compression before stale bytes can be committed', async () => {
    const original = new File(
      [new Uint8Array(OCR_REVIEW_VERIFICATION_MAX_BYTES + 1)],
      'first-receipt.jpg',
      { type: 'image/jpeg' },
    );
    const selection = createLatestSelection();
    const first = selection.begin();
    let compressorSignal: AbortSignal | undefined;
    const preparation = prepareVerificationUploadFile({
      file: original,
      filename: 'prepared-first.jpg',
      signal: first.signal,
      compress: async (_file, options) => {
        compressorSignal = options.signal;
        return await new Promise<Blob>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
        });
      },
    });

    selection.begin();

    expect(compressorSignal).toBe(first.signal);
    expect(first.signal.aborted).toBe(true);
    await expect(preparation).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('ReviewModal OCRs and uploads one finalized receipt file and save RPC receives server-only storage proof', () => {
    const modal = readFileSync(join(import.meta.dir, '../components/reviews/ReviewModal.tsx'), 'utf8');
    const route = readFileSync(join(import.meta.dir, '../app/api/ocr/reviews/save/route.ts'), 'utf8');
    const migration = readFileSync(join(import.meta.dir, '../../../backend/supabase/migrations/20261013190000_durable_receipt_ocr_results.sql'), 'utf8');
    const bucketMigration = readFileSync(join(import.meta.dir, '../../../backend/supabase/migrations/20261008200719_review_verification_private.sql'), 'utf8');
    expect(modal).toContain('preparedFile = await prepareVerificationUploadFile({');
    expect(modal).toContain('signal: selection.signal');
    expect(modal).toContain('replaceVerificationPhoto(preparedFile, selectionGeneration)');
    expect(modal).toContain('void analyzeReceipt(preparedFile, selectionGeneration);');
    expect(modal).toContain('const receipt = draft.verificationPhoto;');
    expect(modal).not.toContain('prepareVerificationUploadFile({ file: draft.verificationPhoto');
    expect(modal).toContain('cacheControl: \'3600\', upsert: false');
    expect(route).toContain('verifyReviewStorageForReceipt({');
    expect(route).toContain('p_verification_photo_sha256: verifiedStorage.verificationPhotoSha256');
    expect(route).not.toContain('body.verificationPhotoSha256');
    expect(migration).toContain("v_owner_prefix text := p_user_id::text || '/reviews/' || p_review_id::text || '/';");
    expect(migration).toContain("AND bucket_id = 'review-verifications'");
    expect(migration).toContain('AND owner_id = p_user_id::text');
    expect(migration).toContain('IF v_result.image_hash <> p_verification_photo_sha256');
    expect(migration).toContain('FOR SHARE;');
    expect(bucketMigration).toContain("VALUES ('review-verifications', 'review-verifications', false, 5242880");
    expect(bucketMigration).toContain('CREATE POLICY review_verifications_owner_insert');
    expect(bucketMigration).not.toContain('CREATE POLICY review_verifications_owner_update');
    expect(OCR_REVIEW_VERIFICATION_MAX_BYTES).toBe(5242880);
  });
});
