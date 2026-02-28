import { describe, expect, test } from 'bun:test';

import {
    parseInsightChatStreamLine,
    type InsightChatStreamState,
} from '@/lib/insight/insight-chat-stream';

describe('insight chat stream parser', () => {
    test('accumulates text payloads from SSE lines', () => {
        const state: InsightChatStreamState = { accumulated: '', streamError: null };

        const next = parseInsightChatStreamLine('data: {"text":"안녕","requestId":"req-1"}', state, (token) => {
            expect(token).toBe('안녕');
        });

        expect(next.accumulated).toBe('안녕');
        expect(next.requestId).toBe('req-1');
        expect(next.streamError).toBeNull();
    });

    test('keeps latest text appended in a chain', () => {
        let output = '';
        let state: InsightChatStreamState = { accumulated: '', streamError: null };

        state = parseInsightChatStreamLine('data: {"text":"hello"}', state, (token) => {
            output += token;
        });
        state = parseInsightChatStreamLine('data: {"text":" world"}', state, (token) => {
            output += token;
        });
        state = parseInsightChatStreamLine('data: [DONE]', state, () => {
            throw new Error('should not call onToken for DONE');
        });

        expect(state.accumulated).toBe('hello world');
        expect(output).toBe('hello world');
    });

    test('collects deduplicated toolTrace from stream messages', () => {
        let output = '';
        const startState: InsightChatStreamState = { accumulated: '', streamError: null, toolTrace: ['route:start'] };

        const next = parseInsightChatStreamLine('data: {"text":"안녕","toolTrace":"route:openai"}', startState, (token) => {
            output += token;
        });
        const nextWithArray = parseInsightChatStreamLine('data: {"text":"!","toolTrace":["route:openai","provider:openai"]}', next, (token) => {
            output += token;
        });

        expect(output).toBe('안녕!');
        expect(nextWithArray.toolTrace).toEqual(['route:start', 'route:openai', 'provider:openai']);
    });

    test('records stream error and ignores subsequent tokens', () => {
        let onTokenCalls = 0;
        const state: InsightChatStreamState = { accumulated: '', streamError: null };
        const next = parseInsightChatStreamLine('data: {"error":"llm_unavailable"}', state, () => {
            onTokenCalls += 1;
        });

        expect(next.streamError).toBe('llm_unavailable');
        expect(onTokenCalls).toBe(0);
    });

    test('keeps toolTrace from stream error payload', () => {
        const next = parseInsightChatStreamLine('data: {"error":"stream_error","toolTrace":["route:stream","provider:gemini"],"requestId":"req-stream"}', {
            accumulated: '',
            streamError: null,
        }, () => {
            throw new Error('should not emit token');
        });

        expect(next.streamError).toBe('stream_error');
        expect(next.requestId).toBe('req-stream');
        expect(next.toolTrace).toEqual(['route:stream', 'provider:gemini']);
    });

    test('tracks requestId from stream error payload', () => {
        const state: InsightChatStreamState = { accumulated: '', streamError: null };
        const next = parseInsightChatStreamLine('data: {"error":"stream_error","requestId":"req-edit-test","cancellationReason":"request_cancelled"}', state, () => {
            throw new Error('should not emit token');
        });

        expect(next.streamError).toBe('stream_error');
        expect(next.cancellationReason).toBe('request_cancelled');
        expect(next.requestId).toBe('req-edit-test');
    });

    test('ignores malformed lines or non-data rows', () => {
        const state: InsightChatStreamState = { accumulated: '', streamError: null };
        const ignored = parseInsightChatStreamLine('not-data-line', state, () => {
            throw new Error('should not process');
        });
        const malformed = parseInsightChatStreamLine('data: {"text":"broken"', state, () => {
            throw new Error('should not process malformed');
        });
        const noPrefix = parseInsightChatStreamLine('hello', state, () => {
            throw new Error('should not process');
        });

        expect(ignored).toEqual(state);
        expect(malformed).toEqual(state);
        expect(noPrefix).toEqual(state);
    });
});
