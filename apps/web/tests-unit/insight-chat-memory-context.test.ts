import { describe, expect, test } from 'bun:test';

import { buildInsightChatContextMessages } from '@/components/insight/InsightChatSection';

const createMessage = (role: 'user' | 'assistant', content: string) => ({
    role,
    content,
});

const createMessageWithId = (
    id: string,
    role: 'user' | 'assistant',
    content: string,
) => ({
    id,
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

    test('scopes to target assistant message in session mode', () => {
        const source = [
            createMessageWithId('u-1', 'user', '질문-1'),
            createMessageWithId('a-1', 'assistant', '답변-1'),
            createMessageWithId('u-2', 'user', '질문-2'),
            createMessageWithId('a-2', 'assistant', '답변-2'),
            createMessageWithId('u-3', 'user', '질문-3'),
            createMessageWithId('a-3', 'assistant', '답변-3'),
            createMessageWithId('u-4', 'user', '질문-4'),
            createMessageWithId('a-4', 'assistant', '답변-4'),
        ];

        const context = buildInsightChatContextMessages(source, 'session', 'a-2');
        expect(context).toEqual([
            { role: 'user', content: '질문-1' },
            { role: 'assistant', content: '답변-1' },
            { role: 'user', content: '질문-2' },
            { role: 'assistant', content: '답변-2' },
        ]);
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

    test('pinned mode scopes to target assistant and avoids later messages', () => {
        const source = [
            createMessageWithId('u-1', 'user', '초기 질문'),
            createMessageWithId('a-1', 'assistant', '초기 답변'),
            createMessageWithId('u-2', 'user', '다음 질문'),
            createMessageWithId('a-2', 'assistant', '다음 답변'),
            createMessageWithId('u-3', 'user', '세 번째 질문'),
            createMessageWithId('a-3', 'assistant', '세 번째 답변'),
        ];

        const context = buildInsightChatContextMessages(source, 'pinned', 'a-2');
        expect(context).toEqual([
            { role: 'user', content: '초기 질문' },
            { role: 'assistant', content: '초기 답변' },
            { role: 'user', content: '다음 질문' },
            { role: 'assistant', content: '다음 답변' },
        ]);
    });
});
