import { describe, expect, test } from 'bun:test';
import { GenerateContentResponse } from '@google/genai';
import { GeminiStoryboardClient, resolveStoryboardGeminiKey } from '../lib/admin/storyboard/gemini-client';
import { storyboardProductionRequestSchema, StoryboardProductionError } from '../lib/admin/storyboard/production-contract';
import { STORYBOARD_GEMINI_IMAGE_MODELS } from '../lib/admin/storyboard/gemini-models';

const request = () => storyboardProductionRequestSchema.parse({ workflow: 'storyboard-mlx-v1', requestId: crypto.randomUUID(),
  prompt: '합성 검증용 식당 촬영안', sceneCount: 5, providers: { externalAI: true,
    text: { id: 'gemini-api', model: 'gemini-3.8-flash' }, image: { id: 'gemini-api', model: 'gemini-3.1-flash-image' } } });
const draft = { title: '합성 검증', logline: '테스트 데이터', scenes: Array.from({ length: 5 }, (_, i) => ({
  sceneNo: i + 1, title: `장면 ${i + 1}`, durationSec: 10, description: '음식 촬영', visualDirection: '테이블 샷',
  narration: '', caption: '', productionNotes: ['합성 검증'], imagePrompt: 'food on a table', sourceIds: [],
})) };
function response(model: string, parts = [{ text: JSON.stringify(draft) }]) {
  const value = new GenerateContentResponse(); value.modelVersion = model;
  value.responseId = 'synthetic-response'; value.candidates = [{ content: { parts } }]; return value;
}
function fakeClient(generate = async () => response('gemini-3.8-flash')) {
  let reads = 0;
  const client = { models: { get: async ({ model }: { model: string }) => { reads++; return { name: `models/${model}` }; }, generateContent: generate } };
  return { client, reads: () => reads };
}
describe('Gemini storyboard worker client', () => {
  test('prefers the funded server credential and never a public key', () => {
    expect(resolveStoryboardGeminiKey({ GEMINI_CREDITS_API_KEY: 'funded', STORYBOARD_GEMINI_API_KEY: 'other' })).toBe('funded');
    expect(resolveStoryboardGeminiKey({ NEXT_PUBLIC_GOOGLE_API_KEY: 'public' })).toBeNull();
  });
  test('coalesces repeated metadata polling through a bounded catalog and returns independent objects', async () => {
    const fake = fakeClient(); const provider = new GeminiStoryboardClient({ client: fake.client });
    const first = await provider.models(); first[0].capabilities.push('forged');
    for (let i = 0; i < 100; i++) expect((await provider.models())[0].capabilities).toEqual(['chat']);
    expect(fake.reads()).toBe(3);
    expect(first.every((model) => model.bytes_on_disk === 0 && model.bytes_resident === 0)).toBe(true);
  });
  test('validates structured scenes and actual response model provenance', async () => {
    const fake = fakeClient(); const provider = new GeminiStoryboardClient({ client: fake.client });
    const result = await provider.draft(request());
    expect(result.draft.scenes).toHaveLength(5);
    expect(result.provenance).toMatchObject({ providerId: 'gemini-api', model: 'gemini-3.8-flash', responseModel: 'gemini-3.8-flash', verification: 'official-api' });
  });
  test('advertises available models when one optional lookup is unavailable', async () => {
    const fake=fakeClient();const missing=STORYBOARD_GEMINI_IMAGE_MODELS[1].id;
    fake.client.models.get=async({model}:{model:string})=>{
      if(model===missing)throw {status:404,message:'synthetic-unavailable'};
      return {name:`models/${model}`};
    };
    const models=await new GeminiStoryboardClient({client:fake.client}).models();
    expect(models.map(entry=>entry.id)).toEqual(['gemini-3.8-flash',STORYBOARD_GEMINI_IMAGE_MODELS[0].id]);
    expect(models.some(entry=>entry.id===missing)).toBe(false);
  });
  test('rejects an empty verified catalog and preserves caller cancellation', async () => {
    const fake=fakeClient();fake.client.models.get=async()=>{throw {status:404,message:'synthetic'};};
    await expect(new GeminiStoryboardClient({client:fake.client}).models()).rejects.toMatchObject({code:'provider_failed'});
    const controller=new AbortController();fake.client.models.get=async()=>{controller.abort();throw new Error('synthetic');};
    await expect(new GeminiStoryboardClient({client:fake.client}).models(controller.signal)).rejects.toBeDefined();
  });
  test('returns a completed result even when optional usage telemetry fails', async () => {
    const fake = fakeClient();
    const provider = new GeminiStoryboardClient({ client: fake.client, onUsage: () => { throw new Error('telemetry unavailable'); } });
    expect((await provider.draft(request())).draft.scenes).toHaveLength(5);
  });
  test('rejects different response models and all non-Gemini or unapproved request models', async () => {
    const fake = fakeClient(async () => response('another-model'));
    await expect(new GeminiStoryboardClient({ client: fake.client }).draft(request())).rejects.toMatchObject({ code: 'model_identity_mismatch' });
    const invalid = request(); invalid.providers.text = { id: 'openai-api', model: 'other' };
    await expect(new GeminiStoryboardClient({ client: fake.client }).draft(invalid)).rejects.toBeInstanceOf(StoryboardProductionError);
  });
  test('performs no work after abort and does not leak provider diagnostics', async () => {
    let calls = 0; const fake = fakeClient(async () => { calls++; throw { status: 429, message: 'private-provider-diagnostic' }; });
    const provider = new GeminiStoryboardClient({ client: fake.client });
    const signal = AbortSignal.abort();
    await expect(provider.draft(request(), signal)).rejects.toBeDefined(); expect(calls).toBe(0);
    await expect(provider.draft(request())).rejects.toMatchObject({ code: 'provider_rate_limited', message: 'provider_rate_limited' });
    expect(calls).toBe(1);
  });
});
