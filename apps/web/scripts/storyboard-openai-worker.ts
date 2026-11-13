/** Dedicated OpenAI outbound worker. OPENAI_API_KEY is read only from process environment. */
import { parseArgs } from 'node:util';
import { OpenAIStoryboardClient } from '../lib/admin/storyboard/openai-client';
import { OutboundStoryboardWorker, StoryboardWorkerTransport, readStoryboardWorkerToken, storyboardWorkerErrorCode } from '../lib/admin/storyboard/outbound-worker';
const stop = new AbortController(); const shutdown = () => stop.abort();
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
try {
  const { values } = parseArgs({ options: { origin: { type: 'string' }, 'token-file': { type: 'string' }, once: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } }, strict: true });
  if (values.help) console.log('Usage: OPENAI_API_KEY=... bun scripts/storyboard-openai-worker.ts --origin https://www.tzudong.app --token-file /private/worker-token [--once]');
  else {
    if (process.env.CI || !values.origin || !values['token-file']) throw new Error('explicit_worker_configuration_required');
    const client = new OpenAIStoryboardClient({ env: process.env, onUsage: usage => console.log(JSON.stringify({ event: 'openai_usage', ...usage })) });
    const api = new StoryboardWorkerTransport({ origin: values.origin, token: await readStoryboardWorkerToken(values['token-file']) });
    const worker = new OutboundStoryboardWorker({ api, openai: client, onEvent: event => console.log(JSON.stringify(event)) });
    console.log(JSON.stringify({ event: 'worker_started', provider: 'openai-api', projectConcurrency: 1 }));
    const result = await worker.run({ signal: stop.signal, once: values.once });
    if (values.once && ['failed', 'lease_lost'].includes(result)) process.exitCode = 1;
  }
} catch (error) { if (!stop.signal.aborted) { console.error(JSON.stringify({ event: 'worker_stopped', code: storyboardWorkerErrorCode(error) })); process.exitCode = 1; } }
finally { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); }
