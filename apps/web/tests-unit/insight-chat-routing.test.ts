import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

mock.restore();

mock.module('@/lib/insight/wordcloud', () => ({
  getAdminInsightWordcloud: async () => ({
    asOf: '2026-02-27T00:00:00.000Z',
    keywords: [
      { keyword: '먹방', count: 1, trend: 'up', category: '음식' },
      { keyword: '리뷰', count: 2, trend: 'up', category: '식당' },
    ],
  }),
}));

mock.module('@/lib/insight/treemap', () => ({
  getInsightTreemapData: async () => ({
    asOf: '2026-02-27T00:00:00.000Z',
    period: 'ALL',
    totalVideos: 1,
    videos: [
      {
        id: 'v1',
        title: '테스트 영상',
        category: '음식',
        viewCount: 12_345,
        likeCount: 100,
        commentCount: 5,
        duration: 120,
        previousViewCount: 10_000,
        previousLikeCount: 80,
        previousCommentCount: 3,
        previousDuration: 110,
        publishedAt: null,
      },
    ],
  }),
}));

let answerAdminInsightChat: typeof import('@/lib/insight/chat').answerAdminInsightChat;

beforeAll(async () => {
  const chat = await import('@/lib/insight/chat?routing-intent-spec');
  answerAdminInsightChat = chat.answerAdminInsightChat;
});

afterAll(() => {
  mock.restore();
});

describe('insight chat routing', () => {
  test('routes keyword-oriented query to wordcloud', async () => {
    const result = await answerAdminInsightChat('인기 키워드 보여줘');
    expect(result.visualComponent).toBe('wordcloud');
    expect(result.meta?.source).toBe('local');
  });

  test('routes distribution query to treemap', async () => {
    const result = await answerAdminInsightChat('인기 분포 트리맵');
    expect(result.visualComponent).toBe('treemap');
    expect(result.meta?.source).toBe('local');
    expect(result.content).toContain('트리맵 분석 요약');
  });

  test('routes storyboard-oriented query via storyboard intent path', async () => {
    const result = await answerAdminInsightChat('인기 영상 스토리보드');
    expect(result.meta?.source).toBe('local');
    expect(result.meta?.fallbackReason).not.toBe('llm_unavailable');
    expect(result.meta?.fallbackReason).not.toBe('storyboard_qna_unavailable');
    expect(result.meta?.fallbackReason).toMatch(/^storyboard_/);
  });
});
