import { describe, expect, test } from 'bun:test';
import { OpenAIStoryboardClient } from '../lib/admin/storyboard/openai-client';
import { storyboardAssistantRequestSchema } from '../lib/admin/storyboard/assistant-contract';

const input = (provider: 'gemini-api' | 'openai-api') => storyboardAssistantRequestSchema.parse({
  provider: { id: provider, model: provider === 'gemini-api' ? 'gemini-3.8-flash' : 'gpt-5.6-luna' }, sceneCount: 6,
  messages: [{ role: 'user', content: '국수집에서 시작하는 이야기를 제안해 주세요.' }], context: { prompt: '', scene: null },
});
const answer = { reply: '간판에서 시작해 음식을 기다리는 모습으로 이어 보세요.', suggestedPrompt: null };

describe('storyboard planning provider boundaries (no external requests)', () => {
  test('OpenAI planning uses a fixed endpoint, strict schema, no tools or storage, and verified actual response identity', async () => {
    let calls = 0;
    const client = new OpenAIStoryboardClient({ apiKey: 'synthetic-test-only', fetcher: (async (url, init) => {
      calls++; expect(url).toBe('https://api.openai.com/v1/responses');
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false); expect(body.tools).toEqual([]); expect(body.max_output_tokens).toBe(2048);
      expect(body.text.format.strict).toBe(true); expect(body.text.format.schema.additionalProperties).toBe(false);
      return Response.json({ status: 'completed', model: 'gpt-5.6-luna', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] });
    }) as typeof fetch });
    const result = await client.plan(input('openai-api'), new AbortController().signal);
    expect(result.answer).toEqual(answer); expect(result.provenance.responseModel).toBe('gpt-5.6-luna'); expect(calls).toBe(1);
  });
  test('OpenAI rejects wrong-model and oversized envelopes without a second request', async () => {
    for (const body of [
      { status: 'completed', model: 'other', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] },
      { padding: 'x'.repeat(70_000) },
    ]) {
      let calls = 0;
      const client = new OpenAIStoryboardClient({ apiKey: 'synthetic-test-only', fetcher: (async () => { calls++; return Response.json(body); }) as typeof fetch });
      await expect(client.plan(input('openai-api'), new AbortController().signal)).rejects.toBeDefined(); expect(calls).toBe(1);
    }
  });
});
