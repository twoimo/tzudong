import { describe, expect, test } from 'bun:test';
import { canDiscardReceiptReplacement } from '../lib/ocr/receipt-replacement-reconciliation';

describe('OCR replacement after concurrent writes', () => {
    test('discards a losing replacement when a competing request has won or the row was deleted', () => {
        expect(canDiscardReceiptReplacement(true, false, { id: 'review', verification_photo: 'winner' }, 'review', 'loser')).toBe(true);
        expect(canDiscardReceiptReplacement(true, false, null, 'review', 'loser')).toBe(true);
    });
    test('retains the replacement on committed readback, missing CAS acknowledgement, or failed read', () => {
        expect(canDiscardReceiptReplacement(true, false, { id: 'review', verification_photo: 'new' }, 'review', 'new')).toBe(false);
        expect(canDiscardReceiptReplacement(false, false, { id: 'review', verification_photo: 'old' }, 'review', 'new')).toBe(false);
        expect(canDiscardReceiptReplacement(true, true, null, 'review', 'new')).toBe(false);
    });
    test('refuses unrelated or malformed readback instead of treating it as absence', () => {
        for (const value of [undefined, [], { id: 'other', verification_photo: 'old' }, { id: 'review' }, { id: 'review', verification_photo: 1 }]) {
            expect(canDiscardReceiptReplacement(true, false, value, 'review', 'new')).toBe(false);
        }
    });
});
