import { describe, expect, test } from 'bun:test';
import {
  STORYBOARD_ARCHIVE_WORKFLOW, STORYBOARD_WORKFLOW,
  storyboardProductionRequestSchema, storyboardStoredProductionRequestSchema,
} from '../lib/admin/storyboard/production-contract';
import { storyboardModelsFor, storyboardWorkerSupportsPair } from '../lib/admin/storyboard/production-model-catalog';

const base = { requestId: crypto.randomUUID(), prompt: 'provider boundary', sceneCount: 5 };

describe('storyboard executable and archived provider allowlists', () => {
  test('keeps historical provider identifiers decode-only under the archived workflow', () => {
    for (const id of ['local-mlx', 'chatgpt-manual', 'grok-manual', 'manual', 'openai-api', 'xai-api'] as const) {
      const value = { ...base, workflow: STORYBOARD_ARCHIVE_WORKFLOW,
        providers: { externalAI: true, text: { id, model: 'historical-text' }, image: { id, model: 'historical-image' } } };
      expect(storyboardStoredProductionRequestSchema.safeParse(value).success).toBe(true);
      expect(storyboardProductionRequestSchema.safeParse(value).success).toBe(false);
    }
  });
  test('admits only the fixed Gemini provider for executable requests', () => {
    const value = { ...base, workflow: STORYBOARD_WORKFLOW, providers: { externalAI: true,
      text: { id: 'gemini-api', model: 'gemini-3.8-flash' },
      image: { id: 'gemini-api', model: 'gemini-3.1-flash-image' } } };
    expect(storyboardProductionRequestSchema.safeParse(value).success).toBe(true);
    expect(storyboardProductionRequestSchema.safeParse({ ...value, providers: { ...value.providers,
      image: { id: 'openai-api', model: 'other' } } }).success).toBe(false);
  });
  test('requires the selected text and image models on the same fresh exact worker', () => {
    const text = { id: 'gemini-3.8-flash', owned_by: 'gemini-api' as const, capabilities: ['chat'],
      loaded: false, bytes_on_disk: 0, bytes_resident: 0 };
    const image = { id: 'gemini-3.1-flash-image', owned_by: 'gemini-api' as const, capabilities: ['image'],
      loaded: false, bytes_on_disk: 0, bytes_resident: 0 };
    const split = [{ online: true, models: [text] }, { online: true, models: [image] }];
    expect(storyboardModelsFor(split, 'chat').map((model) => model.id)).toEqual([text.id]);
    expect(storyboardModelsFor(split, 'image').map((model) => model.id)).toEqual([image.id]);
    expect(storyboardWorkerSupportsPair(split, text.id, image.id)).toBe(false);
    expect(storyboardWorkerSupportsPair([{ online: true, models: [text, image] }], text.id, image.id)).toBe(true);
    expect(storyboardWorkerSupportsPair([{ online: false, models: [text, image] }], text.id, image.id)).toBe(false);
    expect(storyboardWorkerSupportsPair([{ online: true, models: [{ ...text, loaded: true }, image] }], text.id, image.id)).toBe(false);
  });
});
