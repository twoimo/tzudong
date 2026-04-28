import { describe, expect, test } from 'bun:test';
import {
  createOcrRequestToken,
  getReceiptFileKey,
  isCurrentOcrRequest,
  shouldApplyOcrPatch,
} from '../lib/ocr/review-ocr-request-guard';

function makeFile(name: string, sizeSeed: string, lastModified: number) {
  return new File([sizeSeed], name, { type: 'image/jpeg', lastModified });
}

describe('review OCR request guard', () => {
  test('builds a deterministic receipt key from file metadata', () => {
    const file = makeFile('receipt.jpg', 'abc', 1234);
    expect(getReceiptFileKey(file)).toBe('receipt.jpg:3:1234');
    expect(getReceiptFileKey(null)).toBeNull();
  });

  test('rejects stale request ids even when the receipt metadata matches', () => {
    const file = makeFile('receipt.jpg', 'abc', 1234);
    const stale = createOcrRequestToken(file, 1);
    const current = createOcrRequestToken(file, 2);

    expect(isCurrentOcrRequest(stale, current)).toBe(false);
    expect(shouldApplyOcrPatch(stale, current, file)).toBe(false);
  });

  test('rejects a previous receipt after the user selects a different file', () => {
    const first = makeFile('receipt-a.jpg', 'abc', 1234);
    const second = makeFile('receipt-b.jpg', 'abcdef', 5678);
    const token = createOcrRequestToken(first, 1);
    const current = createOcrRequestToken(second, 2);

    expect(shouldApplyOcrPatch(token, current, second)).toBe(false);
  });

  test('rejects patches after the receipt is removed', () => {
    const file = makeFile('receipt.jpg', 'abc', 1234);
    const token = createOcrRequestToken(file, 1);
    const removed = createOcrRequestToken(null, 2);

    expect(shouldApplyOcrPatch(token, removed, null)).toBe(false);
  });

  test('allows a patch only for the latest request and currently attached file', () => {
    const file = makeFile('receipt.jpg', 'abc', 1234);
    const token = createOcrRequestToken(file, 7);
    const current = createOcrRequestToken(file, 7);

    expect(shouldApplyOcrPatch(token, current, file)).toBe(true);
  });
});
