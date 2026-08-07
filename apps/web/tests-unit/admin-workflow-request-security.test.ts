import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from "../lib/security/bounded-json-request";

const encoder = new TextEncoder();

function source(relativePath: string) {
  return readFileSync(join(import.meta.dir, "..", relativePath), "utf8");
}

function postHandler(routeSource: string) {
  const postIndex = routeSource.indexOf("export async function POST");
  expect(postIndex).toBeGreaterThan(-1);
  return routeSource.slice(postIndex);
}

function requestFromChunks(chunks: Uint8Array[], headers: HeadersInit = {}) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
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

const workflowRoutes = [
  {
    routePath: "app/api/admin/ocr-receipts/route.ts",
    readerCall: "readBoundedJsonRequest(request, MAX_OCR_RECEIPT_REQUEST_BYTES)",
    maximumBytes: 4 * 1024,
    maximumDeclaration: "const MAX_OCR_RECEIPT_REQUEST_BYTES = 4 * 1024;",
    sensitiveMarker: "await fetch(",
    validBody: { guardedMutationConfirmation: "APPLY" },
  },
  {
    routePath: "app/api/admin/ocr-receipts/rerun/route.ts",
    readerCall: "readBoundedJsonRequest(request, MAX_OCR_RERUN_REQUEST_BYTES)",
    maximumBytes: 4 * 1024,
    maximumDeclaration: "const MAX_OCR_RERUN_REQUEST_BYTES = 4 * 1024;",
    sensitiveMarker: "createSupabaseServiceRoleClient()",
    validBody: { reviewId: "review-1", guardedMutationConfirmation: "APPLY" },
  },
  {
    routePath: "app/api/admin/ocr-receipts/reset-all/route.ts",
    readerCall: "readBoundedJsonRequest(request, MAX_OCR_RESET_ALL_REQUEST_BYTES)",
    maximumBytes: 4 * 1024,
    maximumDeclaration: "const MAX_OCR_RESET_ALL_REQUEST_BYTES = 4 * 1024;",
    sensitiveMarker: "await fetch(",
    validBody: { confirmation: "OCR초기화", guardedMutationConfirmation: "APPLY" },
  },
  {
    routePath: "app/api/admin/restaurant-refresh-history/route.ts",
    readerCall: "readBoundedJsonRequest(request, MAX_REFRESH_HISTORY_REQUEST_BYTES)",
    maximumBytes: 16 * 1024,
    maximumDeclaration: "const MAX_REFRESH_HISTORY_REQUEST_BYTES = 16 * 1024;",
    sensitiveMarker: "createSupabaseServiceRoleClient()",
    validBody: {
      action: "decide_candidate",
      candidate_id: "candidate-1",
      decision: "approved",
      apply: false,
    },
  },
] as const;

describe("admin workflow request security", () => {
  test("all workflow mutations guard same-origin requests before bounded body reads or sensitive work", () => {
    for (const {
      routePath,
      readerCall,
      maximumDeclaration,
      sensitiveMarker,
    } of workflowRoutes) {
      const routeSource = source(routePath);
      const handler = postHandler(routeSource);
      const requireAdminIndex = handler.indexOf("await requireAdmin()");
      const guardIndex = handler.indexOf("isTrustedSameOriginMutation(request)");
      const readerIndex = handler.indexOf(readerCall);
      const sensitiveWorkIndex = handler.indexOf(sensitiveMarker);

      expect(routeSource).toContain("@/lib/security/bounded-json-request");
      expect(routeSource).toContain("@/lib/security/same-origin-mutation");
      expect(routeSource).not.toMatch(/\brequest\.(?:json|text)\s*\(/);
      expect(routeSource).toContain(maximumDeclaration);
      expect(handler).toContain("noStoreJson");
      expect(handler).toContain("Cache-Control");
      expect(requireAdminIndex).toBeGreaterThan(-1);
      expect(guardIndex).toBeGreaterThan(requireAdminIndex);
      expect(readerIndex).toBeGreaterThan(guardIndex);
      expect(sensitiveWorkIndex).toBeGreaterThan(readerIndex);
    }
  });

  test("the shared reader rejects wrong media types, declared or streamed oversize bodies, malformed JSON, and declaration mismatches", async () => {
    const declaredOversized = requestFromChunks(
      [encoder.encode("{}")],
      { "content-length": String(4 * 1024 + 1) },
    );
    expect(await readBoundedJsonRequest(declaredOversized, 4 * 1024)).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
    });

    let cancelled = false;
    const actualOversized = {
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"confirmation":"'));
          controller.enqueue(encoder.encode("x".repeat(4 * 1024)));
        },
        cancel() {
          cancelled = true;
        },
      }),
    } as unknown as Request;
    expect(await readBoundedJsonRequest(actualOversized, 4 * 1024)).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
    });
    expect(cancelled).toBe(true);

    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode("{} ")], { "content-length": "2" }),
      4 * 1024,
    )).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidContentLength,
    });
    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode("{}")], { "content-type": "text/plain" }),
      4 * 1024,
    )).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType,
    });
    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode("{")]),
      4 * 1024,
    )).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
    });
  });

  test("the shared reader accepts exact valid bodies for every workflow boundary", async () => {
    for (const { validBody, maximumBytes } of workflowRoutes) {
      const serialized = JSON.stringify(validBody);
      expect(await readBoundedJsonRequest(
        requestFromChunks(
          [encoder.encode(serialized)],
          { "content-length": String(encoder.encode(serialized).byteLength) },
        ),
        maximumBytes,
      )).toEqual({ ok: true, value: validBody });
    }
  });
});
