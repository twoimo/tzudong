import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveRootLayoutResourceHintPolicy } from '@/lib/root-layout-resource-hints';
const layoutSource = readFileSync(
  resolve(import.meta.dir, '..', 'app', 'layout.tsx'),
  'utf8',
);
const proxySource = readFileSync(
  resolve(import.meta.dir, '..', 'proxy.ts'),
  'utf8',
);
const globalStylesSource = readFileSync(
  resolve(import.meta.dir, '..', 'app', 'globals.css'),
  'utf8',
);
const homeGlobalStylesSource = readFileSync(
  resolve(import.meta.dir, '..', 'app', 'home-app-globals.css'),
  'utf8',
);
const localWorkspaceBannerSource = readFileSync(
  resolve(import.meta.dir, '..', 'components', 'home', 'LocalWorkspaceBanner.tsx'),
  'utf8',
);

describe('root layout local runtime and CSP nonce contract', () => {
  test('forwards the proxy request nonce to the loading provider', () => {
    expect(proxySource).toContain("requestHeaders.set('x-nonce', nonce)");
    expect(proxySource).toContain("requestHeaders.set('Content-Security-Policy', policy)");
    expect(layoutSource).toContain('import { headers } from "next/headers"');
    expect(layoutSource).toContain('export default async function RootLayout');
    expect(layoutSource).toContain('const nonce = (await headers()).get("x-nonce") ?? undefined;');
    expect(layoutSource).toContain('<LoadingProvider nonce={nonce}>');
    expect(layoutSource).not.toContain('import Script from "next/script"');
    expect(layoutSource).not.toContain('strategy="beforeInteractive"');
    expect(layoutSource).not.toMatch(/randomUUID|Math\.random/);
  });
  test('keeps the local workspace banner outside the app tree', () => {
    expect(layoutSource).toContain('import { LocalWorkspaceBanner } from "@/components/home/LocalWorkspaceBanner"');
    expect(layoutSource).toContain('data-local-workspace={process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME === "1" ? "true" : undefined}');
    expect(layoutSource).toContain('<LocalWorkspaceBanner />');
    expect(layoutSource).toContain('<div data-local-workspace-app="true">');
    expect(layoutSource.indexOf('<LocalWorkspaceBanner />')).toBeLessThan(layoutSource.indexOf('data-local-workspace-app'));
  });

  test('does not reserve viewport height for the removed local workspace banner', () => {
    expect(localWorkspaceBannerSource).toContain("LOCAL_WORKSPACE_BANNER_HEIGHT_CSS = '0px'");
    for (const styles of [globalStylesSource, homeGlobalStylesSource]) {
      expect(styles).toMatch(
        /html\[data-local-workspace="true"\]\s*\{\s*--local-workspace-banner-height: 0px;/,
      );
    }
  });

  test('keeps viewport sizing out of executable root markup', () => {
    expect(layoutSource).not.toContain('viewport-height-bootstrap');
    expect(layoutSource).not.toContain('viewport-height-fix.js');
    expect(layoutSource).not.toContain('dangerouslySetInnerHTML');
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
