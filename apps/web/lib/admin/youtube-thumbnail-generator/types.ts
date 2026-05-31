export const YOUTUBE_THUMBNAIL_TARGET_WIDTH = 1280;
export const YOUTUBE_THUMBNAIL_TARGET_HEIGHT = 720;

export const THUMBNAIL_PROVIDER_IDS = [
  'mock',
  'openai-gpt-image',
  'gemini-nano-banana',
  'local-codex',
] as const;

export type ThumbnailProviderId = (typeof THUMBNAIL_PROVIDER_IDS)[number];

export const OPENAI_THUMBNAIL_IMAGE_MODELS = [
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
  topic: string;
  headline: string;
  subHeadline?: string;
  stylePreset?: 'tzuyang-food-travel-collage';
  acknowledgedSafety: boolean;
  textLayers?: ThumbnailTextLayer[];
};

export type ThumbnailReferenceImage = {
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: Uint8Array;
  role: 'host' | 'food' | 'object' | 'person' | 'other';
};

export type ThumbnailBaseImage = {
  dataUrl: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  width?: number;
  height?: number;
  targetWidth: typeof YOUTUBE_THUMBNAIL_TARGET_WIDTH;
  targetHeight: typeof YOUTUBE_THUMBNAIL_TARGET_HEIGHT;
  providerId: ThumbnailProviderId;
  model: string;
};

export type ThumbnailGenerationResult = {
  baseImage: ThumbnailBaseImage;
  prompt: string;
  warnings: string[];
};

export type ThumbnailGenerationErrorCode =
  | 'required_ack'
  | 'invalid_text'
  | 'unsafe_identity'
  | 'unsafe_brand'
  | 'unsafe_contact'
  | 'unsafe_price'
  | 'unsafe_copy'
  | 'unsafe_crowd'
  | 'unsupported_model'
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
