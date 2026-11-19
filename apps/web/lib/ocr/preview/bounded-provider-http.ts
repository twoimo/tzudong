import { OcrPreviewError, OCR_PREVIEW_ERROR_CODES } from './types';

const MAX_RESPONSE_BYTES = 64 * 1024;

export function previewRequestSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined, fallback: number) {
  const timeout = Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0 ? Math.min(timeoutMs!, 30_000) : fallback;
  return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
}

/** Bound bytes while reading, not after an unbounded response.text() allocation. */
export async function readBoundedPreviewResponse(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE);
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof OcrPreviewError) throw error;
    throw new OcrPreviewError(signal.aborted ? OCR_PREVIEW_ERROR_CODES.TIMEOUT : OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => {});
  }
}
