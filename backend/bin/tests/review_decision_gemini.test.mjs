import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { APPROVAL_CODES, MODEL, judge, parseDecision } from '../review_decision_gemini.mjs';

const sha = 'a'.repeat(64);
function envelope(decision = 'approve') {
  return { evaluation: {
    visit_authenticity: { values: [{ name: 'fixture', eval_value: 1, eval_basis: 'synthetic' }], missing: [] },
    rb_inference_score: [{ name: 'fixture', eval_value: 1, eval_basis: 'synthetic' }],
    rb_grounding_TF: [{ name: 'fixture', eval_value: true, eval_basis: 'synthetic' }],
    review_faithfulness_score: [{ name: 'fixture', eval_value: 1, eval_basis: 'synthetic' }],
    category_TF: [{ name: 'fixture', eval_value: true, category_revision: null }],
  }, recommendation: { schemaVersion: 1, inputSha256: sha, decision,
    evidenceCodes: decision === 'approve' ? APPROVAL_CODES : ['insufficient_evidence'] } };
}
const response = value => ({ modelVersion: MODEL, candidates: [{ finishReason: 'STOP' }], text: JSON.stringify(value) });
const acceptedModelVersions = [MODEL, `models/${MODEL}`, `${MODEL}-001`, `models/${MODEL}-001`, `${MODEL}-123`, `models/${MODEL}-999`];

test('all three recommendations have only bounded structured provenance', () => {
  for (const decision of ['approve', 'hold', 'recheck']) for (const modelVersion of acceptedModelVersions) {
    const value = envelope(decision);
    const result = parseDecision({ ...response(value), modelVersion }, sha, 'untrusted synthetic input');
    assert.equal(result.gemini_decision.recommendation, decision);
    assert.equal(result.gemini_decision.model, MODEL);
    assert.equal(result.gemini_decision.modelVersion, MODEL);
    assert.deepEqual(result.evaluation, value.evaluation);
    assert.deepEqual(result.gemini_decision.evidenceCodes, value.recommendation.evidenceCodes);
    assert.match(result.gemini_decision.promptSha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.keys(result.gemini_decision).length, 8);
    assert(!JSON.stringify(result.gemini_decision).includes('untrusted'));
  }
});

test('incomplete, ambiguous and alternate-model output cannot authorize approval', () => {
  for (const modelVersion of [undefined, null, 38, {}, [MODEL], '', 'gemini-3.7-flash', 'gemini-3.8-pro',
    'models/gemini-3.7-flash-001', 'models/gemini-3.8-pro-001', `${MODEL}-lite`, `${MODEL}-tts-001`,
    'gemini-flash-latest', `${MODEL}-latest`, `${MODEL}-preview`, `${MODEL}-exp`, `${MODEL}-10-05`,
    `${MODEL}-preview-10-05`, `${MODEL}-1`, `${MODEL}-01`, `${MODEL}-0001`, `${MODEL}-001-extra`,
    `models/models/${MODEL}`, `publishers/google/models/${MODEL}`, `Models/${MODEL}`, MODEL.toUpperCase(),
    ` ${MODEL}`, `${MODEL} `, `${MODEL}\n`, `${MODEL}-001\n`, `${MODEL}-00\n`, `${MODEL}\0`, `${MODEL}?v=001`]) {
    assert.throws(() => parseDecision({ ...response(envelope()), modelVersion }, sha, 'fixture'), { code: 'gemini_decision_incomplete' });
  }
  for (const modelVersion of acceptedModelVersions) for (const patch of [
    { candidates: [] }, { candidates: [{ finishReason: 'MAX_TOKENS' }] }, { candidates: [{ finishReason: 'SAFETY' }] },
    { candidates: [{ finishReason: 'STOP' }, { finishReason: 'STOP' }] }]) {
    assert.throws(() => parseDecision({ ...response(envelope()), modelVersion, ...patch }, sha, 'fixture'), { code: 'gemini_decision_incomplete' });
  }
});

test('malformed recommendation, unsupported prose and input substitution are rejected', () => {
  const cases = [value => { value.recommendation.inputSha256 = 'b'.repeat(64); },
    value => { value.recommendation.confidence = 1; },
    value => { value.recommendation.evidenceCodes = ['visit_supported']; },
    value => { value.recommendation.evidenceCodes = [...APPROVAL_CODES, 'private prose']; },
    value => { value.recommendation.evidenceCodes = [...APPROVAL_CODES, APPROVAL_CODES[0]]; },
    value => { value.recommendation.decision = 'delete'; },
    value => { value.recommendation.decision = 'hold'; },
    value => { delete value.evaluation.category_TF; },
    value => { value.diagnostics = 'private'; }];
  for (const modelVersion of acceptedModelVersions) for (const mutate of cases) {
    const value = envelope(); mutate(value);
    assert.throws(() => parseDecision({ ...response(value), modelVersion }, sha, 'fixture'), { code: 'gemini_decision_invalid' });
  }
  assert.throws(() => parseDecision({ ...response(envelope()), text: '{broken' }, sha, 'fixture'), { code: 'gemini_decision_invalid' });
});

test('judge makes one call without model fallback and retains fixed errors', async () => {
  let calls = 0;
  await assert.rejects(judge('fixture', sha, { key: 'synthetic', client: () => ({}),
    generate: async (_client, request, timeout) => {
      calls++;
      assert.equal(request.model, 'gemini-3.8-flash');
      assert.equal(request.config.responseMimeType, 'application/json');
      assert.equal(request.config.thinkingConfig.thinkingLevel, 'MEDIUM');
      assert(!('temperature' in request.config));
      assert.equal(timeout, 300000);
      throw new Error('private provider diagnostics');
    } }), { message: 'gemini_result_uncertain', code: 'gemini_result_uncertain' });
  assert.equal(calls, 1);
  await assert.rejects(judge('fixture', sha, { key: '', client: () => assert.fail('SDK created') }), { code: 'gemini_configuration_invalid' });
});

test('existing thinking policy is preserved and unsupported policy does not call provider', async () => {
  const saved = process.env.LAAJ_THINKING_LEVEL;
  let calls = 0;
  try {
    process.env.LAAJ_THINKING_LEVEL = 'HIGH';
    await judge('fixture', sha, { key: 'synthetic', client: () => ({}), generate: async (_client, request) => {
      calls++; assert.equal(request.config.thinkingConfig.thinkingLevel, 'HIGH'); return response(envelope());
    } });
    process.env.LAAJ_THINKING_LEVEL = 'MINIMAL';
    await assert.rejects(judge('fixture', sha, { key: 'synthetic', client: () => assert.fail('SDK created') }), { code: 'gemini_configuration_invalid' });
    assert.equal(calls, 1);
  } finally {
    saved === undefined ? delete process.env.LAAJ_THINKING_LEVEL : process.env.LAAJ_THINKING_LEVEL = saved;
  }
});

test('installed SDK uses the existing project lease and emits exactly one request', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-gemini-fixture-'));
  const config = { GEMINI_BUDGET_PATH: path.join(directory, 'budget.sqlite'), GEMINI_BUDGET_PROJECT: 'isolated-review-fixture',
    GEMINI_REQUESTS_PER_MINUTE: '100000', GEMINI_MAX_INFLIGHT: '1' };
  const saved = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  const fetch = globalThis.fetch;
  Object.assign(process.env, config);
  let calls = 0;
  const leases = () => {
    const result = spawnSync('python3', ['-c', 'import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select count(*) from leases").fetchone()[0])', config.GEMINI_BUDGET_PATH], { encoding: 'utf8' });
    assert.equal(result.status, 0); return Number(result.stdout.trim());
  };
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.match(String(url), /models\/gemini-3\.8-flash:generateContent/);
      assert.equal(leases(), 1);
      const body = JSON.parse(options.body);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      return new Response(JSON.stringify({ modelVersion: `models/${MODEL}-001`, candidates: [{ finishReason: 'STOP', content: {
        role: 'model', parts: [{ text: JSON.stringify(envelope()) }],
      } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8, totalTokenCount: 13 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await judge('fixture', sha, { key: 'synthetic-fixture-key' });
    assert.equal(result.gemini_decision.recommendation, 'approve');
    assert.equal(result.gemini_decision.model, MODEL);
    assert.equal(result.gemini_decision.modelVersion, MODEL);
    assert.equal(calls, 1); assert.equal(leases(), 0);
    globalThis.fetch = async () => { calls++; assert.equal(leases(), 1); throw new Error('uncertain transport'); };
    await assert.rejects(judge('fixture', sha, { key: 'synthetic-fixture-key' }), { code: 'gemini_result_uncertain' });
    assert.equal(calls, 2); assert.equal(leases(), 0);
  } finally {
    globalThis.fetch = fetch;
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
