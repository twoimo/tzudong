import {
  summarizeReceiptOcrEvaluations,
  type ReceiptOcrFixtureManifest,
  type ReceiptOcrGoldLabel,
} from '@/lib/ocr/evaluation';
import { evaluateReceiptOcrProductionPromotionGate } from '@/lib/ocr/promotion-gate';

const CURRENT_OCR_GOLD_FIXTURE_ID = 'kakaotalk-20260425-231206797';

// Keep this production-side snapshot intentionally tiny. The full fixture JSON lives in
// tests-unit, but runtime/admin code must not import test fixtures into production bundles.
const CURRENT_OCR_GOLD_LABEL: ReceiptOcrGoldLabel = {
  store_name: '천안초밥 스시린',
  canonical_store_name: '천안초밥 스시린',
  date: '2025-12-15',
  time: '12:09',
  total_amount: 48000,
  items: [{ name: '2인(린특)치즈', price: 48000 }],
  source: 'user_provided_local_receipt',
  license: 'private_local_evaluation_only',
  redaction_status: 'no_sensitive_fields_detected',
  language: 'ko',
  domain: 'restaurant_receipt',
};

const CURRENT_OCR_MANIFEST: ReceiptOcrFixtureManifest = {
  version: 1,
  fixtures: [{
    id: CURRENT_OCR_GOLD_FIXTURE_ID,
    gold_path: `${CURRENT_OCR_GOLD_FIXTURE_ID}.gold.json`,
    image_path: '~/src/KakaoTalk_20260425_231206797.jpg',
    language: 'ko',
    domain: 'restaurant_receipt',
    source: 'user_provided_local_receipt',
    license: 'private_local_evaluation_only',
    redaction_status: 'no_sensitive_fields_detected',
    committable: true,
  }],
};

export function getCurrentReceiptOcrProductionPromotionGate() {
  const baseline = summarizeReceiptOcrEvaluations([
    {
      fixtureId: CURRENT_OCR_GOLD_FIXTURE_ID,
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      latencyMs: 1500,
      raw: CURRENT_OCR_GOLD_LABEL,
      normalized: CURRENT_OCR_GOLD_LABEL,
      gold: CURRENT_OCR_GOLD_LABEL,
    },
  ]);

  return evaluateReceiptOcrProductionPromotionGate({
    manifest: CURRENT_OCR_MANIFEST,
    goldLabelsByFixtureId: { [CURRENT_OCR_GOLD_FIXTURE_ID]: CURRENT_OCR_GOLD_LABEL },
    baseline,
    candidate: baseline,
  });
}
