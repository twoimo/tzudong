import { describe, expect, test } from 'bun:test';

import { parseInsightChatRequestBody } from '@/lib/insight/insight-chat-request';

describe('insight chat request parser', () => {
    test('defaults message and requestId when body is missing', () => {
        expect(parseInsightChatRequestBody(null)).toEqual({
            message: '',
            requestId: undefined,
            llmConfig: undefined,
        });
    });

    test('trims and truncates requestId to 64 chars', () => {
        const parsed = parseInsightChatRequestBody({
            message: '안녕',
            requestId: `  ${'x'.repeat(80)}  `,
        });
        expect(parsed.requestId).toBe('x'.repeat(64));
    });

    test('rejects unsupported llm provider values', () => {
        expect(
            parseInsightChatRequestBody({
                message: '안녕',
                requestId: 'req-1',
                provider: 'unsupported',
                model: 'gpt-4',
            }).llmConfig,
        ).toBeUndefined();
    });

    test('infers server key usage for gemini when apiKey is omitted', () => {
        const parsed = parseInsightChatRequestBody({
            message: '안녕',
            provider: 'gemini',
            model: 'gemini-3-flash-preview',
        });
        expect(parsed.llmConfig).toMatchObject({
            provider: 'gemini',
            model: 'gemini-3-flash-preview',
            useServerKey: true,
        });
    });

    test('accepts allow-listed storyboard and image profile fields', () => {
        const parsed = parseInsightChatRequestBody({
            message: '안녕',
            provider: 'openai',
            model: 'gpt-4o-mini',
            storyboardModelProfile: 'nanobanana',
            imageModelProfile: 'nanobanana_pro',
        });

        expect(parsed.llmConfig).toMatchObject({
            provider: 'openai',
            model: 'gpt-4o-mini',
            storyboardModelProfile: 'nanobanana',
            imageModelProfile: 'nanobanana_pro',
        });
    });

    test('normalizes unsupported storyboard and image profiles out', () => {
        const parsed = parseInsightChatRequestBody({
            message: '안녕',
            provider: 'anthropic',
            model: 'claude-opus-4-6',
            storyboardModelProfile: 'unknown-profile',
            imageModelProfile: 7,
        });

        expect(parsed.llmConfig).toMatchObject({
            provider: 'anthropic',
            model: 'claude-opus-4-6',
        });
        expect(parsed.llmConfig?.storyboardModelProfile).toBeUndefined();
        expect(parsed.llmConfig?.imageModelProfile).toBeUndefined();
    });
});
