import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveRootLayoutResourceHintPolicy } from '@/lib/root-layout-resource-hints';
import {
  VIEWPORT_HEIGHT_BOOTSTRAP_SHA256,
  VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE,
} from '@/lib/viewport-height-bootstrap';

const EXPECTED_VIEWPORT_BOOTSTRAP_SHA256 = '9dcae7a6c795fa9f0fa916afd2fc0016df8fde524fe302143abc7d2ffa8fb84f';

const layoutSource = readFileSync(
  resolve(import.meta.dir, '..', 'app', 'layout.tsx'),
  'utf8',
);
const proxySource = readFileSync(
  resolve(import.meta.dir, '..', 'proxy.ts'),
  'utf8',
);

describe('root layout local runtime and CSP nonce contract', () => {
  test('binds the native parser viewport bootstrap to the proxy request nonce', () => {
    expect(proxySource).toContain("requestHeaders.set('x-nonce', nonce)");
    expect(proxySource).toContain("requestHeaders.set('Content-Security-Policy', policy)");
    expect(layoutSource).toContain('import { headers } from "next/headers"');
    expect(layoutSource).toContain('export default async function RootLayout');
    expect(layoutSource).toContain('const nonce = (await headers()).get("x-nonce") ?? undefined;');
    expect(layoutSource).toMatch(
      /<script\s+nonce=\{nonce\}\s+suppressHydrationWarning\s+dangerouslySetInnerHTML=\{\{ __html: VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE \}\}\s+\/>/,
    );
    expect(layoutSource).not.toContain('import Script from "next/script"');
    expect(layoutSource).not.toContain('strategy="beforeInteractive"');
    expect(layoutSource).not.toMatch(/randomUUID|Math\.random/);
  });

  test('inlines only the hash-pinned source-controlled viewport bootstrap', () => {
    const publicBootstrapSource = readFileSync(
      resolve(import.meta.dir, '..', 'public', 'scripts', 'viewport-height-fix.js'),
      'utf8',
    );
    const digest = createHash('sha256').update(VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE).digest('hex');

    expect(VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE).toBe(publicBootstrapSource);
    expect(digest).toBe(EXPECTED_VIEWPORT_BOOTSTRAP_SHA256);
    expect(VIEWPORT_HEIGHT_BOOTSTRAP_SHA256).toBe(EXPECTED_VIEWPORT_BOOTSTRAP_SHA256);
    expect(VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE).not.toContain('</script');
    expect(layoutSource).toContain('dangerouslySetInnerHTML={{ __html: VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE }}');
    expect(layoutSource.match(/dangerouslySetInnerHTML/g)).toHaveLength(1);
    expect(layoutSource).not.toMatch(/readFile|fetch\(|process\.cwd/);
  });

  test('keeps hosted hints in production but suppresses them in strict local runtime', () => {
    expect(resolveRootLayoutResourceHintPolicy({
      localRuntime: undefined,
      supabaseUrl: 'https://project.supabase.co',
    })).toEqual({
      emitHostedResourceHints: true,
      supabasePreconnectUrl: 'https://project.supabase.co',
    });

    expect(resolveRootLayoutResourceHintPolicy({
      localRuntime: '1',
      supabaseUrl: 'http://127.0.0.1:28000',
    })).toEqual({
      emitHostedResourceHints: false,
      supabasePreconnectUrl: 'http://127.0.0.1:28000',
    });

    expect(resolveRootLayoutResourceHintPolicy({
      localRuntime: '1',
      supabaseUrl: 'https://project.supabase.co',
    })).toEqual({
      emitHostedResourceHints: false,
    });

    const hostedHintsStart = layoutSource.indexOf('{emitHostedResourceHints ? (');
    const hostedHintsEnd = layoutSource.indexOf(') : null}', hostedHintsStart);
    expect(hostedHintsStart).toBeGreaterThan(-1);
    expect(hostedHintsEnd).toBeGreaterThan(hostedHintsStart);
    for (const hostname of [
      'oapi.map.naver.com',
      'img.youtube.com',
      'openapi.map.naver.com',
      'ssl.pstatic.net',
      'nrbe.pstatic.net',
      'nrbe.map.naver.net',
      'static.naver.net',
      'i.ytimg.com',
      'lh3.googleusercontent.com',
    ]) {
      const hintIndex = layoutSource.indexOf(hostname);
      expect(hintIndex).toBeGreaterThan(hostedHintsStart);
      expect(hintIndex).toBeLessThan(hostedHintsEnd);
    }
  });

  test('rejects malformed and non-http Supabase preconnect targets', () => {
    for (const supabaseUrl of [
      undefined,
      '',
      'not-a-url',
      'javascript:alert(1)',
      'file:///tmp/postgres',
    ]) {
      expect(resolveRootLayoutResourceHintPolicy({
        localRuntime: undefined,
        supabaseUrl,
      })).toEqual({
        emitHostedResourceHints: true,
      });
    }
  });
});
