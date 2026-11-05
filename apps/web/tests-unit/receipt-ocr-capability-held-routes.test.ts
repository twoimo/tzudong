import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('receipt OCR credential-release readiness responses', () => {
  test('preflights the dedicated capability before claim, quota, or provider work', () => {
    const durable = source('lib/ocr/durable-result.ts');
    const execute = durable.slice(durable.indexOf('export async function executeDurableReceiptOcr'));

    expect(execute.indexOf('await input.store.assertDefinitiveCredentialReleaseReady()'))
      .toBeLessThan(execute.indexOf('const claim = await input.store.claim'));
    expect(execute.indexOf('await input.store.assertDefinitiveCredentialReleaseReady()'))
      .toBeLessThan(execute.indexOf('await input.beforeProvider?.()'));
    expect(execute.indexOf('await input.store.assertDefinitiveCredentialReleaseReady()'))
      .toBeLessThan(execute.indexOf('await input.store.markDispatched'));
  });

  test('maps capability held to fixed no-store HTTP 503 before generic OCR failures', () => {
    const route = source('app/api/ocr/extract/route.ts');
    const catchBlock = route.slice(route.indexOf('} catch (error: unknown)'));
    const held = catchBlock.indexOf('error instanceof DurableReceiptOcrCapabilityHeldError');

    expect(held).toBeGreaterThanOrEqual(0);
    expect(held).toBeLessThan(catchBlock.indexOf('error instanceof DurableReceiptOcrPendingError'));
    expect(held).toBeLessThan(catchBlock.indexOf("const failureCode = error instanceof GeminiOcrError"));
    expect(catchBlock).toContain('{ code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE }');
    expect(catchBlock).toContain("{ status: 503, headers: { 'Cache-Control': 'no-store' } }");
  });

  test('maps capability held to one terminal SSE 503 without provider diagnostics', () => {
    const route = source('app/api/ocr/extract/stream/route.ts');
    const catchBlock = route.slice(route.lastIndexOf('} catch (error)'));
    const held = catchBlock.indexOf('error instanceof DurableReceiptOcrCapabilityHeldError');

    expect(held).toBeGreaterThanOrEqual(0);
    expect(held).toBeLessThan(catchBlock.indexOf('error instanceof DurableReceiptOcrPendingError'));
    expect(catchBlock).toContain('code: FEATURE_DATABASE_HELD_CODE');
    expect(catchBlock).toContain('message: FEATURE_DATABASE_HELD_MESSAGE');
    expect(catchBlock).toContain('terminal: true');
    expect(catchBlock).toContain('status: 503');
  });

  test('maps admin processing capability held to the same fixed 503 contract', () => {
    const processor = source('lib/ocr/admin-receipt-processor.ts');
    const catchBlock = processor.slice(processor.lastIndexOf('} catch (error)'));
    const held = catchBlock.indexOf('error instanceof DurableReceiptOcrCapabilityHeldError');

    expect(held).toBeGreaterThanOrEqual(0);
    expect(held).toBeLessThan(catchBlock.indexOf('error instanceof DurableReceiptOcrPersistenceError'));
    expect(catchBlock).toContain('{ code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE }');
    expect(catchBlock).toContain('{ status: 503 }');
  });
});
