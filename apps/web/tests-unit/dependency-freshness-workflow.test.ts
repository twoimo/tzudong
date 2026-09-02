import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AUTO_MERGE,
  COMMAND_TIMEOUT_MINUTES,
  FIXED_CODES,
  HOLD_LIST,
  MAX_OPEN_PER_UNIT,
  MAX_RUN_INTERVAL_DAYS,
  PIN_CONTRACT_PACKAGES,
  TARGET_BRANCH,
  UNITS,
  VERIFICATION_COMMANDS,
  VERIFICATION_WORKING_DIRECTORY,
  assertGovernanceInvariants,
  buildRunReceipt,
  bumpType,
  classifyCandidate,
  classifyVerification,
  isHoldRangeBump,
  redactForbiddenLogFields,
  splitMajorBumps,
} from '../scripts/verify-dependency-freshness.mjs';

const appRoot = resolve(import.meta.dir, '..');
const repoRoot = resolve(appRoot, '../..');
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8').replace(/\r\n/g, '\n');

const workflow = read('.github/workflows/dependency-freshness.yml');
const dependabot = read('.github/dependabot.yml');
const rustToolchain = read('backend/rust/rust-toolchain.toml');

describe('Dependency_Freshness_Workflow governance contract', () => {
  test('enumerates exactly seven units including the cargo unit (design C2)', () => {
    expect(UNITS).toHaveLength(7);
    const directories = UNITS.map((unit) => unit.directory);
    expect(directories).toEqual([
      '/apps/web',
      '/backend',
      '/backend/pipeline',
      '/backend/restaurant-crawling/scripts',
      '/backend/deploy/pipeline-control',
      '/',
      '/backend/rust',
    ]);
    const cargo = UNITS.find((unit) => unit.ecosystem === 'cargo');
    expect(cargo?.number).toBe(7);
    expect(cargo?.directory).toBe('/backend/rust');
    expect(UNITS.filter((unit) => unit.ecosystem === 'npm')).toHaveLength(2);
    expect(UNITS.filter((unit) => unit.ecosystem === 'pip')).toHaveLength(3);
    expect(UNITS.filter((unit) => unit.ecosystem === 'github-actions')).toHaveLength(1);
  });

  test('the six pre-cargo units mirror the current dependabot.yml directories', () => {
    for (const unit of UNITS.filter((u) => u.ecosystem !== 'cargo')) {
      expect(dependabot).toContain(`directory: "${unit.directory}"`);
    }
  });

  test('targets develop only and never auto-merges', () => {
    expect(TARGET_BRANCH).toBe('develop');
    expect(AUTO_MERGE).toBe(false);
    // Read-only permissions and no merge/push steps.
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).not.toMatch(/auto[_-]?merge/i);
    expect(workflow).not.toMatch(/gh pr merge/);
    expect(workflow).not.toMatch(/contents: write/);
    // Every dependabot unit targets develop.
    const targets = dependabot.match(/target-branch: "develop"/g) ?? [];
    expect(targets.length).toBe(6);
  });

  test('keeps at most five open candidates per unit', () => {
    expect(MAX_OPEN_PER_UNIT).toBe(5);
    const limits = dependabot.match(/open-pull-requests-limit: (\d+)/g) ?? [];
    expect(limits.length).toBe(6);
    for (const limit of limits) {
      const value = Number(limit.replace('open-pull-requests-limit: ', ''));
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  test('runs the four verification commands in apps/web', () => {
    expect(VERIFICATION_WORKING_DIRECTORY).toBe('apps/web');
    expect(VERIFICATION_COMMANDS).toEqual([
      'bun run lint',
      'bun run test:unit',
      'npm run typecheck:parity',
      'npm run build',
    ]);
    expect(COMMAND_TIMEOUT_MINUTES).toBe(30);
    // The workflow runs each command and applies the 30-minute (1800s) budget.
    expect(workflow).toContain('working-directory: apps/web');
    expect(workflow).toContain("run_check 'bun run lint' bun run lint");
    expect(workflow).toContain("run_check 'bun run test:unit' bun run test:unit");
    expect(workflow).toContain("run_check 'npm run typecheck:parity' npm run typecheck:parity");
    expect(workflow).toContain("run_check 'npm run build' npm run build");
    expect(workflow).toContain("COMMAND_TIMEOUT_SECONDS: '1800'");
    expect(workflow).toContain('timeout "${COMMAND_TIMEOUT_SECONDS}"');
  });

  test('preserves the four dependabot holds and treats hold release as separate', () => {
    expect(HOLD_LIST).toHaveLength(4);
    const holdIds = HOLD_LIST.map((hold) => hold.id).sort();
    expect(holdIds).toEqual([
      'eslint-major',
      'next-16-3',
      'types-node-major',
      'typescript-eslint-8-63',
    ]);
    // The preserved holds remain declared in dependabot.yml.
    expect(dependabot).toContain('dependency-name: "next"');
    expect(dependabot).toContain('">=16.3.0"');
    expect(dependabot).toContain('dependency-name: "@next/bundle-analyzer"');
    expect(dependabot).toContain('dependency-name: "eslint-config-next"');
    expect(dependabot).toContain('dependency-name: "eslint"');
    expect(dependabot).toContain('dependency-name: "@types/node"');
    expect(dependabot).toContain('dependency-name: "typescript-eslint"');
    expect(dependabot).toContain('">8.63.0"');
    // The workflow reasserts hold preservation.
    expect(workflow).toContain('Preserve dependabot holds');
  });

  test('exposes the four bounded fixed codes and references them in the workflow', () => {
    expect(Object.values(FIXED_CODES).sort()).toEqual([
      'dependency_check_failed',
      'dependency_hold_violation',
      'pin_contract_violation',
      'target_branch_violation',
    ]);
    expect(workflow).toContain('dependency_check_failed');
    expect(workflow).toContain('pin_contract_violation');
  });

  test('schedules at least weekly with workflow_dispatch and records the run', () => {
    expect(MAX_RUN_INTERVAL_DAYS).toBe(7);
    expect(workflow).toContain('schedule:');
    expect(workflow).toMatch(/cron: '0 6 \* \* 1'/);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('scripts/verify-dependency-freshness.mjs');
    expect(workflow).toContain('dependency-freshness-run.json');
  });

  test('reuses the Pin_Contract verifier and pins the rust toolchain three-digit', () => {
    expect(workflow).toContain('node scripts/verify-pin-contract.mjs');
    expect(PIN_CONTRACT_PACKAGES).toContain('@typescript/native');
    expect(PIN_CONTRACT_PACKAGES).toContain('typescript');
    // rust-toolchain.toml is a fixed three-digit pin, no channel alias.
    expect(rustToolchain).toMatch(/channel\s*=\s*"1\.97\.0"/);
    expect(rustToolchain).not.toMatch(/channel\s*=\s*"(stable|beta|nightly)/);
    expect(workflow).toContain('backend/rust/rust-toolchain.toml');
  });
});

describe('Dependency_Freshness_Workflow enforcement logic', () => {
  test('governance invariants hold', () => {
    expect(assertGovernanceInvariants()).toBe(true);
  });

  test('rejects candidates that do not target develop', () => {
    expect(classifyCandidate({ targetBranch: 'main', packages: [] }).code).toBe(
      FIXED_CODES.TARGET_BRANCH_VIOLATION,
    );
    expect(classifyCandidate({ targetBranch: 'develop', packages: [] }).code).toBeNull();
  });

  test('rejects Pin_Contract value changes', () => {
    const candidate = {
      targetBranch: 'develop',
      packages: [{ name: '@typescript/native', fromVersion: '7.0.2', toVersion: '7.1.0' }],
    };
    expect(classifyCandidate(candidate).code).toBe(FIXED_CODES.PIN_CONTRACT_VIOLATION);
  });

  test('rejects hold-range bumps but admits bumps below the threshold', () => {
    expect(isHoldRangeBump('next', '16.3.0', 'minor')).toBe(true);
    expect(isHoldRangeBump('next', '16.2.9', 'patch')).toBe(false);
    expect(isHoldRangeBump('eslint', '10.0.0', 'major')).toBe(true);
    expect(isHoldRangeBump('eslint', '9.20.1', 'minor')).toBe(false);
    expect(isHoldRangeBump('@types/node', '25.0.0', 'major')).toBe(true);
    expect(isHoldRangeBump('typescript-eslint', '8.64.0', 'minor')).toBe(true);
    expect(isHoldRangeBump('typescript-eslint', '8.63.0', 'patch')).toBe(false);

    const held = {
      targetBranch: 'develop',
      packages: [{ name: 'next', fromVersion: '16.2.0', toVersion: '16.3.0' }],
    };
    expect(classifyCandidate(held).code).toBe(FIXED_CODES.DEPENDENCY_HOLD_VIOLATION);
  });

  test('classifies bump types', () => {
    expect(bumpType('1.2.3', '2.0.0')).toBe('major');
    expect(bumpType('1.2.3', '1.3.0')).toBe('minor');
    expect(bumpType('1.2.3', '1.2.4')).toBe('patch');
    expect(bumpType('1.2.3', '1.2.3')).toBe('none');
  });

  test('splits major bumps into standalone per-package candidates', () => {
    const candidate = {
      unit: '/apps/web',
      targetBranch: 'develop',
      packages: [
        { name: 'a', fromVersion: '1.0.0', toVersion: '2.0.0' },
        { name: 'b', fromVersion: '1.0.0', toVersion: '3.0.0' },
        { name: 'c', fromVersion: '1.0.0', toVersion: '1.1.0' },
        { name: 'd', fromVersion: '1.0.0', toVersion: '1.0.1' },
      ],
    };
    const split = splitMajorBumps(candidate);
    const majorCandidates = split.filter((entry) => entry.standalone);
    expect(majorCandidates).toHaveLength(2);
    for (const entry of majorCandidates) {
      expect(entry.packages).toHaveLength(1);
    }
    const grouped = split.filter((entry) => !entry.standalone);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].packages.map((p: { name: string }) => p.name).sort()).toEqual(['c', 'd']);
  });

  test('marks verification failed on failure, timeout, or incomplete attachment', () => {
    const ok = VERIFICATION_COMMANDS.map((command) => ({
      command,
      passed: true,
      finishedAt: '2026-01-01T00:00:00Z',
      durationMinutes: 1,
    }));
    expect(classifyVerification(ok).code).toBeNull();

    const failed = ok.map((entry, index) => (index === 0 ? { ...entry, passed: false } : entry));
    expect(classifyVerification(failed).code).toBe(FIXED_CODES.DEPENDENCY_CHECK_FAILED);

    const timedOut = ok.map((entry, index) => (index === 1 ? { ...entry, durationMinutes: 31 } : entry));
    expect(classifyVerification(timedOut).code).toBe(FIXED_CODES.DEPENDENCY_CHECK_FAILED);

    expect(classifyVerification(ok.slice(0, 3)).code).toBe(FIXED_CODES.DEPENDENCY_CHECK_FAILED);
  });

  test('run receipt records UTC run time and per-unit candidate count', () => {
    const receipt = buildRunReceipt({
      runAtUtc: '2026-01-05T06:00:00Z',
      candidates: [
        { unit: '/apps/web', targetBranch: 'develop', packages: [], title: 'bump a' },
        { unit: '/apps/web', targetBranch: 'develop', packages: [], title: 'bump b' },
        { unit: '/backend/rust', targetBranch: 'develop', packages: [], title: 'bump cargo' },
      ],
    });
    expect(receipt.runAtUtc).toBe('2026-01-05T06:00:00Z');
    expect(receipt.unitCount).toBe(7);
    expect(receipt.units).toHaveLength(7);
    const web = receipt.units.find((u) => u.directory === '/apps/web');
    expect(web?.candidateCount).toBe(2);
    const cargo = receipt.units.find((u) => u.directory === '/backend/rust');
    expect(cargo?.candidateCount).toBe(1);
    expect(receipt.autoMerge).toBe(false);
    expect(receipt.targetBranch).toBe('develop');
  });

  test('redacts Forbidden_Log_Field values from emitted text', () => {
    const redacted = redactForbiddenLogFields('contact user@example.com token=supersecretvalue');
    expect(redacted).not.toContain('user@example.com');
    expect(redacted).not.toContain('supersecretvalue');
  });
});
