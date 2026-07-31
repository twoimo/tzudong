import type { OcrAiRuntimeConfigCandidate, OcrCredentialCandidate, OcrRoutingMode } from '@/lib/ocr/runtime-config';
import type { ReceiptOcrEnvelope } from '@/lib/ocr/receipt-normalization';
import type { OcrRestaurantLookupStats, RestaurantMatchRow, SelectedRestaurantContext } from '@/lib/ocr/restaurant-matching';
import { RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION } from '@/lib/ocr/cache-version';

export type OcrSuccessLogMetadata = {
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
  fallback_used: boolean;
  force_refresh: boolean;
  attempt_count: number;
  confidence: number;
  needs_review: ReceiptOcrEnvelope['needs_review'];
  restaurant_lookup: OcrRestaurantLookupStats;
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
  fallbackUsed: boolean;
  forceRefresh: boolean;
  envelope: ReceiptOcrEnvelope;
  restaurantLookupStats: OcrRestaurantLookupStats;
}): OcrSuccessLogMetadata {
  return {
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
    fallback_used: input.fallbackUsed,
    force_refresh: input.forceRefresh,
    attempt_count: input.envelope.raw.attempts.length,
    confidence: input.envelope.confidence,
    needs_review: input.envelope.needs_review,
    restaurant_lookup: input.restaurantLookupStats,
  };
}
