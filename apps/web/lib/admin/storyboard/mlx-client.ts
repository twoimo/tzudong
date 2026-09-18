import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MlxTransport } from './mlx-transport.ts';
import {
  MAX_STORYBOARD_IMAGE_BYTES,
  StoryboardProductionError,
  assertStoryboardProviderPolicy,
  buildStoryboardDraftPrompt,
  parseStoryboardDraft,
  storyboardDraftSchema,
  type StoryboardDraft,
  type StoryboardProductionProvenance,
  type StoryboardProductionRequest,
} from './production-contract.ts';

export const mlxModelSchema = z.object({
  id: z.string().min(1).max(200),
  owned_by: z.literal('mlx-serve'),
  capabilities: z.array(z.string().max(80)).max(32),
  loaded: z.boolean().default(false),
  bytes_on_disk: z.number().nonnegative().default(0),
  bytes_resident: z.number().nonnegative().default(0),
});
export type MlxModel = z.infer<typeof mlxModelSchema>;

function provenance(response: Record<string, unknown>, model: string, requestId: string): StoryboardProductionProvenance {
  const responseModel = typeof response.model === 'string' && response.model.length <= 200 ? response.model : null;
  if (responseModel && responseModel !== model) throw new StoryboardProductionError('model_identity_mismatch');
  return {
    providerId: 'local-mlx', model, verification: 'local-worker',
    generatedAt: new Date().toISOString(), requestId,
    responseId: typeof response.id === 'string' && response.id.length <= 200 ? response.id : null,
    responseModel,
    modelEvidence: responseModel ? 'response' : 'installed-catalog-and-request',
  };
}

export function decodeMlxImage(response: Record<string, unknown>): Buffer {
  const data = response.data;
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') {
    throw new StoryboardProductionError('invalid_image_response');
  }
  const encoded: unknown = data[0].b64_json;
  if (typeof encoded !== 'string' || encoded.length < 16
    || encoded.length > Math.ceil(MAX_STORYBOARD_IMAGE_BYTES / 3) * 4
    || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new StoryboardProductionError('invalid_image_response');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_STORYBOARD_IMAGE_BYTES || bytes.toString('base64') !== encoded) {
    throw new StoryboardProductionError('invalid_image_response');
  }
  return bytes;
}

/** This adapter has no cloud SDK, retrieval, evaluation, tools, or model-management route. */
export class MlxStoryboardClient {
  readonly transport: MlxTransport;

  constructor(transport = new MlxTransport()) {
    this.transport = transport;
  }

  async models(signal?: AbortSignal): Promise<MlxModel[]> {
    const health = await this.transport.request('/health', undefined, signal);
    if (health.status !== 'ok') throw new StoryboardProductionError('local_model_unavailable');
    const response = await this.transport.request('/v1/models', undefined, signal);
    if (!Array.isArray(response.data)) throw new StoryboardProductionError('invalid_model_response');
    return response.data.flatMap((item) => {
      const result = mlxModelSchema.safeParse(item);
      // Remote provider entries and nonexistent models are never admitted as local.
      return result.success && result.data.bytes_on_disk > 0 ? [result.data] : [];
    });
  }

  async requireModel(id: string, capability: 'chat' | 'image', signal?: AbortSignal) {
    const model = (await this.models(signal)).find((item) => item.id === id);
    if (!model) throw new StoryboardProductionError('model_not_installed');
    if (!model.capabilities.includes(capability)) throw new StoryboardProductionError('model_capability_mismatch');
    return model;
  }

  async draft(request: StoryboardProductionRequest, signal?: AbortSignal): Promise<{
    draft: StoryboardDraft; provenance: StoryboardProductionProvenance;
  }> {
    assertStoryboardProviderPolicy(request.providers);
    if (request.providers.text.id !== 'local-mlx') throw new StoryboardProductionError('provider_not_configured');
    if (request.retrieval !== 'none') throw new StoryboardProductionError('bge_dependency_unavailable');
    const model = await this.requireModel(request.providers.text.model, 'chat', signal);
    const schema = z.toJSONSchema(storyboardDraftSchema);
    const prompt = buildStoryboardDraftPrompt(request);
    for (let attempt = 0; attempt < 2; attempt++) {
      const requestId = randomUUID();
      const response = await this.transport.request('/v1/chat/completions', {
        model: model.id, stream: false, enable_thinking: false,
        max_tokens: 8192, temperature: 0.5,
        messages: [{ role: 'user', content: prompt + (attempt ? '\n이전 응답의 구조 검증에 실패했습니다. 모든 필수 필드와 정확한 장면 수를 다시 확인하세요.' : '') }],
        response_format: { type: 'json_schema', json_schema: { name: 'storyboard', strict: true, schema } },
      }, signal);
      const proof = provenance(response, model.id, requestId);
      const choices = response.choices;
      const first = Array.isArray(choices) ? choices[0] as Record<string, unknown> | undefined : undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      try {
        if (first?.finish_reason !== 'stop' || typeof message?.content !== 'string') {
          throw new StoryboardProductionError('invalid_structured_response');
        }
        return { draft: parseStoryboardDraft(JSON.parse(message.content), request), provenance: proof };
      } catch (error) {
        if (attempt === 1) throw new StoryboardProductionError('invalid_structured_response');
        if (error instanceof StoryboardProductionError && error.code !== 'invalid_structured_response') throw error;
      }
    }
    throw new StoryboardProductionError('invalid_structured_response');
  }

  async image(request: StoryboardProductionRequest, imagePrompt: string, signal?: AbortSignal) {
    assertStoryboardProviderPolicy(request.providers);
    if (request.providers.image.id !== 'local-mlx') throw new StoryboardProductionError('provider_not_configured');
    if (!imagePrompt.trim() || imagePrompt.length > 3000) throw new StoryboardProductionError('invalid_model_request');
    const model = await this.requireModel(request.providers.image.model, 'image', signal);
    const requestId = randomUUID();
    const response = await this.transport.request('/v1/images/generations', {
      model: model.id, prompt: imagePrompt, size: `${request.imageWidth}x${request.imageHeight}`,
      steps: 4, stream: false,
    }, signal);
    return { bytes: decodeMlxImage(response), provenance: provenance(response, model.id, requestId) };
  }
}
