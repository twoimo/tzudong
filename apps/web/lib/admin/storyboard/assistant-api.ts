import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/require-admin';
import { assertPrivacySafeText } from '@/lib/privacy/sanitize';
import { BOUNDED_JSON_REQUEST_ERROR, readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { hasUnsafeStoryboardInstructionRequest } from './prompt-safety';
import { isAllowedStoryboardModel, storyboardProviderSchema } from './production-contract';
import { OpenAIStoryboardClient, resolveStoryboardOpenAIKey } from './openai-client';
import { STORYBOARD_ASSISTANT_BODY_BYTES, STORYBOARD_ASSISTANT_DEADLINE_MS,
  STORYBOARD_ASSISTANT_RESPONSE_BYTES, storyboardAssistantRequestSchema, storyboardAssistantResultSchema,
  type StoryboardAssistantRequest, type StoryboardAssistantResult } from './assistant-contract';

if (typeof window !== 'undefined') throw new Error('Storyboard assistant is server-only.');

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie, Authorization' };
type AdminAuth = () => Promise<{ ok: true; userId: string } | { ok: false; response: Response }>;
type Planner = (input: StoryboardAssistantRequest, signal: AbortSignal) => Promise<{
  answer: unknown; provenance: Record<string, unknown>;
}>;
class AssistantError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
const failure = (code: string, status: number) => Response.json({ ok: false, error: code }, { status, headers });

function configuration(env: NodeJS.ProcessEnv) {
  const provider = storyboardProviderSchema.safeParse({ id: env.STORYBOARD_ASSISTANT_PROVIDER, model: env.STORYBOARD_ASSISTANT_MODEL });
  const hourlyLimit = Number(env.STORYBOARD_ASSISTANT_REQUESTS_PER_HOUR);
  if (env.STORYBOARD_ASSISTANT_ENABLED !== '1' || !provider.success || provider.data.id !== 'openai-api'
    || !isAllowedStoryboardModel(provider.data.id, provider.data.model, 'text')
    || !Number.isSafeInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > 30) return null;
  const hasKey = !!resolveStoryboardOpenAIKey(env);
  return hasKey ? { provider: provider.data, hourlyLimit } : null;
}

function safeText(text: string) {
  try { assertPrivacySafeText(text); }
  catch { throw new AssistantError('private_content'); }
  if (hasUnsafeStoryboardInstructionRequest(text)) throw new AssistantError('private_content');
}

/**
 * A planning endpoint, not a generation queue. Default-off, with a required explicit
 * per-process hourly ceiling (1–30), one in-flight call and no automatic retry.
 * This is not a distributed billing cap; multiple server instances have independent
 * ceilings. Gemini remains worker-only: its Python project-budget runtime is not
 * imported into or bypassed by this web route. Gemini configuration is unavailable.
 * No conversation, provider payload or credential is logged or stored here.
 */
export function createStoryboardAssistantApi(options: {
  requireAdmin?: AdminAuth; env?: NodeJS.ProcessEnv; planner?: Planner;
  now?: () => number; deadlineMs?: number;
} = {}) {
  const authenticate = options.requireAdmin ?? requireAdmin;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const deadlineMs = Math.min(STORYBOARD_ASSISTANT_DEADLINE_MS, Math.max(1, options.deadlineMs ?? STORYBOARD_ASSISTANT_DEADLINE_MS));
  const usage = { since: now(), count: 0, inFlight: false, lastStarted: Number.NEGATIVE_INFINITY };

  async function authenticated() {
    const auth = await authenticate();
    if (!auth.ok) throw new AssistantError('unauthorized', auth.response.status === 401 ? 401 : 403);
    if (!z.string().uuid().safeParse(auth.userId).success) throw new AssistantError('unauthorized', 403);
  }
  async function guarded(run: () => Promise<Response>) {
    try { await authenticated(); return await run(); }
    catch (error) { return error instanceof AssistantError ? failure(error.code, error.status) : failure('assistant_failed', 502); }
  }

  return {
    GET: () => guarded(async () => {
      const config = configuration(env);
      // Configuration only: this read performs no provider/model request.
      return Response.json({ ok: true, configured: !!config, provider: config?.provider ?? null }, { headers });
    }),
    POST: (request: Request) => guarded(async () => {
      const originHeaders = new Headers(request.headers);
      originHeaders.delete('authorization'); // Session-admin routes never take a bearer CSRF exemption.
      if (!isTrustedSameOriginMutation(new Request(request.url, { method: request.method, headers: originHeaders }), env)) {
        throw new AssistantError('origin_forbidden', 403);
      }
      const body = await readBoundedJsonRequest(request, STORYBOARD_ASSISTANT_BODY_BYTES);
      if (!body.ok) throw new AssistantError(body.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 'request_too_large' : 'invalid_request', body.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 413 : 400);
      const parsed = storyboardAssistantRequestSchema.safeParse(body.value);
      if (!parsed.success) throw new AssistantError('invalid_request');
      const input = parsed.data;
      input.messages.forEach(message => safeText(message.content));
      safeText(input.context.prompt);
      if (input.context.scene) [input.context.scene.title, input.context.scene.description, input.context.scene.caption].forEach(safeText);
      const config = configuration(env);
      if (!config) throw new AssistantError('assistant_unavailable', 503);
      if (input.provider.id !== config.provider.id || input.provider.model !== config.provider.model) throw new AssistantError('invalid_request');
      if (usage.inFlight) throw new AssistantError('assistant_busy', 429);
      const current = now();
      if (current - usage.since >= 3_600_000) { usage.since = current; usage.count = 0; }
      if (usage.count >= config.hourlyLimit || current - usage.lastStarted < 15_000) throw new AssistantError('rate_limited', 429);
      request.signal.throwIfAborted();
      usage.inFlight = true; usage.count += 1; usage.lastStarted = current;
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectDeadline: (() => void) | undefined;
      const aborted = () => rejectDeadline?.();
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = () => reject(new AssistantError('assistant_timeout', 504));
        controller.signal.addEventListener('abort', aborted, { once: true });
        timer = setTimeout(() => controller.abort(), deadlineMs);
        if (request.signal.aborted) controller.abort();
      });
      const pending = Promise.resolve().then(async () => {
        controller.signal.throwIfAborted();
        const planner = options.planner ?? ((value: StoryboardAssistantRequest, signal: AbortSignal) => new OpenAIStoryboardClient({ env }).plan(value, signal));
        return await planner(input, controller.signal);
      });
      // A timed-out, abort-ignoring provider keeps this slot locked until it settles.
      void pending.then(() => { usage.inFlight = false; }, () => { usage.inFlight = false; });
      try {
        const result = await Promise.race([pending, deadline]);
        controller.signal.throwIfAborted();
        const proof = result.provenance;
        const output = storyboardAssistantResultSchema.safeParse({ ok: true, answer: result.answer, provenance: {
          providerId: proof.providerId, model: proof.model, responseModel: proof.responseModel,
          verification: proof.verification, modelEvidence: proof.modelEvidence, generatedAt: proof.generatedAt,
        } });
        if (!output.success || output.data.provenance.providerId !== input.provider.id || output.data.provenance.model !== input.provider.model
          || Buffer.byteLength(JSON.stringify(output.data), 'utf8') > STORYBOARD_ASSISTANT_RESPONSE_BYTES) throw new AssistantError('invalid_response', 502);
        safeText(output.data.answer.reply);
        if (output.data.answer.suggestedPrompt) safeText(output.data.answer.suggestedPrompt);
        return Response.json(output.data satisfies StoryboardAssistantResult, { headers });
      } catch (error) {
        if (controller.signal.aborted) throw new AssistantError('assistant_timeout', 504);
        if (error instanceof AssistantError) throw error;
        throw new AssistantError('assistant_failed', 502);
      } finally {
        clearTimeout(timer); controller.signal.removeEventListener('abort', aborted);
        request.signal.removeEventListener('abort', abort);
      }
    }),
  };
}
