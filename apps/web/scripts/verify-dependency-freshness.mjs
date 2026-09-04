#!/usr/bin/env node

// Dependency_Freshness_Workflow enforcement library + CLI
// (design C2 / requirements 4.1-4.11, 5.3, 5.6).
//
// This module holds the testable enforcement logic that
// `.github/workflows/dependency-freshness.yml` invokes so that the workflow's
// governance rules are asserted by unit/source-contract tests rather than only
// by a live runner. It never merges, never mutates candidate content, never
// touches branch protection, and it redacts Forbidden_Log_Field values from
// every string it emits.
//
// Fixed codes owned here:
//   - dependency_check_failed  : a verification command failed, exceeded the
//     30-minute budget, or a candidate is missing one of the four attachments.
//   - target_branch_violation  : a candidate does not target `develop`.
//   - dependency_hold_violation : a candidate raises a version inside a
//     `.github/dependabot.yml` hold range.
//   - pin_contract_violation   : a candidate changes a Pin_Contract value.
//
// The pin drift check itself is delegated to `verify-pin-contract.mjs`
// (requirements 5.1-5.9); this module only rejects candidates that would touch
// a Pin_Contract package so pin values are never changed by an update PR.

import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { redactCliText, logCliError } from './privacy-safe-cli-log.mjs';

// --- Governance constants (asserted by tests, consumed by the workflow) ---

/** Requirement 4.2: candidates target `develop` only. */
export const TARGET_BRANCH = 'develop';

/** Requirement 4.2: at most five open candidates per unit. */
export const MAX_OPEN_PER_UNIT = 5;

/** Requirement 4.2: candidates are never auto-merged. */
export const AUTO_MERGE = false;

/** Requirement 4.3: the four verification commands run in `apps/web`. */
export const VERIFICATION_WORKING_DIRECTORY = 'apps/web';
export const VERIFICATION_COMMANDS = Object.freeze([
  'bun run lint',
  'bun run test:unit',
  'npm run typecheck:parity',
  'npm run build',
]);

/** Requirement 4.4: a single command may not exceed 30 minutes. */
export const COMMAND_TIMEOUT_MINUTES = 30;

/** Requirement 4.6: run at least once every seven days. */
export const MAX_RUN_INTERVAL_DAYS = 7;

/**
 * Requirement 4.1 + 4.9 + 5.6 + design C2: seven update units.
 *
 * Unit 5 remains `/backend/pipeline-control`. The parked P5 move into
 * `/backend/deploy/pipeline-control` was rejected during recovery so one
 * current compose owner and one Dependabot unit remain authoritative.
 */
export const UNITS = Object.freeze([
  Object.freeze({ number: 1, ecosystem: 'npm', directory: '/apps/web' }),
  Object.freeze({ number: 2, ecosystem: 'npm', directory: '/backend' }),
  Object.freeze({ number: 3, ecosystem: 'pip', directory: '/backend/pipeline' }),
  Object.freeze({ number: 4, ecosystem: 'pip', directory: '/backend/restaurant-crawling/scripts' }),
  Object.freeze({ number: 5, ecosystem: 'pip', directory: '/backend/pipeline-control' }),
  Object.freeze({ number: 6, ecosystem: 'github-actions', directory: '/' }),
  Object.freeze({ number: 7, ecosystem: 'cargo', directory: '/backend/rust' }),
]);

/**
 * Requirement 4.5 + 4.11: the four preserved `.github/dependabot.yml` holds.
 * The `next >=16.3.0` hold is one decision covering three aligned packages.
 */
export const HOLD_LIST = Object.freeze([
  Object.freeze({
    id: 'next-16-3',
    packages: Object.freeze(['next', '@next/bundle-analyzer', 'eslint-config-next']),
    kind: 'version-range',
    operator: '>=',
    threshold: '16.3.0',
  }),
  Object.freeze({ id: 'eslint-major', packages: Object.freeze(['eslint']), kind: 'semver-major' }),
  Object.freeze({ id: 'types-node-major', packages: Object.freeze(['@types/node']), kind: 'semver-major' }),
  Object.freeze({
    id: 'typescript-eslint-8-63',
    packages: Object.freeze(['typescript-eslint']),
    kind: 'version-range',
    operator: '>',
    threshold: '8.63.0',
  }),
]);

/** Requirement 5.3: packages whose value is a Pin_Contract item. */
export const PIN_CONTRACT_PACKAGES = Object.freeze(['@typescript/native', 'typescript']);

/** Bounded fixed codes (design "Error Handling" table). */
export const FIXED_CODES = Object.freeze({
  DEPENDENCY_CHECK_FAILED: 'dependency_check_failed',
  TARGET_BRANCH_VIOLATION: 'target_branch_violation',
  DEPENDENCY_HOLD_VIOLATION: 'dependency_hold_violation',
  PIN_CONTRACT_VIOLATION: 'pin_contract_violation',
});

// --- Semver helpers ---

const parseVersion = (value) => {
  const match = /^\s*(?:[~^]|>=?|<=?|=)?\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  return parts.every(Number.isSafeInteger) ? parts : null;
};

const compareVersion = (a, b) => {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
};

/** Returns 'major' | 'minor' | 'patch' | 'none' | 'unknown'. */
export const bumpType = (fromVersion, toVersion) => {
  const from = parseVersion(fromVersion);
  const to = parseVersion(toVersion);
  if (!from || !to) return 'unknown';
  if (to[0] !== from[0]) return to[0] > from[0] ? 'major' : 'none';
  if (to[1] !== from[1]) return to[1] > from[1] ? 'minor' : 'none';
  if (to[2] !== from[2]) return to[2] > from[2] ? 'patch' : 'none';
  return 'none';
};

/**
 * Requirement 4.11: does raising `packageName` to `toVersion` (bump `bumped`)
 * fall inside a preserved hold range?
 */
export const isHoldRangeBump = (packageName, toVersion, bumped) => {
  for (const hold of HOLD_LIST) {
    if (!hold.packages.includes(packageName)) continue;
    if (hold.kind === 'semver-major') {
      if (bumped === 'major' || bumped === 'unknown') return true;
      continue;
    }
    if (hold.kind === 'version-range') {
      const to = parseVersion(toVersion);
      const threshold = parseVersion(hold.threshold);
      if (!to || !threshold) return true;
      const cmp = compareVersion(to, threshold);
      if (hold.operator === '>=' && cmp >= 0) return true;
      if (hold.operator === '>' && cmp > 0) return true;
    }
  }
  return false;
};

// --- Candidate classification ---

/**
 * Classifies one candidate PR descriptor.
 *
 * Precedence (a candidate is marked unmergeable on the first match):
 *   target_branch_violation > pin_contract_violation > dependency_hold_violation
 *
 * Returns `{ code: null }` when the candidate is admissible (still subject to
 * the four checks and human review; this function never merges).
 */
export const classifyCandidate = (candidate) => {
  const targetBranch = candidate?.targetBranch;
  if (targetBranch !== TARGET_BRANCH) {
    return { code: FIXED_CODES.TARGET_BRANCH_VIOLATION };
  }
  const packages = Array.isArray(candidate?.packages) ? candidate.packages : [];
  if (candidate?.metadataIncomplete === true) return { code: FIXED_CODES.DEPENDENCY_CHECK_FAILED };
  for (const pkg of packages) {
    if (PIN_CONTRACT_PACKAGES.includes(pkg?.name)) {
      return { code: FIXED_CODES.PIN_CONTRACT_VIOLATION };
    }
  }
  for (const pkg of packages) {
    const bumped = pkg?.bumpType ?? bumpType(pkg?.fromVersion, pkg?.toVersion);
    if (isHoldRangeBump(pkg?.name, pkg?.toVersion, bumped)) {
      return { code: FIXED_CODES.DEPENDENCY_HOLD_VIOLATION };
    }
  }
  return { code: null };
};

/**
 * Requirement 4.7: major bumps become standalone one-package-per-PR candidates.
 * Minor/patch bumps for a unit stay grouped in a single candidate.
 */
export const splitMajorBumps = (candidate) => {
  const packages = Array.isArray(candidate?.packages) ? candidate.packages : [];
  const majors = [];
  const nonMajors = [];
  for (const pkg of packages) {
    const bumped = pkg?.bumpType ?? bumpType(pkg?.fromVersion, pkg?.toVersion);
    (bumped === 'major' ? majors : nonMajors).push(pkg);
  }
  const result = majors.map((pkg) => ({ ...candidate, packages: [pkg], standalone: true }));
  if (nonMajors.length > 0) {
    result.push({ ...candidate, packages: nonMajors, standalone: false });
  }
  return result;
};

/**
 * Requirement 4.4: a candidate is mergeable-blocked with `dependency_check_failed`
 * when any of the four checks failed, a command exceeded 30 minutes, or fewer
 * than four results were attached. Candidate content is never changed here.
 */
export const classifyVerification = (results) => {
  const list = Array.isArray(results) ? results : [];
  if (list.length !== VERIFICATION_COMMANDS.length) {
    return { code: FIXED_CODES.DEPENDENCY_CHECK_FAILED, reason: 'incomplete_attachment' };
  }
  if (new Set(list.map((entry) => entry?.command)).size !== VERIFICATION_COMMANDS.length
    || list.some((entry) => !VERIFICATION_COMMANDS.includes(entry?.command))) {
    return { code: FIXED_CODES.DEPENDENCY_CHECK_FAILED, reason: 'incomplete_attachment' };
  }
  for (const entry of list) {
    if (entry?.passed !== true) {
      return { code: FIXED_CODES.DEPENDENCY_CHECK_FAILED, reason: 'command_failed' };
    }
    if (!Number.isFinite(entry?.durationMinutes) || entry.durationMinutes < 0
      || entry.durationMinutes > COMMAND_TIMEOUT_MINUTES) {
      return { code: FIXED_CODES.DEPENDENCY_CHECK_FAILED, reason: 'timeout' };
    }
    if (typeof entry?.finishedAt !== 'string' || entry.finishedAt.length === 0) {
      return { code: FIXED_CODES.DEPENDENCY_CHECK_FAILED, reason: 'incomplete_attachment' };
    }
  }
  return { code: null };
};

/**
 * Requirement 4.8: strip Forbidden_Log_Field values from any text bound for a
 * log, PR body, verification attachment, or run artifact. Reuses the shared
 * redaction boundary used across the web CLIs.
 */
export const redactForbiddenLogFields = (value) => redactCliText(value);

// --- Run receipt (requirement 4.6) ---

const findUnit = (directory) => UNITS.find((unit) => unit.directory === directory) ?? null;

/**
 * Builds the storage-owned run record: UTC run time and per-unit candidate
 * count. Candidate descriptors are optional; when omitted each unit records a
 * count of zero. PR titles are redacted before they enter the receipt.
 */
export const buildRunReceipt = ({ runAtUtc, candidates = [] } = {}) => {
  const counts = new Map(UNITS.map((unit) => [unit.directory, 0]));
  const classified = [];
  for (const candidate of candidates) {
    const unit = findUnit(candidate?.unit);
    if (unit) counts.set(unit.directory, (counts.get(unit.directory) ?? 0) + 1);
    const verdict = classifyCandidate(candidate);
    classified.push({
      number: Number.isSafeInteger(candidate?.number) && candidate.number > 0 ? candidate.number : null,
      headSha: /^[0-9a-f]{40}$/.test(candidate?.headSha ?? '') ? candidate.headSha : null,
      unit: unit ? unit.directory : 'unknown',
      title: redactForbiddenLogFields(candidate?.title ?? ''),
      standalone: candidate?.standalone === true,
      code: verdict.code,
    });
  }
  for (const entry of classified) {
    if (entry.unit === 'unknown' || counts.get(entry.unit) > MAX_OPEN_PER_UNIT) {
      entry.code ??= FIXED_CODES.DEPENDENCY_CHECK_FAILED;
    }
  }
  return {
    schemaVersion: 1,
    schema: 'dependency-freshness-run-v1',
    runAtUtc: typeof runAtUtc === 'string' ? runAtUtc : new Date().toISOString(),
    targetBranch: TARGET_BRANCH,
    autoMerge: AUTO_MERGE,
    maxOpenPerUnit: MAX_OPEN_PER_UNIT,
    unitCount: UNITS.length,
    holdCount: HOLD_LIST.length,
    verificationWorkingDirectory: VERIFICATION_WORKING_DIRECTORY,
    verificationCommands: [...VERIFICATION_COMMANDS],
    fixedCodes: Object.values(FIXED_CODES),
    units: UNITS.map((unit) => ({
      number: unit.number,
      ecosystem: unit.ecosystem,
      directory: unit.directory,
      candidateCount: counts.get(unit.directory) ?? 0,
    })),
    candidates: classified,
  };
};

// --- Self-consistency guard ---

/** Attach command results only to candidates whose exact source was checked. */
export function bindVerificationToCommit(candidates, results, checkedCommit) {
  if (!/^[0-9a-f]{40}$/.test(checkedCommit ?? '')) throw new Error('checked_commit_invalid');
  const matching = candidates.filter((candidate) => candidate?.headSha === checkedCommit);
  const receipt = buildRunReceipt({ candidates: matching });
  const verdict = classifyVerification(results);
  receipt.unverifiedCandidateCount = candidates.length - matching.length;
  receipt.verification = {
    checkedCommit,
    scope: matching.length ? 'matching_candidate_commit' : 'repository_commit_only',
    workingDirectory: VERIFICATION_WORKING_DIRECTORY,
    results: results.map((entry) => ({
      command: VERIFICATION_COMMANDS.includes(entry?.command) ? entry.command : 'unknown',
      passed: entry?.passed === true,
      finishedAt: typeof entry?.finishedAt === 'string' ? entry.finishedAt : null,
      durationMinutes: typeof entry?.durationMinutes === 'number' ? entry.durationMinutes : null,
    })),
    code: verdict.code,
  };
  for (const candidate of receipt.candidates) candidate.code ??= verdict.code;
  return receipt;
}

/** Fails closed if the governance constants ever drift from the contract. */
export const assertGovernanceInvariants = () => {
  if (UNITS.length !== 7) throw Object.assign(new Error('unit_count_invalid'), { code: 'unit_count_invalid' });
  if (HOLD_LIST.length !== 4) throw Object.assign(new Error('hold_count_invalid'), { code: 'hold_count_invalid' });
  if (VERIFICATION_COMMANDS.length !== 4) {
    throw Object.assign(new Error('command_count_invalid'), { code: 'command_count_invalid' });
  }
  if (AUTO_MERGE !== false) throw Object.assign(new Error('auto_merge_forbidden'), { code: 'auto_merge_forbidden' });
  if (TARGET_BRANCH !== 'develop') {
    throw Object.assign(new Error('target_branch_invalid'), { code: 'target_branch_invalid' });
  }
  return true;
};

// --- CLI ---

const readFlagArg = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};

async function main() {
  assertGovernanceInvariants();

  const candidatesPath = readFlagArg('--candidates');
  let candidates = [];
  if (candidatesPath) {
    const raw = JSON.parse(await readFile(candidatesPath, 'utf8'));
    if (!Array.isArray(raw)) throw new Error("candidate_metadata_invalid");
    candidates = raw;
  }

  let receipt = buildRunReceipt({ candidates });

  // Optional: fold the four-command verification verdict into the receipt so
  // the workflow fails closed (no merge) and records `dependency_check_failed`.
  const verificationPath = readFlagArg('--verification');
  if (verificationPath) {
    const raw = JSON.parse(await readFile(verificationPath, 'utf8'));
    const results = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
    const checkedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    receipt = bindVerificationToCommit(candidates, results, checkedCommit);
    if (receipt.verification.code) process.exitCode = 1;
  }

  const anyCandidateBlocked = receipt.candidates.some((entry) => entry.code !== null);
  if (anyCandidateBlocked) process.exitCode = 1;

  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

// Only run as a CLI when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logCliError(error, (line) => process.stderr.write(`[verify-dependency-freshness] ${line}`));
    process.exitCode = 1;
  });
}
