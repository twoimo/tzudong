import {
  GEMINI_OCR_INFERENCE_CONFIG_VERSION,
  normalizeGeminiOcrModel,
  type GeminiOcrInferenceConfigSnapshot,
} from '@/lib/ocr/gemini';

export type ReceiptOcrWorkflowPolicy = Readonly<{
  modelPolicy: string[];
  inferenceConfig: GeminiOcrInferenceConfigSnapshot;
}>;

/** Public configuration only. Credentials never cross workflow_dispatch inputs. */
export function parseReceiptOcrWorkflowPolicy(
  modelPolicyJson: string,
  thinkingLevel: string,
): ReceiptOcrWorkflowPolicy {
  if (modelPolicyJson.length > 2048) throw new Error('OCR_WORKFLOW_POLICY_INVALID');
  let models: unknown;
  try { models = JSON.parse(modelPolicyJson); } catch { throw new Error('OCR_WORKFLOW_POLICY_INVALID'); }
  if (!Array.isArray(models) || models.length < 1 || models.length > 8
    || models.some((model) => typeof model !== 'string' || model.length > 160
      || !/^(?:models\/)?gemini-[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model))
    || !['LOW', 'MEDIUM', 'HIGH'].includes(thinkingLevel)) {
    throw new Error('OCR_WORKFLOW_POLICY_INVALID');
  }
  const normalizedModels = models.map((model) => normalizeGeminiOcrModel(model as string));
  if (new Set(normalizedModels).size !== normalizedModels.length) {
    throw new Error('OCR_WORKFLOW_POLICY_INVALID');
  }
  return {
    modelPolicy: normalizedModels,
    inferenceConfig: Object.freeze({
      version: GEMINI_OCR_INFERENCE_CONFIG_VERSION,
      thinkingLevel: thinkingLevel as GeminiOcrInferenceConfigSnapshot['thinkingLevel'],
      responseMimeType: 'application/json',
      samplingPolicy: 'omit-modern-zero-legacy-v1',
    }),
  };
}
