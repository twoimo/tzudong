/** Explicit outbound worker. Uses only a scoped worker token, never a DB service key. */
import { parseArgs } from 'node:util';
import { MlxTransport } from '../lib/admin/storyboard/mlx-transport.ts';
import { MlxStoryboardClient } from '../lib/admin/storyboard/mlx-client.ts';
import {
  OutboundStoryboardWorker, StoryboardWorkerTransport, readStoryboardWorkerToken, storyboardWorkerErrorCode,
} from '../lib/admin/storyboard/outbound-worker.ts';

const stop = new AbortController();
const shutdown = () => stop.abort();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  const { values } = parseArgs({ options: {
    origin: { type: 'string' }, 'token-file': { type: 'string' }, 'mlx-origin': { type: 'string' },
    once: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  }, strict: true });
  if (values.help) {
    console.log('Usage: node scripts/storyboard-mlx-worker.ts --origin http://127.0.0.1:8080 --token-file /private/path/worker-token [--mlx-origin http://127.0.0.1:11234] [--once]');
    console.log('Token file: current user, mode 0600, canonical base64url from at least 32 random bytes. Provision its SHA256 in the worker table first. Only local loopback or https://tzudong.app is admitted.');
  } else {
    if (process.env.CI || !values.origin || !values['token-file']) throw new Error('explicit_worker_configuration_required');
    const token = await readStoryboardWorkerToken(values['token-file']);
    const api = new StoryboardWorkerTransport({ origin: values.origin, token });
    const mlx = new MlxStoryboardClient(new MlxTransport({ origin: values['mlx-origin'], timeoutMs: 600_000 }));
    const worker = new OutboundStoryboardWorker({ api, mlx, onEvent: (event) => console.log(JSON.stringify(event)) });
    console.log(JSON.stringify({ event: 'worker_started' }));
    const result = await worker.run({ signal: stop.signal, once: values.once });
    if (values.once && (result === 'failed' || result === 'lease_lost')) process.exitCode = 1;
  }
} catch (error) {
  if (!stop.signal.aborted) {
    console.error(JSON.stringify({ event: 'worker_stopped', code: storyboardWorkerErrorCode(error) }));
    process.exitCode = 1;
  }
} finally {
  process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
}
