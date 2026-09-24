import { describe, expect, test } from 'bun:test';
import { snapHeaderHideProgress } from '../lib/mobile-sheet-layout';

describe('mobile sheet header progress', () => {
    test('keeps the header in place until the sheet is fully expanded', () => {
        expect(snapHeaderHideProgress(0)).toBe(0);
        expect(snapHeaderHideProgress(0.5)).toBe(0);
        expect(snapHeaderHideProgress(0.998)).toBe(0);
        expect(snapHeaderHideProgress(1)).toBe(1);
        expect(snapHeaderHideProgress(2)).toBe(1);
    });
});
