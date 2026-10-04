import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createGeminiClient, generateWithProjectBudget, requireGeminiText } from '../utils/gemini-client.mjs';

export const MODEL = 'gemini-3.8-flash';
export const PROMPT_VERSION = 'restaurant-review-v1';
export const APPROVAL_CODES = ['visit_supported', 'identity_supported', 'review_grounded', 'category_supported', 'location_corroborated', 'source_consistent'];
export const EVIDENCE_CODES = [...APPROVAL_CODES, 'insufficient_evidence', 'identity_conflict', 'location_conflict', 'review_unfaithful', 'category_conflict', 'source_conflict'];
const METRICS = ['visit_authenticity', 'rb_inference_score', 'rb_grounding_TF', 'review_faithfulness_score', 'category_TF'];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function parseDecision(response, inputSha256, prompt) {
  if (response?.modelVersion !== MODEL || response?.candidates?.length !== 1 || response.candidates[0]?.finishReason !== 'STOP')
    fail('gemini_decision_incomplete');
  let value;
  try { value = JSON.parse(requireGeminiText(response)); } catch { fail('gemini_decision_invalid'); }
  const rec = value?.recommendation;
  if (!object(value) || Object.keys(value).sort().join() !== 'evaluation,recommendation' || !object(value.evaluation) ||
      Object.keys(value.evaluation).sort().join() !== [...METRICS].sort().join() || !object(rec) ||
      Object.keys(rec).sort().join() !== 'decision,evidenceCodes,inputSha256,schemaVersion' || rec.schemaVersion !== 1 ||
      rec.inputSha256 !== inputSha256 || !['approve', 'hold', 'recheck'].includes(rec.decision) ||
      !Array.isArray(rec.evidenceCodes) || rec.evidenceCodes.length < 1 || rec.evidenceCodes.length > EVIDENCE_CODES.length ||
      new Set(rec.evidenceCodes).size !== rec.evidenceCodes.length || rec.evidenceCodes.some(code => !EVIDENCE_CODES.includes(code)))
    fail('gemini_decision_invalid');
  if (rec.decision === 'approve' && (rec.evidenceCodes.length !== APPROVAL_CODES.length || APPROVAL_CODES.some(code => !rec.evidenceCodes.includes(code))))
    fail('gemini_decision_invalid');
  if (rec.decision !== 'approve' && !rec.evidenceCodes.some(code => !APPROVAL_CODES.includes(code)))
    fail('gemini_decision_invalid');
  return { evaluation: value.evaluation, gemini_decision: {
    schemaVersion: 1, model: MODEL, modelVersion: response.modelVersion, promptVersion: PROMPT_VERSION,
    inputSha256, promptSha256: createHash('sha256').update(prompt).digest('hex'),
    recommendation: rec.decision, evidenceCodes: rec.evidenceCodes,
  }};
}

export async function judge(prompt, inputSha256, { key, generate = generateWithProjectBudget, client = createGeminiClient } = {}) {
  const thinkingLevel = (process.env.LAAJ_THINKING_LEVEL || 'MEDIUM').trim().toUpperCase();
  if (!key || typeof prompt !== 'string' || Buffer.byteLength(prompt) > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(inputSha256) ||
      !['LOW', 'MEDIUM', 'HIGH'].includes(thinkingLevel))
    fail('gemini_configuration_invalid');
  // Exactly one existing shared-budget request. No model env override, fallback,
  // health probe, quota replacement, second recommendation call or retry.
  let response;
  try {
    response = await generate(client(key), { model: MODEL, contents: prompt, config: {
      maxOutputTokens: 4096, thinkingConfig: { thinkingLevel }, responseMimeType: 'application/json',
    }}, 300000);
  } catch { fail('gemini_result_uncertain'); }
  return parseDecision(response, inputSha256, prompt);
}

export async function main(argv = process.argv.slice(2)) {
  const [input, output, inputSha256] = argv;
  if (!input || !output) return 1;
  try {
    const result = await judge(fs.readFileSync(input, 'utf8'), inputSha256, {
      key: process.env.GEMINI_CREDITS_API_KEY || process.env.GEMINI_API_KEY,
    });
    fs.writeFileSync(output, JSON.stringify(result), { mode: 0o600 });
    return 0;
  } catch (error) {
    const code = ['gemini_configuration_invalid', 'gemini_result_uncertain', 'gemini_decision_invalid', 'gemini_decision_incomplete'].includes(error.code)
      ? error.code : 'gemini_result_uncertain';
    fs.writeFileSync(output, JSON.stringify({ error: code }), { mode: 0o600 });
    console.error('REVIEW_GEMINI_DECISION_UNCONFIRMED');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
