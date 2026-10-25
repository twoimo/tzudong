import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { STORYBOARD_GEMINI_IMAGE_MODELS, isAllowedStoryboardGeminiModel } from '../storyboard/gemini-models';

export type ThumbnailGeminiImageModel = typeof STORYBOARD_GEMINI_IMAGE_MODELS[number]['id'];
export type Mime = 'image/png' | 'image/jpeg' | 'image/webp';
type ReferenceRole = 'host' | 'food' | 'object' | 'person' | 'other';
type Identity = { ownerId: string; jobId: string; attemptId: string; fence: number };
export type ThumbnailGeminiContent = {
  model: ThumbnailGeminiImageModel;
  prompt: string;
  references: ReadonlyArray<{ bytes: Uint8Array; mimeType: Mime; role: ReferenceRole }>;
};
export type ThumbnailGeminiInput = Identity & ThumbnailGeminiContent;
export type ThumbnailGeminiDescriptor = Readonly<Identity & {
  providerId: 'gemini-api'; model: ThumbnailGeminiImageModel; inputSha256: string;
}>;
export type ThumbnailGeminiStartReceipt = ThumbnailGeminiDescriptor & {
  state: 'provider_started'; permission: 'fresh-commit';
};
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
export const thumbnailImageFormats = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;
const FORMATS = thumbnailImageFormats;
const ROLES: ReferenceRole[] = ['host', 'food', 'object', 'person', 'other'];
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** The phase is deliberately separate from the code: a timeout is never permission to generate again. */
export class ThumbnailGeminiError extends Error {
  constructor(readonly code: 'invalid_input' | 'provider_not_configured' | 'attempt_consumed' | 'start_not_confirmed'
    | 'cancelled_before_start' | 'budget_unavailable' | 'provider_outcome_unknown' | 'invalid_provider_response' | 'model_catalog_unavailable',
  readonly outcome: 'not_started' | 'unknown' | 'received_invalid' | 'already_consumed' = 'not_started') {
    super(code); this.name = 'ThumbnailGeminiError';
  }
}

function snapshotContent(input: ThumbnailGeminiContent) {
  if (!input || !isAllowedStoryboardGeminiModel(input.model, 'image')
    || typeof input.prompt !== 'string' || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 65_536
    || !Array.isArray(input.references) || input.references.length > 8) throw new ThumbnailGeminiError('invalid_input');
  let total = 0;
  const references = input.references.map((reference) => {
    if (!reference || !(reference.bytes instanceof Uint8Array) || reference.bytes.byteLength < 16
      || reference.bytes.byteLength > MAX_REFERENCE_BYTES || !Object.values(FORMATS).includes(reference.mimeType)
      || !ROLES.includes(reference.role)) throw new ThumbnailGeminiError('invalid_input');
    total += reference.bytes.byteLength;
    if (total > MAX_TOTAL_REFERENCE_BYTES) throw new ThumbnailGeminiError('invalid_input');
    // Copy before the first await; the browser/form/claim object must not mutate an admitted request.
    return { bytes: Buffer.from(reference.bytes), mimeType: reference.mimeType, role: reference.role };
  });
  return { model: input.model, prompt: input.prompt, references };
}

export async function decodeThumbnailImage(bytes: Buffer, mime: Mime) {
  const options = { limitInputPixels: MAX_PIXELS, animated: false, failOn: 'warning' as const };
  const metadata = await sharp(bytes, options).metadata();
  if (!metadata.format || !(metadata.format in FORMATS)
    || FORMATS[metadata.format as keyof typeof FORMATS] !== mime || !metadata.width || !metadata.height
    || (metadata.pages ?? 1) !== 1 || metadata.width * metadata.height > MAX_PIXELS) throw new Error('invalid_image');
  // Header inspection alone accepts some truncated files. Decode every pixel before provider/storage work.
  await sharp(bytes, options).raw().toBuffer();
  return { options, width: metadata.width, height: metadata.height };
}

/** Pure server/worker preparation: no credential lookup, provider call, request ID or Storage path in the digest. */
export async function prepareThumbnailGeminiContent(input: ThumbnailGeminiContent) {
  if (typeof window !== 'undefined') throw new ThumbnailGeminiError('provider_not_configured');
  const snapshot = snapshotContent(input);
  const references = [];
  let total = 0;
  try {
    for (const reference of snapshot.references) {
      const { options } = await decodeThumbnailImage(reference.bytes, reference.mimeType);
      const canonical = await sharp(reference.bytes, options).rotate().png().toBuffer();
      total += canonical.length;
      if (canonical.length > MAX_REFERENCE_BYTES || total > MAX_TOTAL_REFERENCE_BYTES) throw new Error('invalid_image');
      references.push({ bytes: canonical, role: reference.role, mimeType: 'image/png' as const, sha256: sha256(canonical) });
    }
  } catch { throw new ThumbnailGeminiError('invalid_input'); }
  // Only the actual provider input participates. EXIF or other stripped metadata
  // must not turn identical provider pixels into a second unresolved generation.
  const inputSha256 = inputDigest(snapshot, references);
  return { model: snapshot.model, prompt: snapshot.prompt, references, inputSha256 };
}

function inputDigest(content: Pick<ThumbnailGeminiContent, 'model' | 'prompt'>,
  references: { role: ReferenceRole; sha256: string; mimeType: Mime }[]) {
  return sha256(JSON.stringify({ contract: 'thumbnail-gemini-image-v1', model: content.model, prompt: content.prompt,
    canvas: { width: 1280, height: 720, fit: 'cover', imageSize: '1K' },
    references: references.map((reference) => ({ role: reference.role, canonicalSha256: reference.sha256, mimeType: reference.mimeType })) }));
}

/** Stored references were canonicalized at enqueue. Verify/decode them, but preserve exact provider bytes across OS encoders. */
export async function prepareStoredThumbnailGeminiContent(input: ThumbnailGeminiContent) {
  const snapshot = snapshotContent(input); const references = [];
  try {
    for (const reference of snapshot.references) {
      if (reference.mimeType !== 'image/png') throw new Error('invalid_image');
      await decodeThumbnailImage(reference.bytes, reference.mimeType);
      references.push({ ...reference, sha256: sha256(reference.bytes) });
    }
  } catch { throw new ThumbnailGeminiError('invalid_input'); }
  return { ...snapshot, references, inputSha256: inputDigest(snapshot, references) };
}
