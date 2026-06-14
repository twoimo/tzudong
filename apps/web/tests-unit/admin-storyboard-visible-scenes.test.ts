import { describe, expect, test } from 'bun:test';

import {
  getOmittedStoryboardSceneCount,
  getStoryboardImageGenerationTargetScenes,
  getStoryboardScenePageCount,
  getStoryboardSourcePageScenes,
  getStoryboardTrustedScenePageCount,
  getVisibleTrustedStoryboardPageScenes,
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
  prompt: 'Create exactly one full-bleed 16:9 single-scene storyboard cut image',
  generatedAt: '2026-06-07T00:00:00.000Z',
  warnings: [],
  provenance: {
    providerId: 'local-codex',
    authMode: 'codex_oauth',
    endpoint: 'https://chatgpt.com/backend-api/codex/responses',
    agentModel: 'gpt-5.5',
    requestToolType: 'image_generation',
    requestToolModel: 'gpt-image-2',
    model: 'gpt-image-2',
    modelProvenance: 'exact',
    responseId: `resp_visible_${sceneNo}`,
    imageCallId: `ig_visible_${sceneNo}`,
    imageItemCount: 1,
    generatedImageItemTypes: ['image_generation_call'],
    rawImageItemTypes: ['image_generation_call'],
    requestHash: `${sceneNo}`.repeat(64).slice(0, 64),
    responseHash: `${9 - sceneNo}`.repeat(64).slice(0, 64),
    hasOpenAIAPIKey: false,
    generatedAt: '2026-06-07T00:00:00.000Z',
  },
});

describe('storyboard visible trusted scenes', () => {
  test('keeps text-only storyboard cuts available for the canvas source pages', () => {
    const scenes = [1, 2, 3, 4, 5, 6, 7, 8].map(baseScene);

    expect(getVisibleTrustedStoryboardScenes(scenes)).toEqual([]);
    expect(
      getStoryboardSourcePageScenes({
        allScenes: scenes,
        page: 0,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([1, 2, 3, 4]);
    expect(
      getStoryboardSourcePageScenes({
        allScenes: scenes,
        page: 1,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([5, 6, 7, 8]);
    expect(
      getStoryboardScenePageCount({
        allScenes: scenes,
        pageSize: 4,
      }),
    ).toBe(2);
  });

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

  test('targets later source pages even when their images are still missing', () => {
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
      }).map((scene) => scene.sceneNo),
    ).toEqual([5]);
    expect(
      getStoryboardImageGenerationTargetScenes({
        allScenes: scenes,
        visibleScenes: [],
        page: 0,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([1, 2, 3, 4]);
  });

  test('targets the source page to fill missing images instead of regenerating only visible cuts', () => {
    const scenes = [1, 2, 3, 4, 5, 6, 7, 8].map(baseScene).map((scene) =>
      [1, 2, 3, 4, 5].includes(scene.sceneNo)
        ? { ...scene, generatedImage: trustedImage(scene.sceneNo) }
        : scene,
    );
    const visibleScenes = getVisibleTrustedStoryboardScenes(scenes);

    expect(
      getStoryboardImageGenerationTargetScenes({
        allScenes: scenes,
        visibleScenes,
        page: 0,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([1, 2, 3, 4]);
    expect(
      getStoryboardImageGenerationTargetScenes({
        allScenes: scenes,
        visibleScenes,
        page: 1,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([5, 6, 7, 8]);
  });

  test('keeps sparse trusted cuts in their source page window instead of compacting them forward', () => {
    const scenes = [1, 2, 3, 4, 5, 6, 7, 8].map(baseScene).map((scene) =>
      [1, 5].includes(scene.sceneNo)
        ? { ...scene, generatedImage: trustedImage(scene.sceneNo) }
        : scene,
    );
    const visibleScenes = getVisibleTrustedStoryboardScenes(scenes);

    expect(
      getVisibleTrustedStoryboardPageScenes({
        allScenes: scenes,
        page: 0,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([1]);
    expect(
      getVisibleTrustedStoryboardPageScenes({
        allScenes: scenes,
        page: 1,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([5]);
    expect(
      getStoryboardTrustedScenePageCount({
        allScenes: scenes,
        pageSize: 4,
      }),
    ).toBe(2);
    expect(
      getStoryboardImageGenerationTargetScenes({
        allScenes: scenes,
        visibleScenes,
        page: 0,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([1, 2, 3, 4]);
    expect(
      getStoryboardImageGenerationTargetScenes({
        allScenes: scenes,
        visibleScenes,
        page: 1,
        pageSize: 4,
      }).map((scene) => scene.sceneNo),
    ).toEqual([5, 6, 7, 8]);
  });
});
