/** Explicit Mac worker. No launch agent, credential provisioning, external enablement or paid retry is implied. */
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import { GeminiThumbnailWorkerClient } from '../lib/admin/youtube-thumbnail-generator/gemini-worker-client';
import { GeminiThumbnailChatWorkerClient } from '../lib/admin/youtube-thumbnail-generator/chat-gemini-client';
import { ThumbnailWorkerOutbox } from '../lib/admin/youtube-thumbnail-generator/worker-outbox';
import { OutboundThumbnailWorker, ThumbnailWorkerTransport, readThumbnailWorkerFile,
  thumbnailWorkerErrorCode } from '../lib/admin/youtube-thumbnail-generator/outbound-worker';

const stop = new AbortController(); const shutdown = () => stop.abort();
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
let outbox: ThumbnailWorkerOutbox | undefined;
try {
  const { values } = parseArgs({ options: { origin: { type: 'string' }, 'token-file': { type: 'string' },
    'env-file': { type: 'string' }, 'outbox-dir': { type: 'string' }, once: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false } }, strict: true });
  if (values.help) {
    console.log('Usage: bun scripts/thumbnail-gemini-worker.ts --origin https://www.tzudong.app --token-file /private/worker-token --outbox-dir /private/thumbnail-outbox [--env-file /private/operator-env] [--once]');
  } else {
    if (process.env.CI || !values.origin || !values['token-file'] || !values['outbox-dir']) throw new Error('invalid configuration');
    // Read existing operator-managed files only. Do not create/copy a key or accept one on the command line.
    const env: NodeJS.ProcessEnv = values['env-file'] ? { ...parse(await readThumbnailWorkerFile(values['env-file'], 256 * 1024)), NODE_ENV: 'production' } : process.env;
    const token = (await readThumbnailWorkerFile(values['token-file'], 130)).toString('utf8').replace(/\r?\n$/, '');
    const api = new ThumbnailWorkerTransport({ origin: values.origin, token });
    outbox = new ThumbnailWorkerOutbox(values['outbox-dir']);
    const gemini = () => new GeminiThumbnailWorkerClient({ env, onUsage: (usage) => console.log(JSON.stringify({ event: 'gemini_usage', ...usage })) });
    const chatGemini = () => new GeminiThumbnailChatWorkerClient({ env, onUsage: (usage) => console.log(JSON.stringify({ event: 'gemini_usage', ...usage })) });
    const worker = new OutboundThumbnailWorker({ api, outbox, gemini, chatGemini, onEvent: (event) => console.log(JSON.stringify(event)) });
    console.log(JSON.stringify({ event: 'worker_started', provider: 'gemini-api', projectConcurrency: 1 }));
    if (await worker.run({ signal: stop.signal, once: values.once }) === 'held') process.exitCode = 1;
  }
} catch (error) {
  if (!stop.signal.aborted) { console.error(JSON.stringify({ event: 'worker_stopped', code: thumbnailWorkerErrorCode(error) })); process.exitCode = 1; }
} finally {
  outbox?.close(); process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
}
