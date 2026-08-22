import { describe, expect, test } from 'bun:test';
import { resolveR2PublicBase, resolveR2PublicObjectUrl } from '@/lib/r2-public-url';

describe('r2 public url', () => {
  test('accepts cloudflare-issued r2.dev origins only', () => {
    const env = {
      NEXT_PUBLIC_R2_PUBLIC_BASE: 'https://pub-966471b3a9f0473ab2d25f21066c3605.r2.dev',
    };
    expect(resolveR2PublicBase(env)).toBe(
      'https://pub-966471b3a9f0473ab2d25f21066c3605.r2.dev',
    );
    expect(
      resolveR2PublicObjectUrl('data-plane/inventory-receipt.json', env),
    ).toBe(
      'https://pub-966471b3a9f0473ab2d25f21066c3605.r2.dev/data-plane/inventory-receipt.json',
    );
  });

  test('rejects invented hostnames and path traversal', () => {
    expect(
      resolveR2PublicBase({
        NEXT_PUBLIC_R2_PUBLIC_BASE: 'https://r2.tzudong.app',
      }),
    ).toBeNull();
    expect(
      resolveR2PublicObjectUrl('../secret', {
        NEXT_PUBLIC_R2_PUBLIC_BASE:
          'https://pub-966471b3a9f0473ab2d25f21066c3605.r2.dev',
      }),
    ).toBeNull();
  });
});
