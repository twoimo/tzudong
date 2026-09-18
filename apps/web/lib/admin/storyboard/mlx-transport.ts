import http from 'node:http';
import { StoryboardProductionError, MAX_STORYBOARD_IMAGE_BYTES } from './production-contract.ts';

const PATHS = ['/health', '/v1/models', '/v1/chat/completions', '/v1/images/generations'] as const;
export type MlxPath = typeof PATHS[number];
export type MlxDestinationReceipt = {
  method: 'GET' | 'POST'; host: string; port: string; path: MlxPath;
  connected: true; remoteAddress: string; remotePort: number;
};

export function validateMlxOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new StoryboardProductionError('invalid_local_endpoint'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new StoryboardProductionError('invalid_local_endpoint');
  }
  return url;
}

function httpFailure(status: number): StoryboardProductionError {
  if (status === 401) return new StoryboardProductionError('provider_auth_failed');
  if (status === 403) return new StoryboardProductionError('provider_forbidden');
  if (status === 429) return new StoryboardProductionError('provider_rate_limited', true);
  return new StoryboardProductionError('provider_failed', status >= 500);
}

/** Uses literal loopback sockets; never DNS, proxy environment variables, or redirects. */
export class MlxTransport {
  readonly origin: URL;
  private readonly timeoutMs: number;
  private readonly onDestination?: (receipt: MlxDestinationReceipt) => void;

  constructor(options: { origin?: string; timeoutMs?: number; onDestination?: (receipt: MlxDestinationReceipt) => void } = {}) {
    this.origin = validateMlxOrigin(options.origin ?? 'http://127.0.0.1:11234');
    this.timeoutMs = options.timeoutMs ?? 180_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 600_000) {
      throw new StoryboardProductionError('invalid_local_endpoint');
    }
    this.onDestination = options.onDestination;
  }

  async request(path: MlxPath, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!PATHS.includes(path)) throw new StoryboardProductionError('invalid_local_endpoint');
    if (signal?.aborted) throw new StoryboardProductionError('generation_cancelled');
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    if (payload && payload.length > 128 * 1024) throw new StoryboardProductionError('invalid_model_request');
    const maxBytes = path === '/v1/images/generations' ? Math.ceil(MAX_STORYBOARD_IMAGE_BYTES * 4 / 3) + 65536 : 512 * 1024;
    const method = payload ? 'POST' : 'GET';
    return new Promise((resolve, reject) => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: StoryboardProductionError, result?: Record<string, unknown>) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(result ?? {});
      };
      const req = http.request({
        hostname: this.origin.hostname.replace(/^\[|\]$/g, ''), port: this.origin.port || 80,
        method, path, agent: false,
        headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) },
      }, (res) => {
        if (res.statusCode !== 200) {
          finish(httpFailure(res.statusCode ?? 0));
          res.destroy();
          return;
        }
        if (!res.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          finish(new StoryboardProductionError('invalid_model_response'));
          res.destroy();
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            finish(new StoryboardProductionError('model_response_too_large'));
            res.destroy();
          } else chunks.push(chunk);
        });
        res.on('error', () => finish(new StoryboardProductionError('local_model_unavailable', true)));
        res.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
            finish(undefined, parsed as Record<string, unknown>);
          } catch { finish(new StoryboardProductionError('invalid_model_response')); }
        });
      });
      req.on('socket', (socket) => {
        socket.once('connect', () => {
          if (!socket.remoteAddress || !socket.remotePort
            || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.remoteAddress)) {
            finish(new StoryboardProductionError('invalid_local_endpoint'));
            req.destroy();
            return;
          }
          this.onDestination?.({
            method, host: this.origin.hostname, port: this.origin.port || '80', path,
            connected: true, remoteAddress: socket.remoteAddress, remotePort: socket.remotePort,
          });
        });
      });
      const abort = () => {
        finish(new StoryboardProductionError('generation_cancelled'));
        req.destroy();
      };
      timer = setTimeout(() => {
        finish(new StoryboardProductionError('model_timeout'));
        req.destroy();
      }, path === '/health' || path === '/v1/models' ? Math.min(5000, this.timeoutMs) : this.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      req.on('error', () => finish(new StoryboardProductionError('local_model_unavailable', true)));
      if (signal?.aborted) abort(); else req.end(payload);
    });
  }
}
