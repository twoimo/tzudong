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

    test('accepts sse data line without trailing whitespace after colon', () => {
        const state: InsightChatStreamState = { accumulated: '', streamError: null };
        let captured = '';

        const next = parseInsightChatStreamLine('data:{"text":"바로토큰","requestId":"req-no-space"}', state, (token) => {
            captured += token;
        });

        expect(captured).toBe('바로토큰');
        expect(next.accumulated).toBe('바로토큰');
        expect(next.requestId).toBe('req-no-space');
        expect(next.streamError).toBeNull();
    });

    test('accepts sse lines with whitespace and CRLF formatting', () => {
        const state: InsightChatStreamState = { accumulated: '', streamError: null };
        let captured = '';

        const next = parseInsightChatStreamLine('  data: { "text":"줄바꿈", "requestId":"req-whitespace" }\r', state, (token) => {
            captured += token;
        });

        expect(captured).toBe('줄바꿈');
        expect(next.accumulated).toBe('줄바꿈');
        expect(next.requestId).toBe('req-whitespace');
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

    test('ignores [DONE] frames with CRLF-style endings', () => {
        const state: InsightChatStreamState = { accumulated: '', streamError: null };
        const next = parseInsightChatStreamLine('data: [DONE]\r', state, () => {
            throw new Error('should not emit on DONE');
        });

        expect(next).toEqual(state);
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

        const afterError = parseInsightChatStreamLine('data: {"text":"should-be-ignored"}', next, () => {
            onTokenCalls += 1;
        });

        expect(next.streamError).toBe('llm_unavailable');
        expect(afterError.accumulated).toBe('');
        expect(onTokenCalls).toBe(0);
    });

    test('tracks cancellationReason for stream error payload and preserves prior tokens', () => {
        let output = '';
        let state: InsightChatStreamState = { accumulated: '', streamError: null };

        state = parseInsightChatStreamLine('data: {"text":"안녕"}', state, (token) => {
            output += token;
        });
        const next = parseInsightChatStreamLine(
            'data: {"error":"stream_error","requestId":"req-cancel","cancellationReason":"request_cancelled","toolTrace":"route:stream > provider:gemini"}',
            state,
            () => {
                throw new Error('should not emit token');
            },
        );

        expect(output).toBe('안녕');
        expect(next.accumulated).toBe('안녕');
        expect(next.cancellationReason).toBe('request_cancelled');
        expect(next.requestId).toBe('req-cancel');
        expect(next.toolTrace).toEqual(['route:stream', 'provider:gemini']);
        expect(next.streamError).toBe('stream_error');
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

    test('treats metadata-only frames as no-data and updates state without errors', () => {
        let captured = '';
        const next = parseInsightChatStreamLine(
            'data: {"toolTrace":["route:stream",  "provider:openai", "memoryMode:session"],"requestId":"req-meta"}',
            {
                accumulated: 'prefix',
                streamError: null,
                toolTrace: ['route:chat'],
            },
            (token) => {
                captured += token;
            },
        );

        expect(captured).toBe('');
        expect(next.streamError).toBeNull();
        expect(next.requestId).toBe('req-meta');
        expect(next.accumulated).toBe('prefix');
        expect(next.toolTrace).toEqual(['route:chat', 'route:stream', 'provider:openai', 'memoryMode:session']);
    });

    test('splits toolTrace string payloads emitted as provider trace labels', () => {
        const next = parseInsightChatStreamLine('data: {"text":"","toolTrace":"route:stream > provider:openai > memoryMode:session"}', {
            accumulated: '',
            streamError: null,
        }, () => {
            throw new Error('should not emit token');
        });

        expect(next.toolTrace).toEqual(['route:stream', 'provider:openai', 'memoryMode:session']);
    });

    test('parses no-data heartbeat frames without mutating accumulated text', () => {
        const state: InsightChatStreamState = { accumulated: '', streamError: null };
        const next = parseInsightChatStreamLine('data: {"text":"","requestId":"req-heartbeat","toolTrace":"memoryMode:session"}', state, () => {
            throw new Error('should not emit');
        });

        expect(next.accumulated).toEqual('');
        expect(next.requestId).toBe('req-heartbeat');
        expect(next.streamError).toBeNull();
        expect(next.toolTrace).toEqual(['memoryMode:session']);
    });

    test('drops malformed toolTrace values and preserves whitespace-trimmed entries', () => {
        const next = parseInsightChatStreamLine('data: {"text":"","toolTrace":["  route:stream ", 42, "", "provider:openai"]}', {
            accumulated: '',
            streamError: null,
        }, () => {
            throw new Error('should not emit token');
        });

        expect(next.toolTrace).toEqual(['route:stream', 'provider:openai']);
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
