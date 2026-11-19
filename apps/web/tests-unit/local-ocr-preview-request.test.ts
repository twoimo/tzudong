import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLocalOcrPreviewEnabled, parseLocalOcrPreviewRequest } from '../lib/ocr/local-preview-request';

const source = (file: string) => readFileSync(join(import.meta.dir, '..', file), 'utf8');
const image = { imageBase64: Buffer.from('synthetic').toString('base64'), mimeType: 'image/png' };

describe('local receipt preview request contract', () => {
  test('defaults closed, requires exact local opt-in and never enables on hosted Linux', () => {
    expect(isLocalOcrPreviewEnabled({}, 'darwin')).toBe(false);
    expect(isLocalOcrPreviewEnabled({ OCR_PREVIEW_LOCAL_ENABLED: 'true' }, 'darwin')).toBe(true);
    expect(isLocalOcrPreviewEnabled({ OCR_PREVIEW_LOCAL_ENABLED: 'true' }, 'linux')).toBe(false);
    expect(isLocalOcrPreviewEnabled({ OCR_PREVIEW_LOCAL_ENABLED: '1' }, 'darwin')).toBe(false);
  });
  test('accepts bounded canonical base64 but no provider/cost switches or URLs', () => {
    expect(parseLocalOcrPreviewRequest(image)?.bytes.toString()).toBe('synthetic');
    for (const value of [null, {}, { ...image, provider: 'openai' }, { ...image, costPolicy: { allowPaidCloud: true } },
      { ...image, imageBase64: 'https://example.org/private.png' }, { ...image, imageBase64: 'eA===' },
      { ...image, imageBase64: 'eB==' }, { ...image, mimeType: 'image/svg+xml' },
      { ...image, imageBase64: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64') }]) {
      expect(parseLocalOcrPreviewRequest(value)).toBeNull();
    }
  });
  test('auth precedes origin, opt-in, bounded read, signature/pixel canonicalization and OCR', () => {
    const route = source('app/api/admin/ocr-receipts/preview/route.ts');
    const post = route.slice(route.indexOf('export async function POST'));
    const ordered = ['await requireAdmin()', 'isTrustedSameOriginMutation(request)', 'isLocalOcrPreviewEnabled()',
      'readBoundedJsonRequest(request, LOCAL_OCR_PREVIEW_MAX_REQUEST_BYTES)', 'parseLocalOcrPreviewRequest(body.value)',
      'canonicalizeReceiptImage(input.bytes, input.mimeType)', 'await previewReceiptOcr('];
    for (let i = 1; i < ordered.length; i++) expect(post.indexOf(ordered[i])).toBeGreaterThan(post.indexOf(ordered[i - 1]));
    expect(route).toContain("provider: 'local'");
    expect(route).toContain("'Cache-Control': 'no-store, max-age=0'");
    expect(route).toContain('finally');
    expect(route).not.toMatch(/request\.(?:json|text)\(|console\.|createSupabaseServiceRoleClient|\.from\(/);
  });
  test('preview UI is ephemeral and cannot claim review verification', () => {
    const ui = source('components/admin/LocalReceiptOcrPreview.tsx');
    expect(ui).toContain('manualReviewRequired !== true');
    expect(ui).toContain('body.cloudCalls !== 0');
    expect(ui).toContain('영수증 인증에 반영되지 않습니다');
    expect(ui).toContain('active.current?.abort()');
    expect(ui).not.toMatch(/localStorage|sessionStorage|console\.|createObjectURL/);
  });
});
