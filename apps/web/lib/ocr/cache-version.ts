import type { OcrRoutingMode, OcrRoutingProvider } from '@/lib/admin/ai-settings-store';

export const RECEIPT_OCR_RAW_CACHE_KIND = 'receipt_ocr_raw_v1' as const;
export const RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION = 'receipt-ocr-schema-v1' as const;

export type OcrCacheVersion = {
  cacheKind: typeof RECEIPT_OCR_RAW_CACHE_KIND;
  provider: OcrRoutingProvider;
  model: string;
  promptVersion: string;
  preprocessVersion: string;
  extractionSchemaVersion: typeof RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION;
  routingMode: OcrRoutingMode;
};

export type OcrCacheMetadata = Partial<{
  cache_kind: string;
  provider: string;
  model: string;
  prompt_version: string;
  preprocess_version: string;
  extraction_schema_version: string;
  routing_mode: string;
  normalization_version: string;
  raw_ocr_result: Record<string, unknown>;
  model_attempts: Array<Record<string, unknown>>;
  /** Historical corrected envelope kept only for audit/backcompat; never serve directly from cache. */
  ocr_result: Record<string, unknown>;
}>;


export function hasReusableRawOcrCachePayload(metadata: OcrCacheMetadata | null | undefined): boolean {
  return Boolean(metadata?.raw_ocr_result && metadata?.provider && metadata?.model);
}

export function isLegacyRawOcrCacheMetadata(metadata: OcrCacheMetadata | null | undefined): boolean {
  return Boolean(metadata && metadata.cache_kind !== RECEIPT_OCR_RAW_CACHE_KIND && hasReusableRawOcrCachePayload(metadata));
}

export function buildOcrCacheVersion(input: OcrCacheVersion): OcrCacheVersion {
  return input;
}

export function serializeOcrCacheVersion(version: OcrCacheVersion): string {
  return [
    version.cacheKind,
    version.provider,
    version.model,
    version.promptVersion,
    version.preprocessVersion,
    version.extractionSchemaVersion,
    version.routingMode,
  ].join('|');
}

export function doesOcrCacheMetadataMatch(
  metadata: OcrCacheMetadata | null | undefined,
  version: OcrCacheVersion,
): boolean {
  return Boolean(
    metadata?.cache_kind === version.cacheKind
      && metadata?.provider === version.provider
      && metadata?.model === version.model
      && metadata?.prompt_version === version.promptVersion
      && metadata?.preprocess_version === version.preprocessVersion
      && metadata?.extraction_schema_version === version.extractionSchemaVersion
      && metadata?.routing_mode === version.routingMode
      && hasReusableRawOcrCachePayload(metadata),
  );
}
