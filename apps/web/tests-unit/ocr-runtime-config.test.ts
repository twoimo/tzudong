import { describe, expect, test } from 'bun:test';
import {
  getEnvFallbackSecrets,
  resolveOcrAiRuntimeConfig,
} from '@/lib/ocr/runtime-config';

describe('ocr runtime config', () => {
  test('collects unique environment credentials in priority order', () => {
    const secrets = getEnvFallbackSecrets('gemini', {
      GEMINI_API_KEY: '  first-key  ',
      GOOGLE_API_KEY: 'first-key',
      NEXT_PUBLIC_GOOGLE_API_KEY: 'second-key',
      GEMINI_OCR_YEON: '   ',
    } as NodeJS.ProcessEnv);

    expect(secrets).toEqual([
      { apiKey: 'first-key', source: 'environment', sourceName: 'GEMINI_API_KEY' },
      { apiKey: 'second-key', source: 'environment', sourceName: 'NEXT_PUBLIC_GOOGLE_API_KEY' },
    ]);
  });

  test('returns no credentials for an empty environment', () => {
    expect(getEnvFallbackSecrets('gemini', {} as NodeJS.ProcessEnv)).toEqual([]);
  });

  test('falls back to a credential-free automatic configuration', async () => {
    const config = await resolveOcrAiRuntimeConfig({} as NodeJS.ProcessEnv);

    expect(config.routingMode).toBe('automatic');
    expect(config.provider).toBe('gemini');
    expect(config.apiKey).toBeNull();
    expect(config.source).toBe('none');
    expect(config.credentialCandidates).toEqual([]);
    expect(config.models.length).toBeGreaterThan(0);
    expect(config.model).toBe(config.models[0]);
    expect(config.fallbackCandidates).toEqual([]);
  });

  test('prefers the manual model ahead of the fallback chain', async () => {
    const config = await resolveOcrAiRuntimeConfig({
      OCR_ROUTING_MODE: 'manual',
      OCR_MANUAL_MODEL: ' manual-model ',
      GEMINI_OCR_MODEL: 'fallback-a,fallback-b',
      GEMINI_API_KEY: 'env-key',
    } as NodeJS.ProcessEnv);

    expect(config.routingMode).toBe('manual');
    expect(config.models[0]).toBe('manual-model');
    expect(config.models).toContain('fallback-a');
    expect(config.apiKey).toBe('env-key');
    expect(config.source).toBe('environment');
    expect(config.model).toBe('manual-model');
  });

  test('ignores a blank manual model and unknown routing modes', async () => {
    const blankManual = await resolveOcrAiRuntimeConfig({
      OCR_ROUTING_MODE: 'manual',
      OCR_MANUAL_MODEL: '   ',
    } as NodeJS.ProcessEnv);
    const unknownMode = await resolveOcrAiRuntimeConfig({
      OCR_ROUTING_MODE: 'MANUAL',
    } as NodeJS.ProcessEnv);
    const emptyMode = await resolveOcrAiRuntimeConfig({
      OCR_ROUTING_MODE: '',
      RECEIPT_OCR_ROUTING_MODE: 'manual',
    } as NodeJS.ProcessEnv);

    expect(blankManual.routingMode).toBe('manual');
    expect(blankManual.apiKey).toBeNull();
    expect(unknownMode.routingMode).toBe('automatic');
    expect(emptyMode.routingMode).toBe('automatic');
  });

  test('reads the legacy routing mode and model keys', async () => {
    const config = await resolveOcrAiRuntimeConfig({
      RECEIPT_OCR_ROUTING_MODE: 'manual',
      RECEIPT_OCR_MODEL: 'legacy-model',
    } as NodeJS.ProcessEnv);

    expect(config.routingMode).toBe('manual');
    expect(config.models[0]).toBe('legacy-model');
  });
});
