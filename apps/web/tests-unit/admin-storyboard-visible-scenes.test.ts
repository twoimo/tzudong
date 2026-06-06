import { describe, expect, test } from 'bun:test';

import {
  getOmittedStoryboardSceneCount,
  getStoryboardImageGenerationTargetScenes,
  getVisibleTrustedStoryboardScenes,
} from '../lib/admin/storyboard/visible-scenes';
import { STORYBOARD_GENERATED_IMAGE_TRUST_POLICY } from '../lib/admin/storyboard/image-trust';
import type { StoryboardScene } from '../lib/admin/storyboard/types';

const baseScene = (sceneNo: number): StoryboardScene => ({
  sceneNo,
  title: `CUT ${sceneNo}`,
  beat: `beat ${sceneNo}`,
  visualDirection: `visual ${sceneNo}`,
  hostBeat: `audio ${sceneNo}`,
  captionIdea: `subtitle ${sceneNo}`,
  operatorIntent: `intent ${sceneNo}`,
  heatmapEvidence: {
    videoId: `video-${sceneNo}`,
    title: `source ${sceneNo}`,
    peakTime: '00:10',
    replayScore: 0.9,
    reason: 'fixture',
  },
});

const trustedImage = (sceneNo: number): StoryboardScene['generatedImage'] => ({
  dataUrl: `data:image/png;base64,cut${sceneNo}`,
  mime: 'image/png',
  providerId: 'local-codex',
  trustPolicy: STORYBOARD_GENERATED_IMAGE_TRUST_POLICY,
  model: 'gpt-image-2',
  prompt: 'Create exactly one 16:9 raster storyboard panel',
  generatedAt: '2026-06-07T00:00:00.000Z',
  warnings: [],
});

describe('storyboard visible trusted scenes', () => {
  test('omits a fifth no-image scene without creating a phantom visible CUT', () => {
    const scenes = [1, 2, 3, 4, 5].map(baseScene).map((scene) =>
      scene.sceneNo <= 4
        ? { ...scene, generatedImage: trustedImage(scene.sceneNo) }
        : scene,
    );

    const visibleScenes = getVisibleTrustedStoryboardScenes(scenes);

    expect(visibleScenes.map((scene) => scene.sceneNo)).toEqual([1, 2, 3, 4]);
    expect(visibleScenes.some((scene) => scene.sceneNo === 5)).toBe(false);
    expect(getOmittedStoryboardSceneCount(scenes)).toBe(1);
    expect(Math.ceil(visibleScenes.length / 4)).toBe(1);
  });

  test('keeps real pagination when more than four trusted generated scenes exist', () => {
    const scenes = [1, 2, 3, 4, 5].map(baseScene).map((scene) => ({
      ...scene,
      generatedImage: trustedImage(scene.sceneNo),
    }));

    const visibleScenes = getVisibleTrustedStoryboardScenes(scenes);

    expect(visibleScenes.map((scene) => scene.sceneNo)).toEqual([1, 2, 3, 4, 5]);
    expect(getOmittedStoryboardSceneCount(scenes)).toBe(0);
    expect(Math.ceil(visibleScenes.length / 4)).toBe(2);
  });

  test('does not use a raw fallback slice for later empty visible pages', () => {
    const scenes = [1, 2, 3, 4, 5].map(baseScene).map((scene) =>
      scene.sceneNo <= 4
        ? { ...scene, generatedImage: trustedImage(scene.sceneNo) }
        : scene,
    );
    const visibleScenes = getVisibleTrustedStoryboardScenes(scenes);

    expect(
      getStoryboardImageGenerationTargetScenes({
        allScenes: scenes,
        visibleScenes,
        page: 1,
        pageSize: 4,
      }),
    ).toEqual([]);
    expect(
      getStoryboardImageGenerationTargetScenes({
        allScenes: scenes,
        visibleScenes: [],
        page: 0,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([1, 2, 3, 4]);
  });
});
