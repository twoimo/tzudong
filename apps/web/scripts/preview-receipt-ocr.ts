#!/usr/bin/env bun
/**
 * Local-first bounded receipt OCR preview CLI.
 *
 * Safe errors: no raw OCR text, stack traces, credentials, or personal data.
 * Returns normalized review suggestion only with `manualReviewRequired: true`.
 */
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalizeReceiptImage, getReceiptImageMimeTypeFromSignature } from '../lib/ocr/admin-receipt-image-security';
import {
  previewReceiptOcr,
  verifyCostPolicy,
  createLiveGeminiPreviewRunner,
  createLiveOpenAiPreviewRunner,
  OCR_PREVIEW_ERROR_CODES,
  OcrPreviewError,
  type OcrCostPolicy,
  type OcrPreviewOutput,
  type OcrPreviewProvider,
} from '../lib/ocr/preview';

interface CliArguments {
  imagePath: string;
  provider: OcrPreviewProvider;
  costPolicy: Partial<OcrCostPolicy>;
  timeoutMs?: number;
}

function parseCliArgs(args: string[]): CliArguments {
  if (args.length < 1 || args[0].startsWith('--')) {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.EMPTY_INPUT, {
      usage: 'bun scripts/preview-receipt-ocr.ts <imagePath> [--provider local|gemini|openai] [--allow-free-cloud] [--attest-gemini-free] [--allow-paid-cloud]',
    });
  }

  const imagePath = resolve(process.cwd(), args[0]);
  let provider: OcrPreviewProvider = 'local';
  const costPolicy: Partial<OcrCostPolicy> = {
    allowLocal: true,
    allowFreeCloud: false,
    geminiFreeTierAttested: false,
    allowPaidCloud: false,
  };
  let timeoutMs: number | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--provider' && i + 1 < args.length) {
      const p = args[++i];
      if (p === 'local' || p === 'gemini' || p === 'openai') {
        provider = p;
      } else {
        throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
      }
    } else if (arg === '--allow-free-cloud') {
      costPolicy.allowFreeCloud = true;
    } else if (arg === '--attest-gemini-free') {
      costPolicy.geminiFreeTierAttested = true;
    } else if (arg === '--allow-paid-cloud') {
      costPolicy.allowPaidCloud = true;
    } else if (arg === '--timeout-ms' && i + 1 < args.length) {
      const t = Number(args[++i]);
      if (!Number.isInteger(t) || t <= 0 || t > 30_000) throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.INVALID_IMAGE_DATA);
      timeoutMs = t;
    } else {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.INVALID_IMAGE_DATA);
    }
  }

  verifyCostPolicy(provider, costPolicy);
  return { imagePath, provider, costPolicy, timeoutMs };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  let parsed: CliArguments;

  try {
    parsed = parseCliArgs(rawArgs);
  } catch (err: unknown) {
    const code = err instanceof OcrPreviewError ? err.code : OCR_PREVIEW_ERROR_CODES.EMPTY_INPUT;
    const errorOutput: OcrPreviewOutput = {
      engine: 'none',
      manualReviewRequired: true,
      cloudCalls: 0,
      result: { error: code, confidence: 0 },
      error: code,
    };
    console.log(JSON.stringify(errorOutput, null, 2));
    process.exit(1);
  }

  if (!existsSync(parsed.imagePath)) {
    const errorOutput: OcrPreviewOutput = {
      engine: parsed.provider,
      manualReviewRequired: true,
      cloudCalls: 0,
      result: { error: OCR_PREVIEW_ERROR_CODES.INVALID_IMAGE_DATA, confidence: 0 },
      error: OCR_PREVIEW_ERROR_CODES.INVALID_IMAGE_DATA,
    };
    console.log(JSON.stringify(errorOutput, null, 2));
    process.exit(1);
  }

  let fileBytes: Uint8Array;
  try {
    const descriptor = openSync(parsed.imagePath, 'r');
    try {
      const buffer = Buffer.alloc(8 * 1024 * 1024 + 1);
      const read = readSync(descriptor, buffer, 0, buffer.length, 0);
      if (read > 8 * 1024 * 1024) throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.INPUT_TOO_LARGE);
      fileBytes = buffer.subarray(0, read);
    } finally { closeSync(descriptor); }
  } catch {
    const errorOutput: OcrPreviewOutput = {
      engine: parsed.provider,
      manualReviewRequired: true,
      cloudCalls: 0,
      result: { error: OCR_PREVIEW_ERROR_CODES.INVALID_IMAGE_DATA, confidence: 0 },
      error: OCR_PREVIEW_ERROR_CODES.INVALID_IMAGE_DATA,
    };
    console.log(JSON.stringify(errorOutput, null, 2));
    process.exit(1);
  }

  let cloudCalls = 0;
  const trackedFetch: typeof fetch = (...args) => { cloudCalls += 1; return fetch(...args); };
  try {
    const mime = getReceiptImageMimeTypeFromSignature(fileBytes);
    if (!mime) throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.INVALID_IMAGE_DATA);
    const canonical = await canonicalizeReceiptImage(Buffer.from(fileBytes), mime);
    const options = {
      ...(parsed.provider === 'gemini' ? { geminiRunner: createLiveGeminiPreviewRunner({ costPolicy: parsed.costPolicy, fetchFn: trackedFetch }) } : {}),
      ...(parsed.provider === 'openai' ? { openAiRunner: createLiveOpenAiPreviewRunner({ costPolicy: parsed.costPolicy, fetchFn: trackedFetch }) } : {}),
    };
    const output = await previewReceiptOcr({
      imageBytes: canonical.bytes,
      mimeType: canonical.mimeType,
      provider: parsed.provider,
      costPolicy: parsed.costPolicy,
      timeoutMs: parsed.timeoutMs,
    }, options);
    console.log(JSON.stringify(output, null, 2));
  } catch (err: unknown) {
    const code = err instanceof OcrPreviewError ? err.code : OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR;
    const errorOutput: OcrPreviewOutput = {
      engine: parsed.provider,
      manualReviewRequired: true,
      cloudCalls,
      result: { error: code, confidence: 0 },
      error: code,
    };
    console.log(JSON.stringify(errorOutput, null, 2));
    process.exit(1);
  }
}

if (import.meta.main || process.argv[1] === import.meta.filename) {
  main().catch(() => {
    process.exit(1);
  });
}
