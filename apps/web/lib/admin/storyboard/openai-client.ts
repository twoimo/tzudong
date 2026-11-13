import { randomUUID } from 'node:crypto';
import { StoryboardProductionError, buildStoryboardDraftPrompt, parseStoryboardDraft, type StoryboardProductionRequest } from './production-contract';
import { STORYBOARD_OPENAI_TEXT_MODEL, STORYBOARD_OPENAI_IMAGE_MODEL, isAllowedStoryboardOpenAIModel } from './openai-models';

type Usage = { model: string; responseId: string | null; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
const timeoutMs = 45_000;
function resolveKey(env: NodeJS.ProcessEnv = process.env): string | null {
  if (typeof window !== 'undefined') throw new StoryboardProductionError('provider_not_configured');
  const value = env.OPENAI_API_KEY?.trim();
  return value && /^sk-[A-Za-z0-9_-]{20,}$/.test(value) ? value : null;
}
function safeError(status: number): StoryboardProductionError {
  return new StoryboardProductionError(status === 401 ? 'provider_auth_failed' : status === 403 ? 'provider_forbidden'
    : status === 429 ? 'provider_rate_limited' : 'provider_failed');
}
function obj(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function str(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function numberOrNull(value: unknown): number | null { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null; }
const sceneSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    sceneNo: { type: 'integer', minimum: 1, maximum: 12 }, title: { type: 'string' }, durationSec: { type: 'integer', minimum: 1, maximum: 600 },
    description: { type: 'string' }, visualDirection: { type: 'string' }, narration: { type: 'string' }, caption: { type: 'string' },
    productionNotes: { type: 'array', items: { type: 'string' }, minItems: 1 }, imagePrompt: { type: 'string' },
    sourceIds: { type: 'array', items: { type: 'string' }, maxItems: 12 },
  }, required: ['sceneNo','title','durationSec','description','visualDirection','narration','caption','productionNotes','imagePrompt','sourceIds'],
};
const draftSchema = { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, logline: { type: 'string' },
  scenes: { type: 'array', items: sceneSchema, minItems: 5, maxItems: 12 } }, required: ['title','logline','scenes'] };
export class OpenAIStoryboardClient {
  private readonly key: string;
  private readonly fetcher: typeof fetch;
  private readonly onUsage?: (usage: Usage) => void;
  private catalog?: { expiresAt: number; models: ReturnType<OpenAIStoryboardClient['declaredModels']> };
  constructor(options: { apiKey?: string; env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; onUsage?: (usage: Usage) => void } = {}) {
    if (typeof window !== 'undefined') throw new StoryboardProductionError('provider_not_configured');
    const key = options.apiKey ?? resolveKey(options.env);
    if (!key) throw new StoryboardProductionError('provider_not_configured');
    this.key = key;
    this.fetcher = options.fetcher ?? fetch; this.onUsage = options.onUsage;
  }
  private declaredModels() { return [
    { id: STORYBOARD_OPENAI_TEXT_MODEL, owned_by: 'openai-api' as const, capabilities: ['chat'], loaded: false, bytes_on_disk: 0, bytes_resident: 0 },
    { id: STORYBOARD_OPENAI_IMAGE_MODEL, owned_by: 'openai-api' as const, capabilities: ['image'], loaded: false, bytes_on_disk: 0, bytes_resident: 0 },
  ]; }
  async models(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.catalog && this.catalog.expiresAt > Date.now()) return this.catalog.models.map(model => ({ ...model, capabilities: [...model.capabilities] }));
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.fetcher('https://api.openai.com/v1/models', { method: 'GET', signal: controller.signal, headers: { Authorization: `Bearer ${this.key}` } });
      if (!response.ok) throw safeError(response.status);
      if (!response.body) throw new StoryboardProductionError('invalid_model_response');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
        if (length > 512 * 1024) { await reader.cancel(); throw new StoryboardProductionError('model_response_too_large'); } chunks.push(part.value); }
      let catalogValue: unknown; try { catalogValue = JSON.parse(Buffer.concat(chunks.map(part => Buffer.from(part))).toString('utf8')); } catch { catalogValue = null; }
      const body = obj(catalogValue);
      if (!Array.isArray(body.data)) throw new StoryboardProductionError('invalid_model_response');
      const ids = new Set(body.data.map(item => str(obj(item).id)).filter((id): id is string => !!id));
      const models = this.declaredModels().filter(model => ids.has(model.id));
      if (!models.length) throw new StoryboardProductionError('provider_not_configured');
      this.catalog = { expiresAt: Date.now() + 300_000, models };
      return models.map(model => ({ ...model, capabilities: [...model.capabilities] }));
    } catch (error) { if (error instanceof StoryboardProductionError) throw error; signal?.throwIfAborted(); throw new StoryboardProductionError('provider_failed'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.fetcher(`https://api.openai.com/v1/${path}`, { method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw safeError(response.status);
      if (!response.body) throw new StoryboardProductionError('invalid_model_response');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
        if (length > 20 * 1024 * 1024) { await reader.cancel(); throw new StoryboardProductionError('model_response_too_large'); } chunks.push(part.value); }
      let data: unknown; try { data = JSON.parse(Buffer.concat(chunks.map(part => Buffer.from(part))).toString('utf8')); } catch { data = null; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StoryboardProductionError('invalid_model_response');
      return data as Record<string, unknown>;
    } catch (error) {
      if (error instanceof StoryboardProductionError) throw error;
      signal?.throwIfAborted();
      throw new StoryboardProductionError('provider_failed');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  private proof(model: string, responseModel: string, responseId: string | null) {
    if (!responseModel || (responseModel !== model && !new RegExp(`^${model.replaceAll('.', '\\.')}-(?:[0-9]{4}-[0-9]{2}-[0-9]{2})$`).test(responseModel))) throw new StoryboardProductionError('model_identity_mismatch');
    return { providerId: 'openai-api' as const, model, verification: 'official-api' as const, generatedAt: new Date().toISOString(),
      requestId: randomUUID(), responseId, responseModel, modelEvidence: 'response' as const };
  }
  async draft(request: StoryboardProductionRequest, signal?: AbortSignal, maxOutputTokens = 12_000) {
    const model = request.providers.text.model;
    if (request.providers.text.id !== 'openai-api' || !isAllowedStoryboardOpenAIModel(model, 'text')) throw new StoryboardProductionError('model_not_selected');
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 100 || maxOutputTokens > 12_000) throw new StoryboardProductionError('invalid_model_request');
    const response = await this.post('responses', { model, input: buildStoryboardDraftPrompt(request), max_output_tokens: maxOutputTokens, store: false,
      text: { format: { type: 'json_schema', name: 'storyboard_draft', strict: true, schema: draftSchema } } }, signal);
    if (response.status !== 'completed' || response.incomplete_details) throw new StoryboardProductionError('invalid_model_response');
    const output = Array.isArray(response.output) ? response.output : [];
    let text: string | null = null;
    for (const item of output) for (const content of Array.isArray(obj(item).content) ? obj(item).content as unknown[] : []) {
      const part = obj(content); if (part.type === 'refusal') throw new StoryboardProductionError('provider_failed');
      if (part.type === 'output_text' && typeof part.text === 'string') text = part.text;
    }
    if (!text || text.length > 192 * 1024) throw new StoryboardProductionError('invalid_model_response');
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new StoryboardProductionError('invalid_structured_response'); }
    const draft = parseStoryboardDraft(parsed, request);
    const usage = obj(response.usage);
    const usageInfo = { inputTokens: numberOrNull(usage.input_tokens), outputTokens: numberOrNull(usage.output_tokens), totalTokens: numberOrNull(usage.total_tokens) };
    try { this.onUsage?.({ model, responseId: str(response.id), ...usageInfo }); } catch { /* optional telemetry */ }
    return { draft, provenance: { ...this.proof(model, str(response.model) ?? '', str(response.id)), usage: usageInfo } };
  }
  async image(request: StoryboardProductionRequest, prompt: string, signal?: AbortSignal) {
    const model = request.providers.image.model;
    if (request.providers.image.id !== 'openai-api' || !isAllowedStoryboardOpenAIModel(model, 'image')) throw new StoryboardProductionError('model_not_selected');
    const size = request.imageWidth > request.imageHeight ? '1536x1024' : request.imageWidth < request.imageHeight ? '1024x1536' : '1024x1024';
    const response = await this.post('images/generations', { model, prompt: `${prompt}\nCreate one clean storyboard frame. No embedded text, captions, or watermarks.`,
      size, quality: 'low', n: 1, output_format: 'png' }, signal);
    const first = Array.isArray(response.data) ? obj(response.data[0]) : {};
    const encoded = str(first.b64_json);
    if (!encoded || encoded.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new StoryboardProductionError('invalid_image_response');
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new StoryboardProductionError('invalid_image_response');
    const usage = obj(response.usage);
    return { bytes, provenance: { providerId: 'openai-api' as const, model, verification: 'official-api' as const,
      generatedAt: new Date().toISOString(), requestId: randomUUID(), responseId: str(response.id), responseModel: null,
      modelEvidence: 'installed-catalog-and-request' as const, usage: { inputTokens: numberOrNull(usage.input_tokens),
        outputTokens: numberOrNull(usage.output_tokens), totalTokens: numberOrNull(usage.total_tokens) } } };
  }
}
