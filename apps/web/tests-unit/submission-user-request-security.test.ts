import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '../lib/security/bounded-json-request';

const encoder = new TextEncoder();
const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

type RouteContract = {
  authMarker: string;
  handler: 'DELETE' | 'PATCH' | 'POST';
  maximumBytes: number;
  maximumBytesSource: string;
  normalPayload: unknown;
  readerCall: string;
  privilegedWork: string;
  routePath: string;
};

const routeContracts: readonly RouteContract[] = [
  {
    routePath: 'app/api/mypage/submissions/submit/route.ts',
    handler: 'POST',
    authMarker: 'await supabase.auth.getUser()',
    maximumBytes: 64 * 1024,
    maximumBytesSource: 'const MAX_SUBMISSION_REQUEST_BYTES = 64 * 1024;',
    readerCall: 'readBoundedJsonRequest(request, MAX_SUBMISSION_REQUEST_BYTES)',
    privilegedWork: 'return await submitNew(',
    normalPayload: {
      mode: 'new',
      payload: {
        restaurant_name: '테스트 식당',
        address: '서울특별시 중구 테스트로 1',
        phone: '',
        categories: ['한식'],
        youtube_link: 'https://youtu.be/abcdefghijk',
        description: '방문 후기',
      },
      clientRequestKey: 'submit-key-123',
    },
  },
  {
    routePath: 'app/api/mypage/submissions/delete/route.ts',
    handler: 'DELETE',
    authMarker: 'await supabase.auth.getUser()',
    maximumBytes: 1024,
    maximumBytesSource: 'const MAX_SUBMISSION_DELETE_REQUEST_BYTES = 1024;',
    readerCall: 'readBoundedJsonRequest(request, MAX_SUBMISSION_DELETE_REQUEST_BYTES)',
    privilegedWork: 'createSupabaseServiceRoleClient()',
    normalPayload: {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'new',
    },
  },
  {
    routePath: 'app/api/admin/users/[userId]/route.ts',
    handler: 'PATCH',
    authMarker: 'await requireAdmin()',
    maximumBytes: 64 * 1024,
    maximumBytesSource: 'const MAX_ADMIN_USER_MUTATION_REQUEST_BYTES = 64 * 1024;',
    readerCall: 'readBoundedJsonRequest(',
    privilegedWork: 'createSupabaseServiceRoleClient()',
    normalPayload: {
      profile: {
        avatarUrl: null,
        nickname: '운영자',
        username: 'operator',
      },
      role: 'admin',
      accountStatus: 'active',
      confirmation: '권한변경',
    },
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

function handlerSource(routeSource: string, handler: RouteContract['handler']) {
  return routeSource.slice(routeSource.indexOf(`export async function ${handler}`));
}
type SubmitRoutePersistence = {
  insertCalls: number;
  rpcCalls: number;
  serviceRoleCalls: number;
};

const validSubmissionBody = {
  mode: 'new',
  payload: {
    restaurant_name: '테스트 식당',
    address: '서울특별시 중구 테스트로 1',
    phone: '02-1234-5678',
    categories: ['한식'],
    youtube_link: 'https://youtu.be/abcdefghijk',
    description: '방문 후기',
  },
  clientRequestKey: 'submit-key-123',
};

function submitRouteRequest(body: string) {
  return new Request('http://localhost/api/mypage/submissions/submit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body,
  });
}

async function loadSubmissionSubmitRoute() {
  const persistence: SubmitRoutePersistence = {
    insertCalls: 0,
    rpcCalls: 0,
    serviceRoleCalls: 0,
  };
  const requestPayloads: Array<Record<string, unknown>> = [];

  mock.module('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: 'test-user' } },
          error: null,
        }),
      },
    }),
  }));
  mock.module('@/lib/supabase/service-role', () => ({
    createSupabaseServiceRoleClient: () => {
      persistence.serviceRoleCalls += 1;
      return {
        rpc: async (_name: string, params: Record<string, unknown>) => {
          persistence.rpcCalls += 1;
          return {
            data: {
              submission_id: 'submission-id',
              item_id: 'item-id',
              user_id: params.p_user_id,
              submission_type: params.p_submission_type,
              client_submission_key: params.p_client_submission_key,
              status: 'pending',
              restaurant_name: params.p_restaurant_name,
              restaurant_address: params.p_restaurant_address,
              restaurant_phone: params.p_restaurant_phone,
              restaurant_categories: params.p_restaurant_categories,
              youtube_link: params.p_youtube_link,
              tzuyang_review: params.p_tzuyang_review,
            },
            error: null,
          };
        },
        from: () => ({
          insert: (payload: Record<string, unknown>) => {
            persistence.insertCalls += 1;
            requestPayloads.push(payload);
            return {
              select: () => ({
                single: async () => ({ error: null }),
              }),
            };
          },
          select: () => {
            const query = {
              eq: () => query,
              maybeSingle: async () => {
                const payload = requestPayloads.at(-1);
                return {
                  data: payload
                    ? {
                        id: 'request-id',
                        user_id: payload.user_id,
                        restaurant_name: payload.restaurant_name,
                        origin_address: payload.origin_address,
                        phone: payload.phone,
                        categories: payload.categories,
                        recommendation_reason: payload.recommendation_reason,
                        youtube_link: payload.youtube_link,
                        client_request_key: payload.client_request_key,
                        status: payload.status,
                      }
                    : null,
                  error: null,
                };
              },
            };
            return query;
          },
        }),
      };
    },
  }));

  const route = await import(`../app/api/mypage/submissions/submit/route.ts?cache=${Math.random()}`);
  return {
    POST: route.POST as (request: Request) => Promise<Response>,
    persistence,
  };
}

describe('submission and admin-user request security', () => {
  test('uses bounded JSON schema caps without raw readers and retains no-store responses', () => {
    for (const contract of routeContracts) {
      const routeSource = source(contract.routePath);

      expect(contract.maximumBytes).toBeLessThanOrEqual(64 * 1024);
      expect(routeSource).toContain('@/lib/security/bounded-json-request');
      expect(routeSource).toContain(contract.maximumBytesSource);
      expect(routeSource).toContain(contract.readerCall);
      expect(routeSource).toContain('function noStoreJson');
      expect(routeSource).not.toMatch(/request\.(?:json|text)\s*\(/);
    }
  });

  test('checks same-origin after authentication and before reading or privileged mutation work', () => {
    for (const contract of routeContracts) {
      const routeSource = source(contract.routePath);
      const mutationSource = handlerSource(routeSource, contract.handler);
      const authIndex = mutationSource.indexOf(contract.authMarker);
      const guardIndex = mutationSource.indexOf('isTrustedSameOriginMutation(request)');
      const readerIndex = mutationSource.indexOf('readBoundedJsonRequest(');
      const privilegedWorkIndex = mutationSource.indexOf(contract.privilegedWork);

      expect(routeSource).toContain('@/lib/security/same-origin-mutation');
      expect(authIndex).toBeGreaterThan(-1);
      expect(guardIndex).toBeGreaterThan(authIndex);
      expect(readerIndex).toBeGreaterThan(guardIndex);
      expect(privilegedWorkIndex).toBeGreaterThan(readerIndex);
      expect(mutationSource.slice(guardIndex, readerIndex)).toMatch(/(?:status:\s*403|,\s*403\))/);
    }
  });

  test('rejects declared and streamed over-cap bodies plus malformed media, while accepting exact valid bodies', async () => {
    for (const contract of routeContracts) {
      const declaredOversized = requestFromChunks(
        [encoder.encode('{}')],
        { 'content-length': String(contract.maximumBytes + 1) },
      );
      expect(await readBoundedJsonRequest(declaredOversized, contract.maximumBytes)).toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
      });

      const streamedOversized = requestFromChunks([
        new Uint8Array(contract.maximumBytes + 1).fill(0x20),
      ]);
      expect(await readBoundedJsonRequest(streamedOversized, contract.maximumBytes)).toEqual({
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

      const malformedJson = requestFromChunks([encoder.encode('{"unterminated"')]);
      expect(await readBoundedJsonRequest(malformedJson, contract.maximumBytes)).toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
      });

      const serialized = encoder.encode(JSON.stringify(contract.normalPayload));
      expect(serialized.byteLength).toBeLessThanOrEqual(contract.maximumBytes);
      const exactBody = requestFromChunks(
        [serialized],
        { 'content-length': String(serialized.byteLength) },
      );
      expect(await readBoundedJsonRequest(exactBody, contract.maximumBytes)).toEqual({
        ok: true,
        value: contract.normalPayload,
      });
    }
  });
  test('rejects malformed, unknown, lossy, oversized, and coordinate payloads before any persistence', async () => {
    const { POST, persistence } = await loadSubmissionSubmitRoute();
    const nonfiniteLatitude = JSON.stringify({
      ...validSubmissionBody,
      payload: { ...validSubmissionBody.payload, latitude: 1 },
    }).replace('"latitude":1', '"latitude":1e400');
    const invalidBodies = [
      '{',
      'null',
      '[]',
      '"submission"',
      JSON.stringify({ ...validSubmissionBody, ignored: true }),
      JSON.stringify({ ...validSubmissionBody, mode: 'edit' }),
      JSON.stringify({ ...validSubmissionBody, mode: 1 }),
      JSON.stringify({ ...validSubmissionBody, clientRequestKey: null }),
      JSON.stringify({ ...validSubmissionBody, clientRequestKey: 1 }),
      JSON.stringify({ ...validSubmissionBody, clientRequestKey: ' submit-key-123' }),
      JSON.stringify({ ...validSubmissionBody, clientRequestKey: 'k'.repeat(129) }),
      JSON.stringify({ ...validSubmissionBody, payload: null }),
      JSON.stringify({ ...validSubmissionBody, payload: [] }),
      JSON.stringify({ ...validSubmissionBody, payload: 'payload' }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, ignored: true },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, restaurant_name: 1 },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, address: null },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, address: '주'.repeat(501) },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, phone: 1 },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, phone: '0'.repeat(41) },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, phone: '010-1234-5678' },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: {
          ...validSubmissionBody.payload,
          metadata: { phone: '02-1234-5678' },
        },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, description: '연락처 010-1234-5678' },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, categories: null },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, categories: { value: '한식' } },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, categories: ['한식', 1] },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, categories: ['한식', ' 한식 '] },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, categories: [''] },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: {
          ...validSubmissionBody.payload,
          categories: Array.from({ length: 11 }, (_, index) => `음식${index}`),
        },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, categories: ['한'.repeat(51)] },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, restaurant_name: '식'.repeat(161) },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, youtube_link: 'h'.repeat(2_049) },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, description: '설'.repeat(4_001) },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, youtube_link: null },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: { ...validSubmissionBody.payload, description: 1 },
      }),
      JSON.stringify({
        ...validSubmissionBody,
        payload: {
          ...validSubmissionBody.payload,
          latitude: 91,
          longitude: 181,
        },
      }),
      nonfiniteLatitude,
      `{"mode":"new","mode":"request","payload":${JSON.stringify(validSubmissionBody.payload)},"clientRequestKey":"submit-key-123"}`,
      '{"mode":"new","payload":{"restaurant_name":"가","restaurant_name":"나"},"clientRequestKey":"submit-key-123"}',
    ];

    for (const body of invalidBodies) {
      const response = await POST(submitRouteRequest(body));

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(persistence.serviceRoleCalls).toBe(0);
      expect(persistence.rpcCalls).toBe(0);
      expect(persistence.insertCalls).toBe(0);
    }
  });

  test('accepts new and recommendation request controls only after exact validation', async () => {
    const { POST, persistence } = await loadSubmissionSubmitRoute();

    const newResponse = await POST(submitRouteRequest(JSON.stringify(validSubmissionBody)));
    expect(newResponse.status).toBe(200);
    expect(newResponse.headers.get('Cache-Control')).toBe('no-store');
    expect(persistence.serviceRoleCalls).toBe(1);
    expect(persistence.rpcCalls).toBe(1);
    expect(persistence.insertCalls).toBe(0);

    const requestResponse = await POST(submitRouteRequest(JSON.stringify({
      ...validSubmissionBody,
      mode: 'request',
      payload: {
        ...validSubmissionBody.payload,
        youtube_link: '',
        description: '여기는 꼭 추천하고 싶은 맛집입니다.',
      },
      clientRequestKey: 'request-key-123',
    })));
    expect(requestResponse.status).toBe(200);
    expect(requestResponse.headers.get('Cache-Control')).toBe('no-store');
    expect(persistence.serviceRoleCalls).toBe(2);
    expect(persistence.rpcCalls).toBe(1);
    expect(persistence.insertCalls).toBe(1);
  });
});
