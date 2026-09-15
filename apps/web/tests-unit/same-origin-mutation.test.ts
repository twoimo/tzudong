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
  test('admits both local dev aliases only when Origin matches the actual bound request', () => {
    const localEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'development', NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:8080',
      TZUDONG_LOCAL_SUPABASE_DEV: '1', LOCAL_SUPABASE_STATE_ROOT: '/fixture',
      SUPABASE_URL: 'http://127.0.0.1:20000', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:20000',
    };
    for (const host of ['localhost', '127.0.0.1']) {
      const origin = `http://${host}:8080`;
      expect(isTrustedSameOriginMutation(mutation({ origin, 'sec-fetch-site': 'same-origin' }, `${origin}/api/admin/example`), localEnv)).toBe(true);
    }
    for (const origin of ['http://127.0.0.1:8080', 'http://localhost:3000', 'https://attacker.example']) {
      expect(isTrustedSameOriginMutation(mutation({ origin, 'sec-fetch-site': 'same-origin' }, 'http://localhost:8080/api/admin/example'), localEnv)).toBe(false);
    }
    const req = mutation({ origin: 'http://localhost:8080' }, 'http://localhost:8080/api/admin/example');
    expect(isTrustedSameOriginMutation(req, { ...localEnv, TZUDONG_LOCAL_SUPABASE_DEV: '0' })).toBe(false);
    expect(isTrustedSameOriginMutation(req, { ...localEnv, NODE_ENV: 'production' })).toBe(false);
    expect(isTrustedSameOriginMutation(req, { ...localEnv, SUPABASE_URL: 'https://example.supabase.co' })).toBe(false);
  });

  test('allows exact same-origin browser mutations and safe methods', () => {
    expect(isTrustedSameOriginMutation(mutation({
      cookie: 'sb-test-auth-token=value',
      origin: 'https://www.tzudong.app',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    }), productionEnv)).toBe(true);
    expect(isTrustedSameOriginMutation(new Request('https://www.tzudong.app/api/admin/example'), productionEnv)).toBe(true);
  });

  test('keeps a configured loopback origin exact for local mutation servers', () => {
    const localEnv = {
      NODE_ENV: 'development',
      NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:18080',
    } as NodeJS.ProcessEnv;
    expect(isTrustedSameOriginMutation(mutation({
      cookie: 'sb-local-auth-token=value',
      origin: 'http://127.0.0.1:18080',
      'sec-fetch-site': 'same-origin',
    }, 'http://127.0.0.1:18080/api/admin/map-overlays/preview'), localEnv)).toBe(true);
    expect(isTrustedSameOriginMutation(mutation({
      cookie: 'sb-local-auth-token=value',
      origin: 'http://localhost:18080',
      'sec-fetch-site': 'same-origin',
    }, 'http://127.0.0.1:18080/api/admin/map-overlays/preview'), localEnv)).toBe(false);
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
    const accountDeletionUrl = 'https://www.tzudong.app/api/internal/account-deletion';
    const privacyRetentionUrl = 'https://www.tzudong.app/api/internal/privacy-retention';

    expect(isTrustedSameOriginMutation(mutation({
      'x-account-deletion-worker-capability': capability,
    }, accountDeletionUrl), productionEnv)).toBe(true);
    expect(isTrustedSameOriginMutation(mutation({
      'x-privacy-retention-capability': capability,
    }, privacyRetentionUrl), productionEnv)).toBe(true);
    expect(isTrustedSameOriginMutation(mutation({
      'x-account-deletion-worker-capability': capability,
      'sec-fetch-mode': 'cors',
    }, accountDeletionUrl), productionEnv)).toBe(true);
    expect(isTrustedSameOriginMutation(mutation({
      'x-privacy-retention-capability': capability,
      'sec-fetch-mode': 'cors',
    }, privacyRetentionUrl), productionEnv)).toBe(true);

    for (const fetchMode of ['CORS', 'navigate', 'no-cors', 'same-origin', '']) {
      expect(isTrustedSameOriginMutation(mutation({
        'x-account-deletion-worker-capability': capability,
        'sec-fetch-mode': fetchMode,
      }, accountDeletionUrl), productionEnv), fetchMode || 'empty').toBe(false);
    }

    expect(isTrustedSameOriginMutation(mutation({
      'x-account-deletion-worker-capability': capability,
    }, 'https://www.tzudong.app/api/internal/other'), productionEnv)).toBe(false);
    expect(isTrustedSameOriginMutation(mutation({
      'x-account-deletion-worker-capability': capability,
    }, privacyRetentionUrl), productionEnv)).toBe(false);
    expect(isTrustedSameOriginMutation(mutation({
      'x-account-deletion-worker-capability': 'short',
    }, accountDeletionUrl), productionEnv)).toBe(false);
    for (const headers of [
      { cookie: 'browser=session' },
      { authorization: 'Basic browser-credentials' },
      { origin: 'https://attacker.example' },
      { referer: 'https://www.tzudong.app/account' },
      { 'sec-fetch-site': 'same-origin' },
      { 'sec-fetch-dest': 'empty' },
    ]) {
      expect(isTrustedSameOriginMutation(mutation({
        ...headers,
        'x-account-deletion-worker-capability': capability,
        'sec-fetch-mode': 'cors',
      }, accountDeletionUrl), productionEnv)).toBe(false);
    }
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
