import { describe, expect, test } from 'bun:test';
import nextConfig, {
  buildImageRemotePatterns,
  getValidatedSupabaseImageOrigin,
  shouldAllowLoopbackImageUpstreams,
} from '../next.config.mjs';
import { resolveConfiguredSupabaseOrigin } from '../lib/profile-avatar-url.ts';

const SUPABASE_ORIGIN = 'https://project-ref.supabase.co';

describe('Next image optimizer trust boundary', () => {
  test('allows only purpose-scoped Supabase buckets and fixed image hosts', () => {
    expect(buildImageRemotePatterns(SUPABASE_ORIGIN)).toEqual([
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/a/**',
      },
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
        port: '',
        pathname: '/vi/**',
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
        port: '',
        pathname: '/vi/**',
      },
      {
        protocol: 'https',
        hostname: 'project-ref.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/profile-avatars/**',
      },
      {
        protocol: 'https',
        hostname: 'project-ref.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/review-photos/**',
      },
    ]);
  });

  test('rejects malformed and non-Supabase origins instead of extracting a hostname', () => {
    for (const value of [
      'https://tracker.example',
      'http://project-ref.supabase.co',
      'https://user:password@project-ref.supabase.co',
      'https://project-ref.supabase.co:443',
      'https://project-ref.supabase.co/storage/v1/object/public/profile-avatars',
      'https://project-ref.supabase.co?redirect=https://tracker.example',
      'https://project-ref.supabase.co#fragment',
      ' https://project-ref.supabase.co',
    ]) {
      expect(() => getValidatedSupabaseImageOrigin(value)).toThrow(
        'NEXT_PUBLIC_SUPABASE_URL must be a canonical HTTPS *.supabase.co origin',
      );
      expect(() => buildImageRemotePatterns(value)).toThrow();
      expect(resolveConfiguredSupabaseOrigin(value)).toBeNull();
    }

    expect(getValidatedSupabaseImageOrigin(`${SUPABASE_ORIGIN}/`)).toBe(SUPABASE_ORIGIN);
    expect(resolveConfiguredSupabaseOrigin(`${SUPABASE_ORIGIN}/`)).toBe(SUPABASE_ORIGIN);
  });

  test('disables SVG and local-IP optimizer exceptions', () => {
    expect(nextConfig.images?.dangerouslyAllowSVG).toBe(false);
    expect(nextConfig.images).not.toHaveProperty('dangerouslyAllowLocalIP');
  });

  test('enables the loopback optimizer exception only for the gated local stacks', () => {
    expect(
      shouldAllowLoopbackImageUpstreams({
        NODE_ENV: 'development',
        TZUDONG_LOCAL_SUPABASE_DEV: '1',
      }),
    ).toBe(true);
    expect(
      shouldAllowLoopbackImageUpstreams({
        NODE_ENV: 'test',
        NIGHTLY_LOCAL_ENV_ONLY: '1',
      }),
    ).toBe(true);

    for (const env of [
      { NODE_ENV: 'production', TZUDONG_LOCAL_SUPABASE_DEV: '1' },
      { NODE_ENV: 'production', NIGHTLY_LOCAL_ENV_ONLY: '1' },
      { NODE_ENV: 'development' },
      { NODE_ENV: 'test' },
      { NODE_ENV: 'test', TZUDONG_LOCAL_SUPABASE_DEV: '1' },
      { NODE_ENV: 'development', NIGHTLY_LOCAL_ENV_ONLY: '1' },
      {},
    ]) {
      expect(
        shouldAllowLoopbackImageUpstreams(env),
        JSON.stringify(env),
      ).toBe(false);
    }
  });
});
