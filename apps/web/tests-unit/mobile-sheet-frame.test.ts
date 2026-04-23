import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    MOBILE_COMPACT_FORM_SHEET,
    MOBILE_FULL_FORM_SHEET,
    MobileSheetHeader,
    MobileSheetStepIndicator,
} from '../components/ui/mobile-sheet-frame';

describe('mobile sheet frame presets', () => {
    test('full form preset keeps long mobile forms locked to full height', () => {
        expect(MOBILE_FULL_FORM_SHEET).toEqual({
            defaultHeight: 100,
            minHeight: 100,
            maxHeight: 100,
            showHandle: false,
            enablePeek: false,
            hideBottomNavWhenOpen: true,
        });
    });

    test('compact form preset keeps peek affordance for short flows', () => {
        expect(MOBILE_COMPACT_FORM_SHEET).toEqual({
            defaultHeight: 78,
            minHeight: 64,
            maxHeight: 92,
            showHandle: true,
            enablePeek: true,
            hideBottomNavWhenOpen: true,
        });
    });
});

describe('MobileSheetHeader', () => {
    test('renders ids, child meta content, and action slot for accessible sticky headers', () => {
        const html = renderToStaticMarkup(
            createElement(
                MobileSheetHeader,
                {
                    title: '리뷰 작성',
                    description: '3단계로 나눠 쉽게 작성해요.',
                    titleId: 'review-sheet-title',
                    descriptionId: 'review-sheet-description',
                    action: createElement('button', { type: 'button' }, '닫기'),
                },
                createElement('p', null, '자동 저장됨')
            )
        );

        expect(html).toContain('id="review-sheet-title"');
        expect(html).toContain('id="review-sheet-description"');
        expect(html).toContain('리뷰 작성');
        expect(html).toContain('3단계로 나눠 쉽게 작성해요.');
        expect(html).toContain('자동 저장됨');
        expect(html).toContain('닫기');
    });

    test('uses the compact title treatment when compact mode is enabled', () => {
        const html = renderToStaticMarkup(
            createElement(MobileSheetHeader, {
                title: '닉네임 설정',
                compact: true,
            })
        );

        expect(html).toContain('text-lg font-semibold');
        expect(html).not.toContain('text-2xl font-bold');
    });
});

describe('MobileSheetStepIndicator', () => {
    test('marks the current step and keeps the progress list labelled', () => {
        const html = renderToStaticMarkup(
            createElement(MobileSheetStepIndicator, {
                steps: [
                    { id: 1, label: '인증' },
                    { id: 2, label: '방문 정보' },
                    { id: 3, label: '리뷰' },
                ],
                currentStep: 2,
                className: 'grid-cols-3',
            })
        );

        expect(html).toContain('aria-label="진행 단계"');
        expect(html).toContain('aria-current="step"');
        expect(html).toContain('인증');
        expect(html).toContain('방문 정보');
        expect(html).toContain('리뷰');
        expect(html).toContain('grid-cols-3');
        expect(html).toContain('✓');
    });
});
