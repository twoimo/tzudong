import { describe, expect, test } from 'bun:test';

import {
    buildInsightChatTreemapRows,
    type ChatTreemapNode,
    type ChatTreemapViewMode,
} from '@/components/insight/InsightChatSection';

type TestVideo = {
    id: string;
    title: string;
    category: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    duration: number;
    previousViewCount: number | null;
    previousLikeCount: number | null;
    previousCommentCount: number | null;
    previousDuration: number | null;
    publishedAt: string | null;
};

const sampleVideos: TestVideo[] = [
    {
        id: 'v1',
        title: '비빔밥 리뷰',
        category: '음식',
        viewCount: 1200,
        likeCount: 40,
        commentCount: 12,
        duration: 330,
        previousViewCount: 900,
        previousLikeCount: 30,
        previousCommentCount: 10,
        previousDuration: 300,
        publishedAt: null,
    },
    {
        id: 'v2',
        title: '짬뽕 탐방',
        category: '음식',
        viewCount: 600,
        likeCount: 20,
        commentCount: 9,
        duration: 420,
        previousViewCount: 500,
        previousLikeCount: 22,
        previousCommentCount: 11,
        previousDuration: 380,
        publishedAt: null,
    },
    {
        id: 'v3',
        title: '여행 브이로그',
        category: '여행',
        viewCount: 300,
        likeCount: 18,
        commentCount: 4,
        duration: 180,
        previousViewCount: 250,
        previousLikeCount: 14,
        previousCommentCount: 3,
        previousDuration: 200,
        publishedAt: null,
    },
];

describe('insight treemap view mode grouping', () => {
    test('all view mode keeps leaf nodes and orders by metric', () => {
        const rows = buildInsightChatTreemapRows(sampleVideos, 'views', 'all' as ChatTreemapViewMode);
        expect(rows.length).toBe(3);
        expect('children' in rows[0]).toBe(false);
        expect(rows[0]).toMatchObject({ id: 'v1', metricRaw: 1200 });
        expect(rows[1]).toMatchObject({ id: 'v2', metricRaw: 600 });
        expect(rows[2]).toMatchObject({ id: 'v3', metricRaw: 300 });
    });

    test('category view mode groups leaves by category without flattening', () => {
        const rows = buildInsightChatTreemapRows(sampleVideos, 'views', 'category' as ChatTreemapViewMode);
        expect(rows.length).toBe(2);
        expect(rows.every((row) => 'children' in row)).toBe(true);

        const food = rows.find((row) => row.name === '음식') as ChatTreemapNode;
        expect(food.children).toHaveLength(2);
        expect(food.children[0]).toMatchObject({ id: 'v1', metricRaw: 1200 });
        expect(food.children[1]).toMatchObject({ id: 'v2', metricRaw: 600 });
        expect(food.value).toBe(1800);

        const travel = rows.find((row) => row.name === '여행') as ChatTreemapNode;
        expect(travel.children).toHaveLength(1);
        expect(travel.children[0]).toMatchObject({ id: 'v3', metricRaw: 300 });
    });

    test('category mode summary metric values aggregate by category bucket', () => {
        const rows = buildInsightChatTreemapRows(sampleVideos, 'views', 'category' as ChatTreemapViewMode);
        const categoryTotal = rows.reduce((sum, row) => sum + (row.value as number), 0);
        expect(categoryTotal).toBe(2100);
    });
});
