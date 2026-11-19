/**
 * Explicit one-shot live smoke, never run by tests/CI. Requires OPENAI_API_KEY.
 * At most one text request (4,000 output-token cap) and one 1024x1024 low-quality
 * image request, no retries. Official model docs/pricing observed 2026-11-13: Luna
 * $0.20/M input + $1.20/M output, Flare $5/M text input + $30/M image output.
 * The official image calculator's 272-token estimate is not a maximum: the prior
 * observed run returned 824 image output tokens and 32 input tokens. With text usage
 * 382/1184 and the documented rates, that request pair priced to about $0.02638.
 * Use ~$0.05 only as a conservative planning estimate, not a maximum or billing cap;
 * future usage and an account-level upper bound are unknown. Returned usage is the
 * actual receipt. Every POST has a durable pre-call phase record. Existing files
 * block the run, and an uncertain POST is never resumed or replayed automatically.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdir, open, lstat } from 'node:fs/promises';
import { parse } from 'dotenv';
import { parseArgs } from 'node:util';
import { OpenAIStoryboardClient } from '../lib/admin/storyboard/openai-client';
import { STORYBOARD_OPENAI_TEXT_MODEL, STORYBOARD_OPENAI_IMAGE_MODEL } from '../lib/admin/storyboard/openai-models';
import { STORYBOARD_WORKFLOW, type StoryboardProductionRequest } from '../lib/admin/storyboard/production-contract';
const { values } = parseArgs({ options: { 'env-file': { type: 'string' }, 'output-dir': { type: 'string' }, help: { type: 'boolean', default: false } }, strict: true });
if (values.help) { console.log('Usage: bun scripts/verify-storyboard-openai-live.ts --output-dir /absolute/session-proof-dir [--env-file /absolute/operator-env-file]'); process.exit(0); }
if (!values['output-dir'] || !isAbsolute(values['output-dir'])) throw new Error('absolute_output_dir_required');
if (values['env-file'] && !isAbsolute(values['env-file'])) throw new Error('absolute_operator_env_required');
const outputDir = resolve(values['output-dir']);
await mkdir(outputDir, { recursive: false, mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
const directoryStat = await lstat(outputDir);
if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o077) !== 0) throw new Error('private_output_dir_required');
const env: NodeJS.ProcessEnv = values['env-file'] ? { ...parse(readFileSync(values['env-file'])), NODE_ENV: 'production' } : process.env;
const client = new OpenAIStoryboardClient({ env });
const journalPath = `${outputDir}/receipt.jsonl`;
const journal = await open(journalPath, 'wx', 0o600);
const append = async (value: Record<string, unknown>) => { await journal.write(`${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`); await journal.sync(); };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const output of ['draft.json', 'frame.png']) {
  await lstat(`${outputDir}/${output}`).then(() => { throw new Error('existing_output_blocks_run'); })
    .catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
}
const request: StoryboardProductionRequest = { workflow: STORYBOARD_WORKFLOW, requestId: randomUUID(), prompt: 'A quiet 10-second storyboard about a baker preparing morning bread. No factual claims.',
  sceneCount: 5, retrieval: 'none', sources: [], imageWidth: 1024, imageHeight: 1024,
  providers: { externalAI: true, text: { id: 'openai-api', model: STORYBOARD_OPENAI_TEXT_MODEL }, image: { id: 'openai-api', model: STORYBOARD_OPENAI_IMAGE_MODEL } } };
const runId = randomUUID();
await append({ event: 'run_started', runId, requestsMaximum: 2, models: [STORYBOARD_OPENAI_TEXT_MODEL, STORYBOARD_OPENAI_IMAGE_MODEL],
  image: { quality: 'low', size: '1024x1024' }, planningEstimateUsd: 0.05,
  billingNote: 'pricing estimate only; no account-level cap; no automatic retry or resume' });
try {
  const ready = await client.models();
  const available = ready.map(model => model.id);
  await append({ event: 'models_read', runId, available });
  if (!available.includes(STORYBOARD_OPENAI_TEXT_MODEL) || !available.includes(STORYBOARD_OPENAI_IMAGE_MODEL)) throw new Error('allowlisted_models_not_available');
  await append({ event: 'text_post_started', runId, model: STORYBOARD_OPENAI_TEXT_MODEL });
  const generated = await client.draft(request, undefined, 4000);
  const draftBytes = Buffer.from(`${JSON.stringify(generated.draft, null, 2)}\n`, 'utf8');
  const draftHandle = await open(`${outputDir}/draft.json`, 'wx', 0o600);
  try { await draftHandle.writeFile(draftBytes); await draftHandle.sync(); } finally { await draftHandle.close(); }
  await append({ event: 'text_post_succeeded', runId, provenance: generated.provenance,
    usage: generated.provenance.usage ?? null, scenes: generated.draft.scenes.length, draftSha256: sha256(draftBytes) });
  await append({ event: 'image_post_started', runId, model: STORYBOARD_OPENAI_IMAGE_MODEL, quality: 'low', size: '1024x1024' });
  const image = await client.image(request, 'A simple bakery counter at dawn, no text.', undefined);
  const imageHandle = await open(`${outputDir}/frame.png`, 'wx', 0o600);
  try { await imageHandle.writeFile(image.bytes); await imageHandle.sync(); } finally { await imageHandle.close(); }
  await append({ event: 'image_post_succeeded', runId, provenance: image.provenance,
    usage: image.provenance.usage ?? null, imageBytes: image.bytes.length, imageSha256: sha256(image.bytes) });
  await append({ event: 'run_complete', runId, textModel: generated.provenance.model, textResponseId: generated.provenance.responseId,
    textUsage: generated.provenance.usage ?? null, imageModel: image.provenance.model, imageResponseId: image.provenance.responseId,
    imageUsage: image.provenance.usage ?? null, draft: 'draft.json', image: 'frame.png' });
  console.log(JSON.stringify({ event: 'live_smoke_complete', runId, outputDir, draft: 'draft.json', image: 'frame.png',
    draftSha256: sha256(draftBytes), imageSha256: sha256(image.bytes), textUsage: generated.provenance.usage ?? null,
    imageUsage: image.provenance.usage ?? null, planningEstimateUsd: 0.05, estimateIsNotBillingCap: true }));
} catch (error) {
  await append({ event: 'run_blocked_or_uncertain', runId, code: error instanceof Error && /^[a-z_]{1,80}$/.test(error.message) ? error.message : 'provider_failed',
    action: 'do_not_retry_or_resume_without reconciling this receipt' });
  throw error;
} finally { await journal.close(); }
