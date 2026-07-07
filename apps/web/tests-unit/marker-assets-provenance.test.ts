import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const publicRoot = join(import.meta.dir, '..', 'public');

function sha256(relativePublicPath: string) {
  return createHash('sha256')
    .update(readFileSync(join(publicRoot, relativePublicPath.replace(/^\//, ''))))
    .digest('hex');
}

describe('marker GPT Image 2 asset provenance', () => {
  test('commits exact local-codex gpt-image-2 marker assets with hash readback', () => {
    const manifestPath = join(publicRoot, 'images/maker-images/marker-assets-provenance.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      providerId: string;
      authMode: string;
      endpoint: string;
      requestToolModel: string;
      model: string;
      modelProvenance: string;
      hasOpenAIAPIKey: boolean;
      assets: Array<{
        kind: string;
        responseId: string;
        imageCallId: string;
        requestHash: string;
        responseHash: string;
        png: { path: string; sha256: string };
        webp: { path: string; sha256: string };
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

    for (const asset of manifest.assets) {
      expect(asset.responseId).toStartWith('resp_');
      expect(asset.imageCallId).toStartWith('ig_');
      expect(asset.requestHash).toHaveLength(64);
      expect(asset.responseHash).toHaveLength(64);
      expect(existsSync(join(publicRoot, asset.png.path.replace(/^\//, '')))).toBe(true);
      expect(existsSync(join(publicRoot, asset.webp.path.replace(/^\//, '')))).toBe(true);
      expect(sha256(asset.png.path)).toBe(asset.png.sha256);
      expect(sha256(asset.webp.path)).toBe(asset.webp.sha256);
    }
  });
});
