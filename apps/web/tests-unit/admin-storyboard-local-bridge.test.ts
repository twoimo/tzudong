import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';

import {
  buildStoryboardLocalBridgeImagesRequest,
  normalizeStoryboardLocalBridgeImagesResponse,
  normalizeStoryboardLocalBridgeToken,
  normalizeStoryboardLocalBridgeUrl,
  redactStoryboardLocalBridgeSecretText,
  requireStoryboardLocalBridgeToken,
} from '../lib/admin/storyboard/local-bridge-contract';
import {
  buildThumbnailLocalBridgeImagesRequest,
  normalizeThumbnailLocalBridgeImagesResponse,
} from '../lib/admin/youtube-thumbnail-generator/local-bridge-contract';
import { createStoryboardLocalBridgeServer } from '../lib/admin/storyboard/local-bridge-server.mts';
import {
  LOCAL_BRIDGE_HELPER_ORIGIN_QUERY_PARAM,
  LOCAL_BRIDGE_HELPER_ROUTE,
  LOCAL_BRIDGE_HELPER_SESSION_QUERY_PARAM,
  LOCAL_BRIDGE_HELPER_SURFACE_QUERY_PARAM,
} from '../lib/admin/local-bridge/core-contract';
import { isTrustedStoryboardGeneratedImage } from '../lib/admin/storyboard/image-trust';
import type { StoryboardGenerateRequest, StoryboardGenerationResult, StoryboardScene } from '../lib/admin/storyboard/types';

const allowedOrigin = 'https://www.tzudong.app';
const token = 'test-local-bridge-token-1234567890';
const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l9ggGQAAAABJRU5ErkJggg==';

const request: StoryboardGenerateRequest = {
  prompt: '로컬 브릿지 테스트 스토리보드',
  tone: 'energetic',
  targetLengthMinutes: 12,
  sourceLimit: 40,
  segmentCount: 4,
  includeProductionNotes: true,
  generationMode: 'backend_agent',
};

const scene: StoryboardScene = {
  sceneNo: 1,
  title: '로컬 브릿지 컷',
  durationSec: 60,
  operatorIntent: '로컬 브릿지 테스트 의도',
  visualDirection: '음식과 손만 보이는 안전한 테스트 컷',
  hostBeat: '첫 입 기대감',
  captionIdea: '테스트 캡션',
  heatmapEvidence: {
    videoId: 'video-test',
    youtubeLink: 'https://www.youtube.com/watch?v=video-test',
    peakTime: '00:35',
    replayScore: 1,
    reason: 'test',
  },
  productionChecklist: ['test'],
};

const sourceResult = {
  request,
  storyboard: {
    title: '로컬 브릿지 테스트',
    logline: '로컬 브릿지 통합 테스트',
    scenes: [scene],
  },
  sourceSummary: {},
  ahp: {},
  backendAnalysis: {},
} as StoryboardGenerationResult;

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function writeFakeProvider(dir: string, mode: 'success' | 'misleading-failure' | 'path-mismatch' = 'success') {
  const markerPath = join(dir, `provider-${mode}.marker`);
  const providerPath = join(dir, `fake-provider-${mode}.mjs`);
  writeFileSync(providerPath, `
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
let input = {};
try {
  const rawInput = readFileSync(0, 'utf8').trim();
  input = rawInput ? JSON.parse(rawInput) : {};
} catch {}
if (process.argv[2]) input.output = process.argv[2];
writeFileSync(${JSON.stringify(markerPath)}, 'invoked');
if (${JSON.stringify(mode)} === 'misleading-failure') {
  console.log(JSON.stringify({ ok: true, error: 'SUCCESS but failed with Bearer secret-token' }));
  process.exit(7);
}
const png = Buffer.from(${JSON.stringify(tinyPngBase64)}, 'base64');
const outputPath = input.outputPath || input.output;
if (!outputPath) throw new Error('missing output path');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, png);
const reportedOutputPath = ${JSON.stringify(mode)} === 'path-mismatch'
  ? ${JSON.stringify(join('__TEMP_DIR__', 'outside-provider-output.png'))}.replace('__TEMP_DIR__', ${JSON.stringify(dir)})
  : outputPath;
if (reportedOutputPath !== outputPath) {
  mkdirSync(dirname(reportedOutputPath), { recursive: true });
  writeFileSync(reportedOutputPath, png);
}
const responseHash = createHash('sha256').update(png).digest('hex');
console.log(JSON.stringify({
  ok: true,
  providerId: 'local-codex',
  authMode: 'codex_oauth',
  endpoint: 'https://chatgpt.com/backend-api/codex/responses',
  agentModel: 'gpt-5.5',
  requestToolType: 'image_generation',
  requestToolModel: 'gpt-image-2',
  model: 'gpt-image-2',
  modelProvenance: 'exact',
  responseId: 'resp_test_bridge',
  imageCallId: 'ig_test_bridge',
  imageItemCount: 1,
  generatedImageItemTypes: ['image_generation_call'],
  rawImageItemTypes: ['image_generation_call'],
  mime: 'image/png',
  bytes: png.length,
  outputPath: reportedOutputPath,
  durableOutputPath: reportedOutputPath,
  requestHash: ${JSON.stringify(sha256('request'))},
  responseHash,
  hasOpenAIAPIKey: false,
  generatedAt: new Date().toISOString()
}));
`);
  return { providerPath, markerPath };
}

function writeHangingProvider(dir: string) {
  const markerPath = join(dir, 'provider-hanging.marker');
  const providerPath = join(dir, 'fake-provider-hanging.mjs');
  writeFileSync(providerPath, `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(markerPath)}, 'invoked');
setTimeout(() => {}, 10_000);
`);
  return { providerPath, markerPath };
}

async function listenBridge(options: { providerPath: string; outputDir: string; commandTimeoutMs?: number; thumbnailProviderPath?: string }) {
  const bridge = createStoryboardLocalBridgeServer({
    token,
    allowedOrigins: [allowedOrigin],
    providerCommand: process.execPath,
    providerArgs: [options.providerPath],
    thumbnailProviderCommand: process.execPath,
    thumbnailProviderArgs: [options.thumbnailProviderPath ?? options.providerPath, '{output}'],
    outputDir: options.outputDir,
    fakeAuthReady: true,
    commandTimeoutMs: options.commandTimeoutMs ?? 2000,
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    bridge.server.once('error', rejectListen);
    bridge.server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = bridge.server.address();
  if (!address || typeof address === 'string') throw new Error('bridge did not bind to a TCP port');
  return { ...bridge, baseUrl: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: Server) {
  return new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

describe('storyboard local bridge contract', () => {
  test('normalizes only localhost bridge URL and token shapes', () => {
    expect(normalizeStoryboardLocalBridgeUrl('http://127.0.0.1:17873/path?q=1')).toBe('http://127.0.0.1:17873');
    expect(() => normalizeStoryboardLocalBridgeUrl('https://www.tzudong.app/bridge')).toThrow('로컬 브릿지');
    expect(normalizeStoryboardLocalBridgeToken('  abcdefghijklmnop  ')).toBe('abcdefghijklmnop');
    expect(() => requireStoryboardLocalBridgeToken('short')).toThrow('pairing token');
    expect(redactStoryboardLocalBridgeSecretText(`Bearer ${token} sk-1234567890 auth.json`, token)).not.toContain(token);
  });

  test('builds and validates trusted local bridge image response shape', () => {
    const requestPayload = buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene]);
    expect(requestPayload.scenes).toHaveLength(1);
    const image = {
      dataUrl: `data:image/png;base64,${tinyPngBase64}`,
      mime: 'image/png',
      providerId: 'local-codex',
      trustPolicy: 'storyboard-gpt-image-2-panel-v1',
      model: 'gpt-image-2',
      prompt: 'test prompt',
      generatedAt: new Date().toISOString(),
      warnings: [],
      provenance: {
        providerId: 'local-codex',
        authMode: 'codex_oauth',
        endpoint: 'https://chatgpt.com/backend-api/codex/responses',
        agentModel: 'gpt-5.5',
        requestToolType: 'image_generation',
        requestToolModel: 'gpt-image-2',
        model: 'gpt-image-2',
        modelProvenance: 'exact',
        responseId: 'resp_contract',
        imageCallId: 'ig_contract',
        imageItemCount: 1,
        rawImageItemTypes: ['image_generation_call'],
        requestHash: 'a'.repeat(64),
        responseHash: 'b'.repeat(64),
        hasOpenAIAPIKey: false,
        generatedAt: new Date().toISOString(),
      },
    };
    expect(isTrustedStoryboardGeneratedImage(image)).toBe(true);
    expect(normalizeStoryboardLocalBridgeImagesResponse({
      ok: true,
      providerId: 'local-codex',
      model: 'gpt-image-2',
      images: [{ sceneNo: 1, image }],
    }).images).toHaveLength(1);
  });
});

describe('storyboard local bridge server', () => {
  let tempDir = '';
  let activeServer: Server | null = null;

  beforeEach(() => {
    tempDir = join(tmpdir(), `tzudong-local-bridge-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (activeServer) await closeServer(activeServer);
    activeServer = null;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  test('grants allowed CORS/PNA preflight and safe health without returning token', async () => {
    const { providerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;

    const preflight = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');

    const health = await fetch(`${bridge.baseUrl}/health`, { headers: { Origin: allowedOrigin } });
    expect(health.status).toBe(200);
    const text = await health.text();
    expect(text).toContain('tzudong-storyboard-local-bridge');
    expect(text).not.toContain(token);
  });

  test('serves the helper page without requiring an Origin header', async () => {
    const { providerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;

    const helperUrl = new URL(`${bridge.baseUrl}${LOCAL_BRIDGE_HELPER_ROUTE}`);
    helperUrl.searchParams.set(LOCAL_BRIDGE_HELPER_ORIGIN_QUERY_PARAM, allowedOrigin);
    helperUrl.searchParams.set(LOCAL_BRIDGE_HELPER_SESSION_QUERY_PARAM, 'storyboard-session-1');
    helperUrl.searchParams.set(LOCAL_BRIDGE_HELPER_SURFACE_QUERY_PARAM, 'storyboard');

    const helper = await fetch(helperUrl);
    expect(helper.status).toBe(200);
    expect(helper.headers.get('content-type')).toContain('text/html');
    expect(helper.headers.get('cache-control')).toBe('no-store');
    const html = await helper.text();
    expect(html).toContain('Local bridge helper ready');
    expect(html).toContain('storyboard-session-1');
    expect(html).toContain(allowedOrigin);
  });

  test('rejects missing token and wrong origin before provider invocation', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;
    const body = JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene]));

    const missingToken = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
      body,
    });
    expect(missingToken.status).toBe(401);

    const wrongOrigin = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    expect(wrongOrigin.status).toBe(403);
    expect(wrongOrigin.headers.get('access-control-allow-origin')).toBeNull();
    expect(() => readFileSync(markerPath, 'utf8')).toThrow();
  });

  test('rejects malformed and oversized payloads before provider invocation', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;

    const malformed = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{not-json',
    });
    expect(malformed.status).toBe(400);

    const oversized = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene]),
        scenes: Array.from({ length: 5 }, (_, index) => ({ ...scene, sceneNo: index + 1 })),
      }),
    });
    expect(oversized.status).toBe(400);
    expect(() => readFileSync(markerPath, 'utf8')).toThrow();
  });

  test('returns trusted image for valid paired fake provider request', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;

    const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(response.status).toBe(200);
    const payload = normalizeStoryboardLocalBridgeImagesResponse(await response.json());
    expect(payload.images).toHaveLength(1);
    expect(payload.images[0].image.providerId).toBe('local-codex');
    expect(payload.images[0].image.dataUrl).toStartWith('data:image/png;base64,');
    expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
  });

  test('accepts loopback helper origins for status and generation routes', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;
    const localhostOrigin = bridge.baseUrl.replace('127.0.0.1', 'localhost');

    const health = await fetch(`${bridge.baseUrl}/health`, { headers: { Origin: bridge.baseUrl } });
    expect(health.status).toBe(200);
    const healthPayload = await health.json() as { endpoints?: { helper?: string } };
    expect(healthPayload.endpoints?.helper).toBe(LOCAL_BRIDGE_HELPER_ROUTE);

    const authStatus = await fetch(`${bridge.baseUrl}/auth-status`, {
      headers: {
        Origin: localhostOrigin,
        Authorization: `Bearer ${token}`,
      },
    });
    expect(authStatus.status).toBe(200);

    const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: bridge.baseUrl,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(response.status).toBe(200);
    expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
  });

  test('serves thumbnail images through the same paired local bridge without a server relay', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;

    const preflight = await fetch(`${bridge.baseUrl}/v1/youtube-thumbnail/images`, {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(allowedOrigin);

    const health = await fetch(`${bridge.baseUrl}/health`, { headers: { Origin: allowedOrigin } });
    const healthPayload = await health.json() as { endpoints?: { thumbnailImages?: string } };
    expect(healthPayload.endpoints?.thumbnailImages).toBe('/v1/youtube-thumbnail/images');

    const response = await fetch(`${bridge.baseUrl}/v1/youtube-thumbnail/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildThumbnailLocalBridgeImagesRequest({
        providerId: 'local-codex',
        generationMode: 'direct_provider',
        topic: '로컬 브릿지 음식 썸네일',
        headline: '역대급 먹방',
        subHeadline: '한입만 가능?',
        stylePreset: 'night-market-reaction',
        referenceImageRoles: ['host'],
        acknowledgedSafety: true,
        textLayers: [],
      }, [
        {
          name: 'host.png',
          mime: 'image/png',
          role: 'host',
          dataBase64: tinyPngBase64,
        },
      ])),
    });
    expect(response.status).toBe(200);
    const payload = normalizeThumbnailLocalBridgeImagesResponse(await response.json());
    expect(payload.result.baseImage.providerId).toBe('local-codex');
    expect(payload.result.baseImage.model).toBe('gpt-image-2');
    expect(payload.result.baseImage.modelProvenance).toBe('exact');
    expect(payload.result.baseImage.dataUrl).toStartWith('data:image/png;base64,');
    expect(payload.result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('no_relay_transport'),
      expect.stringContaining('server_history_persistence: skipped'),
    ]));
    expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
  });

  test('fails closed when thumbnail provider reports an output path outside the expected run output', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir, 'path-mismatch');
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;

    const response = await fetch(`${bridge.baseUrl}/v1/youtube-thumbnail/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildThumbnailLocalBridgeImagesRequest({
        providerId: 'local-codex',
        generationMode: 'direct_provider',
        topic: '로컬 브릿지 음식 썸네일',
        headline: '역대급 먹방',
        subHeadline: '한입만 가능?',
        stylePreset: 'night-market-reaction',
        referenceImageRoles: ['host'],
        acknowledgedSafety: true,
        textLayers: [],
      }, [
        {
          name: 'host.png',
          mime: 'image/png',
          role: 'host',
          dataBase64: tinyPngBase64,
        },
      ])),
    });
    expect(response.status).toBe(502);
    expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
    const text = await response.text();
    expect(text).toContain('exact gpt-image-2 provenance');
    expect(text).not.toContain('outside-provider-output');
  });

  test('fails closed on misleading provider success output with non-zero exit', async () => {
    const { providerPath } = writeFakeProvider(tempDir, 'misleading-failure');
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;

    const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain('secret-token');
    expect(text).toContain('[redacted_bridge_token]');
  });

  test('times out a hanging provider and redacts the pairing token', async () => {
    const { providerPath, markerPath } = writeHangingProvider(tempDir);
    const bridge = await listenBridge({
      providerPath,
      outputDir: join(tempDir, 'out'),
      commandTimeoutMs: 500,
    });
    activeServer = bridge.server;

    const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(response.status).toBe(504);
    expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
    const text = await response.text();
    expect(text).toContain('timed out');
    expect(text).not.toContain(token);
  });
});
