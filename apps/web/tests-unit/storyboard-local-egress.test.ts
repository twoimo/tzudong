import { afterAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { MlxTransport, type MlxDestinationReceipt } from '../lib/admin/storyboard/mlx-transport';
import { MlxStoryboardClient } from '../lib/admin/storyboard/mlx-client';
import {
  STORYBOARD_WORKFLOW, storyboardProductionRequestSchema,
} from '../lib/admin/storyboard/production-contract';

/**
 * Local-only egress boundary. These cases pin the properties that keep the MLX
 * adapter off the network: literal loopback sockets that ignore proxy
 * environment variables, external providers blocked before a socket is opened,
 * and a retrieval requirement that fails closed instead of calling a provider.
 */

const servers: Server[] = [];
const savedEnv: Record<string, string | undefined> = {};
const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy'] as const;

function request(text = 'local-mlx', image = 'local-mlx', externalAI = false, retrieval: 'none' | 'bge-local' = 'none') {
  return storyboardProductionRequestSchema.parse({
    workflow: STORYBOARD_WORKFLOW, requestId: randomUUID(), prompt: '지역 음식 문화 소개', sceneCount: 5,
    providers: {
      externalAI,
      text: { id: text, model: text === 'local-mlx' ? 'installed-text' : 'cloud-text-model' },
      image: { id: image, model: image === 'local-mlx' ? 'installed-image' : 'cloud-image-model' },
    },
    retrieval,
  });
}

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address');
  return { origin: `http://127.0.0.1:${address.port}`, port: address.port };
}

afterAll(() => {
  for (const server of servers) { server.closeAllConnections(); server.close(); }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function setProxyEnv(value: string) {
  for (const key of PROXY_KEYS) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
}

describe('local-only egress boundary', () => {
  test('connects to literal loopback even when every proxy variable points elsewhere', async () => {
    let proxyConnections = 0;
    const proxy = createServer((_req, res) => { proxyConnections++; res.end('{}'); });
    proxy.on('connection', () => { proxyConnections++; });
    const { port: proxyPort } = await listen(proxy);

    const receipts: MlxDestinationReceipt[] = [];
    const model = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
    });
    const { origin } = await listen(model);

    setProxyEnv(`http://127.0.0.1:${proxyPort}`);
    try {
      // A proxy-aware client would dial the proxy port and never answer here.
      expect((await new MlxTransport({ origin, onDestination: (receipt) => receipts.push(receipt) }).request('/health')).status).toBe('ok');
    } finally {
      for (const key of PROXY_KEYS) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]!; }
    }

    expect(proxyConnections).toBe(0);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].host).toBe('127.0.0.1');
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(receipts[0].remoteAddress);
  });

  test('never routes a model call through the global fetch stack', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    const model = createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/health') return res.end('{"status":"ok"}');
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [
        { id: 'installed-text', owned_by: 'mlx-serve', capabilities: ['chat'], bytes_on_disk: 100 },
        { id: 'installed-image', owned_by: 'mlx-serve', capabilities: ['image'], bytes_on_disk: 100 },
      ] }));
      if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ id: 'r1', model: 'installed-text',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: 't', logline: 'l', scenes: Array.from({ length: 5 }, (_, index) => ({
          sceneNo: index + 1, title: `s${index + 1}`, durationSec: 10, description: 'd', visualDirection: 'v', narration: '',
          caption: '', productionNotes: ['n'], imagePrompt: 'p', sourceIds: [],
        })) }) } }] }));
      return res.end(JSON.stringify({ id: 'r2', model: 'installed-image', data: [{ b64_json: 'A'.repeat(24) }] }));
    });
    const { origin } = await listen(model);
    globalThis.fetch = (async (input: unknown) => { calls.push(String(input)); throw new Error('fetch_must_not_be_used'); }) as typeof globalThis.fetch;
    try {
      const client = new MlxStoryboardClient(new MlxTransport({ origin }));
      await client.draft(request());
      const generated = await client.image(request(), 'a wooden table');
      expect(generated.bytes).toHaveLength(18);
      expect(generated.provenance).toMatchObject({ providerId: 'local-mlx', model: 'installed-image', verification: 'local-worker' });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls).toEqual([]);
  });

  test('rejects an external provider before any socket is opened', async () => {
    const receipts: MlxDestinationReceipt[] = [];
    const model = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); });
    const { origin } = await listen(model);
    const client = new MlxStoryboardClient(new MlxTransport({ origin, onDestination: (receipt) => receipts.push(receipt) }));

    for (const id of ['openai-api', 'xai-api', 'chatgpt-manual', 'grok-manual'] as const) {
      await expect(client.draft(request(id, id))).rejects.toThrow('external_ai_disabled');
      await expect(client.image(request(id, id), 'prompt')).rejects.toThrow('external_ai_disabled');
    }
    expect(receipts).toEqual([]);
  });

  test('consent for external AI never turns the local adapter into a cloud client', async () => {
    const receipts: MlxDestinationReceipt[] = [];
    const model = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); });
    const { origin } = await listen(model);
    const client = new MlxStoryboardClient(new MlxTransport({ origin, onDestination: (receipt) => receipts.push(receipt) }));

    for (const id of ['openai-api', 'xai-api'] as const) {
      await expect(client.draft(request(id, 'local-mlx', true))).rejects.toThrow('provider_not_configured');
      await expect(client.image(request('local-mlx', id, true), 'prompt')).rejects.toThrow('provider_not_configured');
    }
    for (const id of ['chatgpt-manual', 'grok-manual', 'manual'] as const) {
      await expect(client.draft(request(id, 'local-mlx', true))).rejects.toThrow('provider_not_configured');
    }
    expect(receipts).toEqual([]);
  });

  test('retrieval fails closed instead of reaching any embedding provider', async () => {
    const receipts: MlxDestinationReceipt[] = [];
    const paths: string[] = [];
    const model = createServer((req, res) => {
      req.resume(); paths.push(req.url!);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}');
    });
    const { origin } = await listen(model);
    const client = new MlxStoryboardClient(new MlxTransport({ origin, onDestination: (receipt) => receipts.push(receipt) }));

    await expect(client.draft(request('local-mlx', 'local-mlx', false, 'bge-local'))).rejects.toThrow('bge_dependency_unavailable');
    expect(paths).toEqual([]);
    expect(receipts).toEqual([]);
  });
});
