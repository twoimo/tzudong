import { extractCanonicalYouTubeVideoId } from './youtube-url';
import type { Restaurant, YoutubeMeta } from '@/types/restaurant';

export type RestaurantPopularity = {
  score: number;
  basis: 'engagement' | 'search' | 'fallback';
  views: number;
  likes: number;
  comments: number;
  searches: number;
  appearances: number;
  publishedAt: number;
};

function count(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER) : 0;
}

// Log scaling keeps a very large view count from drowning out engagement.
// These are product weights, not a measured prediction of restaurant quality.
export function getRestaurantPopularity(restaurant: Restaurant): RestaurantPopularity {
  const rows = restaurant.mergedRestaurants?.length ? restaurant.mergedRestaurants : [restaurant];
  const videos = new Map<string, YoutubeMeta>();
  const seenRows = new Set<string>();
  let searches = 0;
  for (const row of rows) {
    if (!seenRows.has(row.id)) searches += count(row.weekly_search_count);
    seenRows.add(row.id);
    const videoId = extractCanonicalYouTubeVideoId(row.youtube_link);
    if (!videoId) continue;
    const meta = row.youtube_meta as YoutubeMeta | null;
    const previous = videos.get(videoId);
    videos.set(videoId, {
      viewCount: Math.max(count(previous?.viewCount), count(meta?.viewCount)),
      likeCount: Math.max(count(previous?.likeCount), count(meta?.likeCount)),
      commentCount: Math.max(count(previous?.commentCount), count(meta?.commentCount)),
      publishedAt: [previous?.publishedAt, meta?.publishedAt].filter(Boolean).sort().at(-1),
    });
  }
  let best = { score: 0, views: 0, likes: 0, comments: 0 };
  let publishedAt = 0;
  for (const meta of videos.values()) {
    const views = count(meta.viewCount), likes = count(meta.likeCount), comments = count(meta.commentCount);
    const score = 0.45 * Math.log1p(views) / Math.log1p(1_000_000)
      + 0.25 * Math.log1p(likes) / Math.log1p(10_000)
      + 0.20 * Math.log1p(comments) / Math.log1p(1_000);
    if (score > best.score) best = { score, views, likes, comments };
    const date = Date.parse(meta.publishedAt ?? '');
    if (Number.isFinite(date)) publishedAt = Math.max(publishedAt, date);
  }
  return {
    ...best,
    score: best.score + 0.10 * Math.log1p(searches) / Math.log1p(100),
    searches,
    basis: best.score > 0 ? 'engagement' : searches > 0 ? 'search' : 'fallback',
    appearances: videos.size,
    publishedAt,
  };
}

export function rankPopularRestaurants(restaurants: Restaurant[]) {
  return restaurants.map(restaurant => ({ ...restaurant, popularity: getRestaurantPopularity(restaurant) }))
    .sort((a, b) => b.popularity.score - a.popularity.score
      || b.popularity.appearances - a.popularity.appearances
      || b.popularity.publishedAt - a.popularity.publishedAt
      || a.id.localeCompare(b.id));
}

const numberFormat = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
export function getPopularityDescription(popularity?: RestaurantPopularity): string {
  if (!popularity) return '';
  if (popularity.basis === 'engagement') {
    return [popularity.views > 0 ? `조회 ${numberFormat.format(popularity.views)}` : '',
      popularity.likes > 0 ? `좋아요 ${numberFormat.format(popularity.likes)}` : '',
      popularity.comments > 0 ? `댓글 ${numberFormat.format(popularity.comments)}` : ''].filter(Boolean).join(' · ');
  }
  if (popularity.basis === 'search') return `주간 검색 ${numberFormat.format(popularity.searches)}회`;
  return popularity.appearances > 1 ? `영상 ${popularity.appearances}회 등장 · 통계 수집 전 추천` : '최근 영상 · 통계 수집 전 추천';
}
