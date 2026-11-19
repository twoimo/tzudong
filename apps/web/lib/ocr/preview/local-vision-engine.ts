import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OCR_PREVIEW_ERROR_CODES,
  OcrPreviewError,
  type RecognizedTextLine,
} from './types';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const DEFAULT_TIMEOUT_MS = 8_000;

export type LocalVisionRunner = (
  imageBytes: Uint8Array,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RecognizedTextLine[]>;

function findSwiftScriptPath(): string | null {
  const candidates = [
    resolve(process.cwd(), 'backend/restaurant-crawling/scripts/receipt-preview-ocr.swift'),
    resolve(process.cwd(), '../backend/restaurant-crawling/scripts/receipt-preview-ocr.swift'),
    resolve(process.cwd(), '../../backend/restaurant-crawling/scripts/receipt-preview-ocr.swift'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Executes on-device macOS Vision OCR by streaming image bytes directly to
 * `backend/restaurant-crawling/scripts/receipt-preview-ocr.swift` via standard input.
 * Avoids creating temporary image files on disk.
 */
export async function runMacosVisionOcr(
  imageBytes: Uint8Array,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    scriptPath?: string;
  } = {},
): Promise<RecognizedTextLine[]> {
  if (!imageBytes || imageBytes.byteLength === 0) {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.EMPTY_INPUT);
  }
  if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.INPUT_TOO_LARGE);
  }

  if (process.platform !== 'darwin') throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.LOCAL_ENGINE_UNAVAILABLE);
  const scriptPath = options.scriptPath ?? findSwiftScriptPath();
  if (!scriptPath) {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.LOCAL_ENGINE_UNAVAILABLE, {
      reason: 'swift_script_not_found',
    });
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
    ? Math.min(options.timeoutMs!, 30_000) : DEFAULT_TIMEOUT_MS;

  return new Promise<RecognizedTextLine[]>((resolvePromise, rejectPromise) => {
    let settled = false;
    let proc: ReturnType<typeof spawn> | null = null;

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      if (proc) {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      }
      rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT));
    }, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (proc) {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      }
      rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT));
    };

    if (options.signal?.aborted) {
      clearTimeout(timeoutTimer);
      rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT));
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      proc = spawn('/usr/bin/swift', [scriptPath, '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      cleanup();
      rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.LOCAL_ENGINE_UNAVAILABLE));
      return;
    }

    const { stdin, stdout, stderr } = proc;
    if (!stdin || !stdout || !stderr) {
      cleanup();
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.LOCAL_ENGINE_UNAVAILABLE));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const failProcess = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try { proc?.kill('SIGKILL'); } catch { /* process already gone */ }
      rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR));
    };
    stdin.on('error', failProcess);

    stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > 256 * 1024) { failProcess(); return; }
      if (!settled) stdoutChunks.push(chunk);
    });

    stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 8 * 1024) { failProcess(); return; }
      if (!settled) stderrChunks.push(chunk);
    });

    proc.on('error', () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.LOCAL_ENGINE_UNAVAILABLE));
    });

    proc.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (exitCode !== 0) {
        const rawStderr = Buffer.concat(stderrChunks).toString('utf8');
        try {
          const parsedError = JSON.parse(rawStderr);
          if (parsedError.error === 'INVALID_IMAGE_DATA') {
            rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.INVALID_IMAGE_DATA));
            return;
          }
        } catch { /* ignore */ }
        rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR));
        return;
      }

      const rawStdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      try {
        const parsed = JSON.parse(rawStdout);
        if (Array.isArray(parsed.lines) && parsed.lines.length <= 256 && parsed.lines.every((line: unknown) => {
          if (!line || typeof line !== 'object') return false;
          const row = line as Record<string, unknown>;
          return typeof row.text === 'string' && row.text.length <= 256
            && (row.confidence === undefined || (typeof row.confidence === 'number' && Number.isFinite(row.confidence) && row.confidence >= 0 && row.confidence <= 1));
        })) {
          resolvePromise(parsed.lines as RecognizedTextLine[]);
          return;
        }
        rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE));
      } catch {
        rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE));
      }
    });

    try {
      stdin.write(Buffer.from(imageBytes));
      stdin.end();
    } catch {
      if (!settled) {
        settled = true;
        cleanup();
        try { proc?.kill('SIGKILL'); } catch { /* process already gone */ }
        rejectPromise(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR));
      }
    }
  });
}
