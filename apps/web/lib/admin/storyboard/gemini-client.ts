import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { randomUUID } from 'node:crypto';
import {
  MAX_STORYBOARD_IMAGE_BYTES, StoryboardProductionError, buildStoryboardDraftPrompt,
  parseStoryboardDraft, type StoryboardProductionRequest,
} from './production-contract';
import { STORYBOARD_GEMINI_TEXT_MODEL, STORYBOARD_GEMINI_IMAGE_MODELS, isAllowedStoryboardGeminiModel } from './gemini-models';

type Usage = { model: string; promptTokens: number | null; outputTokens: number | null; thoughtTokens: number | null; totalTokens: number | null };
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

export function resolveStoryboardGeminiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  if (typeof window !== 'undefined') throw new StoryboardProductionError('provider_not_configured');
  return env.GEMINI_CREDITS_API_KEY?.trim() || env.STORYBOARD_GEMINI_API_KEY?.trim() || env.GEMINI_API_KEY?.trim() || null;
}

function providerError(error: unknown): StoryboardProductionError {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : null;
  return new StoryboardProductionError(status === 401 ? 'provider_auth_failed' : status === 403 ? 'provider_forbidden'
    : status === 429 ? 'provider_rate_limited' : 'provider_failed');
}

/** Worker-only client: no browser credentials, alternate LLM, hidden retry or raw output log. */
export class GeminiStoryboardClient {
  private readonly client: { models: Pick<GoogleGenAI['models'], 'get' | 'generateContent'> };
  constructor(options: { apiKey?: string; env?: NodeJS.ProcessEnv; onUsage?: (usage: Usage) => void;
    client?: { models: Pick<GoogleGenAI['models'], 'get' | 'generateContent'> } } = {}) {
    if (typeof window !== 'undefined') throw new StoryboardProductionError('provider_not_configured');
    const apiKey = options.apiKey ?? resolveStoryboardGeminiKey(options.env);
    if (!apiKey && !options.client) throw new StoryboardProductionError('provider_not_configured');
    this.client = options.client ?? new GoogleGenAI({ apiKey: apiKey!, httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } } });
    this.onUsage = options.onUsage;
  }
  private readonly onUsage?: (usage: Usage) => void;
  private catalog?: { expiresAt: number; models: Awaited<ReturnType<GeminiStoryboardClient['readModels']>> };

  async models(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.catalog && this.catalog.expiresAt > Date.now()) return this.catalog.models.map((entry) => ({ ...entry, capabilities: [...entry.capabilities] }));
    const models = await this.readModels(signal);
    this.catalog = { models, expiresAt: Date.now() + 300_000 };
    return models.map((entry) => ({ ...entry, capabilities: [...entry.capabilities] }));
  }

  private async readModels(signal?: AbortSignal) {
    const ids = [STORYBOARD_GEMINI_TEXT_MODEL, ...STORYBOARD_GEMINI_IMAGE_MODELS.map((entry) => entry.id)];
    const results = [];
    for (const id of ids) {
      signal?.throwIfAborted();
      try {
        const model = await this.client.models.get({ model: id, config: { httpOptions: { timeout: 15_000 }, abortSignal: signal } });
        if (model.name?.replace(/^models\//, '') !== id) throw new StoryboardProductionError('model_identity_mismatch');
        results.push({ id, capabilities: [id === STORYBOARD_GEMINI_TEXT_MODEL ? 'chat' : 'image'],
          loaded: false, bytes_on_disk: 0, bytes_resident: 0, owned_by: 'gemini-api' as const });
      } catch {
        signal?.throwIfAborted();
        // An unavailable optional model must not hide verified alternatives.
        // Capability matching still excludes jobs requiring this missing model.
      }
    }
    if (results.length === 0) throw new StoryboardProductionError('provider_failed');
    return results;
  }

  private recordUsage(model: string, usage?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number }) {
    // Telemetry failure must not turn a completed paid generation into a retry.
    try { this.onUsage?.({ model, promptTokens: count(usage?.promptTokenCount), outputTokens: count(usage?.candidatesTokenCount),
      thoughtTokens: count(usage?.thoughtsTokenCount), totalTokens: count(usage?.totalTokenCount) }); } catch { /* optional telemetry */ }
  }

  private proof(model: string, response: { modelVersion?: string; responseId?: string }) {
    const version = response.modelVersion?.replace(/^models\//, '');
    // Numeric service revisions are accepted; different model families are never accepted.
    if (!version || (version !== model && !new RegExp(`^${model.replaceAll('.', '\\.')}-(?:\\d{3}|\\d{2}-\\d{2})$`).test(version))) {
      throw new StoryboardProductionError('model_identity_mismatch');
    }
    return { providerId: 'gemini-api' as const, model, verification: 'official-api' as const, generatedAt: new Date().toISOString(),
      requestId: randomUUID(), responseId: response.responseId || null, responseModel: version, modelEvidence: 'response' as const };
  }

  async draft(request: StoryboardProductionRequest, signal?: AbortSignal) {
    const model = request.providers.text.model;
    if (request.providers.text.id !== 'gemini-api' || !isAllowedStoryboardGeminiModel(model, 'text')) throw new StoryboardProductionError('model_not_selected');
    signal?.throwIfAborted();
    let response;
    try {
      response = await this.client.models.generateContent({ model, contents: buildStoryboardDraftPrompt(request), config: {
        // Gemini 3.8 Flash no longer accepts sampling overrides.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM }, maxOutputTokens: 8192,
        responseMimeType: 'application/json', abortSignal: signal,
        httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } },
      } });
    } catch (error) { signal?.throwIfAborted(); throw providerError(error); }
    signal?.throwIfAborted();
    this.recordUsage(model, response.usageMetadata);
    let parsed;
    try { parsed = JSON.parse(response.text ?? ''); } catch { throw new StoryboardProductionError('invalid_structured_response'); }
    return { draft: parseStoryboardDraft(parsed, request), provenance: this.proof(model, response) };
  }

  async image(request: StoryboardProductionRequest, prompt: string, signal?: AbortSignal) {
    const model = request.providers.image.model;
    if (request.providers.image.id !== 'gemini-api' || !isAllowedStoryboardGeminiModel(model, 'image')) throw new StoryboardProductionError('model_not_selected');
    signal?.throwIfAborted();
    const ratio = request.imageWidth / request.imageHeight;
    const aspectRatio = Math.abs(ratio - 16 / 9) < 0.001 ? '16:9' : Math.abs(ratio - 9 / 16) < 0.001 ? '9:16'
      : Math.abs(ratio - 1) < 0.001 ? '1:1' : null;
    if (!aspectRatio) throw new StoryboardProductionError('invalid_request');
    let response;
    try {
      response = await this.client.models.generateContent({ model, contents: prompt, config: {
        responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: '1K' },
        abortSignal: signal, httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } },
      } });
    } catch (error) { signal?.throwIfAborted(); throw providerError(error); }
    signal?.throwIfAborted();
    this.recordUsage(model, response.usageMetadata);
    const images = response.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
      .filter((part) => !part.thought && part.inlineData?.data);
    if (images?.length !== 1) throw new StoryboardProductionError('invalid_image_response');
    const data = images[0].inlineData?.data ?? '';
    const mime = images[0].inlineData?.mimeType ?? '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime) || data.length > Math.ceil(MAX_STORYBOARD_IMAGE_BYTES / 3) * 4) {
      throw new StoryboardProductionError('invalid_image_response');
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > MAX_STORYBOARD_IMAGE_BYTES || bytes.toString('base64') !== data) throw new StoryboardProductionError('invalid_image_response');
    // The existing worker decodes pixels and enforces dimensions before persistence.
    return { bytes, provenance: this.proof(model, response) };
  }
}
