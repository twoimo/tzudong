export const STORYBOARD_HISTORY_INDEX_URL = '/qa-history/storyboard/history-real-data.json';
export const STORYBOARD_HISTORY_PUBLIC_BASE_URL = '/qa-history/storyboard/';

type StoryboardHistoryPathLike = {
  jsonPath?: unknown;
  rawPath?: unknown;
};

export function normalizeStoryboardHistoryRunPath(
  value: unknown,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('./')) return null;
  if (!trimmed.endsWith('.json')) return null;
  if (trimmed.includes('\\') || trimmed.includes('?') || trimmed.includes('#')) {
    return null;
  }
  const fileName = trimmed.slice(2);
  if (!fileName || fileName.includes('/') || fileName.includes('..')) {
    return null;
  }
  if (fileName.startsWith('.') || fileName === 'latest-real-data.json') {
    return null;
  }
  return `./${fileName}`;
}

export function getSafeStoryboardHistoryRunUrl(
  run: StoryboardHistoryPathLike,
): string | null {
  const normalizedPath =
    normalizeStoryboardHistoryRunPath(run.jsonPath) ??
    normalizeStoryboardHistoryRunPath(run.rawPath);
  if (!normalizedPath) return null;
  return `${STORYBOARD_HISTORY_PUBLIC_BASE_URL}${encodeURIComponent(
    normalizedPath.slice(2),
  )}`;
}
