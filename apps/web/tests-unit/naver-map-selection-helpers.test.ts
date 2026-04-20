import { describe, expect, test } from 'bun:test';

import { resolveNaverSelectionChange } from '../lib/naver-map-selection-helpers';

describe('naver map selection helpers', () => {
    test('detects changed selection ids', () => {
        expect(resolveNaverSelectionChange({
            currentSelectedId: 'r1',
            previousSelectedId: null,
        })).toEqual({
            isSelectionChanged: true,
            nextSelectedId: 'r1',
        });
    });

    test('detects unchanged selection ids', () => {
        expect(resolveNaverSelectionChange({
            currentSelectedId: 'r1',
            previousSelectedId: 'r1',
        })).toEqual({
            isSelectionChanged: false,
            nextSelectedId: 'r1',
        });
    });
});
