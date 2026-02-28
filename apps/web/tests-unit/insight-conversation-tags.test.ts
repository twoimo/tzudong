import { describe, expect, test } from 'bun:test';

import {
    matchesInsightConversationFilter,
    normalizeConversationTags,
    type InsightConversationFilter,
} from '@/components/insight/InsightChatSection';

const makeMessage = (content: string) => ({
    id: 'm1',
    role: 'user' as const,
    content,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

describe('insight conversation tags', () => {
    test('normalizes tags with trim/lower/dedupe and limits', () => {
        expect(normalizeConversationTags([
            '  Finance  ',
            'finance',
            'KPI',
            '',
            '  ',
            'VeryLongTagNameOverTwentyChars',
            'alpha',
            'beta',
            'gamma',
            'delta',
        ])).toEqual(['finance', 'kpi', 'verylongtagnameovert', 'alpha', 'beta']);
    });

    test('search matches tag text and supports pinned filter', () => {
        const conversation = {
            title: '주간 요약',
            messages: [makeMessage('전환율 상승')],
            pinned: true,
            tags: ['growth', 'urgent'],
        };

        expect(matchesInsightConversationFilter(conversation, 'urgent')).toBe(true);
        expect(matchesInsightConversationFilter(conversation, '고정', 'pinned')).toBe(true);
        expect(matchesInsightConversationFilter({ ...conversation, pinned: false }, '고정', 'pinned')).toBe(false);
    });

    test('tag filter combines with search query', () => {
        const filter: InsightConversationFilter = 'tag:growth';
        const conversation = {
            title: '월간 분석',
            messages: [makeMessage('ROAS 개선 포인트')],
            pinned: false,
            tags: ['growth', 'kpi'],
        };

        expect(matchesInsightConversationFilter(conversation, 'roas', filter)).toBe(true);
        expect(matchesInsightConversationFilter(conversation, '이탈률', filter)).toBe(false);
        expect(matchesInsightConversationFilter({ ...conversation, tags: ['kpi'] }, 'roas', filter)).toBe(false);
    });
});
