import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { canonicalizeReceiptImage } from '@/lib/ocr/admin-receipt-image-security';
import { previewReceiptOcr, OcrPreviewError } from '@/lib/ocr/preview';
import {
  isLocalOcrPreviewEnabled,
  LOCAL_OCR_PREVIEW_MAX_REQUEST_BYTES,
  parseLocalOcrPreviewRequest,
} from '@/lib/ocr/local-preview-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const noStoreJson = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache' },
});
let previewInFlight = false;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) { auth.response.headers.set('Cache-Control', 'no-store'); return auth.response; }
  return noStoreJson({ localAvailable: isLocalOcrPreviewEnabled(), cloudAvailable: false, persistsResult: false });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) { auth.response.headers.set('Cache-Control', 'no-store'); return auth.response; }
  if (!isTrustedSameOriginMutation(request)) return noStoreJson({ code: 'FORBIDDEN' }, 403);
  if (!isLocalOcrPreviewEnabled()) return noStoreJson({ code: 'LOCAL_ENGINE_UNAVAILABLE' }, 503);
  if (previewInFlight) return noStoreJson({ code: 'PREVIEW_BUSY' }, 429);
  const body = await readBoundedJsonRequest(request, LOCAL_OCR_PREVIEW_MAX_REQUEST_BYTES);
  if (!body.ok) return noStoreJson({ code: 'INVALID_REQUEST' }, 400);
  const input = parseLocalOcrPreviewRequest(body.value);
  if (!input) return noStoreJson({ code: 'INVALID_REQUEST' }, 400);
  // Recheck after the asynchronous body read before taking the single-process lease.
  if (previewInFlight) return noStoreJson({ code: 'PREVIEW_BUSY' }, 429);
  previewInFlight = true;
  try {
    const canonical = await canonicalizeReceiptImage(input.bytes, input.mimeType);
    const preview = await previewReceiptOcr({
      imageBytes: canonical.bytes,
      mimeType: canonical.mimeType,
      provider: 'local',
      signal: request.signal,
      timeoutMs: 20_000,
    });
    return noStoreJson(preview);
  } catch (error) {
    // Never return native stderr, OCR text, provider diagnostics or filesystem paths.
    const code = error instanceof OcrPreviewError ? error.code : 'INVALID_IMAGE_DATA';
    return noStoreJson({ code }, code === 'TIMEOUT' ? 504 : code === 'LOCAL_ENGINE_UNAVAILABLE' ? 503 : 422);
  } finally {
    previewInFlight = false;
  }
}
