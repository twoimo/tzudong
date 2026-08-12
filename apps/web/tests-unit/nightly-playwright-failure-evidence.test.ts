import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import {
  buildNightlyPlaywrightFailureEvidence,
  preparePrivatePlaywrightReport,
  removePrivatePlaywrightReport,
  removeSanitizedPlaywrightFailureEvidence,
  sanitizePrivatePlaywrightReport,
} from "../scripts/nightly-playwright-failure-evidence.mjs";

function result(status: string, errors: unknown[] = []) {
  return {
    status,
    errors,
    stdout: [{ text: "PRIVATE_STDOUT_MARKER" }],
    stderr: [{ text: "PRIVATE_STDERR_MARKER" }],
    attachments: [{ path: "/PRIVATE_ATTACHMENT_MARKER" }],
  };
}

function testResult(status: string, results: unknown[]) {
  return {
    projectName: "chromium",
    status,
    results,
  };
}

function privateFailureReport() {
  return {
    config: { rootDir: "/PRIVATE_ROOT_MARKER" },
    errors: [],
    stats: {
      expected: 1,
      flaky: 0,
      skipped: 1,
      unexpected: 2,
    },
    suites: [
      {
        title: "PRIVATE_SUITE_MARKER",
        file: "smoke.spec.ts",
        specs: [{
          title: "PRIVATE_TEST_TITLE_MARKER",
          file: "smoke.spec.ts",
          tests: [testResult("expected", [result("passed")])],
        }],
      },
      {
        file: "navigation.spec.ts",
        specs: [{
          title: "PRIVATE_TIMEOUT_TITLE_MARKER",
          file: "navigation.spec.ts",
          tests: [testResult("unexpected", [
            result("timedOut", [{ message: "PRIVATE_ERROR_MESSAGE_MARKER" }]),
          ])],
        }],
      },
      {
        file: "mobile-home-map.spec.ts",
        specs: [{
          title: "PRIVATE_FAILURE_TITLE_MARKER",
          file: "mobile-home-map.spec.ts",
          tests: [testResult("unexpected", [
            result("failed", [{ stack: "PRIVATE_ERROR_STACK_MARKER" }]),
          ])],
        }],
      },
      {
        file: "browser-title.spec.ts",
        specs: [{
          title: "PRIVATE_SKIPPED_TITLE_MARKER",
          file: "browser-title.spec.ts",
          tests: [testResult("skipped", [])],
        }],
      },
    ],
  };
}

describe("nightly Playwright failure evidence", () => {
  test("reduces private JSON to curated IDs and fixed classifications", () => {
    const evidence = buildNightlyPlaywrightFailureEvidence(privateFailureReport(), 1);
    expect(evidence).toEqual({
      schema: "nightly-playwright-failure-evidence-v1",
      source: "playwright-json-report-v2",
      command_exit_code: 1,
      outcome: "failure",
      test_count: 4,
      test_status_counts: {
        expected: 1,
        flaky: 0,
        skipped: 1,
        unexpected: 2,
      },
      result_status_counts: {
        failed: 1,
        interrupted: 0,
        passed: 1,
        skipped: 0,
        timedOut: 1,
      },
      report_error_count: 0,
      failure_count: 2,
      failure_class_counts: {
        failed: 1,
        interrupted: 0,
        no_result: 0,
        runner_error: 0,
        timed_out: 1,
        unexpected_pass: 0,
      },
      failures: [
        {
          spec_id: "PW-NAV",
          test_index: 0,
          classification: "timed_out",
          attempt_count: 1,
          result_error_count: 1,
        },
        {
          spec_id: "PW-MAP",
          test_index: 0,
          classification: "failed",
          attempt_count: 1,
          result_error_count: 1,
        },
      ],
    });
    const serialized = JSON.stringify(evidence);
    for (const forbidden of [
      "PRIVATE_",
      "title",
      "message",
      "stack",
      "stdout",
      "stderr",
      "attachment",
      "http://",
      "https://",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("records a fixed runner class when a failed command has no test error", () => {
    expect(buildNightlyPlaywrightFailureEvidence({
      errors: [],
      stats: { expected: 0, flaky: 0, skipped: 0, unexpected: 0 },
      suites: [],
    }, 1)).toMatchObject({
      outcome: "failure",
      report_error_count: 0,
      failure_count: 1,
      failure_class_counts: { runner_error: 1 },
      failures: [],
    });
  });

  test("keeps the raw report and sanitized evidence in owner-only custody", () => {
    const root = mkdtempSync(join(tmpdir(), "tzudong-playwright-evidence-"));
    const raw = join(root, "private-report.json");
    const output = join(root, "evidence.json");
    try {
      preparePrivatePlaywrightReport(raw);
      writeFileSync(raw, JSON.stringify(privateFailureReport()), { mode: 0o600 });
      sanitizePrivatePlaywrightReport(raw, output, 1);
      expect(lstatSync(raw).mode & 0o777).toBe(0o600);
      expect(lstatSync(output).mode & 0o777).toBe(0o600);
      expect(readFileSync(output, "utf8")).not.toContain("PRIVATE_");
      removePrivatePlaywrightReport(raw);
      expect(() => lstatSync(raw)).toThrow();
      removeSanitizedPlaywrightFailureEvidence(output);
      expect(() => lstatSync(output)).toThrow();
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("fails closed on uncurated specs, forged counts, and unsafe files", () => {
    const uncurated = privateFailureReport();
    uncurated.suites[0].file = "untrusted.spec.ts";
    uncurated.suites[0].specs[0].file = "untrusted.spec.ts";
    expect(() => buildNightlyPlaywrightFailureEvidence(uncurated, 1)).toThrow(
      "uncurated spec identity",
    );

    const forgedCounts = privateFailureReport();
    forgedCounts.stats.unexpected = 1;
    expect(() => buildNightlyPlaywrightFailureEvidence(forgedCounts, 1)).toThrow(
      "status count mismatch",
    );

    expect(() => buildNightlyPlaywrightFailureEvidence({
      errors: [],
      stats: { expected: 0, flaky: 0, skipped: 0, unexpected: 0 },
      suites: [],
    }, 0)).toThrow("no successful test evidence");

    const root = mkdtempSync(join(tmpdir(), "tzudong-playwright-evidence-unsafe-"));
    const raw = join(root, "private-report.json");
    const output = join(root, "evidence.json");
    const link = join(root, "evidence-link.json");
    try {
      writeFileSync(raw, JSON.stringify(privateFailureReport()), { mode: 0o600 });
      chmodSync(raw, 0o644);
      expect(() => sanitizePrivatePlaywrightReport(raw, output, 1)).toThrow(
        "custody mismatch",
      );
      chmodSync(raw, 0o600);
      writeFileSync(output, "do-not-overwrite", { mode: 0o600 });
      symlinkSync(output, link);
      expect(() => sanitizePrivatePlaywrightReport(raw, link, 1)).toThrow(
        "custody mismatch",
      );
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("removes stale evidence before normal CLI validation fails", () => {
    const appRoot = resolve(import.meta.dir, "..");
    const fixtureRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-runner-cleanup-"));
    const fixtureApp = join(fixtureRoot, "app");
    const fixtureScripts = join(fixtureApp, "scripts");
    const evidence = join(fixtureApp, "test-results/nightly-playwright-failure-evidence.json");
    const privateReport = join(fixtureApp, "playwright-report/nightly-playwright-private-report.json");
    try {
      mkdirSync(fixtureScripts, { recursive: true });
      mkdirSync(join(fixtureApp, "test-results"), { recursive: true });
      mkdirSync(join(fixtureApp, "playwright-report"), { recursive: true });
      copyFileSync(
        join(appRoot, "scripts/run-nightly-regression.mjs"),
        join(fixtureScripts, "run-nightly-regression.mjs"),
      );
      copyFileSync(
        join(appRoot, "scripts/nightly-playwright-failure-evidence.mjs"),
        join(fixtureScripts, "nightly-playwright-failure-evidence.mjs"),
      );
      writeFileSync(evidence, "stale-evidence", { mode: 0o600 });
      writeFileSync(privateReport, "stale-private-report", { mode: 0o600 });
      const result = spawnSync(process.execPath, ["scripts/run-nightly-regression.mjs"], {
        cwd: fixtureApp,
        encoding: "utf8",
        env: {
          ...process.env,
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Nightly mode is required");
      expect(() => lstatSync(evidence)).toThrow();
      expect(() => lstatSync(privateReport)).toThrow();
    } finally {
      rmSync(fixtureRoot, { recursive: true });
    }
  });
});
