import { describe, expect, test } from 'bun:test';

import {
    getChatComposerHintId,
    getChatComposerHintText,
    getChatComposerRows,
    getComposerHeightsForValues,
} from '@/components/insight/InsightChatSection';

describe('insight chat composer helpers', () => {
    test('returns stable composer hint copy and aria-describedby target', () => {
        expect(getChatComposerHintText()).toBe('Enter로 전송, Shift+Enter로 줄바꿈');
        expect(getChatComposerHintId()).toBe('insight-chat-composer-hint');
    });

    test('calculates composer row count with 1~6 clamp', () => {
        expect(getChatComposerRows('')).toBe(1);
        expect(getChatComposerRows('hello')).toBe(1);
        expect(getChatComposerRows('a\nb\nc\nd\ne\nf')).toBe(6);
        expect(getChatComposerRows('a\nb\nc\nd\ne\nf\ng')).toBe(6);
    });

    test('treats multi-line composer input with many lines as capped at max rows', () => {
        const multiLine = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join('\n');
        expect(getChatComposerRows(multiLine)).toBe(6);
    });

    test('derives composer pixel bounds from numeric dimensions and falls back for invalid values', () => {
        expect(getComposerHeightsForValues({
            lineHeightPx: 24,
            paddingTopPx: 8,
            paddingBottomPx: 10,
        })).toEqual({
            minPx: 42,
            maxPx: 162,
        });

        expect(getComposerHeightsForValues({
            lineHeightPx: NaN,
            paddingTopPx: NaN,
            paddingBottomPx: NaN,
        })).toEqual({
            minPx: 38,
            maxPx: 138,
        });
    });
});
