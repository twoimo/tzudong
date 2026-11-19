import { describe, expect, test } from 'bun:test';
import { OpenAIStoryboardClient } from '../lib/admin/storyboard/openai-client';
import { STORYBOARD_OPENAI_IMAGE_MODEL, STORYBOARD_OPENAI_TEXT_MODEL } from '../lib/admin/storyboard/openai-models';
import { STORYBOARD_WORKFLOW, storyboardProductionRequestSchema } from '../lib/admin/storyboard/production-contract';

const base = { workflow: STORYBOARD_WORKFLOW, requestId: 'ddbfeddd-4fc3-4019-aae3-c73df693eb6b', prompt: 'Small bakery story',
  sceneCount: 5, sources: [], retrieval: 'none', imageWidth: 1024, imageHeight: 1024,
  providers: { externalAI: true, text: { id: 'openai-api', model: STORYBOARD_OPENAI_TEXT_MODEL }, image: { id: 'openai-api', model: STORYBOARD_OPENAI_IMAGE_MODEL } } };
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
const draft = { title: '아침 빵', logline: '제빵사의 아침.', scenes: Array.from({ length: 5 }, (_, i) => ({ sceneNo: i + 1, title: `장면 ${i + 1}`, durationSec: 10,
  description: '빵을 준비한다.', visualDirection: '고정 와이드 샷', narration: '', caption: '', productionNotes: ['천천히 촬영'], imagePrompt: 'A bakery', sourceIds: [] })) };
describe('OpenAI storyboard provider boundary', () => {
  test('admits only explicit allowlisted OpenAI models and rejects unknown provider/model', () => {
    expect(storyboardProductionRequestSchema.safeParse(base).success).toBe(true);
    expect(storyboardProductionRequestSchema.safeParse({ ...base, providers: { ...base.providers, text: { id: 'openai-api', model: 'gpt-unlisted' } } }).success).toBe(false);
    expect(storyboardProductionRequestSchema.safeParse({ ...base, providers: { ...base.providers, text: { id: 'other', model: STORYBOARD_OPENAI_TEXT_MODEL } } }).success).toBe(false);
  });
  test('advertises only exact allowlisted models returned from Models Read and caches the read', async () => {
    let calls = 0; const client = new OpenAIStoryboardClient({ apiKey: 'sk-test-secret-not-real', fetcher: async (url, init) => {
      calls++; expect(String(url)).toBe('https://api.openai.com/v1/models'); expect(init?.method).toBe('GET');
      return response({ data: [{ id: STORYBOARD_OPENAI_TEXT_MODEL }, { id: STORYBOARD_OPENAI_IMAGE_MODEL }, { id: 'gpt-unapproved' }] });
    } });
    const first = await client.models(); const second = await client.models();
    expect(first.map(model => model.id)).toEqual([STORYBOARD_OPENAI_TEXT_MODEL, STORYBOARD_OPENAI_IMAGE_MODEL]);
    expect(second).toEqual(first); expect(calls).toBe(1);
  });
  test('validates output against the application schema, returns response provenance and usage', async () => {
    const client = new OpenAIStoryboardClient({ apiKey: 'sk-test-secret-not-real', fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.text.format.type).toBe('json_schema'); expect(body.store).toBe(false);
      return response({ id: 'resp_123', model: STORYBOARD_OPENAI_TEXT_MODEL, status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(draft) }] }], usage: { input_tokens: 123, output_tokens: 456, total_tokens: 579 } });
    } });
    const result = await client.draft(base as never);
    expect(result.draft.scenes).toHaveLength(5); expect(result.provenance.responseId).toBe('resp_123');
    expect(result.provenance.usage).toEqual({ inputTokens: 123, outputTokens: 456, totalTokens: 579 });
  });
  test('malformed structured output fails closed with one request and sanitized error', async () => {
    let calls = 0; const client = new OpenAIStoryboardClient({ apiKey: 'sk-test-secret-not-real', fetcher: async () => { calls++; return response({ id: 'resp', model: STORYBOARD_OPENAI_TEXT_MODEL, status: 'completed', output: [{ content: [{ type: 'output_text', text: '{bad' }] }] }); } });
    await expect(client.draft(base as never)).rejects.toThrow('invalid_structured_response'); expect(calls).toBe(1);
  });
  test('pre-aborted requests make zero provider calls for models, text, and image', async () => {
    let calls = 0; const client = new OpenAIStoryboardClient({ apiKey: 'sk-test-secret-not-real', fetcher: async () => { calls++; return response({}); } });
    const abort = new AbortController(); abort.abort();
    await expect(client.models(abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client.draft(base as never, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client.image(base as never, 'A bakery', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
  });
  test('timeout/uncertain request is single-attempt and exposes no provider body or key', async () => {
    let calls = 0; const client = new OpenAIStoryboardClient({ apiKey: 'sk-test-secret-not-real', fetcher: async () => { calls++; throw new Error('secret provider detail'); } });
    await expect(client.draft(base as never)).rejects.toThrow('provider_failed'); expect(calls).toBe(1);
  });
  test('image output is bounded, one request, and model evidence reflects Image API semantics', async () => {
    let calls = 0; const client = new OpenAIStoryboardClient({ apiKey: 'sk-test-secret-not-real', fetcher: async (_url, init) => { calls++; const body = JSON.parse(String(init?.body)); expect(body.quality).toBe('low'); expect(body.n).toBe(1); return response({ data: [{ b64_json: 'not-base64!' }] }); } });
    await expect(client.image(base as never, 'A bakery')).rejects.toThrow('invalid_image_response'); expect(calls).toBe(1);
  });
});
