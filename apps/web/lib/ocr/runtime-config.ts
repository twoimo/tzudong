import { getGeminiOcrModels } from '@/lib/ocr/gemini';

export const OCR_ROUTING_PROVIDERS = ['gemini'] as const;
export const OCR_ROUTING_MODES = ['automatic', 'manual'] as const;

export type OcrRoutingProvider = (typeof OCR_ROUTING_PROVIDERS)[number];
export type OcrRoutingMode = (typeof OCR_ROUTING_MODES)[number];

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

const ENV_PROVIDER_KEYS: Record<OcrRoutingProvider, readonly string[]> = {
  gemini: [
    'GEMINI_API_KEY',
    'GEMINI_OCR_YEON',
    'STORYBOARD_AGENT_GEMINI_API_KEY',
    'GEMINI_API_KEY_BYEON',
    'GOOGLE_API_KEY',
    'NEXT_PUBLIC_GOOGLE_API_KEY',
  ],
};

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeRoutingMode(value: unknown): OcrRoutingMode {
  return value === 'manual' ? 'manual' : 'automatic';
}

function getEnvRoutingMode(env: NodeJS.ProcessEnv): OcrRoutingMode {
  return normalizeRoutingMode(env.OCR_ROUTING_MODE ?? env.RECEIPT_OCR_ROUTING_MODE);
}

function getOcrProviderOrder(_env: NodeJS.ProcessEnv, _routingMode: OcrRoutingMode): OcrRoutingProvider[] {
  return ['gemini'];
}

function getOcrFallbackModels(_provider: OcrRoutingProvider, env: NodeJS.ProcessEnv): string[] {
  return getGeminiOcrModels(env);
}

function getManualModel(env: NodeJS.ProcessEnv, routingMode: OcrRoutingMode): string[] {
  if (routingMode !== 'manual') return [];
  const manualModel = sanitizeText(env.OCR_MANUAL_MODEL ?? env.RECEIPT_OCR_MODEL);
  return manualModel ? [manualModel] : [];
}

export function getEnvFallbackSecrets(
  provider: OcrRoutingProvider,
  env: NodeJS.ProcessEnv = process.env,
): Array<{ apiKey: string; source: 'environment'; sourceName: string }> {
  const seen = new Set<string>();
  const secrets: Array<{ apiKey: string; source: 'environment'; sourceName: string }> = [];
  for (const envName of ENV_PROVIDER_KEYS[provider]) {
    const apiKey = sanitizeText(env[envName]);
    if (!apiKey || seen.has(apiKey)) continue;
    seen.add(apiKey);
    secrets.push({ apiKey, source: 'environment', sourceName: envName });
  }
  return secrets;
}

async function resolveOcrProviderCandidate(input: {
  provider: OcrRoutingProvider;
  routingMode: OcrRoutingMode;
  env: NodeJS.ProcessEnv;
}): Promise<OcrAiRuntimeConfigCandidate> {
  const { provider, routingMode, env } = input;
  const models = [...new Set([...getManualModel(env, routingMode), ...getOcrFallbackModels(provider, env)])].filter(Boolean);
  const credentialCandidates = getEnvFallbackSecrets(provider, env);
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
  const routingMode = getEnvRoutingMode(env);
  const providerOrder = getOcrProviderOrder(env, routingMode);
  const candidates = await Promise.all(providerOrder.map(provider => resolveOcrProviderCandidate({ provider, routingMode, env })));
  const primary = candidates[0] ?? await resolveOcrProviderCandidate({ provider: 'gemini', routingMode, env });

  return {
    routingMode,
    ...primary,
    fallbackCandidates: candidates.slice(1),
  };
}
