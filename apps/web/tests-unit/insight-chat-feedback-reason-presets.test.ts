import { describe, expect, test } from 'bun:test';

import {
    getFeedbackReasonPresetState,
    getFeedbackReasonPresets,
} from '@/components/insight/InsightChatSection';

describe('insight chat feedback reason presets', () => {
    test('exposes presets for positive feedback', () => {
        expect(getFeedbackReasonPresets('up')).toEqual([
            { value: '정확하고 신뢰할 만해요', label: '정확하고 신뢰할 만해요' },
            { value: '질문 맥락에 잘 맞아요', label: '질문 맥락에 잘 맞아요' },
            { value: '설명이 충분하고 명확해요', label: '설명이 충분하고 명확해요' },
            { value: '톤이 적절해요', label: '톤이 적절해요' },
            { value: '답변이 빠르고 유용해요', label: '답변이 빠르고 유용해요' },
            { value: '기타', label: '기타' },
        ]);
    });

    test('exposes presets for negative feedback', () => {
        expect(getFeedbackReasonPresets('down')).toEqual([
            { value: '정확하지 않아요', label: '정확하지 않아요' },
            { value: '관련성이 낮아요', label: '관련성이 낮아요' },
            { value: '정보가 부족해요', label: '정보가 부족해요' },
            { value: '톤이 부적절해요', label: '톤이 부적절해요' },
            { value: '응답이 느려요', label: '응답이 느려요' },
            { value: '기타', label: '기타' },
        ]);
    });

    test('returns no presets when rating is not set', () => {
        expect(getFeedbackReasonPresets()).toEqual([]);
    });

    test('tracks selected preset based on current reason', () => {
        const selected = getFeedbackReasonPresetState({
            rating: 'down',
            reason: '  관련성이 낮아요 ',
        });
        expect(selected).toEqual({
            presets: [
                { value: '정확하지 않아요', label: '정확하지 않아요' },
                { value: '관련성이 낮아요', label: '관련성이 낮아요' },
                { value: '정보가 부족해요', label: '정보가 부족해요' },
                { value: '톤이 부적절해요', label: '톤이 부적절해요' },
                { value: '응답이 느려요', label: '응답이 느려요' },
                { value: '기타', label: '기타' },
            ],
            selectedPreset: '관련성이 낮아요',
        });
    });
});
