import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';

const publicRoot = join(import.meta.dir, '..', 'public');

function sha256(relativePublicPath: string) {
  return createHash('sha256')
    .update(readFileSync(join(publicRoot, relativePublicPath.replace(/^\//, ''))))
    .digest('hex');
}

async function readAlphaStats(relativePublicPath: string) {
  const { data, info } = await sharp(join(publicRoot, relativePublicPath.replace(/^\//, '')))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  let semiTransparentPixels = 0;
  let opaquePixels = 0;
  for (let index = 3; index < data.length; index += 4) {
    const alpha = data[index];
    if (alpha === 0) {
      transparentPixels += 1;
    } else if (alpha === 255) {
      opaquePixels += 1;
    } else {
      semiTransparentPixels += 1;
    }
  }
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
  return {
    width: info.width,
    height: info.height,
    transparentPixels,
    semiTransparentPixels,
    opaquePixels,
    cornerAlpha: [
      alphaAt(0, 0),
      alphaAt(info.width - 1, 0),
      alphaAt(0, info.height - 1),
      alphaAt(info.width - 1, info.height - 1),
      alphaAt(Math.floor(info.width / 2), 0),
    ],
  };
}

describe('marker GPT Image 2 asset provenance', () => {
  test('retains original marker provenance and verifies delivered transparent cutouts', async () => {
    const manifestPath = join(publicRoot, 'images/maker-images/marker-assets-provenance.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      providerId: string;
      authMode: string;
      endpoint: string;
      requestToolModel: string;
      model: string;
      modelProvenance: string;
      hasOpenAIAPIKey: boolean;
      deliveryOptimization: {
        sourceCommit: string;
        resizeCommit: string;
        dimensions: number[];
        assets: Record<string, {
          png: { sha256: string; bytes: number };
          webp: { sha256: string; bytes: number };
        }>;
      };
      assets: Array<{
        kind: string;
        responseId: string;
        imageCallId: string;
        requestHash: string;
        responseHash: string;
        png: { path: string; sha256: string; bytes: number };
        webp: { path: string; sha256: string; bytes: number };
        transparentEdit: {
          providerId: string;
          authMode: string;
          requestToolModel: string;
          model: string;
          modelProvenance: string;
          operation: string;
          responseId: string;
          imageCallId: string;
          requestHash: string;
          responseHash: string;
          rawGeneratedSha256: string;
          alphaExtraction: {
            method: string;
            source: string;
            stats: {
              width: number;
              height: number;
              transparentPixels: number;
              semiTransparentPixels: number;
              opaquePixels: number;
              cornerAlpha: number[];
            };
          };
        };
      }>;
    };

    expect(manifest).toMatchObject({
      providerId: 'local-codex',
      authMode: 'codex_oauth',
      endpoint: 'https://chatgpt.com/backend-api/codex/responses',
      requestToolModel: 'gpt-image-2',
      model: 'gpt-image-2',
      modelProvenance: 'exact',
      hasOpenAIAPIKey: false,
    });
    expect(manifest.assets.map((asset) => asset.kind).sort()).toEqual([
      'seasonal',
      'trend',
      'user-submitted',
    ]);
    expect(manifest.deliveryOptimization).toMatchObject({
      sourceCommit: 'b2a0d2a9f8e57fae0cd4817c6c5a308c5217adbb',
      resizeCommit: '2f78cacd456cc3a286f34111cfc8629562569271',
      dimensions: [128, 128],
    });
    expect(Object.keys(manifest.deliveryOptimization.assets).sort()).toEqual(
      manifest.assets.map((asset) => asset.kind).sort(),
    );

    for (const asset of manifest.assets) {
      expect(asset.responseId).toStartWith('resp_');
      expect(asset.imageCallId).toStartWith('ig_');
      expect(asset.requestHash).toHaveLength(64);
      expect(asset.responseHash).toHaveLength(64);
      expect(existsSync(join(publicRoot, asset.png.path.replace(/^\//, '')))).toBe(true);
      expect(existsSync(join(publicRoot, asset.webp.path.replace(/^\//, '')))).toBe(true);
      const optimized = manifest.deliveryOptimization.assets[asset.kind];
      expect(asset.png.sha256).toHaveLength(64);
      expect(asset.webp.sha256).toHaveLength(64);
      expect(sha256(asset.png.path)).toBe(optimized.png.sha256);
      expect(sha256(asset.webp.path)).toBe(optimized.webp.sha256);
      expect(statSync(join(publicRoot, asset.png.path.replace(/^\//, ''))).size).toBe(optimized.png.bytes);
      expect(statSync(join(publicRoot, asset.webp.path.replace(/^\//, ''))).size).toBe(optimized.webp.bytes);
      expect(optimized.png.bytes).toBeLessThan(asset.png.bytes);
      expect(optimized.webp.bytes).toBeLessThan(asset.webp.bytes);
      expect(asset.transparentEdit).toMatchObject({
        providerId: 'local-codex',
        authMode: 'codex_oauth',
        requestToolModel: 'gpt-image-2',
        model: 'gpt-image-2',
        modelProvenance: 'exact',
        operation: 'background-removal-edit-plus-deterministic-alpha-extraction',
      });
      expect(asset.transparentEdit.responseId).toHaveLength(36);
      expect(asset.transparentEdit.imageCallId).toStartWith('ig_');
      expect(asset.transparentEdit.requestHash).toHaveLength(64);
      expect(asset.transparentEdit.responseHash).toHaveLength(64);
      expect(asset.transparentEdit.rawGeneratedSha256).toHaveLength(64);

      const pngAlpha = await readAlphaStats(asset.png.path);
      const webpAlpha = await readAlphaStats(asset.webp.path);
      for (const alphaStats of [pngAlpha, webpAlpha]) {
        expect(alphaStats.width).toBe(128);
        expect(alphaStats.height).toBe(128);
        expect(alphaStats.cornerAlpha).toEqual([0, 0, 0, 0, 0]);
        expect(alphaStats.transparentPixels).toBeGreaterThan(128 * 128 * 0.6);
        expect(alphaStats.opaquePixels).toBeGreaterThan(128 * 128 * 0.3);
      }
      expect(asset.transparentEdit.alphaExtraction.stats.cornerAlpha).toEqual([0, 0, 0, 0, 0]);
      expect(asset.transparentEdit.alphaExtraction.stats.transparentPixels).toBeGreaterThan(600_000);
    }
  });
});
