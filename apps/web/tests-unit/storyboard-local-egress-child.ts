/**
 * Process-global egress cases for the local MLX adapter, run in a throwaway
 * child process by storyboard-local-egress.test.ts.
 *
 * bun memoizes the proxy configuration inside fetch for the lifetime of a
 * process: setting the proxy variables and then restoring them still leaves
 * every later fetch in that process dialing the proxy. Keeping these two cases
 * in a child process means the shared bun test process never sees them.
 *
 * The report is written to stdout as a single JSON line. No assertion lives
 * here; the parent test owns them.
 */
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { MlxTransport, type MlxDestinationReceipt } from '../lib/admin/storyboard/mlx-transport';
import { MlxStoryboardClient } from '../lib/admin/storyboard/mlx-client';
import {
  STORYBOARD_WORKFLOW, storyboardProductionRequestSchema,
} from '../lib/admin/storyboard/production-contract';

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy'] as const;
const servers: Server[] = [];

function request() {
  return storyboardProductionRequestSchema.parse({
    workflow: STORYBOARD_WORKFLOW, requestId: randomUUID(), prompt: '지역 음식 문화 소개', sceneCount: 5,
    providers: {
      externalAI: false,
      text: { id: 'local-mlx', model: 'installed-text' },
      image: { id: 'local-mlx', model: 'installed-image' },
    },
    retrieval: 'none',
  });
}

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address');
  return { origin: `http://127.0.0.1:${address.port}`, port: address.port };
}

const report: Record<string, unknown> = {};

// Case A: every proxy variable points at a live proxy that must never be dialed.
{
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

  for (const key of PROXY_KEYS) process.env[key] = `http://127.0.0.1:${proxyPort}`;
  const response = await new MlxTransport({ origin, onDestination: (receipt) => receipts.push(receipt) }).request('/health');
  report.proxyStatus = response.status;
  report.proxyConnections = proxyConnections;
  report.proxyReceipts = receipts.map((receipt) => ({ host: receipt.host, remoteAddress: receipt.remoteAddress }));
}

// Case B: the adapter must not touch the global fetch implementation.
{
  const calls: string[] = [];
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

  const client = new MlxStoryboardClient(new MlxTransport({ origin }));
  const drafted = await client.draft(request());
  const generated = await client.image(request(), 'a wooden table');
  report.fetchCalls = calls;
  report.draftTitle = drafted.draft.title;
  report.imageBytes = generated.bytes.length;
  report.imageProvenance = generated.provenance;
}

for (const server of servers) { server.closeAllConnections(); server.close(); }
process.stdout.write(`${JSON.stringify(report)}\n`);
