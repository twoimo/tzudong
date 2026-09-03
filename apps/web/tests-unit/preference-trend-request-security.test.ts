import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '../lib/security/bounded-json-request';

const encoder = new TextEncoder();
const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

type RouteContract = {
  routePath: string;
  maximumBytes: number;
  maximumBytesSource: string;
  normalPayload: unknown;
  usesSameOriginGuard: boolean;
  mutationHandler: 'PATCH' | 'POST';
};

const routeContracts: RouteContract[] = [
  {
    routePath: 'app/api/admin/preferences/dashboard-widget-order/route.ts',
    maximumBytes: 4 * 1024,
    maximumBytesSource: 'const MAX_DASHBOARD_WIDGET_ORDER_REQUEST_BYTES = 4 * 1024;',
    normalPayload: { order: ['views', 'subscribers'] },
    usesSameOriginGuard: true,
    mutationHandler: 'PATCH',
  },
  {
    routePath: 'app/api/admin/preferences/sidebar-order/route.ts',
    maximumBytes: 4 * 1024,
    maximumBytesSource: 'const MAX_SIDEBAR_ORDER_REQUEST_BYTES = 4 * 1024;',
    normalPayload: {
      order: {
        sections: ['운영', '판단'],
        items: {
          판단: ['overview'],
          운영: ['users', 'banners'],
        },
      },
    },
    usesSameOriginGuard: true,
    mutationHandler: 'PATCH',
  },
  {
    routePath: 'app/api/admin/trend-job-requests/route.ts',
    maximumBytes: 16 * 1024,
    maximumBytesSource: 'const MAX_TREND_JOB_REQUEST_BYTES = 16 * 1024;',
    normalPayload: {
      requestKind: 'dry_run',
      parameters: {
        window: {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-02T00:00:00.000Z',
        },
      },
      correlationId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'trend-dry-run-01',
    },
    usesSameOriginGuard: true,
    mutationHandler: 'POST',
  },
  {
    routePath: 'app/api/home/youtube-kpi/route.ts',
    maximumBytes: 8 * 1024,
    maximumBytesSource: 'const MAX_YOUTUBE_KPI_REQUEST_BYTES = 8 * 1024;',
    normalPayload: {
      videoIds: Array.from(
        { length: 120 },
        (_, index) => index.toString(36).padStart(64, 'a'),
      ),
    },
    usesSameOriginGuard: false,
    mutationHandler: 'POST',
  },
];

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

function handlerSource(routeSource: string, handler: 'PATCH' | 'POST') {
  const handlerStart = routeSource.indexOf(`export async function ${handler}`);
  return routeSource.slice(handlerStart);
}

describe('preference and trend request security', () => {
  test('uses the canonical bounded reader with declared caps and no raw body readers', () => {
    for (const contract of routeContracts) {
      const routeSource = source(contract.routePath);

      expect(contract.maximumBytes).toBeLessThanOrEqual(16 * 1024);
      expect(routeSource).toContain('@/lib/security/bounded-json-request');
      expect(routeSource).toContain('readBoundedJsonRequest(');
      expect(routeSource).toContain(contract.maximumBytesSource);
      expect(routeSource).not.toMatch(/request\.(?:json|text)\s*\(/);
    }
  });

  test('checks the canonical origin after admin auth and before body or privileged-client work', () => {
    for (const contract of routeContracts.filter((candidate) => candidate.usesSameOriginGuard)) {
      const routeSource = source(contract.routePath);
      const mutationSource = handlerSource(routeSource, contract.mutationHandler);
      const authIndex = mutationSource.indexOf('await requireAdmin()');
      const guardIndex = mutationSource.indexOf('isTrustedSameOriginMutation(request)');
      const readerIndex = mutationSource.indexOf('readBoundedJsonRequest(');
      const serviceRoleIndex = mutationSource.indexOf('createSupabaseServiceRoleClient()');

      expect(routeSource).toContain('@/lib/security/same-origin-mutation');
      expect(authIndex).toBeGreaterThan(-1);
      expect(guardIndex).toBeGreaterThan(authIndex);
      expect(readerIndex).toBeGreaterThan(guardIndex);
      expect(serviceRoleIndex).toBeGreaterThan(readerIndex);
      expect(mutationSource.slice(guardIndex, readerIndex)).toContain('403');
    }

    const dashboardSource = source('app/api/admin/preferences/dashboard-widget-order/route.ts');
    const deleteSource = dashboardSource.slice(
      dashboardSource.indexOf('export async function DELETE'),
    );
    const deleteAuthIndex = deleteSource.indexOf('await requireAdmin()');
    const deleteGuardIndex = deleteSource.indexOf('isTrustedSameOriginMutation(request)');
    expect(deleteGuardIndex).toBeGreaterThan(deleteAuthIndex);
    expect(deleteSource.indexOf('createSupabaseServiceRoleClient()')).toBeGreaterThan(deleteGuardIndex);

    expect(source('app/api/home/youtube-kpi/route.ts')).not.toContain('isTrustedSameOriginMutation');
  });

  test('omits sidebar-order persistence when the bounded body cannot be read', () => {
    const routeSource = source('app/api/admin/preferences/sidebar-order/route.ts');
    const mutationSource = handlerSource(routeSource, 'PATCH');
    const readerIndex = mutationSource.indexOf('readBoundedJsonRequest(');
    const persistIndex = mutationSource.indexOf('createSupabaseServiceRoleClient()');
    const upsertIndex = mutationSource.indexOf('.upsert(');
    const failureBranch = mutationSource.slice(readerIndex, persistIndex);

    const adminJsonSource = source('lib/admin/admin-json.ts');
    expect(routeSource).toContain('adminJson');
    expect(adminJsonSource).toContain('ADMIN_API_STATUS_CODES');
    expect(adminJsonSource).toContain('Cache-Control');
    expect(adminJsonSource).toContain('no-store');
    expect(routeSource).not.toContain('requestBody.ok ? requestBody.value : null');
    expect(routeSource).toContain('ADMIN_BODY_TOO_LARGE');
    expect(routeSource).toContain('413');
    expect(routeSource).toContain('ADMIN_UNSUPPORTED_MEDIA_TYPE');
    expect(routeSource).toContain('415');
    expect(routeSource).toContain('ADMIN_BODY_UNREADABLE');
    expect(routeSource).toContain('400');
    expect(failureBranch).toContain('!requestBody.ok');
    expect(failureBranch).toContain('bodyFailureResponse');
    expect(failureBranch).not.toContain('.upsert(');
    expect(persistIndex).toBeGreaterThan(readerIndex);
    expect(upsertIndex).toBeGreaterThan(persistIndex);
    expect(mutationSource.indexOf('isRecord(requestBody.value.order)')).toBeGreaterThan(readerIndex);
    expect(mutationSource.indexOf('isRecord(requestBody.value.order)')).toBeLessThan(persistIndex);
  });


  test('rejects actual and declared over-limit bodies, rejects non-JSON media, and accepts normal payloads', async () => {
    for (const contract of routeContracts) {
      const actualOversized = requestFromChunks([
        new Uint8Array(contract.maximumBytes + 1).fill(0x20),
      ]);
      expect(await readBoundedJsonRequest(actualOversized, contract.maximumBytes)).toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
      });

      const declaredOversized = requestFromChunks(
        [encoder.encode('{}')],
        { 'content-length': String(contract.maximumBytes + 1) },
      );
      expect(await readBoundedJsonRequest(declaredOversized, contract.maximumBytes)).toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
      });

      const wrongMediaType = requestFromChunks(
        [encoder.encode(JSON.stringify(contract.normalPayload))],
        { 'content-type': 'text/plain' },
      );
      expect(await readBoundedJsonRequest(wrongMediaType, contract.maximumBytes)).toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType,
      });
      const invalidJson = requestFromChunks([encoder.encode('{"unterminated"')]);
      expect(await readBoundedJsonRequest(invalidJson, contract.maximumBytes)).toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
      });

      const serialized = JSON.stringify(contract.normalPayload);
      const serializedBytes = encoder.encode(serialized);
      expect(serializedBytes.byteLength).toBeLessThanOrEqual(contract.maximumBytes);
      const exactPayload = requestFromChunks(
        [serializedBytes],
        { 'content-length': String(serializedBytes.byteLength) },
      );
      expect(await readBoundedJsonRequest(exactPayload, contract.maximumBytes)).toEqual({
        ok: true,
        value: contract.normalPayload,
      });
    }
  });
});
