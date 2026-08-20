import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const webRoot = join(import.meta.dir, '..');
const source = (path: string) => readFileSync(join(webRoot, path), 'utf8');

function imagePolicySource() {
  const proxy = source('proxy.ts');
  const start = proxy.indexOf('const SUPABASE_IMAGE_PUBLIC_PATHS');
  const end = proxy.indexOf('"font-src \'self\' data:"');

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return proxy.slice(start, end);
}

describe('content-security-policy image source boundary', () => {
  test('uses canonical purpose-scoped origins instead of a scheme-wide HTTPS source', () => {
    const policy = imagePolicySource();

    expect(source('proxy.ts')).toContain("import { resolveConfiguredSupabaseOrigin } from '@/lib/profile-avatar-url'");
    expect(policy).toContain('const SUPABASE_IMAGE_PUBLIC_PATHS');
    expect(policy).toContain("'/storage/v1/object/public/profile-avatars/'");
    expect(policy).toContain("'/storage/v1/object/public/review-photos/'");
    expect(policy).toContain('const configuredSupabaseOrigin = resolveConfiguredSupabaseOrigin()');
    expect(policy).toContain('`img-src ${buildImageSources()}`');

    for (const allowedSource of [
      'https://lh3.googleusercontent.com/a/',
      'https://maps.googleapis.com/maps/vt',
      'https://maps.gstatic.com/mapfiles/',
      'https://map.pstatic.net/',
      'https://ssl.pstatic.net/',
      'https://nrbe.pstatic.net/',
      'https://nrbe.map.naver.net/',
      'https://static.naver.net/',
      'https://img.youtube.com/vi/',
      'https://i.ytimg.com/vi/',
    ]) {
      expect(policy).toContain(`'${allowedSource}'`);
    }

    expect(policy).not.toContain("img-src 'self' data: blob: https:");
    expect(policy).not.toContain('http://static.naver.net/');
    expect(policy).not.toMatch(/['"]http:\/\//);
    expect(policy).not.toMatch(/['"]https:['"]/);
    expect(policy).not.toContain('https://*.');
  });

  test('keeps data and blob image schemes only for verified local rendering paths', () => {
    const policy = imagePolicySource();

    expect(policy).toContain("return [\"'self'\", 'data:', 'blob:'");
    expect(policy).toContain('source-controlled CSS imagery');
    expect(policy).toContain('local upload previews');
    expect(source('app/admin/banners/page.tsx')).toContain('URL.createObjectURL');
    expect(source('app/app-globals.css')).toContain('background-image: url("data:image/svg+xml');
  });
});
