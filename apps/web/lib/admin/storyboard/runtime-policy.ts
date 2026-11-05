import 'server-only';

import { createHash } from 'node:crypto';

import {
  STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL,
  STORYBOARD_GEMINI_IMAGE_MODELS,
  STORYBOARD_GEMINI_PROVIDER_ID,
  STORYBOARD_GEMINI_TEXT_MODEL,
  isAllowedStoryboardGeminiWorkerModel,
  storyboardGeminiDeclaredModels,
} from './gemini-models';
import {
  STORYBOARD_ARCHIVE_WORKFLOW,
  STORYBOARD_WORKFLOW,
  assertGeminiStoryboardExecutionPolicy,
  isExecutableStoryboardRequest,
  storyboardStoredProductionRequestSchema,
} from './production-contract';
import { storyboardGeminiHeartbeatModelsSchema } from './production-worker-auth';
import { STORYBOARD_RUNTIME_SOURCE_BINDING_SCHEMA_VERSION } from './runtime-source-binding';

const SHA256 = /^[0-9a-f]{64}$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function evaluateStoryboardRuntimePolicy(sourceBindingSha256: string) {
  if (!SHA256.test(sourceBindingSha256)) throw new Error('storyboard_source_binding_unavailable');

  const declaredModels = storyboardGeminiDeclaredModels();
  if (!storyboardGeminiHeartbeatModelsSchema.safeParse(declaredModels).success
    || declaredModels.some((model) => !isAllowedStoryboardGeminiWorkerModel(model))) {
    throw new Error('storyboard_policy_drift');
  }

  const textModels = [STORYBOARD_GEMINI_TEXT_MODEL];
  const imageModels = STORYBOARD_GEMINI_IMAGE_MODELS.map((model) => model.id);
  for (const textModel of textModels) {
    for (const imageModel of imageModels) {
      assertGeminiStoryboardExecutionPolicy({
        externalAI: true,
        text: { id: STORYBOARD_GEMINI_PROVIDER_ID, model: textModel },
        image: { id: STORYBOARD_GEMINI_PROVIDER_ID, model: imageModel },
      });
    }
  }

  const archivedRequest = storyboardStoredProductionRequestSchema.parse({
    workflow: STORYBOARD_ARCHIVE_WORKFLOW,
    requestId: '00000000-0000-4000-8000-000000000001',
    prompt: 'readback-only',
    sceneCount: 5,
    retrieval: 'none',
    sources: [],
    imageWidth: 1024,
    imageHeight: 576,
    providers: {
      externalAI: false,
      text: { id: 'local-mlx', model: 'legacy-read-only' },
      image: { id: 'manual', model: 'legacy-read-only' },
    },
  });
  if (isExecutableStoryboardRequest(archivedRequest)) throw new Error('storyboard_legacy_admission_drift');

  const canonicalPolicy = Object.freeze({
    featureDatabaseAdmission: 'required' as const,
    defaultImageModel: STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL,
    executionWorkflow: STORYBOARD_WORKFLOW,
    imageModels,
    legacyExecutionAdmission: 'blocked' as const,
    provider: STORYBOARD_GEMINI_PROVIDER_ID,
    readableLegacyWorkflow: STORYBOARD_ARCHIVE_WORKFLOW,
    sourceBindingSchemaVersion: STORYBOARD_RUNTIME_SOURCE_BINDING_SCHEMA_VERSION,
    sourceBindingSha256,
    textModels,
  });
  const canonicalPolicySha256 = createHash('sha256').update(canonicalJson(canonicalPolicy), 'utf8').digest('hex');
  return Object.freeze({ canonicalPolicy, canonicalPolicySha256 });
}
