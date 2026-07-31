import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '../lib/security/bounded-json-request';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const encoder = new TextEncoder();

function requestFromChunks(chunks: Uint8Array[], headers: HeadersInit = {}) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('content-type')) {
    requestHeaders.set('content-type', 'application/json');
  }

  return {
    headers: requestHeaders,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  } as unknown as Request;
}

const adminMutationRoutes = [
  {
    routePath: 'app/api/admin/restaurant-requests/[requestId]/review/route.ts',
    readerCall: 'readBoundedJsonRequest(request, MAX_REVIEW_REQUEST_BYTES)',
    maximumBytes: 'const MAX_REVIEW_REQUEST_BYTES = 4 * 1024;',
    privilegedClientMarker: 'createSupabaseServiceRoleClient()',
  },
  {
    routePath: 'app/api/admin/restaurants/[restaurantId]/destructive-action/route.ts',
    readerCall: 'readBoundedJsonRequest(request, MAX_DESTRUCTIVE_ACTION_REQUEST_BYTES)',
    maximumBytes: 'const MAX_DESTRUCTIVE_ACTION_REQUEST_BYTES = 4 * 1024;',
    privilegedClientMarker: 'createSupabaseServiceRoleClient()',
  },
  {
    routePath: 'app/api/admin/map-overlays/apply/route.ts',
    readerCall: 'readBoundedJsonRequest(request, MAX_MAP_OVERLAY_APPLY_REQUEST_BYTES)',
    maximumBytes: 'const MAX_MAP_OVERLAY_APPLY_REQUEST_BYTES = 64 * 1024;',
    privilegedClientMarker: 'createSupabaseServiceRoleClient()',
  },
  {
    routePath: 'app/api/admin/map-overlays/preview/route.ts',
    readerCall: 'readBoundedJsonRequest(request, MAX_MAP_OVERLAY_PREVIEW_REQUEST_BYTES)',
    maximumBytes: 'const MAX_MAP_OVERLAY_PREVIEW_REQUEST_BYTES = 64 * 1024;',
    privilegedClientMarker: 'createSupabaseServiceRoleClient()',
  },
  {
    routePath: 'app/api/admin/ocr-receipts/process/route.ts',
    readerCall: 'readBoundedJsonRequest(request, MAX_REQUEST_BYTES)',
    maximumBytes: 'const MAX_REQUEST_BYTES = 4 * 1024;',
    privilegedClientMarker: 'const supabase = getSupabaseAdmin()',
  },
] as const;

describe('admin mutation request security', () => {
  test('uses the shared bounded reader and same-origin guard before mutation work', () => {
    for (const {
      routePath,
      readerCall,
      maximumBytes,
      privilegedClientMarker,
    } of adminMutationRoutes) {
      const routeSource = source(routePath);
      const guardIndex = routeSource.indexOf('isTrustedSameOriginMutation(request)');
      const requireAdminIndex = routeSource.indexOf('await requireAdmin()');
      const readerIndex = routeSource.indexOf(readerCall);
      const serviceRoleIndex = routeSource.indexOf(privilegedClientMarker);

      expect(routeSource).toContain('@/lib/security/bounded-json-request');
      expect(routeSource).toContain('@/lib/security/same-origin-mutation');
      expect(routeSource).not.toMatch(/request\.(?:json|text)\s*\(/);
      expect(routeSource).toContain(maximumBytes);
      expect(routeSource).toContain('Cache-Control');
      expect(guardIndex).toBeGreaterThan(-1);
      expect(readerIndex).toBeGreaterThan(guardIndex);
      expect(serviceRoleIndex).toBeGreaterThan(readerIndex);
      expect(requireAdminIndex).toBeGreaterThan(-1);
      expect(guardIndex).toBeGreaterThan(requireAdminIndex);
      expect(routeSource.slice(guardIndex, readerIndex)).toContain('noStoreJson');
    }
  });

  test('fails closed for oversized or non-JSON request bodies while accepting exact JSON bodies', async () => {
    const declaredOversized = requestFromChunks(
      [encoder.encode('{}')],
      { 'content-length': '33' },
    );
    expect(await readBoundedJsonRequest(declaredOversized, 32)).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
    });

    let cancelled = false;
    const chunkedOversized = {
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"evidence":"'));
          controller.enqueue(encoder.encode('x'.repeat(32)));
        },
        cancel() {
          cancelled = true;
        },
      }),
    } as unknown as Request;
    expect(await readBoundedJsonRequest(chunkedOversized, 32)).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
    });
    expect(cancelled).toBe(true);

    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{}')], { 'content-type': 'text/plain' }),
      32,
    )).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType,
    });

    for (const body of [
      { action: 'approve', adminNote: '검토 완료' },
      {
        action: 'soft_delete_restaurant',
        targetRestaurantIds: ['11111111-1111-4111-8111-111111111111'],
        reason: '중복 등록 확인',
        confirmation: 'DELETE RESTAURANT',
        expectedRestaurantName: '테스트 맛집',
      },
      {
        action: 'upsert',
        restaurantId: '11111111-1111-4111-8111-111111111111',
        overlayType: 'trend',
        label: '여름 대기',
        description: null,
        activeFrom: null,
        activeUntil: null,
        evidence: { source: 'operator' },
        reason: '운영자 확인',
      },
      {
        normalized: {
          action: 'deactivate',
          restaurantId: '11111111-1111-4111-8111-111111111111',
          overlayType: 'seasonal',
          label: null,
          description: null,
          activeFrom: null,
          activeUntil: null,
          evidence: { source: 'operator' },
          reason: '운영자 확인',
        },
        confirmationText: '오버레이 적용',
        previewHash: 'a'.repeat(64),
        correlationId: '22222222-2222-4222-8222-222222222222',
        idempotencyKey: 'overlay-apply-1',
      },
    ]) {
      const serialized = JSON.stringify(body);
      expect(await readBoundedJsonRequest(
        requestFromChunks(
          [encoder.encode(serialized)],
          { 'content-length': String(encoder.encode(serialized).byteLength) },
        ),
        64 * 1024,
      )).toEqual({ ok: true, value: body });
    }
  });
  test('rejects malformed, duplicate, mismatched, aborted, stalled, and invalid UTF-8 JSON bodies', async () => {
    const maximumBytes = 4 * 1024;

    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{')]),
      maximumBytes,
    )).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{}')], { 'content-length': '3' }),
      maximumBytes,
    )).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidContentLength,
    });
    expect(await readBoundedJsonRequest(
      requestFromChunks([new Uint8Array([0xc3, 0x28])]),
      maximumBytes,
    )).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });

    for (const duplicateBody of [
      '{"reviewId":"first","reviewId":"second","guardedMutationConfirmation":"APPLY"}',
      '{"reviewId":"review","guardedMutationConfirmation":"APPLY","guardedMutationConfirmation":"APPLY"}',
      '{"reviewId":"review","guardedMutationConfirmation":"APPLY","mode":"first","mode":"second"}',
    ]) {
      expect(await readBoundedJsonRequest(
        requestFromChunks([encoder.encode(duplicateBody)]),
        maximumBytes,
      )).toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
      });
    }

    const abortController = new AbortController();
    abortController.abort();
    let abortCancelled = false;
    const abortedRequest = {
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream<Uint8Array>({
        cancel() {
          abortCancelled = true;
        },
      }),
      signal: abortController.signal,
    } as unknown as Request;
    expect(await readBoundedJsonRequest(abortedRequest, maximumBytes)).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    expect(abortCancelled).toBe(true);

    let timeoutCancelled = false;
    const stalledRequest = {
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream<Uint8Array>({
        cancel() {
          timeoutCancelled = true;
        },
      }),
    } as unknown as Request;
    expect(await readBoundedJsonRequest(stalledRequest, maximumBytes)).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    expect(timeoutCancelled).toBe(true);
  });

  test('accepts the exact inline OCR process JSON body', async () => {
    const body = {
      reviewId: '11111111-1111-4111-8111-111111111111',
      guardedMutationConfirmation: 'APPLY',
    };
    const serialized = JSON.stringify(body);
    expect(await readBoundedJsonRequest(
      requestFromChunks(
        [encoder.encode(serialized)],
        { 'content-length': String(encoder.encode(serialized).byteLength) },
      ),
      4 * 1024,
    )).toEqual({ ok: true, value: body });
  });
});
