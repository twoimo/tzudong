export const YOUTUBE_THUMBNAIL_TARGET_WIDTH = 1280;
export const YOUTUBE_THUMBNAIL_TARGET_HEIGHT = 720;

export const THUMBNAIL_PROVIDER_IDS = [
  'openai-gpt-image',
  'gemini-nano-banana',
  'local-codex',
] as const;

export type ThumbnailProviderId = (typeof THUMBNAIL_PROVIDER_IDS)[number];

export const THUMBNAIL_GENERATION_MODES = [
  'direct_provider',
  'backend_agent',
] as const;

export type ThumbnailGenerationMode = (typeof THUMBNAIL_GENERATION_MODES)[number];

export const OPENAI_THUMBNAIL_IMAGE_MODELS = [
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1-mini',
  'gpt-image-1',
] as const;

export const GEMINI_THUMBNAIL_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
] as const;

export type OpenAIThumbnailImageModel = (typeof OPENAI_THUMBNAIL_IMAGE_MODELS)[number];
export type GeminiThumbnailImageModel = (typeof GEMINI_THUMBNAIL_IMAGE_MODELS)[number];

export const THUMBNAIL_BRIEF_PRESETS = [
  'tzuyang-food-travel-collage',
  'night-market-reaction',
  'convenience-store-haul',
  'grilled-meat-feast',
  'sushi-seafood-table',
] as const;

export type ThumbnailBriefPreset = (typeof THUMBNAIL_BRIEF_PRESETS)[number];

export const THUMBNAIL_REFERENCE_ROLES = [
  'host',
  'food',
  'object',
  'person',
  'other',
] as const;

export type ThumbnailReferenceRole = (typeof THUMBNAIL_REFERENCE_ROLES)[number];

export type ThumbnailTextLayer = {
  id: string;
  content: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadow: string;
  align: 'left' | 'center' | 'right';
  rotation: number;
  zIndex: number;
};

export type ThumbnailGeneratorPayload = {
  providerId: ThumbnailProviderId;
  generationMode: ThumbnailGenerationMode;
  topic: string;
  headline: string;
  subHeadline?: string;
  stylePreset?: ThumbnailBriefPreset;
  referenceImageRoles?: ThumbnailReferenceRole[];
  acknowledgedSafety: boolean;
  textLayers?: ThumbnailTextLayer[];
};

export type ThumbnailReferenceImage = {
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: Uint8Array;
  role: ThumbnailReferenceRole;
};

export type ThumbnailBaseImage = {
  dataUrl: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width?: number;
  height?: number;
  targetWidth: typeof YOUTUBE_THUMBNAIL_TARGET_WIDTH;
  targetHeight: typeof YOUTUBE_THUMBNAIL_TARGET_HEIGHT;
  providerId: ThumbnailProviderId;
  model: string;
  modelProvenance: 'exact' | 'requested-label' | 'unknown';
};

export type ThumbnailBackendAgentStatus = {
  available: boolean;
  mode: 'command' | 'local_adapter';
  rootPath: string;
  graphEntrypoint: string | null;
  commandConfigured: boolean;
  commandAvailable: boolean;
  commandPath?: string;
  commandRejectionReason?: string;
  localAdapterAvailable: boolean;
  missingPythonModules: string[];
  runtime: string;
  codexModel: string;
  codexEffort: string;
  streamingAvailable: boolean;
};

export type ThumbnailBackendAgentRun = {
  mode: 'command' | 'local_adapter';
  runtime: string;
  concept: string;
  layoutBrief: string;
  promptAddendum: string;
  safetyReview: string;
  nextActions: string[];
  diagnostics: Record<string, unknown>;
};

export type ThumbnailGenerationResult = {
  baseImage: ThumbnailBaseImage;
  prompt: string;
  warnings: string[];
  backendAgent?: ThumbnailBackendAgentRun;
};

export type ThumbnailChatCanvasPatch = {
  topic: string;
  headline: string;
  subHeadline: string;
};

export type ThumbnailChatTextLayerPatch = {
  id: string;
  content?: string;
  x?: number;
  y?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  shadow?: string;
  align?: ThumbnailTextLayer['align'];
  rotation?: number;
  zIndex?: number;
};

export type ThumbnailChatAgentRequest = {
  chatRunId?: string;
  message: string;
  currentTopic?: string;
  currentHeadline?: string;
  currentSubHeadline?: string;
  activeLayerId?: string;
  editingLayerId?: string;
  lastCanvasActionLabel?: string;
  currentTextLayers?: ThumbnailTextLayer[];
  providerId?: ThumbnailProviderId;
  generationMode?: ThumbnailGenerationMode;
};

export type ThumbnailChatAgentResult = {
  assistantMessage: string;
  canvasPatch: ThumbnailChatCanvasPatch;
  textLayerPatches?: ThumbnailChatTextLayerPatch[];
  providerId?: ThumbnailProviderId;
  generationMode?: ThumbnailGenerationMode;
  shouldGenerate: boolean;
  shouldReset: boolean;
  backendAgent: ThumbnailBackendAgentRun;
  diagnostics: {
    runtime: string;
    model: string;
    effort: string;
    streaming: 'sse-progress';
    chatRunId?: string;
  };
};

export type ThumbnailGenerationErrorCode =
  | 'required_ack'
  | 'invalid_text'
  | 'thumbnail_chat_payload_invalid'
  | 'thumbnail_chat_message_required'
  | 'thumbnail_chat_message_too_long'
  | 'thumbnail_chat_aborted'
  | 'thumbnail_generation_aborted'
  | 'unsafe_instruction'
  | 'unsafe_identity'
  | 'unsafe_brand'
  | 'unsafe_contact'
  | 'unsafe_price'
  | 'unsafe_copy'
  | 'unsafe_crowd'
  | 'unsupported_model'
  | 'invalid_generation_mode'
  | 'provider_unavailable';

export class ThumbnailGenerationError extends Error {
  constructor(
    public readonly code: ThumbnailGenerationErrorCode,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'ThumbnailGenerationError';
  }
}
