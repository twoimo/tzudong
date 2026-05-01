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

const PROVIDER_LABELS: Record<AdminAiProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  nvidia_nim: 'NVIDIA NIM',
};

export function getProviderLabel(provider: AdminAiProvider): string {
  return PROVIDER_LABELS[provider];
}
