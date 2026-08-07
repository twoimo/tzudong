import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '../lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '../lib/security/same-origin-mutation';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const encoder = new TextEncoder();

function requestFromChunks(chunks: Uint8Array[], headers: HeadersInit = {}) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('content-type')) requestHeaders.set('content-type', 'application/json');

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

function browserMutation(headers: HeadersInit) {
  return new Request('https://www.tzudong.app/api/admin/storyboard', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

const storyboardJsonMutationRoutes = [
  {
    routePath: 'app/api/admin/storyboard/route.ts',
    authCall: 'await requireAdmin',
    mutationMarker: 'buildStoryboardJobInsert(',
  },
  {
    routePath: 'app/api/admin/storyboard/chat/route.ts',
    authCall: 'await requireAdmin',
    mutationMarker: 'generateStoryboardChatWithBackendAgent(',
  },
  {
    routePath: 'app/api/admin/storyboard/images/route.ts',
    authCall: 'await requireAdmin',
    mutationMarker: 'generateStoryboardSceneImagesForRoute(',
  },
  {
    routePath: 'app/api/admin/storyboard/jobs/route.ts',
    authCall: 'await requireAdmin',
    mutationMarker: 'buildStoryboardJobInsert(',
  },
  {
    routePath: 'app/api/admin/storyboard/rag/documents/route.ts',
    authCall: 'await authenticateStoryboardRagAction',
    mutationMarker: 'embedStoryboardRagTexts(',
  },
  {
    routePath: 'app/api/admin/storyboard/rag/search/route.ts',
    authCall: 'await authenticateStoryboardRagAction',
    mutationMarker: 'embedStoryboardRagTexts(',
  },
] as const;

const productionEnv = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SITE_URL: 'https://www.tzudong.app',
} as NodeJS.ProcessEnv;

describe('admin storyboard mutation request security', () => {
  test('puts the shared same-origin and bounded JSON gates ahead of all six JSON mutation surfaces', () => {
    const telemetrySource = source('lib/admin/storyboard/route-telemetry.ts');
    expect(telemetrySource).toContain("from '@/lib/security/bounded-json-request'");
    expect(telemetrySource).toContain('readBoundedJsonRequest(request, maximumBytes)');
    expect(telemetrySource).not.toMatch(/request\.(?:json|text|arrayBuffer|formData)\s*\(/);

    for (const route of storyboardJsonMutationRoutes) {
      const routeSource = source(route.routePath);
      const authIndex = routeSource.indexOf(route.authCall);
      const originIndex = routeSource.indexOf('isTrustedSameOriginMutation(request)');
      const readerIndex = routeSource.lastIndexOf('readStoryboardRouteJson(');
      const mutationIndex = routeSource.lastIndexOf(route.mutationMarker);

      expect(routeSource).toContain("@/lib/security/same-origin-mutation");
      expect(routeSource).toContain('STORYBOARD_ROUTE_NO_STORE_HEADERS');
      expect(routeSource).not.toMatch(/request\.(?:json|text|arrayBuffer|formData)\s*\(/);
      expect(authIndex).toBeGreaterThan(-1);
      expect(originIndex).toBeGreaterThan(authIndex);
      expect(readerIndex).toBeGreaterThan(originIndex);
      expect(routeSource.slice(readerIndex, mutationIndex)).toMatch(/MAX_[A-Z0-9_]+_REQUEST_BYTES/);
      expect(mutationIndex).toBeGreaterThan(readerIndex);
    }
  });

  test('requires strict RAG request shapes before embedding or database work', () => {
    const documentsRoute = source('app/api/admin/storyboard/rag/documents/route.ts');
    const searchRoute = source('app/api/admin/storyboard/rag/search/route.ts');

    expect(documentsRoute).toContain('const MAX_STORYBOARD_RAG_DOCUMENTS_REQUEST_BYTES = 2 * 1024 * 1024;');
    expect(documentsRoute).toContain('const documentSchema = z.object(');
    expect(documentsRoute).toContain('const upsertDocumentsSchema = z.object(');
    expect(documentsRoute.match(/\}\)\.strict\(\);/g)).toHaveLength(2);
    expect(searchRoute).toContain('const MAX_STORYBOARD_RAG_SEARCH_REQUEST_BYTES = 32 * 1024;');
    expect(searchRoute).toContain('const searchSchema = z.object(');
    expect(searchRoute.match(/\}\)\.strict\(\);/g)).toHaveLength(1);
  });

  test('origin-checks the bodyless job cancellation before it can update a job', () => {
    const cancelRoute = source('app/api/admin/storyboard/jobs/[jobId]/cancel/route.ts');
    const authIndex = cancelRoute.indexOf('await requireAdmin');
    const originIndex = cancelRoute.indexOf('isTrustedSameOriginMutation(request)');
    const mutationIndex = cancelRoute.indexOf(".from('admin_storyboard_jobs')");

    expect(cancelRoute).toContain("@/lib/security/same-origin-mutation");
    expect(authIndex).toBeGreaterThan(-1);
    expect(originIndex).toBeGreaterThan(authIndex);
    expect(mutationIndex).toBeGreaterThan(originIndex);
    expect(cancelRoute.slice(originIndex, mutationIndex)).toContain('storyboard_job_cancel_forbidden');
  });

  test('rejects cross-site, text/plain, oversized, and stalled requests while accepting canonical same-origin JSON', async () => {
    expect(isTrustedSameOriginMutation(browserMutation({
      cookie: 'sb-admin-session=value',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
    }), productionEnv)).toBe(false);
    expect(isTrustedSameOriginMutation(browserMutation({
      cookie: 'sb-admin-session=value',
      origin: 'https://www.tzudong.app',
      'sec-fetch-site': 'same-origin',
    }), productionEnv)).toBe(true);

    const canonicalBody = JSON.stringify({ query: '스토리보드 검색' });
    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode(canonicalBody)], { 'content-length': String(encoder.encode(canonicalBody).byteLength) }),
      256,
    )).toEqual({ ok: true, value: { query: '스토리보드 검색' } });
    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{}')], { 'content-type': 'text/plain' }),
      256,
    )).toEqual({ ok: false, code: BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType });
    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{}')], { 'content-length': '257' }),
      256,
    )).toEqual({ ok: false, code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge });

    let stalledBodyCancelled = false;
    const stalledRequest = {
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream<Uint8Array>({
        cancel() {
          stalledBodyCancelled = true;
        },
      }),
    } as unknown as Request;
    expect(await readBoundedJsonRequest(stalledRequest, 256)).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
    expect(stalledBodyCancelled).toBe(true);
  });
});
