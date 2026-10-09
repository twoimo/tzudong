import { describe, expect, test } from 'bun:test';
import { getTrustedAuthCallbackOrigin } from '../lib/auth/callback-origin';

const productionSite = 'https://www.tzudong.app';

describe('OAuth callback redirect origin', () => {
  test('uses the server-provided Vercel deployment host only for previews', () => {
    expect(getTrustedAuthCallbackOrigin('https://request.example', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: productionSite,
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'Tzudong-Fi9S0Ycyh-Twoimos-Projects.vercel.app',
    })).toBe('https://tzudong-fi9s0ycyh-twoimos-projects.vercel.app');

    expect(getTrustedAuthCallbackOrigin('https://request.example', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: productionSite,
      VERCEL_ENV: 'production',
      VERCEL_URL: 'tzudong-production-twoimos-projects.vercel.app',
    })).toBe(productionSite);
  });

  test('rejects paths, credentials, ports and lookalike Vercel hosts', () => {
    const rejectedHosts = [
      'https://preview.vercel.app',
      'preview.vercel.app/auth/callback',
      'preview.vercel.app?next=https://attacker.example',
      'preview.vercel.app#attacker',
      'preview.vercel.app:443',
      'preview.vercel.app@attacker.example',
      'preview.vercel.app.attacker.example',
      'preview..vercel.app',
      '-preview.vercel.app',
      'preview-.vercel.app',
    ];

    for (const VERCEL_URL of rejectedHosts) {
      expect(getTrustedAuthCallbackOrigin('https://request.example', {
        NODE_ENV: 'production',
        NEXT_PUBLIC_SITE_URL: productionSite,
        VERCEL_ENV: 'preview',
        VERCEL_URL,
      })).toBe(productionSite);
    }
  });

  test('preserves configured production and request-derived local origins', () => {
    expect(getTrustedAuthCallbackOrigin('https://attacker.example', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: productionSite,
      VERCEL_ENV: undefined,
      VERCEL_URL: 'preview.vercel.app',
    })).toBe(productionSite);

    expect(getTrustedAuthCallbackOrigin('http://127.0.0.1:3000', {
      NODE_ENV: 'development',
      NEXT_PUBLIC_SITE_URL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_URL: undefined,
    })).toBe('http://127.0.0.1:3000');
  });

  test('fails closed when trusted environment origins are malformed', () => {
    expect(getTrustedAuthCallbackOrigin('https://attacker.example', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'not a URL',
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'preview.vercel.app/attacker',
    })).toBe(productionSite);

    expect(getTrustedAuthCallbackOrigin('not a URL', {
      NODE_ENV: 'development',
      NEXT_PUBLIC_SITE_URL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_URL: undefined,
    })).toBe(productionSite);
  });
});
