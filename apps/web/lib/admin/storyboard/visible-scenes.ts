import type { StoryboardScene } from './types';
import { getTrustedStoryboardGeneratedImage } from './image-trust';

function getSafeStoryboardPage(page: number) {
  return Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0;
}

function getSafeStoryboardPageSize(pageSize: number) {
  return Number.isFinite(pageSize)
    ? Math.max(1, Math.trunc(pageSize))
    : 1;
}

export function getStoryboardSourcePageScenes({
  allScenes,
  page,
  pageSize,
}: {
  allScenes: StoryboardScene[];
  page: number;
  pageSize: number;
}) {
  const safePage = getSafeStoryboardPage(page);
  const safePageSize = getSafeStoryboardPageSize(pageSize);
  return allScenes.slice(
    safePage * safePageSize,
    safePage * safePageSize + safePageSize,
  );
}

export function getStoryboardScenePageCount({
  allScenes,
  pageSize,
}: {
  allScenes: StoryboardScene[];
  pageSize: number;
}) {
  const safePageSize = getSafeStoryboardPageSize(pageSize);
  return Math.max(1, Math.ceil(allScenes.length / safePageSize));
}

export function getVisibleTrustedStoryboardScenes(
  scenes: StoryboardScene[],
): StoryboardScene[] {
  return scenes.filter((scene) =>
    Boolean(getTrustedStoryboardGeneratedImage(scene.generatedImage)),
  );
}

export function getVisibleTrustedStoryboardPageScenes({
  allScenes,
  page,
  pageSize,
}: {
  allScenes: StoryboardScene[];
  page: number;
  pageSize: number;
}): StoryboardScene[] {
  return getStoryboardSourcePageScenes({ allScenes, page, pageSize }).filter(
    (scene) => Boolean(getTrustedStoryboardGeneratedImage(scene.generatedImage)),
  );
}

export function getStoryboardTrustedScenePageCount({
  allScenes,
  pageSize,
}: {
  allScenes: StoryboardScene[];
  pageSize: number;
}) {
  const safePageSize = getSafeStoryboardPageSize(pageSize);
  const lastTrustedSceneIndex = allScenes.reduce(
    (lastIndex, scene, index) =>
      getTrustedStoryboardGeneratedImage(scene.generatedImage)
        ? index
        : lastIndex,
    -1,
  );
  if (lastTrustedSceneIndex < 0) return 1;
  return Math.max(1, Math.floor(lastTrustedSceneIndex / safePageSize) + 1);
}

export function getOmittedStoryboardSceneCount(scenes: StoryboardScene[]) {
  return Math.max(
    0,
    scenes.length - getVisibleTrustedStoryboardScenes(scenes).length,
  );
}

export function getStoryboardImageGenerationTargetScenes({
  allScenes,
  visibleScenes,
  page,
  pageSize,
}: {
  allScenes: StoryboardScene[];
  visibleScenes: StoryboardScene[];
  page: number;
  pageSize: number;
}): StoryboardScene[] {
  const safePage = getSafeStoryboardPage(page);
  const sourcePageScenes = getStoryboardSourcePageScenes({
    allScenes,
    page,
    pageSize,
  });
  const visibleSceneNos = new Set(visibleScenes.map((scene) => scene.sceneNo));
  const visiblePageScenes = sourcePageScenes.filter((scene) =>
    visibleSceneNos.has(scene.sceneNo),
  );

  if (
    sourcePageScenes.length > 0 &&
    visiblePageScenes.length < sourcePageScenes.length
  ) {
    return sourcePageScenes;
  }
  if (visiblePageScenes.length > 0) return visiblePageScenes;
  return sourcePageScenes;
}
