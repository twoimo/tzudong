import { z } from 'zod';
import { thumbnailBrief, thumbnailRole, TZUYANG_THUMBNAIL_CHANNEL_ID, THUMBNAIL_REFERENCE_BYTES } from './queue-contract';
import type { ThumbnailBrowserDraft } from './browser-queue';

const responseSchema = z.object({ channelId: z.literal(TZUYANG_THUMBNAIL_CHANNEL_ID),
  bucketStartedAt: z.iso.datetime({ offset: true }).nullable(), references: z.array(z.object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), title: z.string().max(200), role: thumbnailRole,
  }).strict()).max(2) }).strict();
const host = (role: string) => role === 'host' || role === 'person';
export class ThumbnailReferencePreparationError extends Error {
  constructor(readonly code: 'host_reference_required' | 'reference_preparation_failed' | 'reference_limit') { super(code); }
}
async function bounded(response: Response, maxBytes: number) {
  if (!response.ok || !response.body) throw new ThumbnailReferencePreparationError('reference_preparation_failed');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > maxBytes) { void reader.cancel().catch(() => undefined); throw new ThumbnailReferencePreparationError('reference_limit'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Collected whole thumbnails are references, never a claim that a host face was detected/cropped. */
export async function prepareThumbnailBrowserReferences(brief: z.infer<typeof thumbnailBrief>,
  references: ThumbnailBrowserDraft['references'], options: { fetch?: typeof fetch; signal?: AbortSignal; ownerId?: string } = {}) {
  const selected = references.map((ref) => ({ ...ref }));
  const submitted = thumbnailBrief.parse(brief); const needed = submitted.stylePreset === 'tzuyang-food-travel-collage' || /쯔양|tzuyang/i.test(submitted.topic);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  const fetcher = options.fetch ?? fetch; const automatic: Array<{ videoId: string; title: string }> = [];
  const headers = { 'Content-Type': 'application/json', ...(options.ownerId ? { 'X-Thumbnail-Owner': options.ownerId } : {}) };
  if (selected.length > 8 || selected.reduce((sum, ref) => sum + ref.file.size, 0) > 16 * 1024 * 1024) {
    throw new ThumbnailReferencePreparationError('reference_limit');
  }
  if (selected.length < 8) {
    try {
      const response = await fetcher('/api/admin/youtube-thumbnail-generator/reference-candidates', { method: 'POST',
        credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal, headers,
        body: JSON.stringify({ brief: submitted, slots: 8 - selected.length }) });
      const payload = responseSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bounded(response, 16_384))));
      for (const ref of payload.references) {
        if (selected.length === 8) break;
        for (const quality of ['maxresdefault', 'sddefault'] as const) {
          signal.throwIfAborted();
          try {
            const image = await fetcher('/api/admin/youtube-thumbnail-generator/reference-image', { method: 'POST',
              credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal, headers,
              body: JSON.stringify({ url: `https://img.youtube.com/vi/${ref.videoId}/${quality}.jpg` }) });
            const bytes = await bounded(image, THUMBNAIL_REFERENCE_BYTES);
            const mime = image.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
            if (bytes.length < 16 || !['image/png', 'image/jpeg', 'image/webp'].includes(mime ?? '')) throw new Error('invalid image');
            const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
            try { if (bitmap.width <= 120 && bitmap.height <= 90) throw new Error('placeholder thumbnail'); }
            finally { bitmap.close(); }
            if (selected.reduce((sum, item) => sum + item.file.size, bytes.length) > 16 * 1024 * 1024) throw new ThumbnailReferencePreparationError('reference_limit');
            selected.push({ role: ref.role, file: new File([bytes], `auto-${ref.videoId}`, { type: mime }) });
            automatic.push({ videoId: ref.videoId, title: ref.title }); break;
          } catch { signal.throwIfAborted(); }
        }
      }
    } catch { options.signal?.throwIfAborted(); }
  }
  if (needed && !selected.some((ref) => host(ref.role))) throw new ThumbnailReferencePreparationError('host_reference_required');
  return { references: selected, automatic };
}
