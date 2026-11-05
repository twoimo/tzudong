import { z } from 'zod';
import { hasExplicitThumbnailGenerationCommand, isThumbnailChatGuidanceQuestion } from './chat-intent';

export const THUMBNAIL_CHAT_MODEL = 'gemini-3.8-flash' as const;
export const THUMBNAIL_CHAT_CONTEXT_BYTES = 65_536;
export const THUMBNAIL_CHAT_RESPONSE_BYTES = 48_000;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
// Match the shared privacy sink's hard UTF-16 length bound before any queued/paid work.
const text = (maxBytes: number) => z.string().max(Math.min(maxBytes, 4096)).refine((value) =>
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)
  && new TextEncoder().encode(value).length <= maxBytes);
const uuid = z.uuid().transform((value) => value.toLowerCase());
const layerId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const correlationId = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const color = z.string().regex(/^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/i);
const layerFields = {
  content: text(320).refine((value) => value.length <= 80),
  x: z.number().min(-1280).max(2560), y: z.number().min(-720).max(1440),
  fontFamily: z.string().min(1).max(160).regex(/^[A-Za-z0-9 ,"'_-]+$/),
  fontSize: z.number().min(1).max(400), fontWeight: z.number().min(100).max(1000),
  fill: color, stroke: color, strokeWidth: z.number().min(0).max(40),
  shadow: z.string().max(120).regex(/^(?:none|[0-9pxrgba(),. %\-]+)$/i),
  align: z.enum(['left', 'center', 'right']), rotation: z.number().min(-360).max(360),
  zIndex: z.number().int().min(-1000).max(1000),
};
const layer = z.object({ id: layerId, ...layerFields }).strict();
const patch = z.object(layerFields).partial().extend({ id: layerId }).strict()
  .refine((value) => Object.keys(value).length > 1);
const uniqueIds = (values: Array<{ id: string }>) => new Set(values.map((value) => value.id)).size === values.length;
const role = z.enum(['host', 'food', 'object', 'person', 'other']);
const deniedAction = /(?:생성|제작|실행|초기화|리셋)(?:해(?:줘|주세요|줘요)?(?:라는|라고)?(?:\s*말(?:은|을)?)?)?\s*(?:하지\s*(?:마|말|않)|금지)|(?:만들|그리)지\s*(?:마|말|않)|(?:do\s+not|don't|never)\s+(?:generate|create|render|reset)/i;
const canvas = z.object({ topic: text(1600).refine((value) => value.length <= 400),
  headline: text(320).refine((value) => value.length <= 80),
  subHeadline: text(480).refine((value) => value.length <= 120) }).strict();

/** No owner, provider selector, URL, key or execution permission is accepted from chat content. */
export const thumbnailChatContext = z.object({
  message: text(4000).refine((value) => Boolean(value.trim())),
  chatRunId: correlationId.optional(), chatThreadId: correlationId.optional(),
  currentTopic: canvas.shape.topic.default(''), currentHeadline: canvas.shape.headline.default(''),
  currentSubHeadline: canvas.shape.subHeadline.default(''),
  activeLayerId: layerId.nullish(), editingLayerId: layerId.nullish(),
  lastCanvasActionLabel: text(320).nullish(),
  currentTextLayers: z.array(layer).max(64).refine(uniqueIds).default([]),
  conversationMessages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: text(8000),
    id: correlationId.optional(), createdAt: z.iso.datetime({ offset: true }).optional() }).strict()).max(32).default([]),
  focusContext: z.object({ kind: z.enum(['text-layer', 'canvas']), label: text(320), promptContext: text(1040),
    layerId: layerId.optional(), role: z.enum(['headline', 'subHeadline', 'custom']).optional(),
    detail: text(720).optional(), createdAt: z.iso.datetime({ offset: true }).optional() }).strict().nullish(),
  referenceImageAttachments: z.array(z.object({ id: correlationId.optional(), name: text(480),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
    size: z.number().int().min(0).max(12 * 1024 * 1024).optional(), role: role.optional(),
    width: z.number().int().min(1).max(16_000_000).optional(),
    height: z.number().int().min(1).max(16_000_000).optional() }).strict()
    .refine((value) => !value.width || !value.height || value.width * value.height <= 16_000_000)).max(8).default([]),
}).strict().refine((value) => bytes(value) <= THUMBNAIL_CHAT_CONTEXT_BYTES);
export type ThumbnailChatContext = z.infer<typeof thumbnailChatContext>;

export const thumbnailChatResponse = z.object({
  assistantMessage: text(24_000).refine((value) => Boolean(value.trim())),
  intent: z.enum(['safety', 'casual_chat', 'conversation', 'review', 'edit', 'generate', 'reset']),
  canvasPatch: canvas, textLayerPatches: z.array(patch).max(64).refine(uniqueIds),
  shouldGenerate: z.boolean(), shouldReset: z.boolean(),
}).strict().refine((value) => value.shouldGenerate === (value.intent === 'generate')
  && value.shouldReset === (value.intent === 'reset') && bytes(value) <= THUMBNAIL_CHAT_RESPONSE_BYTES);
export type ThumbnailChatResponse = z.infer<typeof thumbnailChatResponse>;

/** Contextual validation is required as well as the context-free response schema. */
export function validateThumbnailChatResponse(value: unknown, rawContext: unknown): ThumbnailChatResponse {
  const context = thumbnailChatContext.parse(rawContext), result = thumbnailChatResponse.parse(value);
  const ids = new Set(context.currentTextLayers.map((entry) => entry.id));
  if (result.textLayerPatches.some((entry) => !ids.has(entry.id))) throw new Error('invalid_chat_response');
  if (result.shouldGenerate && (!hasExplicitThumbnailGenerationCommand(context.message) || deniedAction.test(context.message))) {
    throw new Error('invalid_chat_response');
  }
  if (result.shouldReset && (isThumbnailChatGuidanceQuestion(context.message)
    || deniedAction.test(context.message) || !/(?:초기화|리셋|reset)/i.test(context.message))) throw new Error('invalid_chat_response');
  if (['safety', 'casual_chat', 'conversation', 'review'].includes(result.intent)
    && (result.textLayerPatches.length || result.canvasPatch.topic !== context.currentTopic
      || result.canvasPatch.headline !== context.currentHeadline || result.canvasPatch.subHeadline !== context.currentSubHeadline)) {
    throw new Error('invalid_chat_response');
  }
  // No image pixels enter this text client. Reject explicit claims of having inspected them.
  if (/(?:첨부(?:된)?\s*(?:이미지|사진)(?:를|을)?\s*(?:보니|봤|보았|확인했|살펴봤))|(?:I\s+(?:can\s+see|have\s+seen|looked\s+at|viewed)\s+(?:the\s+)?(?:attached\s+)?(?:image|photo))/i.test(result.assistantMessage)) {
    throw new Error('invalid_chat_response');
  }
  return result;
}

export const thumbnailChatProvenance = z.object({
  providerId: z.literal('gemini-api'), model: z.literal(THUMBNAIL_CHAT_MODEL),
  responseModel: z.string().max(100).regex(/^gemini-3\.8-flash(?:-(?:[0-9]{3}|[0-9]{2}-[0-9]{2}))?$/),
  responseId: z.string().min(1).max(256).nullable(), verification: z.literal('official-api'),
  modelEvidence: z.literal('response'), generatedAt: z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/),
  attemptId: uuid, inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ThumbnailChatProvenance = z.infer<typeof thumbnailChatProvenance>;
export const thumbnailChatStartReceipt = z.object({
  ownerId: uuid, jobId: uuid, attemptId: uuid, fence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  providerId: z.literal('gemini-api'), model: z.literal(THUMBNAIL_CHAT_MODEL),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/), state: z.literal('provider_started'), permission: z.literal('fresh-commit'),
}).strict();
export type ThumbnailChatStartReceipt = z.infer<typeof thumbnailChatStartReceipt>;
export type ThumbnailChatDescriptor = Readonly<Omit<ThumbnailChatStartReceipt, 'state' | 'permission'>>;
