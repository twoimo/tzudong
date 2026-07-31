import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

import {
  STORYBOARD_LOCAL_BRIDGE_MAX_BODY_BYTES,
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
import {
  createStoryboardLocalBridgeServer,
  startStoryboardLocalBridgeServer,
} from '../lib/admin/storyboard/local-bridge-server.mts';
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
const oversizedPngBase64 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000020000000000108060000000000000000000049454e4400000000',
  'hex',
).toString('base64');
const FAST_PROVIDER_TEST_TIMEOUT_MS = 5_000;

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

function writeFakeProvider(
  dir: string,
  mode: 'success' | 'misleading-failure' | 'path-mismatch' | 'wrong-format' | 'hash-mismatch' | 'bytes-mismatch' | 'symlink-output' | 'environment-probe' = 'success',
) {
  const markerPath = join(dir, `provider-${mode}.marker`);
  const providerPath = join(dir, `fake-provider-${mode}.mjs`);
  writeFileSync(providerPath, `
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname } from 'node:path';
let input = {};
try {
  const rawInput = readFileSync(0, 'utf8').trim();
  input = rawInput ? JSON.parse(rawInput) : {};
} catch {}
if (process.argv[2]) input.output = process.argv[2];
const observedEnvironment = ${JSON.stringify('environment-probe')} === ${JSON.stringify(mode)}
  ? ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TZUDONG_LOCAL_BRIDGE_TEST_SECRET', 'AUTHORIZATION'].reduce((observed, key) => ({
    ...observed,
    [key]: Object.prototype.hasOwnProperty.call(process.env, key),
  }), {})
  : undefined;
writeFileSync(${JSON.stringify(markerPath)}, observedEnvironment ? JSON.stringify(observedEnvironment) : 'invoked');
if (${JSON.stringify(mode)} === 'misleading-failure') {
  console.log(JSON.stringify({ ok: true, error: 'SUCCESS but failed with Bearer secret-token' }));
  process.exit(7);
}
const png = ${JSON.stringify('wrong-format')} === ${JSON.stringify(mode)}
  ? Buffer.from('not-a-png', 'utf8')
  : Buffer.from(${JSON.stringify(tinyPngBase64)}, 'base64');
const outputPath = input.outputPath || input.output;
if (!outputPath) throw new Error('missing output path');
mkdirSync(dirname(outputPath), { recursive: true });
if (${JSON.stringify(mode)} === 'symlink-output') {
  const symlinkTarget = outputPath + '.target';
  writeFileSync(symlinkTarget, png);
  symlinkSync(symlinkTarget, outputPath);
} else {
  writeFileSync(outputPath, png);
}
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
  bytes: png.length + (${JSON.stringify(mode)} === 'bytes-mismatch' ? 1 : 0),
  outputPath: reportedOutputPath,
  durableOutputPath: reportedOutputPath,
  requestHash: ${JSON.stringify(sha256('request'))},
  responseHash,
  hasOpenAIAPIKey: false,
  outputHash: ${JSON.stringify(mode)} === 'hash-mismatch' ? '0'.repeat(64) : undefined,
  generatedAt: new Date().toISOString()
}));
`);
  return { providerPath, markerPath };
}


function writeProcessTreeProvider(
  dir: string,
  mode: 'hanging' | 'overflow',
) {
  const directPidPath = join(dir, `provider-tree-${mode}-direct.pid`);
  const grandchildPidPath = join(dir, `provider-tree-${mode}-grandchild.pid`);
  const heartbeatPath = join(dir, `provider-tree-${mode}.heartbeat`);
  const grandchildPath = join(dir, `provider-tree-${mode}-grandchild.mjs`);
  const providerPath = join(dir, `provider-tree-${mode}.mjs`);
  writeFileSync(grandchildPath, `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(grandchildPidPath)}, String(process.pid));
process.on('SIGTERM', () => undefined);
setInterval(() => writeFileSync(${JSON.stringify(heartbeatPath)}, 'alive'), 25);
`);
  writeFileSync(providerPath, `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(directPidPath)}, String(process.pid));
process.on('SIGTERM', () => undefined);
spawn(process.execPath, [${JSON.stringify(grandchildPath)}], { stdio: 'ignore', windowsHide: true });
if (${JSON.stringify(mode)} === 'overflow') setTimeout(() => process.stdout.write('x'.repeat(4 * 1024 * 1024)), 100);
setInterval(() => {}, 1_000);
`);
  return { providerPath, directPidPath, grandchildPidPath };
}

function writeDefaultPythonProviderShim(dir: string) {
  const markerPath = join(dir, 'default-python-provider.marker');
  const shimJsPath = join(dir, 'default-python-provider.mjs');
  const commandPath = join(dir, process.platform === 'win32' ? 'python.cmd' : 'python3');
  writeFileSync(shimJsPath, `
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const rawInput = readFileSync(0, 'utf8').trim();
const input = rawInput ? JSON.parse(rawInput) : {};
writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify(process.argv.slice(1)));
const png = Buffer.from(${JSON.stringify(tinyPngBase64)}, 'base64');
mkdirSync(dirname(input.outputPath), { recursive: true });
writeFileSync(input.outputPath, png);
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
  responseId: 'resp_default_python',
  imageCallId: 'ig_default_python',
  imageItemCount: 1,
  generatedImageItemTypes: ['image_generation_call'],
  rawImageItemTypes: ['image_generation_call'],
  mime: 'image/png',
  bytes: png.length,
  outputPath: input.outputPath,
  durableOutputPath: input.outputPath,
  requestHash: ${JSON.stringify(sha256('default-python-request'))},
  responseHash,
  hasOpenAIAPIKey: false,
  generatedAt: new Date().toISOString()
}));
`);
  if (process.platform === 'win32') {
    writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "${shimJsPath}" %*\r\n`);
  } else {
    writeFileSync(commandPath, `#!/bin/sh\nexec "${process.execPath}" "${shimJsPath}" "$@"\n`);
    chmodSync(commandPath, 0o755);
  }
  return { commandPath, markerPath };
}

function writeWindowsCmdProviderShim(dir: string) {
  const { providerPath, markerPath } = writeFakeProvider(dir);
  const commandPath = join(dir, 'fake-provider.cmd');
  writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "${providerPath}" %*\r\n`);
  return { commandPath, markerPath };
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
    commandTimeoutMs: options.commandTimeoutMs ?? FAST_PROVIDER_TEST_TIMEOUT_MS,
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    bridge.server.once('error', rejectListen);
    bridge.server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = bridge.server.address();
  if (!address || typeof address === 'string') throw new Error('bridge did not bind to a TCP port');
  return { ...bridge, baseUrl: `http://127.0.0.1:${address.port}` };
}
async function listenBridgeInNode(options: {
  providerPath: string;
  outputDir: string;
  commandTimeoutMs?: number;
}) {
  const encodedConfig = Buffer.from(JSON.stringify({
    moduleUrl: new URL('../lib/admin/storyboard/local-bridge-server.mts', import.meta.url).href,
    token,
    allowedOrigin,
    providerPath: options.providerPath,
    outputDir: options.outputDir,
    commandTimeoutMs: options.commandTimeoutMs ?? FAST_PROVIDER_TEST_TIMEOUT_MS,
  }), 'utf8').toString('base64');
  const child = spawn('node', ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '-e', `
    (async () => {
      const config = JSON.parse(Buffer.from(process.env.BRIDGE_SERVER_CONFIG, 'base64').toString('utf8'));
      const { createStoryboardLocalBridgeServer } = await import(config.moduleUrl);
      const bridge = createStoryboardLocalBridgeServer({
        token: config.token,
        allowedOrigins: [config.allowedOrigin],
        providerCommand: process.execPath,
        providerArgs: [config.providerPath],
        outputDir: config.outputDir,
        fakeAuthReady: true,
        commandTimeoutMs: config.commandTimeoutMs,
      });
      bridge.server.listen(0, '127.0.0.1', () => {
        const address = bridge.server.address();
        process.stdout.write('READY:' + address.port + '\\n');
      });
      const stop = () => bridge.server.close(() => process.exit(0));
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
    })().catch(() => process.exit(2));
  `], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    env: { ...process.env, BRIDGE_SERVER_CONFIG: encodedConfig },
  });
  return new Promise<{ process: ChildProcess; baseUrl: string }>((resolveReady, rejectReady) => {
    let output = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/READY:(\d+)/);
      if (match?.[1]) resolveReady({ process: child, baseUrl: `http://127.0.0.1:${match[1]}` });
    });
    child.once('error', rejectReady);
    child.once('exit', (code) => {
      if (!output.includes('READY:')) rejectReady(new Error(`node bridge exited before listen: ${code}`));
    });
  });
}

async function stopNodeBridge(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExited) => child.once('exit', () => resolveExited()));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 1_000)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}
let localBridgeSessionSequence = 0;

async function openLocalBridgeSession(
  baseUrl: string,
  surface: 'storyboard' | 'thumbnail' = 'storyboard',
) {
  const sessionId = `test-session-${++localBridgeSessionSequence}`;
  const helperUrl = new URL(`${baseUrl}${LOCAL_BRIDGE_HELPER_ROUTE}`);
  helperUrl.searchParams.set(LOCAL_BRIDGE_HELPER_ORIGIN_QUERY_PARAM, allowedOrigin);
  helperUrl.searchParams.set(LOCAL_BRIDGE_HELPER_SESSION_QUERY_PARAM, sessionId);
  helperUrl.searchParams.set(LOCAL_BRIDGE_HELPER_SURFACE_QUERY_PARAM, surface);
  const response = await fetch(helperUrl);
  if (!response.ok) throw new Error(`helper session failed with ${response.status}`);
  const html = await response.text();
  const bindingMatch = html.match(/"sessionBinding":"([A-Za-z0-9_-]{32,128})"/);
  if (!bindingMatch?.[1]) throw new Error('helper session binding is missing');
  return {
    'X-Tzudong-Local-Bridge-Session': sessionId,
    'X-Tzudong-Local-Bridge-Binding': bindingMatch[1],
    'X-Tzudong-Local-Bridge-Nonce': sha256(`nonce-${sessionId}`),
  };
}

function closeServer(server: Server) {
  return new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
async function waitForCondition(condition: () => boolean, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return condition();
}

async function startAbortableBridgeRequest(
  url: string,
  headers: Record<string, string>,
  body: string,
) {
  const target = new URL(url);
  const requestHeaders = {
    Host: target.host,
    Connection: 'close',
    ...headers,
    'Content-Length': String(Buffer.byteLength(body, 'utf8')),
  };
  const wireRequest = [
    `POST ${target.pathname}${target.search} HTTP/1.1`,
    ...Object.entries(requestHeaders).map(([name, value]) => `${name}: ${value}`),
    '',
    body,
  ].join('\r\n');
  const encodedConfig = Buffer.from(JSON.stringify({
    host: target.hostname,
    port: Number(target.port),
    request: wireRequest,
  }), 'utf8').toString('base64');
  const client = spawn('node', ['-e', `
    const { createConnection } = require('node:net');
    const config = JSON.parse(Buffer.from(process.env.BRIDGE_ABORT_CONFIG, 'base64').toString('utf8'));
    const socket = createConnection({ host: config.host, port: config.port });
    socket.on('error', () => process.exit(2));
    socket.on('connect', () => {
      socket.write(config.request);
      process.stdout.write('READY\\n');
    });
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (command) => {
      if (command.includes('ABORT')) socket.end();
    });
    setInterval(() => {}, 1_000);
  `], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    env: { ...process.env, BRIDGE_ABORT_CONFIG: encodedConfig },
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    let output = '';
    client.stdout?.setEncoding('utf8');
    client.stdout?.on('data', (chunk) => {
      output += chunk;
      if (output.includes('READY\n')) resolveReady();
    });
    client.once('error', rejectReady);
    client.once('exit', (code) => {
      if (!output.includes('READY\n')) rejectReady(new Error(`abort fixture exited before connect: ${code}`));
    });
  });
  return client;
}

function isProviderProcessAlive(pidPath: string) {
  if (!existsSync(pidPath)) return false;
  const pid = Number(readFileSync(pidPath, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function expectProviderTreeCleanup(
  outputDir: string,
  directPidPath: string,
  grandchildPidPath: string,
) {
  const cleaned = await waitForCondition(() => (
    existsSync(outputDir) &&
    readdirSync(outputDir).length === 0 &&
    !isProviderProcessAlive(directPidPath) &&
    !isProviderProcessAlive(grandchildPidPath)
  ));
  expect({
    cleaned,
    outputEntries: existsSync(outputDir) ? readdirSync(outputDir) : ['<missing>'],
    directAlive: isProviderProcessAlive(directPidPath),
    grandchildAlive: isProviderProcessAlive(grandchildPidPath),
  }).toEqual({
    cleaned: true,
    outputEntries: [],
    directAlive: false,
    grandchildAlive: false,
  });
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

  test('keeps generated image data out of repeated local bridge request payloads', () => {
    const generatedImage = {
      dataUrl: `data:image/png;base64,${'a'.repeat(STORYBOARD_LOCAL_BRIDGE_MAX_BODY_BYTES)}`,
      mime: 'image/png',
      providerId: 'local-codex',
      trustPolicy: 'storyboard-gpt-image-2-panel-v1',
      model: 'gpt-image-2',
      prompt: 'previous generated image',
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
        responseId: 'resp_previous',
        imageCallId: 'ig_previous',
        imageItemCount: 1,
        rawImageItemTypes: ['image_generation_call'],
        requestHash: sha256('previous-request'),
        responseHash: sha256('previous-response'),
        hasOpenAIAPIKey: false,
        generatedAt: new Date().toISOString(),
      },
    } as const;
    const generatedScene = { ...scene, generatedImage };
    const generatedSourceResult = {
      ...sourceResult,
      storyboard: {
        ...sourceResult.storyboard,
        scenes: [generatedScene],
      },
    };

    const requestPayload = buildStoryboardLocalBridgeImagesRequest(generatedSourceResult, [generatedScene]);
    const serialized = JSON.stringify(requestPayload);

    expect(requestPayload.scenes[0]?.generatedImage).toBeUndefined();
    expect(requestPayload.sourceResult?.storyboard.scenes[0]?.generatedImage).toBeUndefined();
    expect(serialized).not.toContain('data:image/png;base64');
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(STORYBOARD_LOCAL_BRIDGE_MAX_BODY_BYTES);
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
    expect(html).toMatch(/"sessionBinding":"[A-Za-z0-9_-]{32,128}"/);
    expect(html).not.toContain(token);
    expect(html).toContain("redirect: 'error'");
    expect(html).toContain('url.origin === HELPER_CONFIG.bridgeOrigin');
    expect(html).not.toContain('message.bridgeUrl +');
  });
  test('rejects helper query confusion and one-time session nonce replays before provider invocation', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;
    const malformedHelper = await fetch(
      `${bridge.baseUrl}${LOCAL_BRIDGE_HELPER_ROUTE}?origin=${encodeURIComponent(allowedOrigin)}&session=replay-test&surface=storyboard&extra=1`,
    );
    expect(malformedHelper.status).toBe(400);
    const session = await openLocalBridgeSession(bridge.baseUrl);
    const headers = {
      Origin: allowedOrigin,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...session,
    };
    const first = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers,
      body: '{not-json',
    });
    expect(first.status).toBe(400);
    const replay = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers,
      body: '{not-json',
    });
    expect(replay.status).toBe(403);
    const queriedRoute = await fetch(`${bridge.baseUrl}/health?unexpected=1`, {
      headers: { Origin: allowedOrigin },
    });
    expect(queriedRoute.status).toBe(404);
    expect(existsSync(markerPath)).toBe(false);
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
    const malformedSession = await openLocalBridgeSession(bridge.baseUrl);
    const oversizedSession = await openLocalBridgeSession(bridge.baseUrl);

    const malformed = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...malformedSession,
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
        ...oversizedSession,
      },
      body: JSON.stringify({
        ...buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene]),
        scenes: Array.from({ length: 13 }, (_, index) => ({ ...scene, sceneNo: index + 1 })),
      }),
    });
    expect(oversized.status).toBe(400);
    expect(() => readFileSync(markerPath, 'utf8')).toThrow();
  });
  test('rejects path-like, non-integer, duplicate, and inherited storyboard scenes before provider work', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const outputDir = join(tempDir, 'out');
    const outsidePath = join(tempDir, 'scene-controlled-outside.png');
    const bridge = await listenBridge({ providerPath, outputDir });
    activeServer = bridge.server;
    const basePayload = buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene]);
    const invalidSceneNos: Array<{ label: string; sceneNo: unknown }> = [
      { label: 'POSIX traversal', sceneNo: '../../scene-controlled-outside' },
      { label: 'Windows traversal', sceneNo: '..\\..\\scene-controlled-outside' },
      { label: 'drive path', sceneNo: 'C:\\scene-controlled-outside' },
      { label: 'UNC path', sceneNo: '\\\\server\\share\\scene-controlled-outside' },
      { label: 'numeric string', sceneNo: '1' },
      { label: 'non-number null', sceneNo: null },
      { label: 'float', sceneNo: 1.5 },
      { label: 'below range', sceneNo: 0 },
      { label: 'above range', sceneNo: 13 },
    ];

    for (const { label, sceneNo } of invalidSceneNos) {
      const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(await openLocalBridgeSession(bridge.baseUrl)),
        },
        body: JSON.stringify({
          ...basePayload,
          scenes: [{ ...scene, sceneNo }],
        }),
      });
      expect(response.status, label).toBe(400);
    }
    const nanBody = JSON.stringify({
      ...basePayload,
      scenes: [{ ...scene, sceneNo: null }],
    }).replace('"sceneNo":null', '"sceneNo":NaN');
    const nanResponse = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(await openLocalBridgeSession(bridge.baseUrl)),
      },
      body: nanBody,
    });
    expect(nanResponse.status).toBe(400);

    const inheritedScene = Object.create({ ...scene });
    inheritedScene.sceneNo = scene.sceneNo;
    for (const invalidScene of [
      { ...scene, unexpected: 'reject-extra-scene-key' },
      inheritedScene,
    ]) {
      const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(await openLocalBridgeSession(bridge.baseUrl)),
        },
        body: JSON.stringify({
          ...basePayload,
          scenes: [invalidScene],
        }),
      });
      expect(response.status).toBe(400);
    }

    const duplicate = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(await openLocalBridgeSession(bridge.baseUrl)),
      },
      body: JSON.stringify({
        ...basePayload,
        scenes: [scene, { ...scene }],
      }),
    });
    expect(duplicate.status).toBe(400);
    expect(existsSync(markerPath)).toBe(false);
    expect(existsSync(outputDir)).toBe(false);
    expect(existsSync(outsidePath)).toBe(false);
  });

  test('generates only for valid, unique integer storyboard scene numbers', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;

    const session = await openLocalBridgeSession(bridge.baseUrl);
    const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...session,
      },
      body: JSON.stringify({
        ...buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene]),
        scenes: [scene, { ...scene, sceneNo: 2 }],
      }),
    });

    expect(response.status).toBe(200);
    const payload = normalizeStoryboardLocalBridgeImagesResponse(await response.json());
    expect(payload.images.map((image) => image.sceneNo)).toEqual([1, 2]);
    expect(new Set(payload.images.map((image) => image.sceneNo)).size).toBe(2);
    expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
  });

  test('emits only a fixed readiness code without the pairing token', async () => {
    const logs: string[] = [];
    const bridge = await startStoryboardLocalBridgeServer({
      host: '127.0.0.1',
      port: 0,
      token,
      fakeAuthReady: true,
      log: (message) => logs.push(message),
    });
    activeServer = bridge.server;

    expect(logs).toEqual(['code=storyboard_local_bridge_ready']);
    expect(logs.join('\n')).not.toContain(token);
  });

  test('returns trusted image for valid paired fake provider request', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const outputDir = join(tempDir, 'out');
    const bridge = await listenBridge({ providerPath, outputDir });
    activeServer = bridge.server;
    const session = await openLocalBridgeSession(bridge.baseUrl);

    const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...session,
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(response.status).toBe(200);
    const payload = normalizeStoryboardLocalBridgeImagesResponse(await response.json());
    expect(payload.images).toHaveLength(1);
    expect(payload.images[0].image.providerId).toBe('local-codex');
    expect(payload.images[0].image.dataUrl).toStartWith('data:image/png;base64,');
    expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
    expect(readdirSync(outputDir)).toEqual([]);
  });
  test('does not inherit API, Supabase, or authorization secrets into provider environment or response', async () => {
    const environmentKeys = [
      'OPENAI_API_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'TZUDONG_LOCAL_BRIDGE_TEST_SECRET',
      'AUTHORIZATION',
    ] as const;
    const previousEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, {
      OPENAI_API_KEY: 'test-openai-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'test-supabase-secret',
      TZUDONG_LOCAL_BRIDGE_TEST_SECRET: 'test-provider-secret',
      AUTHORIZATION: 'Bearer test-authorization-secret',
    });
    try {
      const { providerPath, markerPath } = writeFakeProvider(tempDir, 'environment-probe');
      const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out-env') });
      activeServer = bridge.server;
      const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(await openLocalBridgeSession(bridge.baseUrl)),
        },
        body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
      });
      expect(response.status).toBe(200);
      const serializedResponse = JSON.stringify(await response.json());
      const observedEnvironment = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, boolean>;
      for (const key of environmentKeys) {
        expect(observedEnvironment[key]).toBe(false);
      }
      expect(serializedResponse).not.toContain('test-openai-secret');
      expect(serializedResponse).not.toContain('test-supabase-secret');
      expect(serializedResponse).not.toContain('test-provider-secret');
      expect(serializedResponse).not.toContain('test-authorization-secret');
    } finally {
      for (const key of environmentKeys) {
        const value = previousEnvironment[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('accepts loopback helper origins for status and generation routes', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;
    const localhostOrigin = bridge.baseUrl.replace('127.0.0.1', 'localhost');

    const authSession = await openLocalBridgeSession(bridge.baseUrl);
    const storyboardSession = await openLocalBridgeSession(bridge.baseUrl);
    const health = await fetch(`${bridge.baseUrl}/health`, { headers: { Origin: bridge.baseUrl } });
    expect(health.status).toBe(200);
    const healthPayload = await health.json() as { endpoints?: { helper?: string } };
    expect(healthPayload.endpoints?.helper).toBe(LOCAL_BRIDGE_HELPER_ROUTE);

    const authStatus = await fetch(`${bridge.baseUrl}/auth-status`, {
      headers: {
        Origin: localhostOrigin,
        Authorization: `Bearer ${token}`,
        ...authSession,
      },
    });
    expect(authStatus.status).toBe(200);

    const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: bridge.baseUrl,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...storyboardSession,
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(response.status).toBe(200);
    expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
  });

  test('uses the Windows-safe default Python command for storyboard image providers', async () => {
    const { markerPath } = writeDefaultPythonProviderShim(tempDir);
    const previousPath = process.env.PATH;
    const previousPython = process.env.PYTHON;
    const previousProviderCommand = process.env.TZUDONG_LOCAL_BRIDGE_PROVIDER_COMMAND;
    const previousStoryboardCommand = process.env.STORYBOARD_LOCAL_CODEX_COMMAND;
    process.env.PATH = `${tempDir}${process.platform === 'win32' ? ';' : ':'}${previousPath ?? ''}`;
    delete process.env.PYTHON;
    delete process.env.TZUDONG_LOCAL_BRIDGE_PROVIDER_COMMAND;
    delete process.env.STORYBOARD_LOCAL_CODEX_COMMAND;

    try {
      const bridge = createStoryboardLocalBridgeServer({
        token,
        allowedOrigins: [allowedOrigin],
        outputDir: join(tempDir, 'out'),
        fakeAuthReady: true,
        commandTimeoutMs: 2000,
      });
      activeServer = bridge.server;
      await new Promise<void>((resolveListen, rejectListen) => {
        bridge.server.once('error', rejectListen);
        bridge.server.listen(0, '127.0.0.1', () => resolveListen());
      });
      const address = bridge.server.address();
      if (!address || typeof address === 'string') throw new Error('bridge did not bind to a TCP port');

      const baseUrl = `http://127.0.0.1:${address.port}`;
      const session = await openLocalBridgeSession(baseUrl);
      const response = await fetch(`${baseUrl}/v1/storyboard/images`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...session,
        },
        body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
      });
      expect(response.status).toBe(200);
      const invokedScriptPath = readFileSync(markerPath, 'utf8');
      expect(invokedScriptPath).toContain('default-python-provider');
      expect(invokedScriptPath.replaceAll('\\\\', '/')).toContain(
        'apps/web/scripts/codex-imagegen-storyboard-provider.py',
      );
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousPython === undefined) delete process.env.PYTHON;
      else process.env.PYTHON = previousPython;
      if (previousProviderCommand === undefined) delete process.env.TZUDONG_LOCAL_BRIDGE_PROVIDER_COMMAND;
      else process.env.TZUDONG_LOCAL_BRIDGE_PROVIDER_COMMAND = previousProviderCommand;
      if (previousStoryboardCommand === undefined) delete process.env.STORYBOARD_LOCAL_CODEX_COMMAND;
      else process.env.STORYBOARD_LOCAL_CODEX_COMMAND = previousStoryboardCommand;
    }
  });

  test('runs configured Windows cmd provider commands for storyboard and thumbnail routes', async () => {
    if (process.platform !== 'win32') return;

    const { commandPath, markerPath } = writeWindowsCmdProviderShim(tempDir);
    const bridge = createStoryboardLocalBridgeServer({
      token,
      allowedOrigins: [allowedOrigin],
      providerCommand: commandPath,
      thumbnailProviderCommand: commandPath,
      thumbnailProviderArgs: ['{output}'],
      outputDir: join(tempDir, 'out'),
      fakeAuthReady: true,
      commandTimeoutMs: 2000,
    });
    activeServer = bridge.server;
    await new Promise<void>((resolveListen, rejectListen) => {
      bridge.server.once('error', rejectListen);
      bridge.server.listen(0, '127.0.0.1', () => resolveListen());
    });
    const address = bridge.server.address();
    if (!address || typeof address === 'string') throw new Error('bridge did not bind to a TCP port');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const storyboardSession = await openLocalBridgeSession(baseUrl);
    const thumbnailSession = await openLocalBridgeSession(baseUrl, 'thumbnail');

    const storyboardResponse = await fetch(`${baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...storyboardSession,
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(storyboardResponse.status).toBe(200);

    const thumbnailResponse = await fetch(`${baseUrl}/v1/youtube-thumbnail/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...thumbnailSession,
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
    expect(thumbnailResponse.status).toBe(200);
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

    const session = await openLocalBridgeSession(bridge.baseUrl, 'thumbnail');
    const response = await fetch(`${bridge.baseUrl}/v1/youtube-thumbnail/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...session,
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
  test('rejects non-canonical, MIME-mismatched, or oversized-dimension thumbnail references before provider invocation', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir);
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;
    const payload = {
      providerId: 'local-codex' as const,
      generationMode: 'direct_provider' as const,
      topic: '안전한 참조 이미지 검증',
      headline: '참조 검증',
      acknowledgedSafety: true,
      textLayers: [],
    };
    for (const referenceImage of [
      { name: 'noncanonical.png', mime: 'image/png' as const, role: 'host' as const, dataBase64: `${tinyPngBase64}\n` },
      { name: 'mismatch.jpg', mime: 'image/jpeg' as const, role: 'host' as const, dataBase64: tinyPngBase64 },
      { name: 'oversized-dimensions.png', mime: 'image/png' as const, role: 'host' as const, dataBase64: oversizedPngBase64 },
    ]) {
      const response = await fetch(`${bridge.baseUrl}/v1/youtube-thumbnail/images`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(await openLocalBridgeSession(bridge.baseUrl, 'thumbnail')),
        },
        body: JSON.stringify(buildThumbnailLocalBridgeImagesRequest(payload, [referenceImage])),
      });
      expect(response.status).toBe(400);
    }
    expect(existsSync(markerPath)).toBe(false);
  });

  test('fails closed when thumbnail provider reports an output path outside the expected run output', async () => {
    const { providerPath, markerPath } = writeFakeProvider(tempDir, 'path-mismatch');
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;
    const session = await openLocalBridgeSession(bridge.baseUrl, 'thumbnail');

    const response = await fetch(`${bridge.baseUrl}/v1/youtube-thumbnail/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...session,
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
  test('rejects wrong-format, byte-mismatched, and hash-mismatched provider files before disclosure and removes run artifacts', async () => {
    for (const mode of ['wrong-format', 'bytes-mismatch', 'hash-mismatch'] as const) {
      const { providerPath, markerPath } = writeFakeProvider(tempDir, mode);
      const outputDir = join(tempDir, `out-${mode}`);
      const bridge = await listenBridge({ providerPath, outputDir });
      activeServer = bridge.server;
      const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(await openLocalBridgeSession(bridge.baseUrl)),
        },
        body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
      });
      expect(response.status, mode).toBe(502);
      expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
      expect(readdirSync(outputDir), mode).toEqual([]);
      await closeServer(bridge.server);
      activeServer = null;
    }
  });

  test('rejects provider symlink outputs on POSIX before disclosure', async () => {
    if (process.platform === 'win32') return;
    const { providerPath, markerPath } = writeFakeProvider(tempDir, 'symlink-output');
    const outputDir = join(tempDir, 'out-symlink');
    const bridge = await listenBridge({ providerPath, outputDir });
    activeServer = bridge.server;
    const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(await openLocalBridgeSession(bridge.baseUrl)),
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(response.status).toBe(502);
    expect(readFileSync(markerPath, 'utf8')).toBe('invoked');
    expect(readdirSync(outputDir)).toEqual([]);
  });

  test('fails closed on misleading provider success output with non-zero exit', async () => {
    const { providerPath } = writeFakeProvider(tempDir, 'misleading-failure');
    const bridge = await listenBridge({ providerPath, outputDir: join(tempDir, 'out') });
    activeServer = bridge.server;
    const session = await openLocalBridgeSession(bridge.baseUrl);

    const response = await fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...session,
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain(token);
    expect(text).toContain('Provider execution failed.');
  });

  test('removes direct-child and grandchild provider trees before returning a timeout response', async () => {
    const outputDir = join(tempDir, 'out-timeout-tree');
    const { providerPath, directPidPath, grandchildPidPath } = writeProcessTreeProvider(tempDir, 'hanging');
    const bridge = await listenBridge({
      providerPath,
      outputDir,
      commandTimeoutMs: 500,
    });
    activeServer = bridge.server;
    const pending = fetch(`${bridge.baseUrl}/v1/storyboard/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(await openLocalBridgeSession(bridge.baseUrl)),
      },
      body: JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene])),
    });
    expect(await waitForCondition(() => (
      existsSync(directPidPath) && existsSync(grandchildPidPath)
    ))).toBe(true);

    const response = await pending;
    expect(response.status).toBe(504);
    expect((await response.text())).toContain('timed out');
    await expectProviderTreeCleanup(outputDir, directPidPath, grandchildPidPath);
  });

  test('removes direct-child and grandchild thumbnail provider trees after output overflow', async () => {
    const outputDir = join(tempDir, 'out-overflow-tree');
    const { providerPath, directPidPath, grandchildPidPath } = writeProcessTreeProvider(tempDir, 'overflow');
    const bridge = await listenBridge({
      providerPath,
      thumbnailProviderPath: providerPath,
      outputDir,
      commandTimeoutMs: 5_000,
    });
    activeServer = bridge.server;
    const pending = fetch(`${bridge.baseUrl}/v1/youtube-thumbnail/images`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(await openLocalBridgeSession(bridge.baseUrl, 'thumbnail')),
      },
      body: JSON.stringify(buildThumbnailLocalBridgeImagesRequest({
        providerId: 'local-codex',
        generationMode: 'direct_provider',
        topic: '프로세스 트리 오버플로 테스트',
        headline: '출력 제한',
        acknowledgedSafety: true,
        textLayers: [],
      }, [])),
    });
    expect(await waitForCondition(() => (
      existsSync(directPidPath) && existsSync(grandchildPidPath)
    ))).toBe(true);

    const response = await pending;
    expect(response.status).toBe(502);
    await expectProviderTreeCleanup(outputDir, directPidPath, grandchildPidPath);
  });

  test('removes private run artifacts and direct-child/grandchild trees when the client aborts', async () => {
    const outputDir = join(tempDir, 'out-abort-tree');
    const { providerPath, directPidPath, grandchildPidPath } = writeProcessTreeProvider(tempDir, 'hanging');
    const bridge = await listenBridgeInNode({
      providerPath,
      outputDir,
      commandTimeoutMs: 5_000,
    });
    let pending: Awaited<ReturnType<typeof startAbortableBridgeRequest>> | undefined;
    try {
      const sessionHeaders = await openLocalBridgeSession(bridge.baseUrl);
      const body = JSON.stringify(buildStoryboardLocalBridgeImagesRequest(sourceResult, [scene]));
      pending = await startAbortableBridgeRequest(
        `${bridge.baseUrl}/v1/storyboard/images`,
        {
          Origin: allowedOrigin,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...sessionHeaders,
        },
        body,
      );
      expect(await waitForCondition(() => (
        existsSync(directPidPath) && existsSync(grandchildPidPath)
      ))).toBe(true);

      pending.stdin?.end('ABORT\n');
      await expectProviderTreeCleanup(outputDir, directPidPath, grandchildPidPath);
    } finally {
      pending?.kill('SIGKILL');
      await stopNodeBridge(bridge.process);
    }
  });
});
