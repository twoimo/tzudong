import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '../lib/security/bounded-json-request';

const encoder = new TextEncoder();
const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

const proposalId = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);

type RouteContract = {
  routePath: string;
  maximumBytes: number;
  maximumBytesSource: string;
  normalPayload: unknown;
  privilegedWork: string;
  parserError: string;
};

const routeContracts: RouteContract[] = [
  {
    routePath: 'app/api/admin/routes/directions/route.ts',
    maximumBytes: 16 * 1024,
    maximumBytesSource: 'const MAX_DIRECTIONS_REQUEST_BYTES = 16 * 1024;',
    normalPayload: {
      points: [
        { id: 'start', name: '출발지', lat: 37.5665, lng: 126.978 },
        { id: 'goal', name: '도착지', lat: 37.5701, lng: 126.992 },
      ],
      option: 'trafast',
      mode: 'driving',
    },
    privilegedWork: 'resolveNaverDirectionsCredentials(process.env)',
    parserError: 'error: "Invalid JSON body"',
  },
  {
    routePath: 'app/api/admin/trend-proposals/[proposalId]/approve/route.ts',
    maximumBytes: 64 * 1024,
    maximumBytesSource: 'const MAX_TREND_PROPOSAL_APPROVAL_REQUEST_BYTES = 64 * 1024;',
    normalPayload: {
      normalizedOverlayPayload: {
        action: 'upsert',
        restaurantId: proposalId,
        overlayType: 'trend',
        label: '여름 추천',
        description: '검증된 계절 추천입니다.',
        activeFrom: null,
        activeUntil: null,
        evidence: { source: 'operator-review' },
        reason: '검토 완료',
      },
      confirmationText: '오버레이 적용',
      expectedProposalHash: hash,
      previewHash: hash,
      payloadHash: hash,
      previewExpiresAt: '2099-01-01T00:00:00.000Z',
      correlationId: proposalId,
      idempotencyKey: 'trend-proposal-approval-test',
    },
    privilegedWork: 'createSupabaseServiceRoleClient()',
    parserError: "error: 'invalid_trend_proposal_approval_request'",
  },
  {
    routePath: 'app/api/admin/trend-proposals/[proposalId]/preview-overlay/route.ts',
    maximumBytes: 4 * 1024,
    maximumBytesSource: 'const MAX_TREND_PROPOSAL_PREVIEW_REQUEST_BYTES = 4 * 1024;',
    normalPayload: { edits: { label: '여름 추천', description: '검증된 계절 추천입니다.' } },
    privilegedWork: 'createSupabaseServiceRoleClient()',
    parserError: "error: 'invalid_trend_proposal_preview_request'",
  },
  {
    routePath: 'app/api/admin/trend-proposals/[proposalId]/reject/route.ts',
    maximumBytes: 4 * 1024,
    maximumBytesSource: 'const MAX_TREND_PROPOSAL_REJECT_REQUEST_BYTES = 4 * 1024;',
    normalPayload: {
      transition: 'rejected',
      reason: '근거가 부족합니다.',
      expectedProposalHash: hash,
      correlationId: proposalId,
      idempotencyKey: 'trend-proposal-rejection-test',
    },
    privilegedWork: 'createSupabaseServiceRoleClient()',
    parserError: "error: 'invalid_trend_proposal_review_request'",
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

function postHandlerSource(routeSource: string) {
  const handlerStart = routeSource.indexOf('export async function POST');
  return routeSource.slice(handlerStart);
}

describe('trend proposal and directions request security', () => {
  test('uses bounded readers with schema-derived caps and fixed parser errors', () => {
    for (const contract of routeContracts) {
      const routeSource = source(contract.routePath);

      expect(contract.maximumBytes).toBeLessThanOrEqual(64 * 1024);
      expect(routeSource).toContain('@/lib/security/bounded-json-request');
      expect(routeSource).toContain('readBoundedJsonRequest(');
      expect(routeSource).toContain(contract.maximumBytesSource);
      expect(routeSource).toContain(contract.parserError);
      expect(routeSource).not.toMatch(/request\.(?:json|text)\s*\(/);
    }
  });

  test('checks the same-origin boundary after admin auth and before parsing or privileged work', () => {
    for (const contract of routeContracts) {
      const routeSource = source(contract.routePath);
      const handlerSource = postHandlerSource(routeSource);
      const authIndex = handlerSource.indexOf('await requireAdmin()');
      const guardIndex = handlerSource.indexOf('isTrustedSameOriginMutation(request)');
      const readerIndex = handlerSource.indexOf('readBoundedJsonRequest(');
      const privilegedWorkIndex = handlerSource.indexOf(contract.privilegedWork);

      expect(routeSource).toContain('@/lib/security/same-origin-mutation');
      expect(authIndex).toBeGreaterThan(-1);
      expect(guardIndex).toBeGreaterThan(authIndex);
      expect(readerIndex).toBeGreaterThan(guardIndex);
      expect(privilegedWorkIndex).toBeGreaterThan(readerIndex);
      expect(handlerSource.slice(guardIndex, readerIndex)).toContain('status: 403');
    }
  });

  test('rejects actual and declared over-limit bodies, wrong media types, and malformed JSON while accepting exact valid payloads', async () => {
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

      const malformedJson = requestFromChunks([encoder.encode('{"unterminated"')]);
      expect(await readBoundedJsonRequest(malformedJson, contract.maximumBytes)).toEqual({
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
