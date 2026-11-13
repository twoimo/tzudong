import { describe, expect, test } from 'bun:test';
import { createLiveGeminiPreviewRunner, createLiveOpenAiPreviewRunner, buildOpenAiResponsesPayload } from '../lib/ocr/preview';
import { readBoundedPreviewResponse } from '../lib/ocr/preview/bounded-provider-http';

const openaiInput = { model: 'gpt-4o-mini', payload: {} };

describe('preview transport bounds without real network', () => {
  test('both direct live factories deny before credential getters or fetch by default', async () => {
    let touched = 0;
    const env = new Proxy({}, { get() { touched++; throw new Error('must not read'); } });
    const deniedFetch = (() => { touched++; throw new Error('must not fetch'); }) as unknown as typeof fetch;
    await expect(createLiveOpenAiPreviewRunner({ env, fetchFn: deniedFetch })(openaiInput)).rejects.toThrow('OPENAI_PAID_POLICY_DENIED');
    await expect(createLiveGeminiPreviewRunner({ env, fetchFn: deniedFetch })({ prompt: '', imageBase64: '', mimeType: 'image/png' })).rejects.toThrow('POLICY_DENIED_LOCAL_ONLY');
    expect(touched).toBe(0);
  });
  test('streaming response is cancelled as soon as the byte cap is crossed', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(65537)); },
      cancel() { cancelled = true; },
    }));
    await expect(readBoundedPreviewResponse(response, AbortSignal.timeout(1000))).rejects.toThrow('MALFORMED_RESPONSE');
    expect(cancelled).toBe(true);
  });
  test('a stalled response body observes the deadline and cancels its reader', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    await expect(readBoundedPreviewResponse(response, AbortSignal.timeout(10))).rejects.toThrow('TIMEOUT');
    expect(cancelled).toBe(true);
  });
  test('native body errors never expose provider detail', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('private upstream diagnostic')); } }));
    await expect(readBoundedPreviewResponse(response, AbortSignal.timeout(1000))).rejects.toThrow('PROVIDER_ERROR');
  });
  test('an already-aborted request performs zero network calls', async () => {
    let calls = 0;
    const runner = createLiveOpenAiPreviewRunner({ apiKey: 'synthetic-only', costPolicy: { allowPaidCloud: true }, fetchFn: (() => { calls++; throw new Error('unexpected'); }) as unknown as typeof fetch });
    await expect(runner({ ...openaiInput, signal: AbortSignal.abort() })).rejects.toThrow('TIMEOUT');
    expect(calls).toBe(0);
  });
  test('Responses structured output uses text.format and disables response storage', () => {
    const payload = buildOpenAiResponsesPayload({ imageBase64: 'AA==', mimeType: 'image/png' });
    expect(payload.store).toBe(false);
    expect(payload.text.format.type).toBe('json_schema');
    expect(payload).not.toHaveProperty('response_format');
  });
});
