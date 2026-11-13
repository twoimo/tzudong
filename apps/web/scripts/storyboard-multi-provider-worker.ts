/** Optional dual-provider worker required only for mixed Gemini/OpenAI requests. */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parse } from 'dotenv';
import { GeminiStoryboardClient } from '../lib/admin/storyboard/gemini-client';
import { OpenAIStoryboardClient } from '../lib/admin/storyboard/openai-client';
import { OutboundStoryboardWorker, StoryboardWorkerTransport, readStoryboardWorkerToken, storyboardWorkerErrorCode } from '../lib/admin/storyboard/outbound-worker';
const stop = new AbortController(); const shutdown = () => stop.abort();
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
try {
  const { values } = parseArgs({ options: { origin: { type: 'string' }, 'token-file': { type: 'string' }, 'env-file': { type: 'string' }, once: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } }, strict: true });
  if (values.help) console.log('Usage: bun scripts/storyboard-multi-provider-worker.ts --origin https://www.tzudong.app --token-file /private/worker-token [--env-file /private/operator-env] [--once]');
  else {
    if (process.env.CI || !values.origin || !values['token-file']) throw new Error('explicit_worker_configuration_required');
    if (values['env-file'] && !isAbsolute(values['env-file'])) throw new Error('absolute_operator_env_required');
    const env: NodeJS.ProcessEnv = values['env-file'] ? { ...parse(readFileSync(values['env-file'])), NODE_ENV: 'production' } : process.env;
    const gemini = new GeminiStoryboardClient({ env, onUsage: usage => console.log(JSON.stringify({ event: 'gemini_usage', ...usage })) });
    const openai = new OpenAIStoryboardClient({ env, onUsage: usage => console.log(JSON.stringify({ event: 'openai_usage', ...usage })) });
    const api = new StoryboardWorkerTransport({ origin: values.origin, token: await readStoryboardWorkerToken(values['token-file']) });
    const worker = new OutboundStoryboardWorker({ api, gemini, openai, onEvent: event => console.log(JSON.stringify(event)) });
    console.log(JSON.stringify({ event: 'worker_started', providers: ['gemini-api', 'openai-api'], projectConcurrency: 1 }));
    const result = await worker.run({ signal: stop.signal, once: values.once });
    if (values.once && ['failed', 'lease_lost'].includes(result)) process.exitCode = 1;
  }
} catch (error) { if (!stop.signal.aborted) { console.error(JSON.stringify({ event: 'worker_stopped', code: storyboardWorkerErrorCode(error) })); process.exitCode = 1; } }
finally { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); }
