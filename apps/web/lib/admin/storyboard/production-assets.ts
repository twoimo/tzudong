import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  MAX_STORYBOARD_IMAGE_BYTES, MAX_STORYBOARD_IMAGE_PIXELS,
  StoryboardProductionError, storyboardProductionAssetSchema,
  type StoryboardProductionAsset, type StoryboardProductionProvenance,
} from './production-contract.ts';

export const STORYBOARD_ASSET_BUCKET = 'storyboard-private';
export const storyboardHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const formats = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;

export function trustedStoryboardAsset(value: unknown, projectId: string): StoryboardProductionAsset | null {
  const parsed = storyboardProductionAssetSchema.safeParse(value);
  if (!parsed.success || !uuid.test(projectId)) return null;
  const asset = parsed.data;
  const prefix = `${projectId}/${asset.id}/`;
  const variants = [asset.original, ...asset.web];
  if (variants.some((variant) => !variant.path.startsWith(prefix)
    || !/^(?:original\.(?:png|jpeg|webp)|web-\d{2,4}\.webp)$/.test(variant.path.slice(prefix.length))
    || variant.width * variant.height > MAX_STORYBOARD_IMAGE_PIXELS
    || !variant.path.endsWith(`.${variant.mime.split('/')[1]}`))) return null;
  if (new Set(variants.map((variant) => variant.path)).size !== variants.length) return null;
  return asset;
}

/** Decode before storing; preserve the source and make smaller WebP derivatives without upscaling. */
export async function prepareStoryboardAsset(
  bytes: Buffer, projectId: string, provenance: StoryboardProductionProvenance,
): Promise<{ asset: StoryboardProductionAsset; files: Array<{ path: string; bytes: Buffer; mime: string }> }> {
  if (!uuid.test(projectId)) throw new StoryboardProductionError('invalid_image');
  if (bytes.length < 16 || bytes.length > MAX_STORYBOARD_IMAGE_BYTES) throw new StoryboardProductionError('image_too_large');
  try {
    const options = { limitInputPixels: MAX_STORYBOARD_IMAGE_PIXELS, animated: false, failOn: 'warning' as const };
    const metadata = await sharp(bytes, options).metadata();
    const format = metadata.format;
    if (!format || !(format in formats) || !metadata.width || !metadata.height
      || (metadata.pages ?? 1) !== 1 || metadata.width * metadata.height > MAX_STORYBOARD_IMAGE_PIXELS) {
      throw new StoryboardProductionError('invalid_image');
    }
    // metadata() alone does not reject truncated image pixels.
    await sharp(bytes, options).raw().toBuffer();
    const id = randomUUID();
    const mime = formats[format as keyof typeof formats];
    const originalPath = `${projectId}/${id}/original.${format}`;
    const original = {
      path: originalPath, sha256: storyboardHash(bytes), mime,
      width: metadata.width, height: metadata.height, bytes: bytes.length,
    };
    const files = [{ path: originalPath, bytes, mime: mime as string }];
    const web: StoryboardProductionAsset['web'] = [];
    for (const width of [...new Set([Math.min(480, metadata.width), Math.min(960, metadata.width), metadata.width])].sort((a, b) => a - b)) {
      const result = await sharp(bytes, options).rotate().resize({ width, withoutEnlargement: true })
        .webp({ quality: 88, effort: 4 }).toBuffer({ resolveWithObject: true });
      if (result.data.length > MAX_STORYBOARD_IMAGE_BYTES) throw new StoryboardProductionError('image_too_large');
      const path = `${projectId}/${id}/web-${width}.webp`;
      web.push({ path, sha256: storyboardHash(result.data), mime: 'image/webp', width: result.info.width, height: result.info.height, bytes: result.data.length });
      files.push({ path, bytes: result.data, mime: 'image/webp' });
    }
    const asset = storyboardProductionAssetSchema.parse({ id, trustPolicy: 'storyboard-private-asset-v1', original, web, provenance });
    if (!trustedStoryboardAsset(asset, projectId)) throw new StoryboardProductionError('invalid_image');
    return { asset, files };
  } catch (error) {
    if (error instanceof StoryboardProductionError) throw error;
    throw new StoryboardProductionError('invalid_image');
  }
}
