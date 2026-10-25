import { ThumbnailChatGeminiError, prepareThumbnailChatContent, thumbnailChatGenerationConfig as generationConfig } from './gemini-chat-input';
export { ThumbnailChatGeminiError, prepareThumbnailChatContent } from './gemini-chat-input';
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import type { z } from 'zod';
import {
  THUMBNAIL_CHAT_MODEL, THUMBNAIL_CHAT_RESPONSE_BYTES, thumbnailChatContext, thumbnailChatResponse,
  thumbnailChatProvenance, thumbnailChatStartReceipt, validateThumbnailChatResponse,
  type ThumbnailChatContext, type ThumbnailChatDescriptor, type ThumbnailChatResponse, type ThumbnailChatProvenance,
} from './chat-contract';

export type { ThumbnailChatDescriptor } from './chat-contract';
type BudgetOptions = { env?: NodeJS.ProcessEnv; signal?: AbortSignal };
type ProjectBudget = <T>(work: () => Promise<T>, options?: BudgetOptions) => Promise<T>;
type Client = { models: Pick<GoogleGenAI['models'], 'generateContent'> & Partial<Pick<GoogleGenAI['models'], 'get'>> };
type Usage = { model: string; promptTokens: number | null; outputTokens: number | null; thoughtTokens: number | null; totalTokens: number | null };
export type ThumbnailChatStoredInput = { context: unknown; ownerId: string; jobId: string; attemptId: string; fence: number };
export type ThumbnailChatWorkerResult = { bytes: Buffer; result: ThumbnailChatResponse; provenance: ThumbnailChatProvenance };
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
const identity = thumbnailChatStartReceipt.pick({ ownerId: true, jobId: true, attemptId: true, fence: true });
async function sharedBudget<T>(work: () => Promise<T>, options?: BudgetOptions): Promise<T> {
  const budget = await import('../../../../../backend/utils/provider-budget.mjs');
  return await budget.withProjectBudget(work, options);
}

function received(response: GenerateContentResponse, context: ThumbnailChatContext, descriptor: ThumbnailChatDescriptor): ThumbnailChatWorkerResult {
  if (!response || response.candidates?.length !== 1 || response.promptFeedback?.blockReason) throw new Error('invalid_response');
  const candidate = response.candidates[0];
  if (candidate.finishReason && candidate.finishReason !== 'STOP') throw new Error('invalid_response');
  const parts = candidate.content?.parts;
  if (!parts?.length || parts.length > 16) throw new Error('invalid_response');
  let text = '';
  for (const part of parts) {
    if (part.thought) continue;
    if (typeof part.text !== 'string' || Object.keys(part).some((key) => !['text', 'thought', 'thoughtSignature'].includes(key))) {
      throw new Error('invalid_response');
    }
    text += part.text;
    if (Buffer.byteLength(text) > THUMBNAIL_CHAT_RESPONSE_BYTES) throw new Error('invalid_response');
  }
  const result = validateThumbnailChatResponse(JSON.parse(text), context);
  const bytes = Buffer.from(JSON.stringify(result), 'utf8');
  if (bytes.length > THUMBNAIL_CHAT_RESPONSE_BYTES) throw new Error('invalid_response');
  const provenance = thumbnailChatProvenance.parse({ providerId: 'gemini-api', model: THUMBNAIL_CHAT_MODEL,
    responseModel: response.modelVersion?.replace(/^models\//, ''), responseId: response.responseId ?? null,
    verification: 'official-api', modelEvidence: 'response', generatedAt: new Date().toISOString(),
    attemptId: descriptor.attemptId, inputSha256: descriptor.inputSha256 });
  return { bytes, result, provenance };
}

/** Worker-only: the durable caller supplies a new start commit after shared budget acquisition. */
export class GeminiThumbnailChatWorkerClient {
  private readonly client: Client;
  private readonly env: NodeJS.ProcessEnv;
  private readonly budget: ProjectBudget;
  private readonly onUsage?: (usage: Usage) => void;
  private catalogExpiresAt = 0;
  constructor(options: { env?: NodeJS.ProcessEnv; client?: Client; budget?: ProjectBudget; onUsage?: (usage: Usage) => void } = {}) {
    if (typeof window !== 'undefined') throw new ThumbnailChatGeminiError('provider_not_configured');
    this.env = { ...(options.env ?? process.env) };
    const apiKey = this.env.GEMINI_CREDITS_API_KEY?.trim();
    if (!apiKey && !options.client) throw new ThumbnailChatGeminiError('provider_not_configured');
    this.client = options.client ?? new GoogleGenAI({ apiKey: apiKey!, vertexai: false,
      httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } } });
    this.budget = options.budget ?? sharedBudget; this.onUsage = options.onUsage;
  }
  async models(signal?: AbortSignal): Promise<Array<typeof THUMBNAIL_CHAT_MODEL>> {
    signal?.throwIfAborted();
    if (this.catalogExpiresAt > Date.now()) return [THUMBNAIL_CHAT_MODEL];
    if (!this.client.models.get) throw new ThumbnailChatGeminiError('model_catalog_unavailable');
    try {
      const model = await this.budget(() => this.client.models.get!({ model: THUMBNAIL_CHAT_MODEL,
        config: { abortSignal: signal, httpOptions: { timeout: 15_000, retryOptions: { attempts: 1 } } } }), { env: { ...this.env }, signal });
      signal?.throwIfAborted();
      if (model.name?.replace(/^models\//, '') !== THUMBNAIL_CHAT_MODEL) throw new Error('model_mismatch');
      this.catalogExpiresAt = Date.now() + 300_000; return [THUMBNAIL_CHAT_MODEL];
    } catch { signal?.throwIfAborted(); throw new ThumbnailChatGeminiError('model_catalog_unavailable'); }
  }
  async prepareStored(input: ThumbnailChatStoredInput) {
    let admitted: z.infer<typeof identity>;
    try { admitted = identity.parse({ ownerId: input.ownerId, jobId: input.jobId, attemptId: input.attemptId, fence: input.fence }); }
    catch { throw new ThumbnailChatGeminiError('invalid_input'); }
    const snapshot = prepareThumbnailChatContent(input.context);
    const descriptor: ThumbnailChatDescriptor = Object.freeze({ ...admitted, providerId: 'gemini-api',
      model: THUMBNAIL_CHAT_MODEL, inputSha256: snapshot.inputSha256 });
    let consumed = false;
    return Object.freeze({ descriptor, run: async (
      authorizeStart: (expected: ThumbnailChatDescriptor) => Promise<unknown>, signal?: AbortSignal,
    ): Promise<ThumbnailChatWorkerResult> => {
      if (consumed) throw new ThumbnailChatGeminiError('attempt_consumed', 'already_consumed');
      consumed = true;
      let started = false, budgetEntered = false, responseReceived = false;
      let response: GenerateContentResponse | undefined;
      try {
        if (signal?.aborted) throw new ThumbnailChatGeminiError('cancelled_before_start');
        await this.budget(async () => {
          if (budgetEntered) throw new ThumbnailChatGeminiError('attempt_consumed', 'already_consumed');
          budgetEntered = true;
          if (signal?.aborted) throw new ThumbnailChatGeminiError('cancelled_before_start');
          let receipt;
          try { receipt = thumbnailChatStartReceipt.parse(await authorizeStart(descriptor)); }
          catch { throw new ThumbnailChatGeminiError('start_not_confirmed'); }
          if (Object.entries(descriptor).some(([key, value]) => receipt[key as keyof typeof receipt] !== value)) {
            throw new ThumbnailChatGeminiError('start_not_confirmed');
          }
          if (signal?.aborted) throw new ThumbnailChatGeminiError('cancelled_before_start');
          started = true;
          response = await this.client.models.generateContent({ model: THUMBNAIL_CHAT_MODEL,
            contents: [{ role: 'user', parts: [{ text: snapshot.prompt }] }], config: {
              ...generationConfig(),
              abortSignal: signal, httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } },
            } });
          responseReceived = true;
        }, { env: { ...this.env }, signal });
      } catch (error) {
        if (!responseReceived) {
          if (!started && error instanceof ThumbnailChatGeminiError) throw error;
          throw new ThumbnailChatGeminiError(started ? 'provider_outcome_unknown'
            : signal?.aborted ? 'cancelled_before_start' : 'budget_unavailable', started ? 'unknown' : 'not_started');
        }
      }
      if (!responseReceived) throw new ThumbnailChatGeminiError('budget_unavailable');
      try {
        this.onUsage?.({ model: THUMBNAIL_CHAT_MODEL, promptTokens: count(response?.usageMetadata?.promptTokenCount),
          outputTokens: count(response?.usageMetadata?.candidatesTokenCount), thoughtTokens: count(response?.usageMetadata?.thoughtsTokenCount),
          totalTokens: count(response?.usageMetadata?.totalTokenCount) });
      } catch { /* Optional telemetry cannot discard a completed paid response. */ }
      try { return received(response!, snapshot.context, descriptor); }
      catch { throw new ThumbnailChatGeminiError('invalid_provider_response', 'received_invalid'); }
    } });
  }
}
