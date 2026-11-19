import { normalizeReceiptOcrData, type ReceiptOcrData } from '@/lib/ocr/types';
import { sanitizePrivacyValue } from '@/lib/privacy/sanitize';
import type { RecognizedTextLine } from './types';

const DATE_REGEX = /\b(20\d{2})[-./년\s]+(0?[1-9]|1[0-2])[-./월\s]+(0?[1-9]|[12]\d|3[01])(?:일)?\b/;
const TIME_REGEX = /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/;

const TOTAL_KEYWORDS = [
  '합계',
  '결제금액',
  '받을금액',
  '총액',
  '합 계',
  '총 금액',
  '결제 금액',
  '승인금액',
  'total',
];

const STORE_NAME_PREFIXES = [
  '상호명',
  '가맹점명',
  '가맹점',
  '상호',
  '매장명',
  '점포명',
];

const METADATA_EXCLUSION_PATTERNS = [
  /영\s*수\s*증/,
  /매\s*출\s*전\s*표/,
  /신\s*용\s*카\s*드/,
  /고\s*객\s*용/,
  /가\cb맹\s*점\s*용/,
  /재\s*발\s*행/,
  /사업자\s*등록번호/,
  /주문번호/,
  /승인번호/,
  /카드번호/,
  /단말기번호/,
  /테이블/,
  /pos/i,
];

function sanitizeExtractedText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = sanitizePrivacyValue(value).value;
  if (typeof sanitized !== 'string') return undefined;
  const trimmed = sanitized.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseDate(lines: RecognizedTextLine[]): { date?: string; confidence?: number } {
  // Prefer lines with transaction labels
  let bestMatch: { date: string; confidence?: number; score: number } | null = null;

  for (const line of lines) {
    const match = DATE_REGEX.exec(line.text);
    if (!match) continue;

    const year = match[1];
    const month = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');
    const formatted = `${year}-${month}-${day}`;

    let score = 1;
    if (/일시|거래|승인|결제|매출/.test(line.text)) score += 2;
    if (TIME_REGEX.test(line.text)) score += 1;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { date: formatted, confidence: line.confidence, score };
    }
  }

  return bestMatch ? { date: bestMatch.date, confidence: bestMatch.confidence } : {};
}

function parseTime(lines: RecognizedTextLine[]): { time?: string; confidence?: number } {
  let bestMatch: { time: string; confidence?: number; score: number } | null = null;

  for (const line of lines) {
    const match = TIME_REGEX.exec(line.text);
    if (!match) continue;

    const hour = match[1].padStart(2, '0');
    const minute = match[2];
    const formatted = `${hour}:${minute}`;

    let score = 1;
    if (DATE_REGEX.test(line.text)) score += 2;
    if (/일시|시간|거래|승인/.test(line.text)) score += 1;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { time: formatted, confidence: line.confidence, score };
    }
  }

  return bestMatch ? { time: bestMatch.time, confidence: bestMatch.confidence } : {};
}

function parseTotalAmount(lines: RecognizedTextLine[]): { total_amount?: number; confidence?: number } {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.text.toLowerCase();
    const hasKeyword = TOTAL_KEYWORDS.some((kw) => lower.includes(kw));

    if (!hasKeyword) continue;

    // Look for amount in the same line after keyword
    const sameLineNumbers = line.text
      .replace(/[^0-9\s,]/g, ' ')
      .trim()
      .split(/\s+/)
      .map((s) => Number(s.replace(/,/g, '')))
      .filter((n) => Number.isFinite(n) && n >= 100 && n <= 100_000_000);

    if (sameLineNumbers.length > 0) {
      const amount = sameLineNumbers[sameLineNumbers.length - 1];
      return { total_amount: amount, confidence: line.confidence };
    }

    // Or in immediately following line
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const nextNumbers = nextLine.text
        .replace(/[^0-9\s,]/g, ' ')
        .trim()
        .split(/\s+/)
        .map((s) => Number(s.replace(/,/g, '')))
        .filter((n) => Number.isFinite(n) && n >= 100 && n <= 100_000_000);

      if (nextNumbers.length === 1) {
        return { total_amount: nextNumbers[0], confidence: nextLine.confidence };
      }
    }
  }

  return {};
}

function parseStoreName(lines: RecognizedTextLine[]): { store_name?: string; confidence?: number } {
  for (const line of lines) {
    const text = line.text.trim();
    for (const prefix of STORE_NAME_PREFIXES) {
      const pattern = new RegExp(`^${prefix}\\s*[:：\\s]\\s*(.+)`, 'i');
      const match = pattern.exec(text);
      if (match && match[1]) {
        const candidate = match[1].replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();
        if (candidate.length >= 2 && candidate.length <= 64) {
          const isMetadata = METADATA_EXCLUSION_PATTERNS.some((p) => p.test(candidate));
          if (!isMetadata) {
            return { store_name: candidate, confidence: line.confidence };
          }
        }
      }
    }
  }

  // Conservative: do not guess arbitrary lines as store name if not explicitly labeled.
  return {};
}

export function parseReceiptLinesDeterministically(lines: RecognizedTextLine[]): ReceiptOcrData {
  if (!lines || lines.length === 0) {
    return {
      error: 'EMPTY_INPUT',
      confidence: 0,
    };
  }

  const { date, confidence: dateConf } = parseDate(lines);
  const { time, confidence: timeConf } = parseTime(lines);
  const { total_amount, confidence: totalConf } = parseTotalAmount(lines);
  const { store_name, confidence: storeConf } = parseStoreName(lines);

  const matchedConfidences = [dateConf, timeConf, totalConf, storeConf].filter(
    (c): c is number => typeof c === 'number' && Number.isFinite(c),
  );

  const avgConfidence = matchedConfidences.length > 0
    ? Math.round((matchedConfidences.reduce((a, b) => a + b, 0) / matchedConfidences.length) * 100) / 100
    : 0.1;

  const rawCandidate: Record<string, unknown> = {
    date: sanitizeExtractedText(date),
    time: sanitizeExtractedText(time),
    total_amount,
    store_name: sanitizeExtractedText(store_name),
    confidence: avgConfidence,
  };

  const normalized = normalizeReceiptOcrData(rawCandidate);

  // Final privacy assertion: no raw sensitive values (RRN, phone, card, token) in output
  const privacySanitized = sanitizePrivacyValue(normalized).value as ReceiptOcrData;

  return privacySanitized;
}
