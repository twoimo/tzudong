import { beforeAll, describe, expect, mock, test } from 'bun:test';

mock.module('@/lib/insight/wordcloud', () => ({
    getAdminInsightWordcloud: async () => ({
        asOf: '2026-02-27T00:00:00.000Z',
        keywords: [
            { keyword: '먹방', count: 1, trend: 'up', category: '음식' },
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
                viewCount: 1_200,
                likeCount: 45,
                commentCount: 3,
                duration: 120,
                previousViewCount: 900,
                previousLikeCount: 30,
                previousCommentCount: 2,
                previousDuration: 100,
                publishedAt: null,
            },
        ],
    }),
}));

let answerAdminInsightChat: (message: string, config?: unknown) => Promise<any>;

beforeAll(async () => {
    const chat = await import('@/lib/insight/chat');
    answerAdminInsightChat = chat.answerAdminInsightChat;
});

describe('insight chat intent ordering', () => {
    test('storyboard-oriented prompt does not fall back to simple_chat', async () => {
        const result = await answerAdminInsightChat('먹방 영상 기획안 어떤 구성으로 찍으면 좋아요?');

        expect(result.meta?.source).toBe('local');
        expect(result.meta?.fallbackReason).not.toBe('storyboard_simple_chat');
        expect(result.meta?.fallbackReason).not.toBe('llm_unavailable');
    });

    test('storyboard qna-like prompt uses storyboard qna flow instead of simple_chat', async () => {
        const result = await answerAdminInsightChat('먹방 영상 조회수나 개수를 알려줘');

        expect(result.meta?.source).toBe('local');
        expect([
            'storyboard_qna_local',
            'storyboard_qna_unavailable',
        ]).toContain(result.meta?.fallbackReason);
    });
});
