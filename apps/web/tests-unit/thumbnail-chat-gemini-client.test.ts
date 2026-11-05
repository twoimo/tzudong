import { describe, expect, test } from 'bun:test';
import { FinishReason, GenerateContentResponse, type GenerateContentParameters } from '@google/genai';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import {
  THUMBNAIL_CHAT_MODEL, thumbnailChatContext, thumbnailChatResponse, thumbnailChatProvenance,
  thumbnailChatStartReceipt, validateThumbnailChatResponse, type ThumbnailChatContext, type ThumbnailChatResponse,
} from '../lib/admin/youtube-thumbnail-generator/chat-contract';
import {
  GeminiThumbnailChatWorkerClient, ThumbnailChatGeminiError, prepareThumbnailChatContent,
  type ThumbnailChatDescriptor, type ThumbnailChatStoredInput,
} from '../lib/admin/youtube-thumbnail-generator/chat-gemini-client';

const directBudget = async <T>(work: () => Promise<T>) => await work();
const admit = async (descriptor: ThumbnailChatDescriptor) => ({ ...descriptor, state: 'provider_started', permission: 'fresh-commit' });
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const layer = { id: 'headline', content: '원래 문구', x: 96, y: 520, fontFamily: 'system-ui', fontSize: 72,
  fontWeight: 900, fill: '#ffffff', stroke: '#111', strokeWidth: 8, shadow: '0 8px 18px rgba(0,0,0,0.6)',
  align: 'center' as const, rotation: 0, zIndex: 0 };
const context = (overrides: Partial<ThumbnailChatContext> = {}) => thumbnailChatContext.parse({
  message: '썸네일 문구를 더 읽기 쉽게 하려면 어떤 점을 살펴야 해?', currentTopic: '한식', currentHeadline: '원래 문구', currentSubHeadline: '',
  currentTextLayers: [layer], conversationMessages: [{ role: 'user', content: '글씨가 작아 보여요.' },
    { role: 'assistant', content: '문구를 줄이거나 크기를 키울 수 있어요.' }],
  focusContext: { kind: 'text-layer', label: '메인 문구', promptContext: '선택한 문구 크기', layerId: 'headline' },
  referenceImageAttachments: [{ id: 'image-1', name: '참고.png', mime: 'image/png', size: 32, width: 8, height: 8, role: 'food' }],
  ...overrides,
});
const input = (overrides: Partial<ThumbnailChatStoredInput> = {}): ThumbnailChatStoredInput => ({
  ownerId: randomUUID(), jobId: randomUUID(), attemptId: randomUUID(), fence: 1, context: context(), ...overrides,
});
const answer = (ctx = context(), overrides: Partial<ThumbnailChatResponse> = {}): ThumbnailChatResponse => ({
  assistantMessage: '문구 길이와 대비부터 확인하고, 필요한 경우 글자 크기를 조절해 보세요.', intent: 'conversation',
  canvasPatch: { topic: ctx.currentTopic, headline: ctx.currentHeadline, subHeadline: ctx.currentSubHeadline },
  textLayerPatches: [], shouldGenerate: false, shouldReset: false, ...overrides,
});
function response(result: unknown = answer(), model: string | undefined = THUMBNAIL_CHAT_MODEL) {
  const value = new GenerateContentResponse(); value.modelVersion = model; value.responseId = 'synthetic-chat-response';
  value.usageMetadata = { promptTokenCount: 13, candidatesTokenCount: 21, thoughtsTokenCount: 5, totalTokenCount: 39 };
  value.candidates = [{ finishReason: FinishReason.STOP, content: { role: 'model', parts: [{ text: JSON.stringify(result) }] } }];
  return value;
}
function fixture(generate: (params: GenerateContentParameters) => Promise<GenerateContentResponse> = async () => response()) {
  const requests: GenerateContentParameters[] = []; let catalogCalls = 0;
  const client = { models: { get: async ({ model }: { model: string }) => { catalogCalls++; return { name: `models/${model}` }; },
    generateContent: async (params: GenerateContentParameters) => { requests.push(params); return await generate(params); } } };
  return { requests, client, get catalogCalls() { return catalogCalls; } };
}

test('chat schema rejects strings beyond the shared privacy character boundary', () => {
  expect(thumbnailChatContext.safeParse({ ...context(), conversationMessages: [{ role: 'assistant', content: 'a'.repeat(4097) }] }).success).toBe(false);
  expect(thumbnailChatResponse.safeParse(answer(context(), { assistantMessage: 'a'.repeat(4097) })).success).toBe(false);
  expect(thumbnailChatResponse.parse(answer(context(), { assistantMessage: '가'.repeat(4096) })).assistantMessage.length).toBe(4096);
});

test('initial null canvas action is valid without weakening action-label text validation', () => {
  expect(thumbnailChatContext.parse({ ...context(), lastCanvasActionLabel: null }).lastCanvasActionLabel).toBeNull();
  expect(thumbnailChatContext.parse(context()).lastCanvasActionLabel).toBeUndefined();
  expect(thumbnailChatContext.parse({ ...context(), lastCanvasActionLabel: '문구 선택됨' }).lastCanvasActionLabel).toBe('문구 선택됨');
  for (const label of [42, {}, 'a'.repeat(321), '\u0000', '\ud800']) {
    expect(thumbnailChatContext.safeParse({ ...context(), lastCanvasActionLabel: label }).success).toBe(false);
  }
});

describe('thumbnail chat contracts and credits worker', () => {
  test('preserves both conversation roles, focus, metadata and 64 actual layers in a browser-safe contract', async () => {
    const ctx = context({ currentTextLayers: Array.from({ length: 64 }, (_, index) => ({ ...layer, id: `layer-${index}` })) });
    expect(ctx.conversationMessages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(ctx.currentTextLayers).toHaveLength(64); expect(ctx.focusContext?.layerId).toBe('headline');
    expect(ctx.referenceImageAttachments[0].name).toBe('참고.png');
    expect(thumbnailChatContext.safeParse({ ...ctx, currentTextLayers: [...ctx.currentTextLayers, layer] }).success).toBe(false);
    const built = await Bun.build({ entrypoints: ['lib/admin/youtube-thumbnail-generator/chat-contract.ts'], target: 'browser', write: false });
    expect(built.success).toBe(true); const code = await built.outputs[0].text();
    expect(code).not.toContain('node:'); expect(code).not.toContain('Buffer.byteLength');
  });
  test('rejects authority fields, unsafe CSS, duplicate IDs, invalid numbers and UTF-8 overflows without truncating', () => {
    for (const bad of [
      { ...context(), providerId: 'alternate' }, { ...context(), ownerId: randomUUID() },
      { ...context(), message: '가'.repeat(1334) }, { ...context(), message: '\ud800' },
      { ...context(), currentTextLayers: [layer, layer] },
      { ...context(), currentTextLayers: [{ ...layer, fill: 'url(https://invalid.example)' }] },
      { ...context(), currentTextLayers: [{ ...layer, fontFamily: 'x; color:red' }] },
      { ...context(), currentTextLayers: [{ ...layer, shadow: 'url(x)' }] },
      { ...context(), currentTextLayers: [{ ...layer, x: Infinity }] },
      { ...context(), referenceImageAttachments: [{ name: 'x', url: 'https://invalid.example' }] },
      { ...context(), conversationMessages: Array.from({ length: 12 }, () => ({ role: 'user', content: '가'.repeat(2600) })) },
    ]) expect(thumbnailChatContext.safeParse(bad).success).toBe(false);
  });
  test('non-mutating replies preserve the canvas and patches; edits target existing layer IDs only', () => {
    const ctx = context(); expect(validateThumbnailChatResponse(answer(ctx), ctx)).toEqual(answer(ctx));
    for (const intent of ['conversation', 'casual_chat', 'review', 'safety'] as const) {
      expect(() => validateThumbnailChatResponse(answer(ctx, { intent, canvasPatch: { ...answer(ctx).canvasPatch, headline: 'changed' } }), ctx)).toThrow();
      expect(() => validateThumbnailChatResponse(answer(ctx, { intent, textLayerPatches: [{ id: 'headline', fontSize: 80 }] }), ctx)).toThrow();
    }
    const edit = answer(ctx, { intent: 'edit', textLayerPatches: [{ id: 'headline', fontSize: 84, fill: '#aabbccdd' }] });
    expect(validateThumbnailChatResponse(edit, ctx).textLayerPatches[0].fontSize).toBe(84);
    for (const patch of [{ id: 'other', fontSize: 84 }, { id: 'headline' }, { id: 'headline', x: 10000 }, { id: 'headline', fill: '#12345' }]) {
      expect(() => validateThumbnailChatResponse({ ...edit, textLayerPatches: [patch] }, ctx)).toThrow();
    }
    expect(thumbnailChatResponse.safeParse({ ...edit, permission: 'fresh-commit' }).success).toBe(false);
  });
  test('only the current shared-intent generation command authorizes generation, not history or questions', () => {
    const generated = answer(context(), { intent: 'generate', shouldGenerate: true });
    const permitted = context({ message: '이걸로 썸네일 생성해줘' });
    expect(validateThumbnailChatResponse(generated, permitted).shouldGenerate).toBe(true);
    for (const message of ['어떻게 이미지를 생성해줘라고 요청하나요?', '좋아요', '생성하려면 얼마나 걸려요?', '이미지 생성해줘라는 말은 하지 마']) {
      const ctx = context({ message, conversationMessages: [{ role: 'user', content: '이미지 생성해줘' }] });
      expect(() => validateThumbnailChatResponse(generated, ctx)).toThrow();
    }
    expect(thumbnailChatResponse.safeParse({ ...generated, shouldReset: true }).success).toBe(false);
    const reset = answer(context(), { intent: 'reset', shouldReset: true });
    expect(validateThumbnailChatResponse(reset, context({ message: '문구 초기화해줘' })).shouldReset).toBe(true);
    expect(() => validateThumbnailChatResponse(reset, context({ message: '초기화는 어떻게 하나요?' }))).toThrow();
    expect(() => validateThumbnailChatResponse(reset, context({ message: '문구 초기화하지 마' }))).toThrow();
  });
  test('metadata never becomes image pixels or evidence of visual inspection', () => {
    const prepared = prepareThumbnailChatContent(context());
    expect(prepared.prompt).toContain('metadata ONLY'); expect(prepared.prompt).toContain('No image pixels');
    for (const assistantMessage of ['첨부 이미지를 보니 글씨가 작습니다.', 'I can see the attached image.']) {
      expect(() => validateThumbnailChatResponse(answer(context(), { assistantMessage }), context())).toThrow();
    }
  });
  test('document hash binds context bytes; input hash separately binds the actual prompt and schema', () => {
    const ctx = context(), a = prepareThumbnailChatContent(ctx), b = prepareThumbnailChatContent(structuredClone(ctx));
    expect(a).toEqual(b); expect(JSON.parse(a.documentBytes.toString())).toEqual(ctx);
    expect(a.documentSha256).toBe(hash(a.documentBytes)); expect(a.inputSha256).not.toBe(a.documentSha256);
    for (const changed of [{ ...ctx, message: '다른 질문' }, { ...ctx, conversationMessages: [...ctx.conversationMessages].reverse() },
      { ...ctx, currentTextLayers: [{ ...layer, fontSize: 86 }] }, { ...ctx, referenceImageAttachments: [] }]) {
      expect(prepareThumbnailChatContent(changed).inputSha256).not.toBe(a.inputSha256);
    }
  });
  test('credits-only setup refuses generic key fallback', () => {
    expect(() => new GeminiThumbnailChatWorkerClient({ env: { GEMINI_API_KEY: 'generic', STORYBOARD_GEMINI_API_KEY: 'other' } }))
      .toThrow('provider_not_configured');
  });
  test('the exact catalog is budgeted and cached, while missing/wrong/rate-limited models fail closed', async () => {
    const fake = fixture(); let budgets = 0;
    const worker = new GeminiThumbnailChatWorkerClient({ client: fake.client, budget: async (work) => { budgets++; return work(); } });
    const models = await worker.models(); models.pop(); expect(await worker.models()).toEqual([THUMBNAIL_CHAT_MODEL]);
    expect(fake.catalogCalls).toBe(1); expect(budgets).toBe(1);
    for (const get of [async () => ({ name: 'models/other' }), async () => { throw { status: 429, message: 'private diagnostic' }; }]) {
      const other = new GeminiThumbnailChatWorkerClient({ client: { models: { ...fake.client.models, get } }, budget: directBudget });
      await expect(other.models()).rejects.toMatchObject({ code: 'model_catalog_unavailable', message: 'model_catalog_unavailable' });
    }
    await expect(worker.models(AbortSignal.abort())).rejects.toBeDefined();
    expect(fake.requests).toHaveLength(0);
  });
  test('snapshots mutable input and identity synchronously before a caller can change them', async () => {
    const fake = fixture(), client = new GeminiThumbnailChatWorkerClient({ client: fake.client, budget: directBudget });
    const request = input(), original = structuredClone(request), pending = client.prepareStored(request);
    request.ownerId = randomUUID(); request.fence = 99;
    (request.context as ThumbnailChatContext).conversationMessages[1].content = 'changed';
    (request.context as ThumbnailChatContext).currentTextLayers[0].fontSize = 30;
    const prepared = await pending;
    expect(prepared.descriptor).toEqual((await client.prepareStored(original)).descriptor);
    expect(Object.isFrozen(prepared.descriptor)).toBe(true);
    const saved = await prepared.run(admit);
    expect(saved.bytes.equals(Buffer.from(JSON.stringify(saved.result)))).toBe(true);
    expect(thumbnailChatProvenance.safeParse(saved.provenance).success).toBe(true);
    expect(fake.requests[0].contents).toEqual([{ role: 'user', parts: [{ text: prepareThumbnailChatContent(original.context).prompt }] }]);
  });
  test('fresh start occurs after budget admission; duplicate/concurrent run cannot call the SDK again', async () => {
    let releaseBudget!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { releaseBudget = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const events: string[] = [], fake = fixture(async () => { events.push('sdk'); return response(); });
    const worker = new GeminiThumbnailChatWorkerClient({ client: fake.client, budget: async (work) => {
      entered(); await gate; events.push('budget'); return work();
    } });
    const prepared = await worker.prepareStored(input());
    const running = prepared.run(async (descriptor) => { events.push('start'); return admit(descriptor); });
    await started; expect(events).toEqual([]); expect(fake.requests).toHaveLength(0);
    await expect(prepared.run(admit)).rejects.toMatchObject({ outcome: 'already_consumed' });
    releaseBudget(); await running; expect(events).toEqual(['budget', 'start', 'sdk']);
    await expect(prepared.run(admit)).rejects.toMatchObject({ outcome: 'already_consumed' }); expect(fake.requests).toHaveLength(1);
  });
  test('wrong owner/job/attempt/fence/digest/model, stale readback and extra authority cannot admit an SDK call', async () => {
    const changes = [{ ownerId: randomUUID() }, { jobId: randomUUID() }, { attemptId: randomUUID() }, { fence: 2 },
      { inputSha256: 'f'.repeat(64) }, { model: 'gemini-3.1-flash-image' }, { permission: 'readback' }, { extraPermission: true }];
    for (const change of changes) {
      const fake = fixture(), prepared = await new GeminiThumbnailChatWorkerClient({ client: fake.client, budget: directBudget }).prepareStored(input());
      await expect(prepared.run(async (expected) => ({ ...await admit(expected), ...change }))).rejects.toMatchObject({ code: 'start_not_confirmed' });
      expect(fake.requests).toHaveLength(0); await expect(prepared.run(admit)).rejects.toMatchObject({ outcome: 'already_consumed' });
    }
    const fake = fixture(), prepared = await new GeminiThumbnailChatWorkerClient({ client: fake.client, budget: directBudget }).prepareStored(input());
    await expect(prepared.run(async () => { throw new Error('start ACK lost'); })).rejects.toMatchObject({ code: 'start_not_confirmed' });
    expect(fake.requests).toHaveLength(0);
    expect(thumbnailChatStartReceipt.safeParse({}).success).toBe(false);
  });
  test('abort before SDK prevents execution, including after the fresh permission arrives', async () => {
    for (const stage of ['before', 'receipt'] as const) {
      const controller = new AbortController(), fake = fixture(); let admissions = 0;
      const prepared = await new GeminiThumbnailChatWorkerClient({ client: fake.client, budget: directBudget }).prepareStored(input());
      if (stage === 'before') controller.abort();
      await expect(prepared.run(async (expected) => { admissions++; controller.abort(); return admit(expected); }, controller.signal))
        .rejects.toMatchObject({ code: 'cancelled_before_start', outcome: 'not_started' });
      expect(admissions).toBe(stage === 'before' ? 0 : 1); expect(fake.requests).toHaveLength(0);
    }
  });
  test('received output survives cancellation, budget release failure and telemetry failure', async () => {
    const controller = new AbortController(), fake = fixture(async () => { controller.abort(); return response(); });
    const prepared = await new GeminiThumbnailChatWorkerClient({ client: fake.client,
      budget: async (work) => { await work(); throw new Error('release bookkeeping'); },
      onUsage: () => { throw new Error('telemetry'); } }).prepareStored(input());
    const saved = await prepared.run(admit, controller.signal);
    expect(saved.result).toEqual(answer()); expect(saved.provenance.responseId).toBe('synthetic-chat-response');
    expect(fake.requests).toHaveLength(1);
  });
  test('a budget callback invoked twice still invokes start and the SDK only once', async () => {
    const fake = fixture(); let admissions = 0;
    const prepared = await new GeminiThumbnailChatWorkerClient({ client: fake.client,
      budget: async (work) => { await work(); return await work(); } }).prepareStored(input());
    expect((await prepared.run(async (expected) => { admissions++; return admit(expected); })).result).toEqual(answer());
    expect(admissions).toBe(1); expect(fake.requests).toHaveLength(1);
  });
  test('provider timeout is unknown, sanitized and cannot be retried with the consumed attempt', async () => {
    const fake = fixture(async () => { throw new Error('private provider diagnostics'); });
    const prepared = await new GeminiThumbnailChatWorkerClient({ client: fake.client, budget: directBudget }).prepareStored(input());
    await expect(prepared.run(admit)).rejects.toMatchObject({ code: 'provider_outcome_unknown', outcome: 'unknown', message: 'provider_outcome_unknown' });
    await expect(prepared.run(admit)).rejects.toMatchObject({ outcome: 'already_consumed' }); expect(fake.requests).toHaveLength(1);
  });
  test('invalid model proof, oversized/partial JSON, mixed parts and injected fields stay received-invalid', async () => {
    const missingModel = response(); missingModel.modelVersion = undefined;
    const partial = response(); partial.candidates![0].finishReason = FinishReason.MAX_TOKENS;
    const mixed = response(); mixed.candidates![0].content!.parts!.push({ functionCall: { name: 'execute' } });
    const tooLarge = response(); tooLarge.candidates![0].content!.parts![0].text = ' '.repeat(48_001);
    const malformed = response(); malformed.candidates![0].content!.parts![0].text = '{';
    for (const value of [missingModel, response(answer(), 'other'), partial, mixed, tooLarge, malformed,
      response({ ...answer(), ownerId: randomUUID() }), response(answer(context(), { textLayerPatches: [{ id: 'nonexistent', fontSize: 80 }] })),
      null as unknown as GenerateContentResponse]) {
      const fake = fixture(async () => value);
      const prepared = await new GeminiThumbnailChatWorkerClient({ client: fake.client, budget: directBudget }).prepareStored(input());
      await expect(prepared.run(admit)).rejects.toMatchObject({ code: 'invalid_provider_response', outcome: 'received_invalid' });
      expect(fake.requests).toHaveLength(1);
    }
  });
  test('actual shared Python/SQLite budget holds its isolated lease through fresh start and SDK, then releases it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'thumbnail-chat-budget-')), databasePath = join(directory, 'provider.sqlite');
    const scope = 'thumbnail-chat-candidate-test';
    const env = { ...process.env, GEMINI_BUDGET_PATH: databasePath, GEMINI_BUDGET_PROJECT: scope,
      RUN_DAILY_PYTHON: process.env.RUN_DAILY_PYTHON || 'python3', GEMINI_MAX_INFLIGHT: '1', GEMINI_REQUESTS_PER_MINUTE: '30' };
    const leaseCount = () => {
      const database = new Database(databasePath, { readonly: true });
      try { return (database.query('SELECT count(*) AS count FROM leases WHERE scope=?').get(scope) as { count: number }).count; }
      finally { database.close(); }
    };
    try {
      const fake = fixture(async () => { expect(leaseCount()).toBe(1); return response(); });
      const prepared = await new GeminiThumbnailChatWorkerClient({ env, client: fake.client }).prepareStored(input());
      await prepared.run(async (expected) => { expect(leaseCount()).toBe(1); return admit(expected); });
      expect(leaseCount()).toBe(0); expect(fake.requests).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test('actual pinned SDK wire uses the credits key, MEDIUM and JSON schema; HTTP 503 gets one call only', async () => {
    const originalFetch = globalThis.fetch, bodies: Record<string, unknown>[] = []; let calls = 0, fail = false;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(url, init); calls++;
      expect(new URL(request.url).hostname).toBe('generativelanguage.googleapis.com');
      expect(request.headers.get('x-goog-api-key')).toBe('synthetic-credits-marker');
      bodies.push(await request.json());
      return fail ? Response.json({ error: { code: 503, status: 'UNAVAILABLE', message: 'synthetic' } }, { status: 503 })
        : Response.json(response());
    }) as typeof fetch;
    try {
      const env = { GEMINI_CREDITS_API_KEY: 'synthetic-credits-marker', GEMINI_API_KEY: 'forbidden-generic-marker', GOOGLE_GENAI_USE_VERTEXAI: 'true' };
      const prepared = await new GeminiThumbnailChatWorkerClient({ env, budget: directBudget }).prepareStored(input());
      expect((await prepared.run(admit)).result).toEqual(answer()); expect(calls).toBe(1);
      expect(bodies[0]).toMatchObject({ generationConfig: { thinkingConfig: { thinkingLevel: 'MEDIUM' },
        responseMimeType: 'application/json', maxOutputTokens: 8192,
        responseJsonSchema: { type: 'object', additionalProperties: false, required: ['assistantMessage', 'intent', 'canvasPatch', 'textLayerPatches', 'shouldGenerate', 'shouldReset'] } } });
      fail = true;
      const failed = await new GeminiThumbnailChatWorkerClient({ env, budget: directBudget }).prepareStored(input());
      await expect(failed.run(admit)).rejects.toBeInstanceOf(ThumbnailChatGeminiError); expect(calls).toBe(2);
    } finally { globalThis.fetch = originalFetch; }
  });
});
