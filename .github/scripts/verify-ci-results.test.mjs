import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyPaths } from './classify-ci-scope.mjs';
import { verifyResults, WEB_JOB_SCOPES, SECURITY_JOBS, SECURITY_SELECTED_REASONS } from './verify-ci-results.mjs';

function webNeeds(paths = ['apps/web/app/page.tsx']) {
  const outputs = Object.fromEntries(Object.entries(classifyPaths(paths)).map(([key, value]) => [key, String(value)]));
  return {
    scope: { result: 'success', outputs },
    ...Object.fromEntries(Object.entries(WEB_JOB_SCOPES).map(([job, flag]) => [job, { result: outputs[flag] === 'true' ? 'success' : 'skipped', outputs: {} }])),
  };
}
function securityNeeds(enabled = true) {
  return {
    scope: { result: 'success', outputs: { security: String(enabled), reason: enabled ? 'SECURITY_INPUT_CHANGED' : 'SECURITY_INPUTS_UNCHANGED', fatal: 'false' } },
    ...Object.fromEntries(SECURITY_JOBS.map((job) => [job, { result: enabled ? 'success' : 'skipped', outputs: {} }])),
  };
}
const verifyWeb = (needs) => verifyResults({ mode: 'web', needs });
const verifySecurity = (needs) => verifyResults({ mode: 'security', needs });

test('web aggregate accepts only the selected success and unselected skipped combination', () => {
  for (const paths of [['README.md'], ['apps/web/app/page.tsx'], ['backend/supabase/migrations/change.sql'], ['apps/web/package-lock.json']]) {
    assert.equal(verifyWeb(webNeeds(paths)).passed, true);
  }
});

test('every selected web job, including the unit matrix, fails closed for failure, cancellation, skip or missing result', () => {
  for (const job of Object.keys(WEB_JOB_SCOPES)) {
    for (const result of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', '', undefined]) {
      const needs = webNeeds(['apps/web/package-lock.json']);
      needs[job].result = result;
      const verdict = verifyWeb(needs);
      assert.equal(verdict.passed, false, job + ':' + result);
      assert.deepEqual(verdict.jobs, [job]);
    }
  }
});

test('an unselected job must really be skipped, not failed or unexpectedly executed', () => {
  for (const job of Object.keys(WEB_JOB_SCOPES)) {
    for (const result of ['success', 'failure', 'cancelled', undefined]) {
      const needs = webNeeds(['README.md']);
      needs[job].result = result;
      assert.equal(verifyWeb(needs).passed, false);
    }
  }
});

test('a missing or extra dependency cannot disappear from aggregate accounting', () => {
  for (const job of ['scope', ...Object.keys(WEB_JOB_SCOPES)]) {
    const needs = webNeeds();
    delete needs[job];
    assert.equal(verifyWeb(needs).passed, false);
  }
  const needs = webNeeds(); needs['unchecked-new-job'] = { result: 'success' };
  assert.equal(verifyWeb(needs).passed, false);
  for (const value of [null, [], {}, 'success']) assert.equal(verifyWeb(value).passed, false);
});

test('scope failure, cancellation and malformed flags never turn into successful skips', () => {
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    const needs = webNeeds(['README.md']); needs.scope.result = result;
    assert.equal(verifyWeb(needs).passed, false);
  }
  for (const key of ['authority', 'unit', 'build', 'compatibility', 'install', 'admin', 'fatal']) {
    for (const value of [undefined, true, false, '', 'False', 'unknown']) {
      const needs = webNeeds(['README.md']); needs.scope.outputs[key] = value;
      assert.equal(verifyWeb(needs).passed, false, key + ':' + value);
    }
  }
  for (const reason of [undefined, '', 'UNKNOWN_NEW_REASON', 'private diagnostic text', 'DOCUMENTATION_ONLY\nother=true']) {
    const needs = webNeeds(['README.md']); needs.scope.outputs.reason = reason;
    assert.equal(verifyWeb(needs).passed, false);
  }
  const fatal = webNeeds(['README.md']); fatal.scope.outputs.fatal = 'true';
  assert.equal(verifyWeb(fatal).passed, false);
});

test('each scope reason fixes every flag even when job results agree with a tampered selection', () => {
  const cases = [
    ['README.md'], ['apps/web/app/page.tsx'],
    ['apps/web/app/page.tsx', 'backend/supabase/migrations/change.sql'],
    ['backend/supabase/migrations/change.sql'], ['apps/web/package-lock.json'],
  ];
  for (const paths of cases) {
    for (const flag of ['authority', 'unit', 'build', 'compatibility', 'install', 'admin']) {
      const needs = webNeeds(paths);
      const altered = needs.scope.outputs[flag] === 'true' ? 'false' : 'true';
      needs.scope.outputs[flag] = altered;
      for (const [job, mappedFlag] of Object.entries(WEB_JOB_SCOPES)) {
        if (mappedFlag === flag) needs[job].result = altered === 'true' ? 'success' : 'skipped';
      }
      assert.equal(verifyWeb(needs).passed, false, needs.scope.outputs.reason + ':' + flag);
    }
  }
  const hiddenWeb = webNeeds(['README.md']);
  hiddenWeb.scope.outputs.reason = 'WEB_CHANGE';
  assert.equal(verifyWeb(hiddenWeb).passed, false);
});

test('security aggregate accounts for all seven independent jobs', () => {
  assert.equal(verifySecurity(securityNeeds()).passed, true);
  assert.equal(verifySecurity(securityNeeds(false)).passed, true);
  for (const job of SECURITY_JOBS) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const needs = securityNeeds(); needs[job].result = result;
      assert.equal(verifySecurity(needs).passed, false);
    }
    const needs = securityNeeds(); delete needs[job];
    assert.equal(verifySecurity(needs).passed, false);
    const unselected = securityNeeds(false); unselected[job].result = 'success';
    assert.equal(verifySecurity(unselected).passed, false);
  }
});

test('full benchmark and source-failure reasons cannot be laundered into skipped profiles', () => {
  for (const reason of ['BENCHMARK_INPUT', 'PROTECTED_PROMOTION', 'PROTECTED_PUSH', 'DIFF_UNAVAILABLE', 'CI_POLICY_CHANGE']) {
    const needs = webNeeds(['README.md']); needs.scope.outputs.reason = reason;
    assert.equal(verifyWeb(needs).passed, false);
  }
  for (const reason of ['SOURCE_INVALID', 'SOURCE_MISMATCH', 'SOURCE_UNAVAILABLE']) {
    const needs = webNeeds(['apps/web/package-lock.json']); needs.scope.outputs.reason = reason;
    assert.equal(verifyWeb(needs).passed, false);
  }
});

test('security requires a successful selector and explicit boolean/reason outputs', () => {
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    const needs = securityNeeds(false); needs.scope.result = result;
    assert.equal(verifySecurity(needs).passed, false);
  }
  for (const value of [undefined, true, false, '', 'False', 'unknown']) {
    const needs = securityNeeds(false); needs.scope.outputs.security = value;
    assert.equal(verifySecurity(needs).passed, false);
  }
  for (const reason of [undefined, '', 'private diagnostics', 'CODE\nsecurity=false', 'UNKNOWN_NEW_REASON', 'SOURCE_INVALID', 'SOURCE_MISMATCH', 'POLICY_INVALID']) {
    const needs = securityNeeds(false); needs.scope.outputs.reason = reason;
    assert.equal(verifySecurity(needs).passed, false);
  }
  for (const value of [undefined, true, false, '', 'False', 'true', 'unknown']) {
    const fatal = securityNeeds(false); fatal.scope.outputs.fatal = value;
    assert.equal(verifySecurity(fatal).passed, false);
  }
  assert.equal(verifyResults({ mode: 'other', needs: webNeeds() }).passed, false);
});

test('security reason and selection must agree even when all seven job results are rewired', () => {
  for (const reason of SECURITY_SELECTED_REASONS) {
    const enabled = securityNeeds(); enabled.scope.outputs.reason = reason;
    assert.equal(verifySecurity(enabled).passed, true, reason);
    const hidden = securityNeeds(false); hidden.scope.outputs.reason = reason;
    assert.equal(verifySecurity(hidden).passed, false, reason);
  }
  const extra = securityNeeds(); extra.scope.outputs.reason = 'SECURITY_INPUTS_UNCHANGED';
  assert.equal(verifySecurity(extra).passed, false);
  for (const reason of ['SOURCE_INVALID', 'SOURCE_MISMATCH', 'POLICY_INVALID', 'UNKNOWN_NEW_REASON']) {
    const needs = securityNeeds(); needs.scope.outputs.reason = reason;
    assert.equal(verifySecurity(needs).passed, false);
  }
});

test('CLI does not expose malformed metadata and returns failure for a cancelled matrix', () => {
  const script = fileURLToPath(new URL('./verify-ci-results.mjs', import.meta.url));
  const run = (input, mode = 'web') => spawnSync(process.execPath, [script], { encoding: 'utf8', env: {
    ...process.env, CI_RESULTS_MODE: mode, CI_NEEDS_JSON: input,
  } });
  assert.equal(run(JSON.stringify(webNeeds())).status, 0);
  assert.equal(run(JSON.stringify(securityNeeds()), 'security').status, 0);
  const needs = webNeeds(); needs['ubuntu-npm-unit'].result = 'cancelled';
  const cancelled = run(JSON.stringify(needs));
  assert.equal(cancelled.status, 1);
  assert.deepEqual(JSON.parse(cancelled.stdout).jobs, ['ubuntu-npm-unit']);
  for (const input of ['PRIVATE_PROVIDER_DIAGNOSTIC', '{"private":"DO_NOT_PRINT"', 'x'.repeat(65 * 1024)]) {
    const malformed = run(input);
    assert.equal(malformed.status, 1);
    assert.doesNotMatch(malformed.stdout + malformed.stderr, /PRIVATE_PROVIDER_DIAGNOSTIC|DO_NOT_PRINT|xxx/);
  }
});
