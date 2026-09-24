import { extractCanonicalYouTubeVideoId } from '@/lib/youtube-url';
import type { Restaurant, YoutubeMeta } from '@/types/restaurant';

export const POPULAR_SCORE_WEIGHTS = {
  search: 0.24,
  views: 0.22,
  likes: 0.1,
  comments: 0.1,
  reviews: 0.14,
  reviewLikes: 0.12,
  reappearances: 0.08,
} as const;

export const POPULAR_SCORE_REFERENCES = {
  search: 40,
  views: 3_000_000,
  likes: 80_000,
  comments: 6_000,
  reviews: 15,
  reviewLikes: 30,
  reappearances: 2,
} as const;

export type PopularScoreSignal = keyof typeof POPULAR_SCORE_WEIGHTS;

export type PopularRestaurantSignals = Record<PopularScoreSignal, number>;

const SIGNAL_KEYS = Object.keys(POPULAR_SCORE_WEIGHTS) as PopularScoreSignal[];

function readNonNegative(value: unknown): number {
  const numeric = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < 0) return 0;
  return numeric;
}

function readMetaMetric(meta: YoutubeMeta, keys: readonly string[]): number {
  const record = meta as YoutubeMeta & Record<string, unknown>;
  for (const key of keys) {
    const metric = readNonNegative(record[key]);
    if (metric > 0 || record[key] === 0) return metric;
  }
  return 0;
}

function isMeta(value: unknown): value is YoutubeMeta {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addVideoLink(links: Set<string>, value: unknown) {
  if (typeof value !== 'string') return;
  const normalized = value.trim();
  if (!normalized) return;
  links.add(extractCanonicalYouTubeVideoId(normalized) ?? normalized);
}

export function readPopularRestaurantSignals(
  restaurant: Restaurant,
  reviewLikeTotal = 0,
): PopularRestaurantSignals {
  const links = new Set<string>();
  addVideoLink(links, restaurant.youtube_link);
  restaurant.mergedYoutubeLinks?.forEach((link) => addVideoLink(links, link));
  restaurant.mergedRestaurants?.forEach((merged) => addVideoLink(links, merged.youtube_link));

  const seen = new Set<string>();
  let views = 0;
  let likes = 0;
  let comments = 0;
  const visit = (meta: YoutubeMeta) => {
    const record = meta as YoutubeMeta & Record<string, unknown>;
    const videoKey = extractCanonicalYouTubeVideoId(String(record.videoId ?? record.video_id ?? ''))
      ?? [
        meta.title ?? '',
        String(record.publishedAt ?? record.published_at ?? ''),
        String(record.viewCount ?? record.view_count ?? ''),
      ].join('\u0000');
    if (seen.has(videoKey)) return;
    seen.add(videoKey);
    views += readMetaMetric(meta, ['viewCount', 'view_count']);
    likes += readMetaMetric(meta, ['likeCount', 'like_count']);
    comments += readMetaMetric(meta, ['commentCount', 'comment_count']);
  };

  if (isMeta(restaurant.youtube_meta)) visit(restaurant.youtube_meta);
  restaurant.mergedYoutubeMetas?.forEach((meta) => {
    if (isMeta(meta)) visit(meta);
  });
  restaurant.mergedRestaurants?.forEach((merged) => {
    if (isMeta(merged.youtube_meta)) visit(merged.youtube_meta);
  });

  return {
    search: readNonNegative(restaurant.weekly_search_count),
    views,
    likes,
    comments,
    reviews: readNonNegative(restaurant.review_count),
    reviewLikes: readNonNegative(reviewLikeTotal),
    reappearances: Math.max(Math.max(links.size, seen.size) - 1, 0),
  };
}

export function saturatePopularSignal(value: number, reference: number): number {
  const safeValue = readNonNegative(value);
  const safeReference = readNonNegative(reference);
  if (safeReference <= 0) return 0;
  return Math.log1p(safeValue) / Math.log1p(safeReference);
}

export function scorePopularRestaurantSignals(signals: PopularRestaurantSignals): number {
  return SIGNAL_KEYS.reduce((total, key) => {
    return total + POPULAR_SCORE_WEIGHTS[key] * saturatePopularSignal(signals[key], POPULAR_SCORE_REFERENCES[key]);
  }, 0);
}

export function scorePopularRestaurant(restaurant: Restaurant, reviewLikeTotal = 0): number {
  return scorePopularRestaurantSignals(readPopularRestaurantSignals(restaurant, reviewLikeTotal));
}

export function comparePopularRestaurants(
  left: Restaurant,
  right: Restaurant,
  reviewLikesById: ReadonlyMap<string, number> = new Map(),
): number {
  const leftScore = scorePopularRestaurant(left, reviewLikesById.get(left.id) ?? 0);
  const rightScore = scorePopularRestaurant(right, reviewLikesById.get(right.id) ?? 0);
  if (rightScore !== leftScore) return rightScore - leftScore;

  const searchDelta = (right.weekly_search_count ?? 0) - (left.weekly_search_count ?? 0);
  if (searchDelta !== 0) return searchDelta;

  const reviewDelta = (right.review_count ?? 0) - (left.review_count ?? 0);
  if (reviewDelta !== 0) return reviewDelta;

  return left.id.localeCompare(right.id);
}
