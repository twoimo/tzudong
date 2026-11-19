import { z } from 'zod';

export const LOCAL_OCR_PREVIEW_MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const LOCAL_OCR_PREVIEW_MAX_REQUEST_BYTES = 4 * 1024 * 1024 + 1024;

const requestSchema = z.object({
  imageBase64: z.string().min(4).max(4 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
}).strict();

export function parseLocalOcrPreviewRequest(value: unknown) {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return null;
  const bytes = Buffer.from(parsed.data.imageBase64, 'base64');
  if (!bytes.length || bytes.length > LOCAL_OCR_PREVIEW_MAX_IMAGE_BYTES
    || bytes.toString('base64') !== parsed.data.imageBase64) return null;
  return { bytes, mimeType: parsed.data.mimeType };
}

export function isLocalOcrPreviewEnabled(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
) {
  // This is an opt-in for this machine, never a hosted Linux fallback to a cloud provider.
  return platform === 'darwin' && env.OCR_PREVIEW_LOCAL_ENABLED === 'true';
}
