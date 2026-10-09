import { describe, expect, test } from 'bun:test';
import {
  getTrustedAuthCallbackOrigin,
  getTrustedVercelPreviewOrigins,
} from '../lib/auth/callback-origin';

const productionSite = 'https://www.tzudong.app';

describe('OAuth callback redirect origin', () => {
  test('preserves the exact server-provided deployment or branch preview alias in use', () => {
    const previewEnv = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: productionSite,
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'Tzudong-Fi9S0Ycyh-Twoimos-Projects.vercel.app',
      VERCEL_BRANCH_URL: 'Tzudong-Git-Fix-Preview-Twoimos-Projects.vercel.app',
    };
    expect(getTrustedAuthCallbackOrigin(
      'https://tzudong-fi9s0ycyh-twoimos-projects.vercel.app',
      previewEnv,
    )).toBe('https://tzudong-fi9s0ycyh-twoimos-projects.vercel.app');
    expect(getTrustedAuthCallbackOrigin(
      'https://tzudong-git-fix-preview-twoimos-projects.vercel.app',
      previewEnv,
    )).toBe('https://tzudong-git-fix-preview-twoimos-projects.vercel.app');
    expect(getTrustedVercelPreviewOrigins(previewEnv)).toEqual([
      'https://tzudong-fi9s0ycyh-twoimos-projects.vercel.app',
      'https://tzudong-git-fix-preview-twoimos-projects.vercel.app',
    ]);

    expect(getTrustedAuthCallbackOrigin('https://request.example', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: productionSite,
      VERCEL_ENV: 'production',
      VERCEL_URL: 'tzudong-production-twoimos-projects.vercel.app',
      VERCEL_BRANCH_URL: 'tzudong-git-main-twoimos-projects.vercel.app',
    })).toBe(productionSite);
  });

  test('rejects arbitrary Vercel hosts and malformed aliases instead of trusting request host data', () => {
    const deploymentHost = 'preview-commit-team.vercel.app';
    const branchHost = 'preview-git-fix-team.vercel.app';
    for (const requestOrigin of [
      'https://another-preview.vercel.app',
      'https://preview-commit-team.vercel.app.attacker.example',
      'https://attacker.example',
      'https://preview-commit-team.vercel.app:444',
      'https://user@preview-commit-team.vercel.app',
      'https://preview-commit-team.vercel.app/auth/callback',
    ]) {
      expect(getTrustedAuthCallbackOrigin(requestOrigin, {
        NODE_ENV: 'production',
        NEXT_PUBLIC_SITE_URL: productionSite,
        VERCEL_ENV: 'preview',
        VERCEL_URL: deploymentHost,
        VERCEL_BRANCH_URL: branchHost,
      }), requestOrigin).toBe(`https://${deploymentHost}`);
    }

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
        VERCEL_BRANCH_URL: undefined,
      })).toBe(productionSite);
    }
  });

  test('preserves configured production and request-derived local origins', () => {
    expect(getTrustedAuthCallbackOrigin('https://attacker.example', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: productionSite,
      VERCEL_ENV: undefined,
      VERCEL_URL: 'preview.vercel.app',
      VERCEL_BRANCH_URL: 'preview-git-main.vercel.app',
    })).toBe(productionSite);

    expect(getTrustedAuthCallbackOrigin('http://127.0.0.1:3000', {
      NODE_ENV: 'development',
      NEXT_PUBLIC_SITE_URL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
    })).toBe('http://127.0.0.1:3000');
  });

  test('fails closed when trusted environment origins are malformed', () => {
    expect(getTrustedAuthCallbackOrigin('https://attacker.example', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'not a URL',
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'preview.vercel.app/attacker',
      VERCEL_BRANCH_URL: 'preview.vercel.app?attacker',
    })).toBe(productionSite);

    expect(getTrustedAuthCallbackOrigin('not a URL', {
      NODE_ENV: 'development',
      NEXT_PUBLIC_SITE_URL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
    })).toBe(productionSite);
  });
});
