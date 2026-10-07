/** One synthetic request, no database writes or automatic repeat. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { judge } from './review_decision_gemini.mjs';
import { generateWithProjectBudget } from '../utils/gemini-client.mjs';

const [reportPath] = process.argv.slice(2);
if (!reportPath || fs.existsSync(reportPath)) {
  console.error('REVIEW_PROBE_NEW_REPORT_REQUIRED');
  process.exit(2);
}
const inputSha256 = createHash('sha256').update('tzudong-synthetic-insufficient-evidence-review-20261004').digest('hex');
const prompt = `실 사용자 데이터가 없는 합성 검증입니다. 합성 검증 맛집의 방문 영상·주소·좌표·메뉴 근거와 자막이 없습니다. 근거를 만들지 말고 실제 확인된 정보만 판단하세요.
evaluation과 recommendation 두 키의 JSON만 반환하세요. evaluation 키는 visit_authenticity, rb_inference_score, rb_grounding_TF, review_faithfulness_score, category_TF입니다. 각 평가는 배열 [{"name":"합성 검증 맛집","eval_value":평가값,"eval_basis":"근거 부재에 관한 짧은 요약"}]입니다. 방문은 0–4 정수, 추론은 0–2 정수, grounded는 boolean, review는 0–1, category는 boolean입니다.
recommendation은 schemaVersion:1, inputSha256:"${inputSha256}", decision:approve/hold/recheck 중 실제 판단, evidenceCodes:허용 코드 배열을 포함합니다. 승인에는 visit_supported, identity_supported, review_grounded, category_supported, location_corroborated, source_consistent 여섯 코드와 실제 근거가 모두 필요합니다. 근거가 부족하면 insufficient_evidence, 충돌은 identity_conflict/location_conflict/review_unfaithful/category_conflict/source_conflict 중 실제 해당 코드를 사용하세요. 자유 서술·confidence·개인정보는 추천에 넣지 마세요.`;
const base = { kind: 'real-gemini-synthetic-review-smoke', requestedModel: 'gemini-3.8-flash', inputSha256,
  promptSha256: createHash('sha256').update(prompt).digest('hex'), synthetic: true, dbWrites: 0,
  samples: 1, confidenceInterval: null, costVerified: false };
const save = value => fs.writeFileSync(reportPath, JSON.stringify(value, null, 2) + String.fromCharCode(10), { mode: 0o600 });
save({ ...base, state: 'running', providerRequestsUpper: 1, resultUnconfirmed: true });
const start = performance.now();
let calls = 0, usage = null;
try {
  const result = await judge(prompt, inputSha256, {
    key: process.env.GEMINI_CREDITS_API_KEY || process.env.GEMINI_API_KEY,
    generate: async (...args) => {
      calls++;
      const response = await generateWithProjectBudget(...args);
      const value = response.usageMetadata ?? {};
      usage = Object.fromEntries(['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount']
        .map(key => [key, Number.isSafeInteger(value[key]) ? value[key] : null]));
      return response;
    },
  });
  const passed = result.gemini_decision.recommendation !== 'approve'
    && result.gemini_decision.evidenceCodes.includes('insufficient_evidence');
  const report = { ...base, state: 'completed', observedAt: new Date().toISOString(), passed,
    providerRequests: calls, elapsedMs: performance.now() - start, servedModel: result.gemini_decision.modelVersion,
    recommendation: result.gemini_decision.recommendation, evidenceCodes: result.gemini_decision.evidenceCodes, usage,
    limitations: ['One synthetic case is not model accuracy evidence.', 'No operational approval, database, deployment or billing readback.'] };
  save(report); console.log(JSON.stringify(report));
  if (!passed) process.exitCode = 2;
} catch (error) {
  const allowed = ['gemini_configuration_invalid', 'gemini_result_uncertain', 'gemini_decision_invalid', 'gemini_decision_incomplete'];
  const report = { ...base, state: 'unconfirmed', passed: false, code: allowed.includes(error.code) ? error.code : 'unconfirmed',
    providerRequestsUpper: calls, elapsedMs: performance.now() - start, usage };
  save(report); console.log(JSON.stringify(report)); process.exitCode = 2;
}
