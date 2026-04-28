import type { OcrAiRuntimeConfigCandidate, OcrCredentialCandidate, OcrRoutingMode, OcrRoutingProvider } from '@/lib/admin/ai-settings-store';
import {
  buildReceiptOcrEnvelope,
  flattenReceiptOcrEnvelope,
  type ReceiptOcrEnvelope,
} from '@/lib/ocr/receipt-normalization';
import { findOcrRestaurantMatches, type OcrRestaurantLookupStats, type RestaurantMatchRow, type SelectedRestaurantContext } from '@/lib/ocr/restaurant-matching';
import {
  isLegacyRawOcrCacheMetadata,
  RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
  RECEIPT_OCR_RAW_CACHE_KIND,
  type OcrCacheMetadata,
} from '@/lib/ocr/cache-version';
import type { NvidiaNimReceiptOcrAttempt, NvidiaNimReceiptOcrData } from '@/lib/ocr/nvidia-nim';

export type OcrSuccessLogMetadata = {
  cache_kind: typeof RECEIPT_OCR_RAW_CACHE_KIND;
  file_size: number;
  compressed_size: number;
  savings: string;
  store_found: boolean;
  provider: string;
  model: string;
  prompt_version: string;
  preprocess_version: string;
  extraction_schema_version: typeof RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION;
  routing_mode: OcrRoutingMode;
  normalization_version: string;
  credential_source: string;
  fallback_used: boolean;
  force_refresh: boolean;
  model_attempts: ReceiptOcrEnvelope['raw']['attempts'];
  raw_ocr_result: ReceiptOcrEnvelope['raw']['fields'];
  normalized_ocr_result: ReceiptOcrEnvelope['normalized'];
  field_trust: ReceiptOcrEnvelope['field_trust'];
  restaurant_lookup: OcrRestaurantLookupStats;
  ocr_result: unknown;
};

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function parseSelectedRestaurantContext(formData: FormData): SelectedRestaurantContext | null {
  const id = getFormString(formData, 'selectedRestaurantId');
  const name = getFormString(formData, 'selectedRestaurantName');
  const roadAddress = getFormString(formData, 'selectedRestaurantRoadAddress');
  const jibunAddress = getFormString(formData, 'selectedRestaurantJibunAddress');
  const category = getFormString(formData, 'selectedRestaurantCategory');
  if (!id && !name && !roadAddress && !jibunAddress && !category) return null;
  return {
    id: id || null,
    name: name || null,
    road_address: roadAddress || null,
    jibun_address: jibunAddress || null,
    category: category || null,
  };
}

export function getRunnableCredentials(input: {
  candidate: OcrAiRuntimeConfigCandidate;
  routingMode: OcrRoutingMode;
}): OcrCredentialCandidate[] {
  const credentials = input.candidate.credentialCandidates?.length
    ? input.candidate.credentialCandidates
    : input.candidate.apiKey
      ? [{ apiKey: input.candidate.apiKey, source: (input.candidate.source === 'database' ? 'database' : 'environment') as 'database' | 'environment' }]
      : [];

  return input.routingMode === 'manual' ? credentials.slice(0, 1) : credentials;
}

export function hasRunnableOcrCredentials(candidates: OcrAiRuntimeConfigCandidate[]): boolean {
  return candidates.some((candidate) => candidate.apiKey || candidate.credentialCandidates?.length);
}

export function mapRestaurantRow(row: unknown): RestaurantMatchRow | null {
  if (!row || typeof row !== 'object') return null;
  const candidate = row as Partial<RestaurantMatchRow>;
  if (!candidate.id || !candidate.name) return null;
  return {
    id: String(candidate.id),
    name: String(candidate.name),
    road_address: candidate.road_address ?? null,
    jibun_address: candidate.jibun_address ?? null,
  };
}

export function createRestaurantLookupCallbacks(client: { from: (table: string) => any }) {
  return {
    lookupBySelectedId: async (id: string): Promise<RestaurantMatchRow | null> => {
      const { data } = await client
        .from('restaurants')
        .select('id, name:approved_name, road_address, jibun_address')
        .eq('id', id)
        .maybeSingle();
      return mapRestaurantRow(data);
    },
    lookupExactName: async (name: string): Promise<RestaurantMatchRow[]> => {
      const { data } = await client
        .from('restaurants')
        .select('id, name:approved_name, road_address, jibun_address')
        .eq('approved_name', name)
        .limit(3);
      return ((data ?? []) as unknown[]).map(mapRestaurantRow).filter((row): row is RestaurantMatchRow => Boolean(row));
    },
    lookupFuzzyToken: async (token: string): Promise<RestaurantMatchRow[]> => {
      const { data } = await client
        .from('restaurants')
        .select('id, name:approved_name, road_address, jibun_address')
        .ilike('approved_name', `%${token}%`)
        .limit(5);
      return ((data ?? []) as unknown[]).map(mapRestaurantRow).filter((row): row is RestaurantMatchRow => Boolean(row));
    },
  };
}

export function buildOcrSuccessLogMetadata(input: {
  fileSize: number;
  compressedSize: number;
  savings: string;
  provider: string;
  model: string;
  promptVersion: string;
  preprocessVersion: string;
  routingMode: OcrRoutingMode;
  normalizationVersion: string;
  extractionSchemaVersion?: typeof RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION;
  credentialSource: string;
  fallbackUsed: boolean;
  forceRefresh: boolean;
  envelope: ReceiptOcrEnvelope;
  ocrResult: unknown;
  restaurantLookupStats: OcrRestaurantLookupStats;
}): OcrSuccessLogMetadata {
  return {
    cache_kind: RECEIPT_OCR_RAW_CACHE_KIND,
    file_size: input.fileSize,
    compressed_size: input.compressedSize,
    savings: input.savings,
    store_found: Boolean(input.envelope.normalized.store_name),
    provider: input.provider,
    model: input.model,
    prompt_version: input.promptVersion,
    preprocess_version: input.preprocessVersion,
    extraction_schema_version: input.extractionSchemaVersion ?? RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
    routing_mode: input.routingMode,
    normalization_version: input.normalizationVersion,
    credential_source: input.credentialSource,
    fallback_used: input.fallbackUsed,
    force_refresh: input.forceRefresh,
    model_attempts: input.envelope.raw.attempts,
    raw_ocr_result: input.envelope.raw.fields,
    normalized_ocr_result: input.envelope.normalized,
    field_trust: input.envelope.field_trust,
    restaurant_lookup: input.restaurantLookupStats,
    ocr_result: input.ocrResult,
  };
}


function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isReceiptOcrData(value: unknown): value is NvidiaNimReceiptOcrData {
  return isObject(value);
}

function isReceiptOcrAttempts(value: unknown): value is NvidiaNimReceiptOcrAttempt[] {
  return Array.isArray(value);
}

function isOcrRoutingProvider(value: unknown): value is OcrRoutingProvider {
  return value === 'gemini' || value === 'nvidia_nim';
}

export async function buildOcrResponseFromRawCache(input: {
  metadata: OcrCacheMetadata | null | undefined;
  selectedRestaurantContext?: SelectedRestaurantContext | null;
  lookupCallbacks?: ReturnType<typeof createRestaurantLookupCallbacks>;
}): Promise<{
  responsePayload: NvidiaNimReceiptOcrData & ReceiptOcrEnvelope;
  envelope: ReceiptOcrEnvelope;
  restaurantLookupStats: OcrRestaurantLookupStats;
} | null> {
  const metadata = input.metadata;
  if (!metadata) return null;
  const isRawV1 = metadata.cache_kind === RECEIPT_OCR_RAW_CACHE_KIND;
  const isLegacyWithRaw = isLegacyRawOcrCacheMetadata(metadata);
  if (!isRawV1 && !isLegacyWithRaw) return null;
  if (!isOcrRoutingProvider(metadata.provider) || typeof metadata.model !== 'string') return null;
  if (!isReceiptOcrData(metadata.raw_ocr_result)) return null;

  const restaurantMatches = await findOcrRestaurantMatches({
    receiptStoreName: typeof metadata.raw_ocr_result.store_name === 'string'
      ? metadata.raw_ocr_result.store_name
      : undefined,
    selectedRestaurant: input.selectedRestaurantContext,
    ...input.lookupCallbacks,
  });
  const envelope = buildReceiptOcrEnvelope({
    provider: metadata.provider,
    model: metadata.model,
    attempts: isReceiptOcrAttempts(metadata.model_attempts) ? metadata.model_attempts : [],
    data: metadata.raw_ocr_result,
    matchedRestaurantCandidates: restaurantMatches.candidates,
  });
  return {
    responsePayload: flattenReceiptOcrEnvelope(envelope),
    envelope,
    restaurantLookupStats: restaurantMatches.stats,
  };
}
