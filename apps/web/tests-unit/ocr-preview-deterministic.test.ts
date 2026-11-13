import { describe, expect, test } from 'bun:test';
import { parseReceiptLinesDeterministically } from '../lib/ocr/preview/deterministic-parser';

describe('OCR preview conservative deterministic parsing', () => {
  test('returns empty input error when no lines are provided', () => {
    const parsed = parseReceiptLinesDeterministically([]);
    expect(parsed.error).toBe('EMPTY_INPUT');
    expect(parsed.confidence).toBe(0);
  });

  test('extracts exact date, time, and total from labeled receipt lines', () => {
    const lines = [
      { text: '[영수증] (고객용)', confidence: 0.99 },
      { text: '상호: 맛있는 찌개마을', confidence: 0.95 },
      { text: '사업자번호: 123-45-67890', confidence: 0.9 },
      { text: '거래일시: 2026-10-25 13:45:10', confidence: 0.98 },
      { text: '김치찌개 9,000', confidence: 0.92 },
      { text: '공기밥 1,000', confidence: 0.88 },
      { text: '합계금액 10,000원', confidence: 0.96 },
      { text: '카드번호: 5424-****-****-1234', confidence: 0.95 },
    ];

    const result = parseReceiptLinesDeterministically(lines);

    expect(result.date).toBe('2026-10-25');
    expect(result.time).toBe('13:45');
    expect(result.total_amount).toBe(10000);
    expect(result.store_name).toBe('맛있는 찌개마을');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  test('leaves store name and items unknown when lines lack recognizable labels rather than guessing', () => {
    const lines = [
      { text: '2026/08/15 20:30', confidence: 0.85 },
      { text: '불분명한 상단 문구', confidence: 0.4 },
      { text: '금액 25,000', confidence: 0.9 },
      { text: '총결제금액: 25,000원', confidence: 0.95 },
    ];

    const result = parseReceiptLinesDeterministically(lines);

    expect(result.date).toBe('2026-08-15');
    expect(result.time).toBe('20:30');
    expect(result.total_amount).toBe(25000);
    expect(result.store_name).toBeUndefined();
    expect(result.items).toBeUndefined();
  });

  test('normalizes Korean date and time variants reliably', () => {
    const lines = [
      { text: '매출일자: 2026년 3월 5일', confidence: 0.9 },
      { text: '시간 9:05', confidence: 0.85 },
      { text: '받을금액 4,500', confidence: 0.92 },
    ];

    const result = parseReceiptLinesDeterministically(lines);

    expect(result.date).toBe('2026-03-05');
    expect(result.time).toBe('09:05');
    expect(result.total_amount).toBe(4500);
  });

  test('redacts sensitive PII from store name if personal info like phone numbers appear', () => {
    const lines = [
      { text: '가맹점: 홍길동 010-1234-5678', confidence: 0.9 },
      { text: '승인일시: 2026-05-01 12:00', confidence: 0.9 },
      { text: '합계: 15,000', confidence: 0.9 },
    ];

    const result = parseReceiptLinesDeterministically(lines);
    expect(result.date).toBe('2026-05-01');
    expect(result.time).toBe('12:00');
    expect(result.total_amount).toBe(15000);
    // Any phone number must be redacted or sanitized
    expect(result.store_name).not.toContain('010-1234-5678');
  });
});
