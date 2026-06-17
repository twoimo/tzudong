import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type StoryboardSeedPayload = {
  result: {
    storyboard: {
      scenes: Array<{ generatedImage?: { dataUrl?: string } }>;
    };
  };
};

describe('admin storyboard shared production seed', () => {
  test('ships the promoted 10-cut storyboard images through deployable seed paths', () => {
    const webRoot = process.cwd();
    const seedPath = resolve(webRoot, 'public/storyboard-seed/latest-real-data.json');
    const seedSource = readFileSync(seedPath, 'utf8');
    const seed = JSON.parse(seedSource) as StoryboardSeedPayload;
    const imageUrls = seed.result.storyboard.scenes.map(
      (scene) => scene.generatedImage?.dataUrl,
    );

    expect(imageUrls).toEqual(
      Array.from(
        { length: 10 },
        (_, index) =>
          `/storyboard-seed/generated/cut-${String(index + 1).padStart(2, '0')}.png`,
      ),
    );
    expect(seedSource).not.toContain('/qa-history/storyboard/generated/');

    for (const imageUrl of imageUrls) {
      expect(imageUrl).toBeTruthy();
      const imagePath = join(webRoot, 'public', imageUrl!.slice(1));
      expect(existsSync(imagePath)).toBe(true);
    }
  });
});
