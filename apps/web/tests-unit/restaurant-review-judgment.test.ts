import { describe, expect, test } from 'bun:test';
import { isReviewGeminiDecision, parseReviewAutomationSnapshot, REVIEW_EVIDENCE_CODES } from '../lib/admin/restaurant-review-automation';

const uuid = '00000000-0000-4000-8000-000000000001';
const decision = { schemaVersion: 1, model: 'gemini-3.8-flash', modelVersion: 'gemini-3.8-flash', promptVersion: 'restaurant-review-v1', inputSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64), recommendation: 'approve', evidenceCodes: REVIEW_EVIDENCE_CODES.slice(0, 6), outcome: 'blocked', decidedAt: '2026-10-04T09:00:00Z' };
const legacy = { policy: { version: 1, enabled: true, batch_size: 50, daily_limit: 50, last_run_at: null }, runs: [], items: [], queue: { queued: 0, running: 0, failed: 0 } };
const engine = { provider: 'gemini', model: 'gemini-3.8-flash', promptVersion: 'restaurant-review-v1', requiredForApproval: true, maxCallsPerClaim: 1 };
const item = { id: uuid, restaurant_id: uuid, reason: 'location_requires_review', state: 'succeeded', geminiDecision: decision };

describe('Gemini recommendation and applied outcome are separate read evidence', () => {
  test('retains legacy state without inventing a Gemini engine', () => {
    expect(parseReviewAutomationSnapshot(legacy).judgmentEngine).toBeUndefined();
  });
  test('keeps a blocked or deferred approval recommendation distinct from approval', () => {
    for (const outcome of ['blocked', 'deferred', 'hold']) {
      const parsed = parseReviewAutomationSnapshot({ ...legacy, judgmentEngine: engine, items: [{ ...item, geminiDecision: { ...decision, outcome } }] });
      expect(parsed.items[0].geminiDecision?.recommendation).toBe('approve');
      expect(parsed.items[0].geminiDecision?.outcome).toBe(outcome);
    }
  });
  test('approval requires all six positive families and no conflict code', () => {
    expect(isReviewGeminiDecision(decision)).toBe(true);
    for (const evidenceCodes of [decision.evidenceCodes.slice(1), [...decision.evidenceCodes, 'source_conflict'], [...decision.evidenceCodes, decision.evidenceCodes[0]]])
      expect(isReviewGeminiDecision({ ...decision, evidenceCodes })).toBe(false);
  });
  test('hold and recheck require an actual insufficiency or conflict', () => {
    for (const recommendation of ['hold', 'recheck']) {
      expect(isReviewGeminiDecision({ ...decision, recommendation })).toBe(false);
      expect(isReviewGeminiDecision({ ...decision, recommendation, evidenceCodes: ['insufficient_evidence'] })).toBe(true);
    }
  });
  test('rejects provider prose, arbitrary models, unsupported versions and unbounded evidence', () => {
    for (const patch of [{ model: 'other' }, { modelVersion: 'other' }, { promptVersion: 'unknown' }, { inputSha256: 'invalid' }, { evidenceCodes: ['untrusted'] }, { evidenceCodes: Array(13).fill('insufficient_evidence') }, { providerMessage: 'untrusted prose' }, { confidence: 1 }, { decidedAt: 'invalid' }, { outcome: 'deleted' }])
      expect(isReviewGeminiDecision({ ...decision, ...patch })).toBe(false);
  });
  test('refuses invalid engine promises and malformed stored judgments', () => {
    for (const patch of [{ model: 'other' }, { maxCallsPerClaim: 2 }, { requiredForApproval: false }, { promptVersion: 'unknown' }])
      expect(() => parseReviewAutomationSnapshot({ ...legacy, judgmentEngine: { ...engine, ...patch } })).toThrow('AUTOMATION_RESPONSE_INVALID');
    expect(() => parseReviewAutomationSnapshot({ ...legacy, items: [{ ...item, geminiDecision: { ...decision, evidenceCodes: [] } }] })).toThrow('AUTOMATION_RESPONSE_INVALID');
    expect(parseReviewAutomationSnapshot({ ...legacy, items: [{ ...item, geminiDecision: null }] }).items[0].geminiDecision).toBeNull();
  });
});
