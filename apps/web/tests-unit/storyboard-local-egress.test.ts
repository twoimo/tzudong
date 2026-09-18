import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
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
 *
 * The proxy and global-fetch cases run in a throwaway child process
 * (storyboard-local-egress-child.ts). bun memoizes the proxy configuration
 * inside fetch for the lifetime of a process, so setting the proxy variables and
 * then restoring them here would leave every later fetch in this shared bun test
 * process dialing the proxy; that already broke admin-storyboard-local-bridge
 * on CI. The child keeps the side effect contained.
 */

type EgressChildReport = {
  proxyStatus?: string;
  proxyConnections?: number;
  proxyReceipts?: { host: string; remoteAddress?: string }[];
  fetchCalls?: string[];
  draftTitle?: string;
  imageBytes?: number;
  imageProvenance?: Record<string, unknown>;
};

const servers: Server[] = [];
let egressChild: EgressChildReport | undefined;

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

beforeAll(() => {
  const child = spawnSync(process.execPath, [join(import.meta.dir, 'storyboard-local-egress-child.ts')], {
    encoding: 'utf8', timeout: 60_000,
  });
  const line = (child.stdout ?? '').trim().split('\n').at(-1) ?? '';
  if (!line.startsWith('{')) throw new Error(`egress child report missing: ${child.error?.message ?? child.stderr ?? child.stdout ?? ''}`);
  egressChild = JSON.parse(line) as EgressChildReport;
});

afterAll(() => {
  for (const server of servers) { server.closeAllConnections(); server.close(); }
});

describe('local-only egress boundary', () => {
  test('connects to literal loopback even when every proxy variable points elsewhere', () => {
    expect(egressChild?.proxyStatus).toBe('ok');
    expect(egressChild?.proxyConnections).toBe(0);
    expect(egressChild?.proxyReceipts).toHaveLength(1);
    expect(egressChild?.proxyReceipts?.[0].host).toBe('127.0.0.1');
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(egressChild?.proxyReceipts?.[0].remoteAddress ?? '');
  });

  test('never routes a model call through the global fetch stack', () => {
    expect(egressChild?.fetchCalls).toEqual([]);
    expect(egressChild?.draftTitle).toBe('t');
    expect(egressChild?.imageBytes).toBe(18);
    expect(egressChild?.imageProvenance).toMatchObject({
      providerId: 'local-mlx', model: 'installed-image', verification: 'local-worker',
    });
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
