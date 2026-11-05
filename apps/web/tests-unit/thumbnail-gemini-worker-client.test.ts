import { describe, expect, test } from 'bun:test';
import { GenerateContentResponse, type GenerateContentParameters } from '@google/genai';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import sharp from 'sharp';
import {
  GeminiThumbnailWorkerClient, ThumbnailGeminiError, resolveThumbnailGeminiCreditsKey, prepareThumbnailGeminiContent,
  type ThumbnailGeminiDescriptor, type ThumbnailGeminiInput,
} from '../lib/admin/youtube-thumbnail-generator/gemini-worker-client';

const directBudget = async <T>(work: () => Promise<T>) => await work();
const admit = async (descriptor: ThumbnailGeminiDescriptor) => ({ ...descriptor, state: 'provider_started', permission: 'fresh-commit' });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const input = (overrides: Partial<ThumbnailGeminiInput> = {}): ThumbnailGeminiInput => ({
  ownerId: randomUUID(), jobId: randomUUID(), attemptId: randomUUID(), fence: 1,
  model: 'gemini-3.1-flash-image', prompt: '합성 검증: 음식 접시와 편집용 빈 공간', references: [], ...overrides,
});
const pixels = (color = '#ff4411', width = 512, height = 288) => sharp({ create: {
  width, height, channels: 3, background: color,
} }).png().toBuffer();
function response(bytes: Buffer, model = 'gemini-3.1-flash-image', mimeType = 'image/png') {
  const value = new GenerateContentResponse();
  value.modelVersion = model; value.responseId = 'synthetic-response';
  value.usageMetadata = { promptTokenCount: 21, candidatesTokenCount: 33, totalTokenCount: 54 };
  value.candidates = [{ content: { parts: [{ inlineData: { mimeType, data: bytes.toString('base64') } }] } }];
  return value;
}
function fixture(generate: (params: GenerateContentParameters) => Promise<GenerateContentResponse>) {
  const requests: GenerateContentParameters[] = [];
  const client = { models: { generateContent: async (params: GenerateContentParameters) => {
    requests.push(params); return await generate(params);
  } } };
  return { requests, client };
}

describe('thumbnail Gemini worker candidate', () => {
  test('stored reference mode preserves the exact approved PNG bytes across encoder choices', async () => {
    const stored = await sharp(await pixels('#338844', 64, 48)).png({ compressionLevel: 9, palette: true }).toBuffer();
    const fake = fixture(async () => response(await pixels()));
    const request = input({ references: [{ bytes: stored, mimeType: 'image/png', role: 'food' }] });
    const prepared = await new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget }).prepareStored(request);
    const expected = createHash('sha256').update(JSON.stringify({ contract: 'thumbnail-gemini-image-v1', model: request.model,
      prompt: request.prompt, canvas: { width: 1280, height: 720, fit: 'cover', imageSize: '1K' },
      references: [{ role: 'food', canonicalSha256: hash(stored), mimeType: 'image/png' }] })).digest('hex');
    expect(prepared.descriptor.inputSha256).toBe(expected);
    expect((await prepared.run(admit)).normalized).toBeNull();
    const inline = (fake.requests[0].contents as { parts: { inlineData?: { data: string } }[] }[])[0].parts.find((part) => part.inlineData);
    expect(inline?.inlineData?.data).toBe(stored.toString('base64'));
  });
  test('requires the credits key rather than silently selecting another project', () => {
    expect(resolveThumbnailGeminiCreditsKey({ GEMINI_API_KEY: 'generic-marker', STORYBOARD_GEMINI_API_KEY: 'other-marker' })).toBeNull();
    expect(resolveThumbnailGeminiCreditsKey({ GEMINI_CREDITS_API_KEY: '  credits-marker  ', GEMINI_API_KEY: 'other-marker' })).toBe('credits-marker');
    expect(() => new GeminiThumbnailWorkerClient({ env: {} })).toThrow('provider_not_configured');
  });

  test('uses actual canonical reference pixels and returns distinct original and normalized proofs', async () => {
    const original = await pixels(); const reference = await sharp(await pixels('#11ff44', 320, 240)).jpeg().withMetadata().toBuffer();
    const fake = fixture(async () => response(original));
    const attempt = await new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget }).prepare(input({
      references: [{ bytes: reference, mimeType: 'image/jpeg', role: 'host' }],
    }));
    const result = await attempt.run(admit);
    expect(fake.requests).toHaveLength(1);
    const contents = fake.requests[0].contents as Array<{ parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> }>;
    expect(contents[0].parts[1].text).toContain('role=host');
    const sent = contents[0].parts[2].inlineData!;
    const sentMetadata = await sharp(Buffer.from(sent.data, 'base64')).metadata();
    expect(sent.mimeType).toBe('image/png'); expect(sentMetadata.width).toBe(320);
    expect(sentMetadata.exif).toBeUndefined();
    expect(result.original.bytes.equals(original)).toBe(true);
    expect(result.original.sha256).toBe(hash(original));
    expect(result.normalized.sha256).toBe(hash(result.normalized.bytes));
    expect(await sharp(result.normalized.bytes).metadata()).toMatchObject({ format: 'png', width: 1280, height: 720 });
    expect(result.provenance).toMatchObject({ providerId: 'gemini-api', model: 'gemini-3.1-flash-image',
      responseModel: 'gemini-3.1-flash-image', inputSha256: attempt.descriptor.inputSha256 });
  });

  test('snapshots model, prompt, role and bytes before the first await', async () => {
    const original = await pixels(); const reference = await pixels('#11ff44', 320, 240);
    const fake = fixture(async () => response(original));
    const client = new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget });
    const request = input({ references: [{ bytes: reference, mimeType: 'image/png', role: 'food' }] });
    const untouched = structuredClone(request);
    const pending = client.prepare(request);
    request.model = 'gemini-3-pro-image'; request.prompt = 'changed'; request.references[0].role = 'other'; reference.fill(0);
    const attempt = await pending; const baseline = await client.prepare(untouched);
    expect(attempt.descriptor).toEqual(baseline.descriptor);
    await attempt.run(admit);
    expect(fake.requests[0].model).toBe('gemini-3.1-flash-image');
    expect((fake.requests[0].contents as Array<{ parts: Array<{ text?: string }> }>)[0].parts[0].text).toBe(untouched.prompt);
    expect(Object.isFrozen(attempt.descriptor)).toBe(true);
  });

  test('fingerprints model, prompt, actual reference bytes, role and order', async () => {
    const first = await pixels('#112233', 32, 32), second = await pixels('#334455', 32, 32);
    const fake = fixture(async () => response(first));
    const client = new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget });
    const request = input({ references: [{ bytes: first, mimeType: 'image/png', role: 'food' }, { bytes: second, mimeType: 'image/png', role: 'host' }] });
    const values = [request, { ...request, model: 'gemini-3-pro-image' as const }, { ...request, prompt: 'changed' },
      { ...request, references: [...request.references].reverse() },
      { ...request, references: [{ ...request.references[0], role: 'other' as const }, request.references[1]] },
      { ...request, references: [request.references[1], request.references[1]] }];
    const hashes = [];
    for (const value of values) hashes.push((await client.prepare(value)).descriptor.inputSha256);
    expect(new Set(hashes).size).toBe(values.length);
    expect(fake.requests).toHaveLength(0);
  });

  test('metadata-only changes cannot bypass the digest of identical provider pixels', async () => {
    const plain = await pixels('#112233', 32, 32);
    const decorated = await sharp(plain).withMetadata({ exif: { IFD0: { Copyright: 'synthetic-metadata' } } }).png().toBuffer();
    expect(hash(plain)).not.toBe(hash(decorated));
    const requests: GenerateContentParameters[] = [];
    const fake = fixture(async (request) => { requests.push(request); return response(await pixels()); });
    const worker = new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget });
    const first = await worker.prepare(input({ references: [{ bytes: plain, mimeType: 'image/png', role: 'food' }] }));
    const second = await worker.prepare(input({ references: [{ bytes: decorated, mimeType: 'image/png', role: 'food' }] }));
    await first.run(admit); await second.run(admit);
    const data = (request: GenerateContentParameters) => (request.contents as Array<{ parts: Array<{ inlineData?: { data: string } }> }>)[0].parts[2].inlineData!.data;
    expect(data(requests[0])).toBe(data(requests[1]));
    expect(first.descriptor.inputSha256).toBe(second.descriptor.inputSha256);
    const prepared = await prepareThumbnailGeminiContent({ model: 'gemini-3.1-flash-image', prompt: input().prompt,
      references: [{ bytes: decorated, mimeType: 'image/png', role: 'food' }] });
    expect((await prepareThumbnailGeminiContent(prepared)).inputSha256).toBe(prepared.inputSha256);
  });

  test('rejects unsupported models, malformed identities and oversized input without provider work', async () => {
    const fake = fixture(async () => response(await pixels()));
    const client = new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget });
    for (const changes of [{ model: 'gpt-image-2' }, { model: 'gemini-nano-banana-2.1' }, { fence: 0 },
      { jobId: '../another-job' }, { prompt: 'x'.repeat(65_537) }, { references: Array(9).fill({}) }]) {
      await expect(client.prepare(input(changes as Partial<ThumbnailGeminiInput>))).rejects.toMatchObject({ code: 'invalid_input', outcome: 'not_started' });
    }
    expect(fake.requests).toHaveLength(0);
  });

  test('decodes references and rejects corrupt pixels, MIME mismatch and byte overflow', async () => {
    const image = await pixels(); const fake = fixture(async () => response(image));
    const client = new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget });
    for (const reference of [{ bytes: image, mimeType: 'image/jpeg' as const, role: 'food' as const },
      { bytes: image.subarray(0, image.length - 30), mimeType: 'image/png' as const, role: 'food' as const },
      { bytes: Buffer.alloc(8 * 1024 * 1024 + 1), mimeType: 'image/png' as const, role: 'food' as const }]) {
      await expect(client.prepare(input({ references: [reference] }))).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(fake.requests).toHaveLength(0);
  });

  test('acquires budget before fresh admission and serializes concurrent run calls', async () => {
    const events: string[] = []; const fake = fixture(async () => { events.push('provider'); return response(await pixels()); });
    const worker = new GeminiThumbnailWorkerClient({ client: fake.client, budget: async (work) => {
      events.push('budget'); return await work();
    } });
    const attempt = await worker.prepare(input());
    const first = attempt.run(async (expected) => { events.push('admit'); return admit(expected); });
    await expect(attempt.run(admit)).rejects.toMatchObject({ code: 'attempt_consumed', outcome: 'already_consumed' });
    await first;
    expect(events).toEqual(['budget', 'admit', 'provider']); expect(fake.requests).toHaveLength(1);
  });

  test('even a repeated budget callback cannot issue a second paid request', async () => {
    const fake = fixture(async () => response(await pixels()));
    const attempt = await new GeminiThumbnailWorkerClient({ client: fake.client, budget: async (work) => {
      const result = await work(); await work(); return result;
    } }).prepare(input());
    expect((await attempt.run(admit)).original.bytes.length).toBeGreaterThan(0);
    expect(fake.requests).toHaveLength(1);
  });

  test('budget denial and lost or mismatched start ACK issue zero SDK calls', async () => {
    const fake = fixture(async () => response(await pixels()));
    const denied = await new GeminiThumbnailWorkerClient({ client: fake.client, budget: async () => { throw new Error('private-budget'); } }).prepare(input());
    await expect(denied.run(admit)).rejects.toMatchObject({ code: 'budget_unavailable', message: 'budget_unavailable' });
    const client = new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget });
    for (const start of [async () => { throw new Error('private-database'); }, async () => null,
      async (expected: ThumbnailGeminiDescriptor) => ({ ...await admit(expected), inputSha256: '0'.repeat(64) }),
      async (expected: ThumbnailGeminiDescriptor) => ({ ...await admit(expected), fence: expected.fence + 1 }),
      async (expected: ThumbnailGeminiDescriptor) => ({ ...await admit(expected), permission: 'readback' }),
      async (expected: ThumbnailGeminiDescriptor) => ({ ...await admit(expected), ownerId: randomUUID() })]) {
      const attempt = await client.prepare(input());
      await expect(attempt.run(start)).rejects.toMatchObject({ code: 'start_not_confirmed', outcome: 'not_started', message: 'start_not_confirmed' });
      await expect(attempt.run(admit)).rejects.toMatchObject({ code: 'attempt_consumed', outcome: 'already_consumed' });
    }
    expect(fake.requests).toHaveLength(0);
  });

  test('cancellation before or during admission never starts the provider', async () => {
    const fake = fixture(async () => response(await pixels()));
    const client = new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget });
    await expect((await client.prepare(input())).run(admit, AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled_before_start' });
    const controller = new AbortController();
    await expect((await client.prepare(input())).run(async (expected) => { controller.abort(); return admit(expected); }, controller.signal))
      .rejects.toMatchObject({ code: 'cancelled_before_start' });
    expect(fake.requests).toHaveLength(0);
  });

  test('provider timeout stays unknown, sanitizes diagnostics and cannot be retried on this attempt', async () => {
    const fake = fixture(async () => { throw new Error('private-provider-details'); });
    const attempt = await new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget }).prepare(input());
    await expect(attempt.run(admit)).rejects.toMatchObject({ code: 'provider_outcome_unknown', outcome: 'unknown', message: 'provider_outcome_unknown' });
    await expect(attempt.run(admit)).rejects.toMatchObject({ code: 'attempt_consumed', outcome: 'already_consumed' });
    expect(fake.requests).toHaveLength(1);
  });

  test('preserves received paid output after cancellation, usage failure and budget release failure', async () => {
    const controller = new AbortController(); const image = await pixels();
    const fake = fixture(async () => { controller.abort(); return response(image); });
    const attempt = await new GeminiThumbnailWorkerClient({ client: fake.client,
      budget: async (work) => { await work(); throw new Error('release-ACK-lost'); },
      onUsage: () => { throw new Error('counter-unavailable'); },
    }).prepare(input());
    expect((await attempt.run(admit, controller.signal)).original.bytes.equals(image)).toBe(true);
    expect(fake.requests).toHaveLength(1);
  });

  test('accepts only the exact selected model or its numeric service revision', async () => {
    const image = await pixels();
    for (const model of ['gemini-3.1-flash-image-001', 'models/gemini-3.1-flash-image-10-23', 'gemini-3-pro-image']) {
      const selected = model === 'gemini-3-pro-image' ? model : 'gemini-3.1-flash-image';
      const fake = fixture(async () => response(image, model));
      const attempt = await new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget }).prepare(input({ model: selected }));
      expect((await attempt.run(admit)).provenance.responseModel).toBe(model.replace(/^models\//, ''));
    }
    for (const model of ['', 'gpt-image-2', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image']) {
      const fake = fixture(async () => response(image, model));
      const attempt = await new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget }).prepare(input());
      await expect(attempt.run(admit)).rejects.toMatchObject({ code: 'invalid_provider_response', outcome: 'received_invalid' });
      expect(fake.requests).toHaveLength(1);
    }
  });

  test('rejects missing, duplicate, corrupt and MIME-spoofed output without retry', async () => {
    const image = await pixels();
    const missing = response(image); missing.candidates = [];
    const duplicate = response(image); duplicate.candidates![0].content!.parts!.push(...duplicate.candidates![0].content!.parts!);
    const nonCanonical = response(image); nonCanonical.candidates![0].content!.parts![0].inlineData!.data += '\n';
    const thoughtOnly = response(image); thoughtOnly.candidates![0].content!.parts![0].thought = true;
    for (const value of [missing, duplicate, nonCanonical, thoughtOnly, response(Buffer.alloc(32)), response(image, 'gemini-3.1-flash-image', 'image/jpeg')]) {
      const fake = fixture(async () => value);
      const attempt = await new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget }).prepare(input());
      await expect(attempt.run(admit)).rejects.toMatchObject({ code: 'invalid_provider_response', outcome: 'received_invalid' });
      expect(fake.requests).toHaveLength(1);
    }
  });

  test('a malformed resolved response remains received-invalid rather than not-started', async () => {
    const fake = fixture(async () => null as unknown as GenerateContentResponse);
    const attempt = await new GeminiThumbnailWorkerClient({ client: fake.client, budget: directBudget }).prepare(input());
    await expect(attempt.run(admit)).rejects.toMatchObject({ code: 'invalid_provider_response', outcome: 'received_invalid' });
    expect(fake.requests).toHaveLength(1);
  });

  test('the real shared Python/SQLite budget holds a lease during admission and releases it after output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tzudong-thumbnail-budget-'));
    const databasePath = join(directory, 'provider.sqlite');
    const env = { ...process.env, GEMINI_BUDGET_PATH: databasePath, GEMINI_BUDGET_PROJECT: 'thumbnail-candidate-test',
      RUN_DAILY_PYTHON: process.env.RUN_DAILY_PYTHON || 'python3' };
    const leaseCount = () => {
      const database = new Database(databasePath, { readonly: true });
      try { return (database.query('SELECT count(*) AS count FROM leases WHERE scope=?').get('thumbnail-candidate-test') as { count: number }).count; }
      finally { database.close(); }
    };
    try {
      const fake = fixture(async () => { expect(leaseCount()).toBe(1); return response(await pixels()); });
      const attempt = await new GeminiThumbnailWorkerClient({ env, client: fake.client }).prepare(input());
      const result = await attempt.run(async (expected) => { expect(leaseCount()).toBe(1); return admit(expected); });
      expect(result.normalized.width).toBe(1280); expect(leaseCount()).toBe(0); expect(fake.requests).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test('actual pinned SDK serializes references, decodes success and never retries HTTP 503', async () => {
    const originalFetch = globalThis.fetch; const bodies: Record<string, unknown>[] = []; let calls = 0;
    let fail = false; const image = await pixels();
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(url, init);
      expect(new URL(request.url).hostname).toBe('generativelanguage.googleapis.com');
      bodies.push(await request.json()); calls++;
      return fail ? Response.json({ error: { code: 503, message: 'synthetic-unavailable', status: 'UNAVAILABLE' } }, { status: 503 })
        : Response.json(response(image));
    }) as typeof fetch;
    try {
      const attempt = await new GeminiThumbnailWorkerClient({ env: { GEMINI_CREDITS_API_KEY: 'synthetic-sdk-marker' }, budget: directBudget })
        .prepare(input({ references: [{ bytes: await pixels('#112233', 32, 32), mimeType: 'image/png', role: 'food' }] }));
      expect((await attempt.run(admit)).original.bytes.equals(image)).toBe(true);
      expect(calls).toBe(1);
      expect(bodies[0]).toMatchObject({ generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '1K' } } });
      const parts = (bodies[0].contents as Array<{ parts: Array<{ inlineData?: unknown }> }>)[0].parts;
      expect(parts[2].inlineData).toBeDefined();
      fail = true;
      const failed = await new GeminiThumbnailWorkerClient({ env: { GEMINI_CREDITS_API_KEY: 'synthetic-sdk-marker' }, budget: directBudget }).prepare(input());
      await expect(failed.run(admit)).rejects.toBeInstanceOf(ThumbnailGeminiError);
      expect(calls).toBe(2);
    } finally { globalThis.fetch = originalFetch; }
  });
});
