/** Official Gemini API IDs verified against Google documentation on 2026-10-03. */
export const STORYBOARD_GEMINI_TEXT_MODEL = 'gemini-3.8-flash' as const;
export const STORYBOARD_GEMINI_IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2' },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro' },
] as const;
export const STORYBOARD_GEMINI_PROVIDER_ID = 'gemini-api' as const;
export const STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL = STORYBOARD_GEMINI_IMAGE_MODELS[0].id;

export function isAllowedStoryboardGeminiModel(model: string, modality: 'text' | 'image') {
  return modality === 'text' ? model === STORYBOARD_GEMINI_TEXT_MODEL
    : STORYBOARD_GEMINI_IMAGE_MODELS.some((entry) => entry.id === model);
}
