import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { GenerateContentResponse } from '@google/genai';
import sharp from 'sharp';
import { GeminiThumbnailWorkerClient, type ThumbnailGeminiInput } from '../../lib/admin/youtube-thumbnail-generator/gemini-worker-client';

// Actual TS client + actual PG candidate. SDK and private Storage remain synthetic.
const mode = process.argv[2];
const ownerId = process.env.FIXTURE_OWNER_ID!;
const tokens = [process.env.FIXTURE_TOKEN_0!, process.env.FIXTURE_TOKEN_1!];
const model = 'gemini-3.1-flash-image' as const;
type Job = { id: string; ownerId: string; requestId: string; inputSha256: string; attemptId: string; fence: number; state: string; cancelRequested: boolean };
const quoted = (value: unknown) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
function sql(statement: string) {
  const child = spawnSync(process.env.FIXTURE_PSQL!, ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', process.env.FIXTURE_PG_PORT!, '-U', 'postgres', '-d', 'postgres'],
  { input: statement, encoding: 'utf8', timeout: 8_000 });
  if (child.status !== 0) throw new Error('fixture_sql_rejected');
  const output = child.stdout.trim();
  return output ? JSON.parse(output) : null;
}
function worker(action: string, job?: Job, payload: unknown = {}, index = 0) {
  return sql(`SET ROLE service_role; SELECT public.thumbnail_production_worker(${quoted(tokens[index])},${quoted(action)},${quoted(job?.id)},${quoted(job?.attemptId)},${job?.fence ?? 'NULL'},${quoted(job?.inputSha256)},${quoted(JSON.stringify(payload))}::jsonb);`);
}
function cancel(job: Job) {
  return sql(`SET ROLE service_role; SELECT public.thumbnail_production_admin(${quoted(ownerId)},'cancel',${quoted(job.id)});`);
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const image = await sharp({ create: { width: 512, height: 288, channels: 3, background: '#ff6611' } }).png().toBuffer();
const reference = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#11dd44' } }).png().toBuffer();
let calls = 0; let job: Job;
const client = new GeminiThumbnailWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
  generateContent: async () => {
    calls++;
    if (mode === 'response-lost') throw new Error('synthetic-response-loss');
    if (mode === 'cancel-after-start') cancel(job);
    const response = new GenerateContentResponse(); response.modelVersion = model; response.responseId = 'synthetic-provider';
    response.candidates = [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] } }];
    return response;
  },
} } });
const content = { model, prompt: `synthetic queue ${mode}`, references: [{ bytes: reference, mimeType: 'image/png' as const, role: 'food' as const }] };
const preview = await client.prepare({ ...content, ownerId, jobId: randomUUID(), attemptId: randomUUID(), fence: 1 });
function enqueue(requestId = randomUUID()) {
  const input = { contract: 'thumbnail-gemini-image-v1', model, prompt: content.prompt,
    references: [{ path: `${ownerId}/${requestId}/input/0-${hash(reference)}.png`, sha256: hash(reference),
      mimeType: 'image/png', bytes: reference.length, role: 'food' }] };
  return sql(`SET ROLE service_role; SELECT public.thumbnail_production_admin(${quoted(ownerId)},'enqueue',NULL,${quoted(requestId)},${quoted(preview.descriptor.inputSha256)},${quoted(model)},${quoted(JSON.stringify(input))}::jsonb);`);
}
enqueue(); job = worker('claim'); assert.ok(job);
const prepared = await client.prepare({ ...content, ownerId, jobId: job.id, attemptId: job.attemptId, fence: job.fence } satisfies ThumbnailGeminiInput);
assert.equal(prepared.descriptor.inputSha256, job.inputSha256);
let result;
if (mode === 'stale-fence') {
  sql(`UPDATE public.admin_thumbnail_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${quoted(job.id)};`);
  const next: Job = worker('claim', undefined, {}, 1); assert.equal(next.fence, job.fence + 1);
  await assert.rejects(prepared.run(async () => worker('start', job)), { code: 'start_not_confirmed' });
  assert.equal(calls, 0); job = next;
  result = await (await client.prepare({ ...content, ownerId, jobId: job.id, attemptId: job.attemptId, fence: job.fence }))
    .run(async () => worker('start', job, {}, 1));
} else if (mode === 'start-ack-lost') {
  await assert.rejects(prepared.run(async () => { worker('start', job); throw new Error('synthetic-ACK-loss'); }), { code: 'start_not_confirmed' });
  assert.equal(calls, 0); worker('unknown', job);
} else if (mode === 'response-lost') {
  await assert.rejects(prepared.run(async () => worker('start', job)), { code: 'provider_outcome_unknown', outcome: 'unknown' });
  assert.equal(calls, 1); worker('unknown', job);
} else result = await prepared.run(async () => worker('start', job));

if (result) {
  const prefix = `${ownerId}/${job.id}/${job.attemptId}/`;
  const manifest = { original: { path: prefix + 'original.png', sha256: result.original.sha256, mimeType: result.original.mimeType,
    bytes: result.original.bytes.length, width: result.original.width, height: result.original.height },
  normalized: { path: prefix + 'normalized.png', sha256: result.normalized.sha256, mimeType: result.normalized.mimeType,
    bytes: result.normalized.bytes.length, width: result.normalized.width, height: result.normalized.height }, provenance: result.provenance };
  const index = mode === 'stale-fence' ? 1 : 0;
  const complete = worker('complete', job, manifest, index); assert.equal(complete.state, 'succeeded');
  assert.deepEqual(worker('complete', job, manifest, index), complete);
  assert.equal(complete.cancelRequested, mode === 'cancel-after-start');
  assert.equal(calls, 1);
} else {
  assert.equal(worker('claim', undefined, {}, 1), null);
  assert.throws(() => enqueue()); // Same actual input, new requestId and upload path: held.
  await assert.rejects(prepared.run(async () => worker('start', job)), { code: 'attempt_consumed', outcome: 'already_consumed' });
}
console.log(JSON.stringify({ mode, bunVersion: Bun.version, sdkCalls: calls, completed: Boolean(result), inputBound: true, realPostgres: true, storageSynthetic: true }));
