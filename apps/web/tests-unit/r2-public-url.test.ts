import { describe, expect, test } from 'bun:test';
import { resolveR2PublicBase, resolveR2PublicObjectUrl } from '@/lib/r2-public-url';

describe('r2 public url', () => {
  test('accepts cloudflare-issued development origins', () => {
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

  test('accepts the verified production origin without admitting sibling hosts or credentials', () => {
    const env = { NEXT_PUBLIC_R2_PUBLIC_BASE: 'https://assets.tzudong.app' };
    expect(resolveR2PublicObjectUrl('public/font.otf', env)).toBe('https://assets.tzudong.app/public/font.otf');
    for (const value of ['https://assets.tzudong.app.example.org', 'https://assets.tzudong.app:444', 'https://user@assets.tzudong.app', 'http://assets.tzudong.app', 'https://assets.tzudong.app/private']) {
      expect(resolveR2PublicBase({ NEXT_PUBLIC_R2_PUBLIC_BASE: value })).toBeNull();
    }
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
