import {
  type OcrCostPolicy,
  type OcrPreviewProvider,
  OCR_PREVIEW_ERROR_CODES,
  OcrPreviewError,
} from './types';

export const DEFAULT_COST_POLICY: Readonly<OcrCostPolicy> = Object.freeze({
  allowLocal: true,
  allowFreeCloud: false,
  geminiFreeTierAttested: false,
  allowPaidCloud: false,
});

/**
 * Validates cost and execution boundary policy before any provider invocation,
 * network fetch, or credential lookup occurs.
 *
 * State limitation notice:
 * The `geminiFreeTierAttested` boolean reflects explicit developer/operator attestation
 * of an intended free-tier allocation. As a client/application level configuration,
 * it cannot cryptographically or externally guarantee Google Cloud project billing status.
 */
export function verifyCostPolicy(
  provider: OcrPreviewProvider,
  partialPolicy?: Partial<OcrCostPolicy>,
): OcrCostPolicy {
  const policy: OcrCostPolicy = {
    ...DEFAULT_COST_POLICY,
    ...partialPolicy,
  };

  if (provider === 'local') {
    if (policy.allowLocal !== true) {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.POLICY_DENIED_LOCAL_ONLY);
    }
    return policy;
  }

  if (provider === 'gemini') {
    if (policy.allowFreeCloud !== true) {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.POLICY_DENIED_LOCAL_ONLY);
    }
    if (policy.geminiFreeTierAttested !== true) {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.GEMINI_FREE_TIER_NOT_ATTESTED);
    }
    return policy;
  }

  if (provider === 'openai') {
    if (policy.allowPaidCloud !== true) {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.OPENAI_PAID_POLICY_DENIED);
    }
    return policy;
  }

  throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.POLICY_DENIED_LOCAL_ONLY);
}
