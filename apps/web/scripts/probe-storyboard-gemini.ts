import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parse } from 'dotenv';
import { GeminiStoryboardClient, resolveStoryboardGeminiKey } from '../lib/admin/storyboard/gemini-client';

// Read the existing vault copy, never write it or emit provider diagnostics/credentials.
const file = process.argv[2];
if (!file || !isAbsolute(file)) throw new Error('ABSOLUTE_OPERATOR_ENV_FILE_REQUIRED');
const env: NodeJS.ProcessEnv = { ...parse(readFileSync(file)), NODE_ENV: 'production' };
const client = new GeminiStoryboardClient({ apiKey: resolveStoryboardGeminiKey(env) ?? undefined });
const started = performance.now();
try {
  const models = await client.models();
  const result = { kind: 'live-gemini-model-readiness', measuredAt: new Date().toISOString(), elapsedMs: performance.now() - started,
    models: models.map(({ id, capabilities }) => ({ id, capabilities })), paidInferenceCalls: 0,
    environment: { sdk: JSON.parse(readFileSync('node_modules/@google/genai/package.json', 'utf8')).version },
    limitations: ['Model metadata is not inference verification or a credit deduction receipt.'] };
  mkdirSync('performance/ui-renewal-20261003', { recursive: true });
  writeFileSync('performance/ui-renewal-20261003/gemini-model-readiness.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', models: result.models.map(({ id }) => id), paidInferenceCalls: 0 }));
} catch (error) {
  console.log(JSON.stringify({ status: 'failed', code: error && typeof error === 'object' && 'code' in error ? error.code : 'provider_failed' }));
  process.exitCode = 1;
}
