/** Explicit Gemini worker; database progress is controlled by the existing scoped worker token. */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parse } from 'dotenv';
import { GeminiStoryboardClient } from '../lib/admin/storyboard/gemini-client';
import { OutboundStoryboardWorker, StoryboardWorkerTransport, readStoryboardWorkerToken, storyboardWorkerErrorCode } from '../lib/admin/storyboard/outbound-worker';

const stop = new AbortController();
const shutdown = () => stop.abort();
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
try {
  const { values } = parseArgs({ options: {
    origin: { type: 'string' }, 'token-file': { type: 'string' }, 'env-file': { type: 'string' },
    once: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  }, strict: true });
  if (values.help) {
    console.log('Usage: bun scripts/storyboard-gemini-worker.ts --origin https://www.tzudong.app --token-file /private/worker-token [--env-file /private/operator-env] [--once]');
  } else {
    if (process.env.CI || !values.origin || !values['token-file']) throw new Error('explicit_worker_configuration_required');
    if (values['env-file'] && !isAbsolute(values['env-file'])) throw new Error('absolute_operator_env_required');
    const env: NodeJS.ProcessEnv = values['env-file'] ? { ...parse(readFileSync(values['env-file'])), NODE_ENV: 'production' } : process.env;
    const token = await readStoryboardWorkerToken(values['token-file']);
    const api = new StoryboardWorkerTransport({ origin: values.origin, token });
    const client = new GeminiStoryboardClient({ env, onUsage: (usage) => console.log(JSON.stringify({ event: 'gemini_usage', ...usage })) });
    const worker = new OutboundStoryboardWorker({ api, mlx: client, onEvent: (event) => console.log(JSON.stringify(event)) });
    console.log(JSON.stringify({ event: 'worker_started', provider: 'gemini-api', projectConcurrency: 1 }));
    const result = await worker.run({ signal: stop.signal, once: values.once });
    if (values.once && (result === 'failed' || result === 'lease_lost')) process.exitCode = 1;
  }
} catch (error) {
  if (!stop.signal.aborted) { console.error(JSON.stringify({ event: 'worker_stopped', code: storyboardWorkerErrorCode(error) })); process.exitCode = 1; }
} finally {
  process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
}
