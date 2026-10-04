import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { isTrustedSameOriginMutation } from '../lib/security/same-origin-mutation';

const origin = 'http://127.0.0.1:18080';
const env = { NODE_ENV: 'test', NEXT_PUBLIC_SITE_URL: origin };
function request(headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/admin/map-overlays/preview`, {
    method: 'POST', headers: { origin, host: '127.0.0.1:18080', 'sec-fetch-site': 'same-origin', ...headers },
  });
}

describe('NextRequest loopback normalization at the mutation boundary', () => {
  test('admits the configured real host after framework normalization', () => {
    const r = request();
    expect(new URL(r.url).hostname).toBe('localhost');
    expect(isTrustedSameOriginMutation(r, env)).toBe(true);
  });

  test('rejects a different origin, port, host, fetch site and forwarded-header substitution', () => {
    for (const headers of [
      { origin: 'http://localhost:18080' }, { origin: 'http://127.0.0.1:18081' },
      { origin: 'https://attacker.invalid' }, { host: 'attacker.invalid' },
      { host: 'localhost:18080' }, { 'sec-fetch-site': 'cross-site' },
      { host: 'attacker.invalid', 'x-forwarded-host': '127.0.0.1:18080' },
    ]) expect(isTrustedSameOriginMutation(request(headers), env)).toBe(false);
    expect(isTrustedSameOriginMutation(request(), { ...env, NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:18081' })).toBe(false);
  });

  test('preserves exact configured HTTPS production origin and rejects loopback flags', () => {
    const production = { NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://www.tzudong.app', NIGHTLY_LOCAL_ENV_ONLY: '1' };
    expect(isTrustedSameOriginMutation(request(), production)).toBe(false);
    const r = new NextRequest('https://www.tzudong.app/api/admin/map-overlays/preview', {
      method: 'POST', headers: { origin: 'https://www.tzudong.app', host: 'www.tzudong.app', 'sec-fetch-site': 'same-origin' },
    });
    expect(isTrustedSameOriginMutation(r, production)).toBe(true);
    expect(isTrustedSameOriginMutation(new NextRequest(r.url, {
      method: 'POST', headers: { origin, host: '127.0.0.1:18080' },
    }), production)).toBe(false);
  });
});
