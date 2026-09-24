import { describe, expect, test } from 'bun:test';

import {
  comparePopularRestaurants,
  scorePopularRestaurant,
} from '@/lib/popular-restaurant-score';
import type { Restaurant } from '@/types/restaurant';

function restaurant(partial: Partial<Restaurant> & Pick<Restaurant, 'id'>): Restaurant {
  return {
    approved_name: partial.id,
    name: partial.id,
    status: 'approved',
    weekly_search_count: 0,
    review_count: 0,
    ...partial,
  } as Restaurant;
}

describe('popular restaurant composite score', () => {
  test('ranks a multi-signal restaurant ahead of a search-only leader', () => {
    const searchLeader = restaurant({
      id: 'search-leader',
      weekly_search_count: 100,
      youtube_meta: { viewCount: 1000 },
    });
    const multiSignal = restaurant({
      id: 'multi-signal',
      weekly_search_count: 10,
      review_count: 20,
      youtube_link: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      mergedYoutubeLinks: [
        'https://www.youtube.com/watch?v=aaaaaaaaaaa',
        'https://www.youtube.com/watch?v=bbbbbbbbbbb',
        'https://youtu.be/ccccccccccc',
      ],
      youtube_meta: { viewCount: 5_000_000, likeCount: 100_000, commentCount: 5_000 },
      mergedYoutubeMetas: [
        { viewCount: 5_000_000, likeCount: 100_000, commentCount: 5_000, title: 'a' },
        { viewCount: 800_000, likeCount: 12_000, commentCount: 900, title: 'b' },
      ],
    });
    const likes = new Map([['multi-signal', 40]]);

    expect(scorePopularRestaurant(multiSignal, 40)).toBeGreaterThan(scorePopularRestaurant(searchLeader, 0));
    expect(comparePopularRestaurants(searchLeader, multiSignal, likes)).toBeGreaterThan(0);
    expect([searchLeader, multiSignal].sort((a, b) => comparePopularRestaurants(a, b, likes)).map((item) => item.id))
      .toEqual(['multi-signal', 'search-leader']);
  });

  test('does not let a second copy of the same video double the view total', () => {
    const once = restaurant({
      id: 'once',
      youtube_meta: { title: 'same', publishedAt: '2026-01-01', viewCount: 1000, likeCount: 10, commentCount: 2 },
      mergedYoutubeMetas: [
        { title: 'same', publishedAt: '2026-01-01', viewCount: 1000, likeCount: 10, commentCount: 2 },
      ],
    });
    const doubled = restaurant({
      id: 'doubled',
      youtube_meta: { title: 'same', publishedAt: '2026-01-01', viewCount: 2000, likeCount: 20, commentCount: 4 },
    });

    expect(scorePopularRestaurant(once)).toBeLessThan(scorePopularRestaurant(doubled));
  });
});
