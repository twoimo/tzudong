import { describe, expect, mock, test } from 'bun:test';
import { createClient, StorageApiError } from '@supabase/supabase-js';

mock.module('server-only', () => ({}));

const {
  getAdminReceiptStorageRowFailureCode,
  persistAdminReceiptRowFailure,
} = await import('@/lib/ocr/admin-receipt-row-failure');

const reviewId = '10000000-0000-4000-8000-000000000001';
const ownerId = '20000000-0000-4000-8000-000000000001';
const verificationPhoto = `${ownerId}/reviews/${reviewId}/verification/receipt.jpg`;
const processedAt = '2026-10-19T00:00:00.000Z';

const pendingSnapshot = {
  id: reviewId,
  user_id: ownerId,
  verification_photo: verificationPhoto,
  receipt_hash: null,
  receipt_data: null,
  is_duplicate: false,
  ocr_processed_at: null,
};

const terminalFailure = {
  ...pendingSnapshot,
  receipt_data: {
    schema_version: 'receipt_summary_v1',
    status: 'failed',
    failure_code: 'verification_object_missing',
  },
  ocr_processed_at: processedAt,
};

function clientWithFetch(fetchImpl: typeof fetch) {
  return createClient('https://fixture.supabase.co', 'synthetic-service-role-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
}

describe('administrator receipt OCR terminal row failures', () => {
  test('uses exact pending-state CAS and independently reads back the terminal failure', async () => {
    const requests: Array<{ method: string; url: string; body: string | null }> = [];
    const client = clientWithFetch(async (input, init) => {
      requests.push({
        method: init?.method ?? 'GET',
        url: String(input),
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return new Response(JSON.stringify(terminalFailure), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const outcome = await persistAdminReceiptRowFailure(client as never, {
      snapshot: pendingSnapshot,
      failureCode: 'verification_object_missing',
      processedAt,
    });

    expect(outcome).toBe('applied');
    expect(requests.map(({ method }) => method)).toEqual(['PATCH', 'GET']);
    const mutationUrl = new URL(requests[0]!.url);
    expect(mutationUrl.searchParams.get('id')).toBe(`eq.${reviewId}`);
    expect(mutationUrl.searchParams.get('user_id')).toBe(`eq.${ownerId}`);
    expect(mutationUrl.searchParams.get('verification_photo')).toBe(`eq.${verificationPhoto}`);
    expect(mutationUrl.searchParams.get('ocr_processed_at')).toBe('is.null');
    expect(mutationUrl.searchParams.get('receipt_data')).toBe('is.null');
    expect(mutationUrl.searchParams.get('receipt_hash')).toBe('is.null');
    expect(mutationUrl.searchParams.get('is_duplicate')).toBe('eq.false');
    expect(JSON.parse(requests[0]!.body!)).toEqual({
      receipt_hash: null,
      receipt_data: terminalFailure.receipt_data,
      is_duplicate: false,
      ocr_processed_at: processedAt,
    });

    const readbackUrl = new URL(requests[1]!.url);
    expect(readbackUrl.searchParams.get('id')).toBe(`eq.${reviewId}`);
    expect(readbackUrl.searchParams.has('verification_photo')).toBe(false);
  });

  test('fails closed when an administrator changes the verification object during the CAS', async () => {
    const changedPending = {
      ...pendingSnapshot,
      verification_photo: `${ownerId}/reviews/${reviewId}/verification/replacement.jpg`,
    };
    let requestCount = 0;
    const client = clientWithFetch(async () => {
      requestCount += 1;
      return new Response(JSON.stringify(requestCount === 1 ? null : changedPending), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(persistAdminReceiptRowFailure(client as never, {
      snapshot: pendingSnapshot,
      failureCode: 'verification_object_missing',
      processedAt,
    })).rejects.toThrow();
    expect(requestCount).toBe(2);
  });

  test('recovers an uncertain mutation response only from exact terminal readback', async () => {
    let requestCount = 0;
    const client = clientWithFetch(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({ message: 'synthetic transport uncertainty' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(terminalFailure), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(persistAdminReceiptRowFailure(client as never, {
      snapshot: pendingSnapshot,
      failureCode: 'verification_object_missing',
      processedAt,
    })).resolves.toBe('recovered');
  });

  test('preserves a concurrent terminal winner after the row-failure CAS loses', async () => {
    const concurrentProcessed = {
      ...pendingSnapshot,
      receipt_data: {
        schema_version: 'receipt_summary_v1',
        status: 'processed',
        item_count: 1,
      },
      ocr_processed_at: '2026-10-19T00:00:01.000Z',
    };
    let requestCount = 0;
    const client = clientWithFetch(async () => {
      requestCount += 1;
      return new Response(JSON.stringify(requestCount === 1 ? null : concurrentProcessed), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(persistAdminReceiptRowFailure(client as never, {
      snapshot: pendingSnapshot,
      failureCode: 'verification_object_missing',
      processedAt,
    })).resolves.toBe('preserved');
  });

  test('classifies an exact missing object but not storage auth or transport failures as row defects', () => {
    expect(getAdminReceiptStorageRowFailureCode(
      new StorageApiError('Object not found', 400, '404'),
    )).toBe('verification_object_missing');
    expect(getAdminReceiptStorageRowFailureCode(
      new StorageApiError('Forbidden', 403, '403'),
    )).toBeNull();
    expect(getAdminReceiptStorageRowFailureCode(new TypeError('synthetic network failure'))).toBeNull();
  });
});
