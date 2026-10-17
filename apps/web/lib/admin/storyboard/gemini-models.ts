/** Official Gemini API IDs verified against Google documentation on 2026-10-13. */
export const STORYBOARD_GEMINI_TEXT_MODEL = 'gemini-3.8-flash' as const;
export const STORYBOARD_GEMINI_IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2' },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro' },
] as const;
export const STORYBOARD_GEMINI_PROVIDER_ID = 'gemini-api' as const;
export const STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL = STORYBOARD_GEMINI_IMAGE_MODELS[0].id;

const STORYBOARD_GEMINI_DECLARED_MODEL_SPECS = [
  { id: STORYBOARD_GEMINI_TEXT_MODEL, capability: 'chat' },
  ...STORYBOARD_GEMINI_IMAGE_MODELS.map((model) => ({ id: model.id, capability: 'image' as const })),
] as const;

export type StoryboardGeminiWorkerModel = {
  id: string;
  /** Legacy catalog ownership remains decodable; the policy check admits only gemini-api. */
  owned_by?: 'gemini-api' | 'mlx-serve';
  capabilities: string[];
  loaded: boolean;
  bytes_on_disk: number;
  bytes_resident: number;
};

/** Fixed policy advertisement; it performs no provider I/O. */
export function storyboardGeminiDeclaredModels(): StoryboardGeminiWorkerModel[] {
  return STORYBOARD_GEMINI_DECLARED_MODEL_SPECS.map((model) => ({
    id: model.id,
    owned_by: STORYBOARD_GEMINI_PROVIDER_ID,
    capabilities: [model.capability],
    loaded: false,
    bytes_on_disk: 0,
    bytes_resident: 0,
  }));
}

/** Server and worker share the same exact outbound model descriptor policy. */
export function isAllowedStoryboardGeminiWorkerModel(model: StoryboardGeminiWorkerModel): boolean {
  const expected = STORYBOARD_GEMINI_DECLARED_MODEL_SPECS.find((entry) => entry.id === model.id);
  return Boolean(expected)
    && model.owned_by === STORYBOARD_GEMINI_PROVIDER_ID
    && model.capabilities.length === 1
    && model.capabilities[0] === expected?.capability
    && model.loaded === false
    && model.bytes_on_disk === 0
    && model.bytes_resident === 0;
}

export function isAllowedStoryboardGeminiModel(model: string, modality: 'text' | 'image') {
  return modality === 'text' ? model === STORYBOARD_GEMINI_TEXT_MODEL
    : STORYBOARD_GEMINI_IMAGE_MODELS.some((entry) => entry.id === model);
}
