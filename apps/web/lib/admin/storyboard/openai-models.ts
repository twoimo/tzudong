/** OpenAI model IDs chosen from current official docs, observed 2026-11-13.
 * Text: https://developers.openai.com/api/docs/models/gpt-5.6-luna
 * Structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
 * Image: https://developers.openai.com/api/docs/models/gpt-image-2.6-flare
 * Image pricing calculator: https://developers.openai.com/api/docs/guides/image-generation#calculating-costs
 * The worker additionally confirms exact model availability with GET /v1/models; docs alone are not account readiness. */
export const STORYBOARD_OPENAI_TEXT_MODEL = 'gpt-5.6-luna' as const;
export const STORYBOARD_OPENAI_IMAGE_MODEL = 'gpt-image-2.6-flare' as const;
export const STORYBOARD_OPENAI_PROVIDER_ID = 'openai-api' as const;
export const STORYBOARD_OPENAI_MODEL_SPECS = [
  { id: STORYBOARD_OPENAI_TEXT_MODEL, capability: 'chat' },
  { id: STORYBOARD_OPENAI_IMAGE_MODEL, capability: 'image' },
] as const;
export type StoryboardOpenAIWorkerModel = {
  id: string; owned_by: 'openai-api'; capabilities: string[]; loaded: false; bytes_on_disk: 0; bytes_resident: 0;
};
export function storyboardOpenAIDeclaredModels(): StoryboardOpenAIWorkerModel[] {
  return STORYBOARD_OPENAI_MODEL_SPECS.map((model) => ({ id: model.id, owned_by: STORYBOARD_OPENAI_PROVIDER_ID,
    capabilities: [model.capability], loaded: false, bytes_on_disk: 0, bytes_resident: 0 }));
}
export function isAllowedStoryboardOpenAIModel(model: string, modality: 'text' | 'image'): boolean {
  return modality === 'text' ? model === STORYBOARD_OPENAI_TEXT_MODEL : model === STORYBOARD_OPENAI_IMAGE_MODEL;
}
export function isAllowedStoryboardOpenAIWorkerModel(model: { id: string; owned_by?: string; capabilities: string[]; loaded: boolean; bytes_on_disk: number; bytes_resident: number }): boolean {
  const expected = STORYBOARD_OPENAI_MODEL_SPECS.find((entry) => entry.id === model.id);
  return !!expected && model.owned_by === STORYBOARD_OPENAI_PROVIDER_ID && model.capabilities.length === 1
    && model.capabilities[0] === expected.capability && model.loaded === false
    && model.bytes_on_disk === 0 && model.bytes_resident === 0;
}
