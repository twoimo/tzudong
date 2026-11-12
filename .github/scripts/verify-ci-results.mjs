import { pathToFileURL } from 'node:url';
import { SCOPE_FLAGS, SCOPE_REASONS } from './classify-ci-scope.mjs';

export const WEB_JOB_SCOPES = Object.freeze({
  'dependency-modernization-proof': 'install',
  'ubuntu-npm-authority': 'authority',
  'ubuntu-npm-unit': 'unit',
  'ubuntu-npm-build': 'build',
  'ubuntu-bun-compatibility': 'compatibility',
  'windows-npm-tooling': 'compatibility',
  'windows-bun-compatibility': 'compatibility',
  'admin-address-consistency': 'admin',
});
export const SECURITY_JOBS = Object.freeze([
  'cloudflare-toolchain-audit', 'npm-audit', 'pip-audit',
  'orchestration-readiness', 'rust-recovery', 'secret-pattern-scan', 'sbom',
]);
const WEB_NARROW_FLAGS = Object.freeze({
  DOCUMENTATION_ONLY: [],
  WEB_CHANGE: ['authority', 'unit', 'build', 'install', 'admin'],
  MIXED_CHANGE: ['authority', 'unit', 'build', 'install', 'admin'],
  SOURCE_CONTRACT_CHANGE: ['unit', 'admin'],
});
export const SECURITY_SELECTED_REASONS = Object.freeze([
  'SECURITY_INPUT_CHANGED', 'UNKNOWN_INPUT', 'PATH_INVALID', 'DIFF_UNAVAILABLE',
  'PROTECTED_PROMOTION', 'PROTECTED_PUSH', 'PERIODIC_OR_MANUAL', 'UNKNOWN_BASE',
  'UNKNOWN_REF', 'UNKNOWN_EVENT', 'EVENT_UNAVAILABLE',
]);
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const verdict = (passed, reason, jobs = []) => ({ passed, reason, jobs });
const sameKeys = (value, keys) => object(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function verifyResults({ mode, needs }) {
  if (!['web', 'security'].includes(mode)) return verdict(false, 'MODE_INVALID');
  const jobNames = mode === 'web' ? Object.keys(WEB_JOB_SCOPES) : SECURITY_JOBS;
  if (!sameKeys(needs, ['scope', ...jobNames])) return verdict(false, 'NEEDS_INVALID');
  if (!object(needs.scope) || needs.scope.result !== 'success') return verdict(false, 'SCOPE_NOT_SUCCESSFUL');
  const outputs = needs.scope.outputs;
  if (!object(outputs) || typeof outputs.reason !== 'string' || !CODE.test(outputs.reason)) return verdict(false, 'SCOPE_OUTPUT_INVALID');
  if (mode === 'web') {
    if (!SCOPE_REASONS.includes(outputs.reason) || outputs.fatal !== 'false' ||
        SCOPE_FLAGS.some((flag) => !['true', 'false'].includes(outputs[flag]))) return verdict(false, 'SCOPE_OUTPUT_INVALID');
    if (['SOURCE_INVALID', 'SOURCE_MISMATCH', 'SOURCE_UNAVAILABLE'].includes(outputs.reason)) return verdict(false, 'SCOPE_OUTPUT_INVALID');
    const requiredFlags = Object.hasOwn(WEB_NARROW_FLAGS, outputs.reason) ? WEB_NARROW_FLAGS[outputs.reason] : SCOPE_FLAGS;
    if (SCOPE_FLAGS.some((flag) => outputs[flag] !== String(requiredFlags.includes(flag)))) return verdict(false, 'SCOPE_OUTPUT_INVALID');
  } else {
    if (!['true', 'false'].includes(outputs.security) || outputs.fatal !== 'false') return verdict(false, 'SCOPE_OUTPUT_INVALID');
    const reasonMatchesSelection = outputs.security === 'false'
      ? outputs.reason === 'SECURITY_INPUTS_UNCHANGED'
      : SECURITY_SELECTED_REASONS.includes(outputs.reason);
    if (!reasonMatchesSelection) return verdict(false, 'SCOPE_OUTPUT_INVALID');
  }

  const failed = [];
  for (const name of jobNames) {
    const selected = (mode === 'web' ? outputs[WEB_JOB_SCOPES[name]] : outputs.security) === 'true';
    const expected = selected ? 'success' : 'skipped';
    if (!object(needs[name]) || needs[name].result !== expected) failed.push(name);
  }
  // The matrix result is accepted only as success. No job-level continue-on-error
  // may mask a failed shard; the workflow contract tests enforce that boundary.
  return failed.length ? verdict(false, 'JOB_RESULT_MISMATCH', failed) : verdict(true, 'REQUIRED_RESULTS_VERIFIED');
}

function main() {
  let result;
  try {
    const input = process.env.CI_NEEDS_JSON;
    if (typeof input !== 'string' || Buffer.byteLength(input) > 64 * 1024) throw new Error('NEEDS_INVALID');
    result = verifyResults({ mode: process.env.CI_RESULTS_MODE, needs: JSON.parse(input) });
  } catch {
    result = verdict(false, 'NEEDS_INVALID');
  }
  // Only fixed reasons and known job IDs are printed; malformed needs metadata
  // and provider diagnostics never leave this process.
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
