import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ANYCAP_REQUIRED_MODEL,
  normalizeAnyCapGptImageReadiness,
  sanitizeAnyCapTraceSnippet,
  type AnyCapProbeResult,
} from '../lib/admin/anycap-gpt-image-readiness';

const statusCommand = ['anycap', 'status'];
const modelsCommand = ['anycap', 'image', 'models'];
const webRoot = path.resolve(import.meta.dir, '..');

function probe(command: string[], stdout: string, stderr = '', exitCode = 0): AnyCapProbeResult {
  return { command, stdout, stderr, exitCode };
}

function readyStatusProbe(): AnyCapProbeResult {
  return probe(statusCommand, JSON.stringify({ loggedIn: true, account: 'ops' }));
}

function modelsProbe(models: unknown): AnyCapProbeResult {
  return probe(modelsCommand, JSON.stringify({ models }));
}

async function loadReadinessRoute() {
  return import(`../app/api/admin/image-generation-readiness/route.ts?cache=${Math.random()}`);
}

describe('AnyCap gpt-image-2 readiness contract', () => {
  test('returns ready only when AnyCap is authenticated and catalog includes exact gpt-image-2', () => {
    const readiness = normalizeAnyCapGptImageReadiness({
      requestedModel: ANYCAP_REQUIRED_MODEL,
      statusProbe: readyStatusProbe(),
      modelsProbe: modelsProbe([{ id: 'gpt-image-1' }, { id: ANYCAP_REQUIRED_MODEL }]),
      checkedAt: '2026-07-04T00:00:00.000Z',
    });

    expect(readiness).toMatchObject({
      providerId: 'anycap',
      model: 'gpt-image-2',
      strictExactModelRequired: true,
      fallbackAllowed: false,
      status: 'ready',
    });
    expect(readiness.trace.statusCommand).toEqual(statusCommand);
    expect(readiness.trace.modelsCommand).toEqual(modelsCommand);
  });

  test('reports missing when AnyCap CLI is not available', () => {
    const readiness = normalizeAnyCapGptImageReadiness({
      statusProbe: { command: statusCommand, exitCode: null, errorCode: 'ENOENT', stderr: 'anycap not found' },
    });

    expect(readiness.status).toBe('missing');
    expect(readiness.reason).toContain('AnyCap CLI');
  });

  test('preserves auth_required as a first-class status', () => {
    const readiness = normalizeAnyCapGptImageReadiness({
      statusProbe: probe(statusCommand, JSON.stringify({ loggedIn: false, message: 'not logged in' }), 'please log in', 1),
    });

    expect(readiness.status).toBe('auth_required');
    expect(readiness.remediation.join(' ')).toContain('anycap login');
  });

  test('rejects any configured/requested model other than exact gpt-image-2', () => {
    const readiness = normalizeAnyCapGptImageReadiness({
      requestedModel: 'gpt-image-1',
      statusProbe: readyStatusProbe(),
      modelsProbe: modelsProbe([{ id: 'gpt-image-1' }, { id: ANYCAP_REQUIRED_MODEL }]),
    });

    expect(readiness.status).toBe('invalid');
    expect(readiness.reason).toContain('exactly gpt-image-2');
    expect(readiness.fallbackAllowed).toBe(false);
  });

  test('requires model catalog to include gpt-image-2 before ready', () => {
    const readiness = normalizeAnyCapGptImageReadiness({
      statusProbe: readyStatusProbe(),
      modelsProbe: modelsProbe([{ id: 'gpt-image-1' }, { id: 'dall-e-3' }]),
    });

    expect(readiness.status).toBe('missing');
    expect(readiness.reason).toContain('gpt-image-2');
  });

  test('accepts plain-text model catalog output when it contains exact gpt-image-2', () => {
    const readiness = normalizeAnyCapGptImageReadiness({
      statusProbe: probe(statusCommand, 'authenticated as ops'),
      modelsProbe: probe(modelsCommand, 'gpt-image-1\ngpt-image-2\n'),
    });

    expect(readiness.status).toBe('ready');
  });

  test('redacts obvious secrets from trace snippets', () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const readiness = normalizeAnyCapGptImageReadiness({
      statusProbe: probe(statusCommand, '{bad json}', `Authorization: Bearer ${secret}`),
      modelsProbe: modelsProbe([{ id: ANYCAP_REQUIRED_MODEL }]),
    });

    expect(JSON.stringify(readiness)).not.toContain(secret);
    expect(sanitizeAnyCapTraceSnippet(`api_key=${secret}`)).toContain('[redacted]');
  });
});

describe('AnyCap readiness route/source invariants', () => {
  test('admin route is node runtime, gated by requireAdmin, no-store, and returns sanitized readiness JSON', async () => {
    mock.module('@/lib/auth/require-admin', () => ({
      requireAdmin: async () => ({ ok: true, userId: 'admin-user' }),
    }));
    mock.module('@/lib/admin/anycap-gpt-image-readiness', () => ({
      probeAnyCapGptImageReadiness: async () => ({
        providerId: 'anycap',
        model: 'gpt-image-2',
        strictExactModelRequired: true,
        fallbackAllowed: false,
        status: 'ready',
        reason: 'mock-ready',
        trace: { checkedAt: '2026-07-04T00:00:00.000Z', requestedModel: 'gpt-image-2', snippets: [] },
        remediation: ['ok'],
      }),
      buildAnyCapGptImageReadinessError: () => ({
        providerId: 'anycap',
        model: 'gpt-image-2',
        strictExactModelRequired: true,
        fallbackAllowed: false,
        status: 'error',
        reason: 'mock-error',
        trace: { checkedAt: '2026-07-04T00:00:00.000Z', requestedModel: 'gpt-image-2', snippets: [] },
        remediation: ['error'],
      }),
    }));

    const route = await loadReadinessRoute();
    expect(route.runtime).toBe('nodejs');

    const response = await route.GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      providerId: 'anycap',
      model: 'gpt-image-2',
      status: 'ready',
      fallbackAllowed: false,
    });
  });

  test('route source contains admin gate and no image generation/fallback path', () => {
    const routeSource = readFileSync(path.join(webRoot, 'app/api/admin/image-generation-readiness/route.ts'), 'utf8');
    expect(routeSource).toContain('requireAdmin');
    expect(routeSource).toContain("runtime = 'nodejs'");
    expect(routeSource).not.toContain('generate');
    expect(routeSource).not.toContain('fallback');
  });

  test('CLI and package script expose readiness without fallback model', () => {
    const packageJson = JSON.parse(readFileSync(path.join(webRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const scriptSource = readFileSync(path.join(webRoot, 'scripts/check-anycap-gpt-image-readiness.ts'), 'utf8');

    expect(packageJson.scripts['image:readiness']).toBe('bun scripts/check-anycap-gpt-image-readiness.ts');
    expect(scriptSource).toContain('probeAnyCapGptImageReadiness');
    expect(scriptSource).toContain("readiness.status === 'ready' ? 0 : 1");
    expect(scriptSource).not.toContain('gpt-image-1');
    expect(scriptSource).not.toContain('fallback');
  });
});
