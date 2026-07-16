import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

const productionEnv = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SITE_URL: 'https://www.tzudong.app',
} as NodeJS.ProcessEnv;

function mutation(headers: HeadersInit = {}, url = 'https://www.tzudong.app/api/admin/example') {
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'apply' }),
  });
}

describe('same-origin mutation authorization', () => {
  test('allows exact same-origin browser mutations and safe methods', () => {
    expect(isTrustedSameOriginMutation(mutation({
      cookie: 'sb-test-auth-token=value',
      origin: 'https://www.tzudong.app',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    }), productionEnv)).toBe(true);
    expect(isTrustedSameOriginMutation(new Request('https://www.tzudong.app/api/admin/example'), productionEnv)).toBe(true);
  });

  test('rejects cross-origin, same-site sibling, null, missing, and ambiguous origins', () => {
    for (const origin of [
      'https://attacker.example',
      'https://evil.tzudong.app',
      'null',
      '',
      'https://www.tzudong.app, https://attacker.example',
    ]) {
      const headers: Record<string, string> = {
        cookie: 'sb-test-auth-token=value',
        'sec-fetch-site': origin === 'https://www.tzudong.app' ? 'same-origin' : 'cross-site',
      };
      if (origin) headers.origin = origin;
      expect(isTrustedSameOriginMutation(mutation(headers), productionEnv), origin || 'missing').toBe(false);
    }

    expect(isTrustedSameOriginMutation(mutation({
      cookie: 'sb-test-auth-token=value',
      origin: 'https://www.tzudong.app',
      'sec-fetch-site': 'same-site',
    }), productionEnv)).toBe(false);
  });

  test('does not trust internal paths for cross-origin cookie mutations', () => {
    const internalUrl = 'https://www.tzudong.app/api/internal/privacy-retention';
    expect(isTrustedSameOriginMutation(mutation({
      cookie: 'sb-test-auth-token=value',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
    }, internalUrl), productionEnv)).toBe(false);
    expect(isTrustedSameOriginMutation(mutation({
      'x-privacy-retention-capability': 'capability',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
    }, internalUrl), productionEnv)).toBe(false);
  });
  test('allows only exact cookie-free internal capability routes through the CSRF layer', () => {
    const capability = 'c'.repeat(32);
    expect(isTrustedSameOriginMutation(mutation({
      'x-account-deletion-worker-capability': capability,
    }, 'https://www.tzudong.app/api/internal/account-deletion'), productionEnv)).toBe(true);
    expect(isTrustedSameOriginMutation(mutation({
      'x-privacy-retention-capability': capability,
    }, 'https://www.tzudong.app/api/internal/privacy-retention'), productionEnv)).toBe(true);
    expect(isTrustedSameOriginMutation(mutation({
      'x-account-deletion-worker-capability': capability,
    }, 'https://www.tzudong.app/api/internal/other'), productionEnv)).toBe(false);
    expect(isTrustedSameOriginMutation(mutation({
      cookie: 'browser=session',
      'x-account-deletion-worker-capability': capability,
    }, 'https://www.tzudong.app/api/internal/account-deletion'), productionEnv)).toBe(false);
    expect(isTrustedSameOriginMutation(mutation({
      origin: 'https://attacker.example',
      'x-account-deletion-worker-capability': capability,
    }, 'https://www.tzudong.app/api/internal/account-deletion'), productionEnv)).toBe(false);
  });

  test('allows only cookie-free Bearer credentials through this CSRF layer', () => {
    const internalUrl = 'https://www.tzudong.app/api/internal/privacy-retention';
    expect(isTrustedSameOriginMutation(mutation({
      authorization: 'Bearer service-token',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
    }, internalUrl), productionEnv)).toBe(true);
    expect(isTrustedSameOriginMutation(mutation({
      authorization: 'Bearer service-token',
      cookie: 'sb-test-auth-token=value',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
    }, internalUrl), productionEnv)).toBe(false);
    expect(isTrustedSameOriginMutation(mutation({ authorization: 'Bearer    ' }), productionEnv)).toBe(false);
  });

  test('fails closed on an invalid or absent production canonical origin and is wired before session bypass', () => {
    expect(isTrustedSameOriginMutation(mutation({ origin: 'https://www.tzudong.app' }), {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'http://www.tzudong.app',
    } as NodeJS.ProcessEnv)).toBe(false);
    expect(isTrustedSameOriginMutation(mutation({ origin: 'https://www.tzudong.app' }), {
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv)).toBe(false);

    const proxySource = readFileSync(join(import.meta.dir, '..', 'proxy.ts'), 'utf8');
    expect(proxySource.indexOf('if (!isTrustedSameOriginMutation(request))')).toBeLessThan(
      proxySource.indexOf('if (await shouldSkipSession(request))'),
    );
    expect(proxySource).toContain("{ status: 403, headers: { 'Cache-Control': 'no-store' } }");

    const guardSource = readFileSync(
      join(import.meta.dir, '..', 'lib', 'security', 'same-origin-mutation.ts'),
      'utf8',
    );
    expect(guardSource).not.toContain("pathname.startsWith('/api/internal/')");
    expect(guardSource).toContain('routes still authenticate them');
  });
});
