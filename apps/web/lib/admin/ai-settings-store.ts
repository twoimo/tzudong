import crypto from 'crypto';
import { createSupabaseServiceRoleClient } from '@/lib/insight/supabase';
import { getLatestOcrLeaderboardCandidateModels } from '@/lib/admin/ai-leaderboard';
import { getGeminiOcrModels } from '@/lib/ocr/gemini';
import { getNvidiaNimOcrModels } from '@/lib/ocr/nvidia-nim';
import { getCurrentReceiptOcrProductionPromotionGate } from '@/lib/ocr/current-promotion-gate';
import type { ReceiptOcrPromotionGateResult } from '@/lib/ocr/promotion-gate';

export const ADMIN_AI_PROVIDERS = ['gemini', 'openai', 'nvidia_nim'] as const;
export const OCR_ROUTING_PROVIDERS = ['gemini', 'nvidia_nim'] as const;
export const OCR_ROUTING_MODES = ['automatic', 'manual'] as const;

export type AdminAiProvider = (typeof ADMIN_AI_PROVIDERS)[number];
export type OcrRoutingProvider = (typeof OCR_ROUTING_PROVIDERS)[number];
export type OcrRoutingMode = (typeof OCR_ROUTING_MODES)[number];

export type AdminAiCandidateModel = {
  id: string;
  provider: AdminAiProvider;
  model: string;
  label: string;
};

export type AdminAiProviderKeySummary = {
  provider: AdminAiProvider;
  hasStoredKey: boolean;
  hasEnvKey: boolean;
  source: 'database' | 'environment' | 'none';
  maskedSecret: string | null;
  updatedAt: string | null;
  updatedByAdminId: string | null;
};

export type AdminAiSettingsRecord = {
  routingMode: OcrRoutingMode;
  manualProvider: AdminAiProvider | null;
  manualModel: string | null;
  candidateModels: AdminAiCandidateModel[];
  updatedAt: string | null;
  updatedByAdminId: string | null;
  persisted: boolean;
};

export type AdminAiSettingsResponse = {
  settings: AdminAiSettingsRecord;
  providers: AdminAiProviderKeySummary[];
  promotionGate: ReceiptOcrPromotionGateResult;
  storage: {
    serviceRoleConfigured: boolean;
    databaseConfigured: boolean;
  };
};

export type OcrCredentialCandidate = {
  apiKey: string;
  source: 'database' | 'environment';
  sourceName?: string;
};

export type OcrAiRuntimeConfigCandidate = {
  provider: OcrRoutingProvider;
  model: string;
  models: string[];
  apiKey: string | null;
  source: 'database' | 'environment' | 'none';
  credentialCandidates: OcrCredentialCandidate[];
};

export type OcrAiRuntimeConfig = OcrAiRuntimeConfigCandidate & {
  routingMode: OcrRoutingMode;
  fallbackCandidates: OcrAiRuntimeConfigCandidate[];
};

type SettingsRow = {
  id: string;
  routing_mode: string;
  manual_provider: string | null;
  manual_model: string | null;
  candidate_models: unknown;
  updated_at: string | null;
  updated_by_admin_id: string | null;
};

type ProviderKeyRow = {
  provider: string;
  api_key: string;
  updated_at: string | null;
  updated_by_admin_id: string | null;
};

const ENV_PROVIDER_KEYS: Record<AdminAiProvider, readonly string[]> = {
  gemini: [
    'GEMINI_OCR_YEON',
    'STORYBOARD_AGENT_GEMINI_API_KEY',
    'GEMINI_API_KEY',
    'GEMINI_API_KEY_BYEON',
    'GOOGLE_API_KEY',
    'NEXT_PUBLIC_GOOGLE_API_KEY',
  ],
  openai: [
    'OPENAI_API_KEY',
    'STORYBOARD_AGENT_OPENAI_API_KEY',
    'NEXT_OPENAI_API_KEY_BYEON',
  ],
  nvidia_nim: ['NVIDIA_NIM_API_KEY'],
};

const PROVIDER_LABELS: Record<AdminAiProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  nvidia_nim: 'NVIDIA NIM',
};

const ENCRYPTED_SECRET_PREFIX = 'enc:v1';

function serviceRoleConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function normalizeProvider(value: unknown): AdminAiProvider | null {
  return typeof value === 'string' && (ADMIN_AI_PROVIDERS as readonly string[]).includes(value)
    ? (value as AdminAiProvider)
    : null;
}

function normalizeRoutingMode(value: unknown): OcrRoutingMode {
  return value === 'manual' ? 'manual' : 'automatic';
}

function normalizeOcrRoutingProvider(value: unknown): OcrRoutingProvider | null {
  return typeof value === 'string' && (OCR_ROUTING_PROVIDERS as readonly string[]).includes(value)
    ? (value as OcrRoutingProvider)
    : null;
}

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function maskSecret(secret: string | null | undefined): string | null {
  const normalized = secret?.trim();
  if (!normalized) return null;
  const suffix = normalized.slice(-4);
  return `••••••••${suffix}`;
}

function getSecretEncryptionMaterial(env: NodeJS.ProcessEnv = process.env): string | null {
  return sanitizeText(env.AI_SETTINGS_ENCRYPTION_KEY) ?? sanitizeText(env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSecretEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const material = getSecretEncryptionMaterial(env);
  return material ? crypto.createHash('sha256').update(material).digest() : null;
}

export function encryptStoredProviderSecret(secret: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = getSecretEncryptionKey(env);
  const normalized = sanitizeText(secret);
  if (!normalized || !key) return normalized ?? '';

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTED_SECRET_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptStoredProviderSecret(value: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const normalized = sanitizeText(value);
  if (!normalized) return null;
  if (!normalized.startsWith(`${ENCRYPTED_SECRET_PREFIX}:`)) return normalized;

  const key = getSecretEncryptionKey(env);
  if (!key) return null;

  const [, , ivPart, tagPart, ciphertextPart] = normalized.split(':');
  if (!ivPart || !tagPart || !ciphertextPart) return null;

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return sanitizeText(plaintext);
  } catch {
    return null;
  }
}

export function getProviderLabel(provider: AdminAiProvider): string {
  return PROVIDER_LABELS[provider];
}

export function getEnvFallbackSecrets(
  provider: AdminAiProvider,
  env: NodeJS.ProcessEnv = process.env,
): Array<{ apiKey: string; source: 'environment'; sourceName: string }> {
  const seen = new Set<string>();
  const secrets: Array<{ apiKey: string; source: 'environment'; sourceName: string }> = [];
  for (const envName of ENV_PROVIDER_KEYS[provider]) {
    const candidate = env[envName]?.trim();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    secrets.push({ apiKey: candidate, source: 'environment', sourceName: envName });
  }
  return secrets;
}

export function getEnvFallbackSecret(
  provider: AdminAiProvider,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return getEnvFallbackSecrets(provider, env)[0]?.apiKey ?? null;
}

function buildDefaultCandidateModels(env: NodeJS.ProcessEnv = process.env): AdminAiCandidateModel[] {
  const geminiModels = getGeminiOcrModels(env);
  const nimModels = getNvidiaNimOcrModels(env);
  const defaults: AdminAiCandidateModel[] = [
    ...geminiModels.map((model, index) => ({
      id: `gemini:${model}`,
      provider: 'gemini' as const,
      model,
      label: index === 0 ? 'Gemini 기본 OCR 모델' : `Gemini 후보 ${index + 1}`,
    })),
    ...nimModels.map((model, index) => ({
      id: `nvidia_nim:${model}`,
      provider: 'nvidia_nim' as const,
      model,
      label: index === 0 ? 'NVIDIA NIM 실험 OCR 모델' : `NVIDIA NIM 후보 ${index + 1}`,
    })),
  ];

  return sanitizeCandidateModels(defaults);
}

export function sanitizeCandidateModels(raw: unknown): AdminAiCandidateModel[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const models: AdminAiCandidateModel[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const candidate = item as Partial<AdminAiCandidateModel>;
    const provider = normalizeProvider(candidate.provider);
    const model = sanitizeText(candidate.model);
    const label = sanitizeText(candidate.label) ?? model;

    if (!provider || !model || !label) continue;

    const key = `${provider}:${model.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    models.push({
      id: sanitizeText(candidate.id) ?? key,
      provider,
      model,
      label,
    });
  }

  return models;
}

export function sanitizeSettingsInput(
  input: Partial<{
    routingMode: unknown;
    manualProvider: unknown;
    manualModel: unknown;
    candidateModels: unknown;
    productionPromotionApproved: unknown;
  }>,
  env: NodeJS.ProcessEnv = process.env,
): AdminAiSettingsRecord {
  const defaultCandidates = buildDefaultCandidateModels(env);
  const candidateModels = sanitizeCandidateModels(input.candidateModels)
    .filter((candidate) => normalizeOcrRoutingProvider(candidate.provider));
  const safeCandidates = candidateModels.length ? candidateModels : defaultCandidates;
  const requestedManualProvider = normalizeOcrRoutingProvider(input.manualProvider);
  const manualProvider = requestedManualProvider ?? safeCandidates[0]?.provider ?? 'gemini';
  const manualModel = requestedManualProvider
    ? sanitizeText(input.manualModel) ?? safeCandidates[0]?.model ?? null
    : safeCandidates[0]?.model ?? null;

  return {
    routingMode: normalizeRoutingMode(input.routingMode),
    manualProvider: manualProvider as AdminAiProvider,
    manualModel,
    candidateModels: safeCandidates,
    updatedAt: null,
    updatedByAdminId: null,
    persisted: false,
  };
}


function candidateModelsSignature(models: AdminAiCandidateModel[]): string {
  return models
    .map((model) => `${model.provider}:${model.model}`.toLowerCase())
    .sort()
    .join('|');
}

function isDefaultOcrRoutingSettings(next: AdminAiSettingsRecord, defaults: AdminAiSettingsRecord): boolean {
  return next.routingMode === defaults.routingMode
    && next.manualProvider === defaults.manualProvider
    && next.manualModel === defaults.manualModel
    && candidateModelsSignature(next.candidateModels) === candidateModelsSignature(defaults.candidateModels);
}

export function assertAdminAiSettingsPromotionAllowed(input: {
  next: AdminAiSettingsRecord;
  defaults: AdminAiSettingsRecord;
  acknowledged?: boolean;
}): void {
  if (isDefaultOcrRoutingSettings(input.next, input.defaults)) return;

  const gate = getCurrentReceiptOcrProductionPromotionGate();
  if (gate.ok && input.acknowledged) return;

  throw new Error([
    'OCR 모델 라우팅/프로덕션 기본값 변경은 평가 게이트 통과 후에만 저장할 수 있습니다.',
    ...gate.reasons,
  ].join(' '));
}

function buildProviderSummary(
  provider: AdminAiProvider,
  dbRow?: ProviderKeyRow,
  env: NodeJS.ProcessEnv = process.env,
): AdminAiProviderKeySummary {
  const storedSecret = decryptStoredProviderSecret(dbRow?.api_key, env);
  const envSecret = getEnvFallbackSecret(provider, env);
  const activeSecret = storedSecret ?? envSecret;

  return {
    provider,
    hasStoredKey: Boolean(storedSecret),
    hasEnvKey: Boolean(envSecret),
    source: storedSecret ? 'database' : envSecret ? 'environment' : 'none',
    maskedSecret: maskSecret(activeSecret),
    updatedAt: dbRow?.updated_at ?? null,
    updatedByAdminId: dbRow?.updated_by_admin_id ?? null,
  };
}

function isMissingRelationError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === '42P01',
  );
}

export async function getAdminAiSettings(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminAiSettingsResponse> {
  const defaults = sanitizeSettingsInput({}, env);
  const emptyProviders = ADMIN_AI_PROVIDERS.map((provider) => buildProviderSummary(provider, undefined, env));
  const promotionGate = getCurrentReceiptOcrProductionPromotionGate();

  if (!serviceRoleConfigured(env)) {
    return {
      settings: defaults,
      providers: emptyProviders,
      promotionGate,
      storage: {
        serviceRoleConfigured: false,
        databaseConfigured: false,
      },
    };
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const [{ data: settingsData, error: settingsError }, { data: keyData, error: keyError }] = await Promise.all([
      supabase
        .from('admin_ai_settings' as never)
        .select('id, routing_mode, manual_provider, manual_model, candidate_models, updated_at, updated_by_admin_id')
        .eq('id', 'ocr')
        .maybeSingle(),
      supabase
        .from('admin_ai_provider_keys' as never)
        .select('provider, api_key, updated_at, updated_by_admin_id')
        .order('provider', { ascending: true }),
    ]);

    if (settingsError && !isMissingRelationError(settingsError)) {
      throw settingsError;
    }
    if (keyError && !isMissingRelationError(keyError)) {
      throw keyError;
    }

    const row = (settingsData as SettingsRow | null) ?? null;
    const merged = sanitizeSettingsInput({
      routingMode: row?.routing_mode,
      manualProvider: row?.manual_provider,
      manualModel: row?.manual_model,
      candidateModels: row?.candidate_models,
    }, env);
    const keyRows = ((keyData as ProviderKeyRow[] | null) ?? []).reduce<Record<string, ProviderKeyRow>>((acc, item) => {
      acc[item.provider] = item;
      return acc;
    }, {});

    return {
      settings: {
        ...merged,
        updatedAt: row?.updated_at ?? null,
        updatedByAdminId: row?.updated_by_admin_id ?? null,
        persisted: Boolean(row),
      },
      providers: ADMIN_AI_PROVIDERS.map((provider) => buildProviderSummary(provider, keyRows[provider], env)),
      promotionGate,
      storage: {
        serviceRoleConfigured: true,
        databaseConfigured: !settingsError && !keyError,
      },
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        settings: defaults,
        providers: emptyProviders,
        promotionGate,
        storage: {
          serviceRoleConfigured: true,
          databaseConfigured: false,
        },
      };
    }

    throw error;
  }
}

export async function saveAdminAiSettings(
  input: Partial<{
    routingMode: unknown;
    manualProvider: unknown;
    manualModel: unknown;
    candidateModels: unknown;
    productionPromotionApproved: unknown;
  }>,
  adminUserId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminAiSettingsResponse> {
  if (!serviceRoleConfigured(env)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY가 없어 설정을 저장할 수 없습니다.');
  }

  const next = sanitizeSettingsInput(input, env);
  assertAdminAiSettingsPromotionAllowed({
    next,
    defaults: sanitizeSettingsInput({}, env),
    acknowledged: input.productionPromotionApproved === true,
  });
  const supabase = createSupabaseServiceRoleClient();
  const payload = {
    id: 'ocr',
    routing_mode: next.routingMode,
    manual_provider: next.manualProvider,
    manual_model: next.manualModel,
    candidate_models: next.candidateModels,
    updated_by_admin_id: adminUserId,
  };

  const { error } = await supabase.from('admin_ai_settings' as never).upsert(payload as never, {
    onConflict: 'id',
  });

  if (error) {
    throw new Error(`AI 설정 저장 실패: ${error.message}`);
  }

  return getAdminAiSettings(env);
}

export async function upsertProviderApiKey(
  provider: AdminAiProvider,
  secret: string,
  adminUserId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminAiProviderKeySummary> {
  if (!serviceRoleConfigured(env)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY가 없어 API 키를 저장할 수 없습니다.');
  }

  const normalizedSecret = sanitizeText(secret);
  if (!normalizedSecret) {
    throw new Error(`${getProviderLabel(provider)} API 키를 입력해주세요.`);
  }

  const supabase = createSupabaseServiceRoleClient();
  const encryptedSecret = encryptStoredProviderSecret(normalizedSecret, env);
  const { error } = await supabase.from('admin_ai_provider_keys' as never).upsert({
    provider,
    api_key: encryptedSecret,
    updated_by_admin_id: adminUserId,
  } as never, {
    onConflict: 'provider',
  });

  if (error) {
    throw new Error(`${getProviderLabel(provider)} API 키 저장 실패: ${error.message}`);
  }

  const payload = await getAdminAiSettings(env);
  return payload.providers.find((entry) => entry.provider === provider) ?? buildProviderSummary(provider, undefined, env);
}

export async function deleteProviderApiKey(
  provider: AdminAiProvider,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminAiProviderKeySummary> {
  if (!serviceRoleConfigured(env)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY가 없어 API 키를 삭제할 수 없습니다.');
  }

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.from('admin_ai_provider_keys' as never).delete().eq('provider', provider);

  if (error) {
    throw new Error(`${getProviderLabel(provider)} API 키 삭제 실패: ${error.message}`);
  }

  const payload = await getAdminAiSettings(env);
  return payload.providers.find((entry) => entry.provider === provider) ?? buildProviderSummary(provider, undefined, env);
}

export function parseProviderParam(value: string): AdminAiProvider | null {
  return normalizeProvider(value);
}

function getOcrFallbackModels(provider: OcrRoutingProvider, env: NodeJS.ProcessEnv): string[] {
  return provider === 'gemini'
    ? getGeminiOcrModels(env)
    : getNvidiaNimOcrModels(env);
}

function getOcrProviderOrder(settings: AdminAiSettingsRecord): OcrRoutingProvider[] {
  if (settings.routingMode === 'manual') {
    return [normalizeOcrRoutingProvider(settings.manualProvider) ?? 'gemini'];
  }
  return ['gemini', 'nvidia_nim'];
}

async function resolveOcrProviderCandidate(input: {
  provider: OcrRoutingProvider;
  settings: AdminAiSettingsRecord;
  env: NodeJS.ProcessEnv;
}): Promise<OcrAiRuntimeConfigCandidate> {
  const { provider, settings, env } = input;
  const leaderboardCandidateModels = settings.routingMode === 'automatic'
    ? (await getLatestOcrLeaderboardCandidateModels(env))
      .filter((candidate) => candidate.provider === provider)
      .map((candidate) => candidate.model)
    : [];
  const configuredCandidateModels = settings.candidateModels
    .filter((candidate) => candidate.provider === provider)
    .map((candidate) => candidate.model);
  const fallbackModels = getOcrFallbackModels(provider, env);
  const manualModel = settings.routingMode === 'manual' && settings.manualProvider === provider && settings.manualModel
    ? [settings.manualModel]
    : [];
  const models = [...new Set([...manualModel, ...leaderboardCandidateModels, ...configuredCandidateModels, ...fallbackModels])].filter(Boolean);

  let dbSecret: string | null = null;
  if (serviceRoleConfigured(env)) {
    try {
      const supabase = createSupabaseServiceRoleClient();
      const { data, error } = await supabase
        .from('admin_ai_provider_keys' as never)
        .select('api_key')
        .eq('provider', provider)
        .maybeSingle();
      if (!error) {
        dbSecret = decryptStoredProviderSecret((data as { api_key?: string } | null)?.api_key, env);
      } else if (!isMissingRelationError(error)) {
        throw error;
      }
    } catch (error) {
      if (!isMissingRelationError(error)) throw error;
    }
  }

  const envSecrets = getEnvFallbackSecrets(provider, env);
  const credentialCandidates = [
    ...(dbSecret ? [{ apiKey: dbSecret, source: 'database' as const, sourceName: 'admin_ai_provider_keys' }] : []),
    ...envSecrets,
  ];
  const primaryCredential = credentialCandidates[0];
  return {
    provider,
    model: models[0] ?? '',
    models,
    apiKey: primaryCredential?.apiKey ?? null,
    source: primaryCredential?.source ?? 'none',
    credentialCandidates,
  };
}

export async function resolveOcrAiRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OcrAiRuntimeConfig> {
  const payload = await getAdminAiSettings(env);
  const settings = payload.settings;
  const providerOrder = getOcrProviderOrder(settings);
  const candidates = await Promise.all(providerOrder.map(provider => resolveOcrProviderCandidate({ provider, settings, env })));
  const primary = candidates[0] ?? await resolveOcrProviderCandidate({ provider: 'gemini', settings, env });

  return {
    routingMode: settings.routingMode,
    ...primary,
    fallbackCandidates: candidates.slice(1),
  };
}
