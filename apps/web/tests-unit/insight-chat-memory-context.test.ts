import { describe, expect, test } from 'bun:test';

import { buildInsightChatContextMessages } from '@/components/insight/InsightChatSection';

const createMessage = (role: 'user' | 'assistant', content: string) => ({
    role,
    content,
});

describe('insight chat memory context builder', () => {
    test('returns empty when memory mode is off', () => {
        expect(
            buildInsightChatContextMessages([
                createMessage('user', '질문'),
                createMessage('assistant', '답변'),
            ], 'off'),
        ).toEqual([]);
    });

    test('keeps recent messages for session mode', () => {
        const source = Array.from({ length: 14 }, (_, index) => createMessage(
            index % 2 === 0 ? 'user' : 'assistant',
            `message-${index + 1}`,
        ));

        const context = buildInsightChatContextMessages(source, 'session');
        expect(context.length).toBe(12);
        expect(context[0]).toEqual({ role: 'user', content: 'message-3' });
        expect(context[11]).toEqual({ role: 'assistant', content: 'message-14' });
    });

    test('pinned mode includes first user anchor and latest assistant', () => {
        const context = buildInsightChatContextMessages([
            createMessage('user', '초기 목표를 설정해줘'),
            createMessage('assistant', '초기 분석 결과'),
            createMessage('user', '최근 변화도 알려줘'),
            createMessage('assistant', '최근 변화 요약'),
        ], 'pinned');

        expect(context[0]).toEqual({
            role: 'user',
            content: '초기 목표를 설정해줘',
        });
        expect(context[context.length - 1]).toEqual({
            role: 'assistant',
            content: '최근 변화 요약',
        });
    });
});
