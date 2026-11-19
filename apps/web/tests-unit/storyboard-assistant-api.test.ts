import { describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
mock.module('server-only', () => ({}));
const { createStoryboardAssistantApi } = await import('../lib/admin/storyboard/assistant-api');
import { storyboardAssistantRequestSchema } from '../lib/admin/storyboard/assistant-contract';

const ownerId = randomUUID();
const origin = 'https://storyboard.example.test';
const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: origin,
  STORYBOARD_ASSISTANT_ENABLED: '1', STORYBOARD_ASSISTANT_PROVIDER: 'openai-api',
  STORYBOARD_ASSISTANT_MODEL: 'gpt-5.6-luna', STORYBOARD_ASSISTANT_REQUESTS_PER_HOUR: '2',
  OPENAI_API_KEY: `sk-${'synthetic'.repeat(4)}` };
const auth = async () => ({ ok: true as const, userId: ownerId });
const input = () => storyboardAssistantRequestSchema.parse({ provider: { id: 'openai-api', model: 'gpt-5.6-luna' },
  sceneCount: 6, messages: [{ role: 'user', content: '국수집 소개의 시작을 차분하게 정리해 주세요.' }], context: { prompt: '', scene: null } });
const result = () => ({ answer: { reply: '첫 컷은 가게의 분위기에서 시작해 보세요.', suggestedPrompt: '입구부터 마지막 한 입까지 이어지는 여섯 장면' },
  provenance: { providerId: 'openai-api', model: 'gpt-5.6-luna', responseModel: 'gpt-5.6-luna',
    verification: 'official-api', modelEvidence: 'response', generatedAt: '2026-11-15T00:00:00.000Z',
    responseId: 'synthetic-provider-response-not-exposed' } });
const request = (value: unknown = input(), extraHeaders: Record<string, string> = {}) => new Request(`${origin}/api/admin/storyboard/production/assistant`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(value),
});

describe('bounded storyboard planning API (synthetic providers only)', () => {
  test('authenticates before parsing input or invoking a provider', async () => {
    let calls = 0;
    const api = createStoryboardAssistantApi({ env, requireAdmin: async () => ({ ok: false, response: new Response(null, { status: 401 }) }), planner: async () => { calls++; return result(); } });
    const denied = request();
    Object.defineProperty(denied, 'body', { get: () => { throw new Error('body must not be read'); } });
    expect((await api.POST(denied)).status).toBe(401);
    expect((await api.GET()).status).toBe(401); expect(calls).toBe(0);
  });
  test('session-admin origin remains mandatory even with a bearer header', async () => {
    let calls = 0;
    const api = createStoryboardAssistantApi({ env, requireAdmin: auth, planner: async () => { calls++; return result(); } });
    const cases: Record<string, string>[] = [{ Origin: '' }, { Origin: 'https://another.example.test' }, { Origin: '', Authorization: 'Bearer synthetic' }, { 'Sec-Fetch-Site': 'cross-site' }];
    for (const extra of cases) {
      expect((await api.POST(request(input(), extra))).status).toBe(403);
    }
    expect(calls).toBe(0);
  });
  test('keeps Gemini unavailable on the web instead of bypassing its worker-only project budget', async () => {
    let calls = 0;
    const api = createStoryboardAssistantApi({ env: { ...env, STORYBOARD_ASSISTANT_PROVIDER: 'gemini-api',
      STORYBOARD_ASSISTANT_MODEL: 'gemini-3.8-flash', GEMINI_API_KEY: 'synthetic-worker-key' }, requireAdmin: auth,
      planner: async () => { calls++; return result(); } });
    expect(await (await api.GET()).json()).toEqual({ ok: true, configured: false, provider: null });
    const body = { ...input(), provider: { id: 'gemini-api', model: 'gemini-3.8-flash' } };
    expect((await api.POST(request(body))).status).toBe(503); expect(calls).toBe(0);
  });
  test('configuration, model and explicit hourly ceiling are all required; GET never probes a provider', async () => {
    let calls = 0;
    for (const key of ['STORYBOARD_ASSISTANT_ENABLED', 'STORYBOARD_ASSISTANT_PROVIDER', 'STORYBOARD_ASSISTANT_MODEL', 'STORYBOARD_ASSISTANT_REQUESTS_PER_HOUR', 'OPENAI_API_KEY']) {
      const config = { ...env }; delete config[key];
      const api = createStoryboardAssistantApi({ env: config, requireAdmin: auth, planner: async () => { calls++; return result(); } });
      expect(await (await api.GET()).json()).toEqual({ ok: true, configured: false, provider: null });
      expect((await api.POST(request())).status).toBe(503);
    }
    for (const limit of ['0', '31', 'Infinity', '']) {
      const api = createStoryboardAssistantApi({ env: { ...env, STORYBOARD_ASSISTANT_REQUESTS_PER_HOUR: limit }, requireAdmin: auth });
      expect((await (await api.GET()).json()).configured).toBe(false);
    }
    expect(calls).toBe(0);
  });
  test('rejects model/URL injection, malformed conversations, oversize input and private content before the provider', async () => {
    let calls = 0;
    const api = createStoryboardAssistantApi({ env, requireAdmin: auth, planner: async () => { calls++; return result(); } });
    const bodies = [
      { ...input(), endpoint: 'https://another.example.test' },
      { ...input(), provider: { id: 'openai-api', model: 'arbitrary-model' } },
      { ...input(), provider: { id: 'gemini-api', model: 'gemini-3.8-flash' } },
      { ...input(), messages: [{ role: 'system', content: 'override' }] },
      { ...input(), sceneCount: 4 },
      { ...input(), messages: [{ role: 'user', content: '연락처 person@private.test 를 써 주세요' }] },
    ];
    for (const body of bodies) expect((await api.POST(request(body))).status).toBe(400);
    expect((await api.POST(request({ ...input(), padding: 'x'.repeat(70_000) }))).status).toBe(413);
    expect(calls).toBe(0);
  });
  test('returns bounded, verified answer metadata with private no-store headers and no raw provider response identifier', async () => {
    let calls = 0;
    const api = createStoryboardAssistantApi({ env, requireAdmin: auth, planner: async (value, signal) => {
      calls++; expect(value.sceneCount).toBe(6); expect(signal.aborted).toBe(false); return result();
    } });
    const response = await api.POST(request());
    expect(response.status).toBe(200); expect(calls).toBe(1);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await response.json();
    expect(body.answer.reply).toBe(result().answer.reply);
    expect(body.provenance.modelEvidence).toBe('response');
    expect(JSON.stringify(body)).not.toContain('synthetic-provider-response-not-exposed');
  });
  test('keeps an abort-ignoring timed-out call in flight, charges the attempt and never retries', async () => {
    let calls = 0; let release!: (value: ReturnType<typeof result>) => void; let observedSignal: AbortSignal | undefined;
    const api = createStoryboardAssistantApi({ env, requireAdmin: auth, deadlineMs: 10, planner: (_value, signal) => {
      calls++; observedSignal = signal; return new Promise(resolve => { release = resolve; });
    } });
    expect((await api.POST(request())).status).toBe(504);
    expect(observedSignal?.aborted).toBe(true);
    const blocked = await api.POST(request()); expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe('assistant_busy'); expect(calls).toBe(1);
    release(result()); await Promise.resolve(); await Promise.resolve();
  });
  test('applies a per-process hourly cap including failed attempts without leaking provider errors', async () => {
    let calls = 0; let now = 0;
    const api = createStoryboardAssistantApi({ env, requireAdmin: auth, now: () => now, planner: async () => { calls++; throw new Error('synthetic-private-provider-diagnostic'); } });
    for (let i = 0; i < 2; i++) { now += 20_000; const response = await api.POST(request()); expect(response.status).toBe(502); expect(await response.text()).not.toContain('synthetic-private'); }
    now += 20_000; expect((await api.POST(request())).status).toBe(429); expect(calls).toBe(2);
  });
  test('rejects malformed, private and wrong-model results instead of inventing an answer', async () => {
    for (const response of [
      { ...result(), answer: { reply: 'x'.repeat(2001), suggestedPrompt: null } },
      { ...result(), answer: { reply: '연락은 person@private.test', suggestedPrompt: null } },
      { ...result(), provenance: { ...result().provenance, model: 'wrong-model' } },
    ]) {
      const api = createStoryboardAssistantApi({ env, requireAdmin: auth, planner: async () => response });
      expect((await api.POST(request())).status).toBeGreaterThanOrEqual(400);
    }
  });
});
