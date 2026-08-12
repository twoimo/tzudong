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
  classifyNightlyRunnerStageFailure,
  completeNightlyCleanupTasks,
  preparePrivatePlaywrightReport,
  removePrivatePlaywrightReport,
  removeSanitizedPlaywrightFailureEvidence,
  replaceWithNightlyRunnerStageEvidence,
  sanitizePrivatePlaywrightReport,
  writeNightlyRunnerStageEvidence,
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

  test("writes only fixed owner-only runner stage evidence before a report exists", () => {
    const root = mkdtempSync(join(tmpdir(), "tzudong-runner-stage-evidence-"));
    const output = join(root, "test-results/evidence.json");
    try {
      expect(writeNightlyRunnerStageEvidence(
        output,
        "admission",
        "custody_rejected",
      )).toEqual({
        schema: "nightly-e2e-runner-stage-evidence-v1",
        source: "nightly-runner-stage-v1",
        command_exit_code: 1,
        outcome: "failure",
        stage: "admission",
        failure_class: "custody_rejected",
      });
      expect(lstatSync(output).mode & 0o777).toBe(0o600);
      expect(lstatSync(join(root, "test-results")).mode & 0o022).toBe(0);
      const serialized = readFileSync(output, "utf8");
      for (const forbidden of ["PRIVATE_", "message", "stack", "path", "url", "http"] ) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(() => writeNightlyRunnerStageEvidence(
        output,
        "PRIVATE_STAGE",
        "custody_rejected",
      )).toThrow("contract mismatch");
      expect(classifyNightlyRunnerStageFailure(
        "health",
        new Error("Nightly application exited before the health endpoint became ready."),
      )).toBe("application_exit");
      expect(classifyNightlyRunnerStageFailure(
        "health",
        new Error("PRIVATE_ERROR_WITH_URL_AND_SECRET"),
      )).toBe("runtime_unavailable");
      expect(classifyNightlyRunnerStageFailure(
        "PRIVATE_STAGE",
        new Error("PRIVATE_ERROR_WITH_URL_AND_SECRET"),
      )).toBe("unexpected_failure");
      expect(() => writeNightlyRunnerStageEvidence(
        output,
        "health",
        "PRIVATE_FAILURE_CLASS",
      )).toThrow("contract mismatch");
      for (const [stage, failureClass] of [
        ["health", "custody_rejected"],
        ["sanitize", "health_timeout"],
        ["diagnostics", "report_rejected"],
        ["cleanup", "diagnostics_rejected"],
      ]) {
        expect(() => writeNightlyRunnerStageEvidence(
          output,
          stage,
          failureClass,
        )).toThrow("contract mismatch");
      }
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("writes evidence through the guarded descriptor and rejects a symlink destination", () => {
    const appRoot = resolve(import.meta.dir, "..");
    const source = readFileSync(
      join(appRoot, "scripts/nightly-playwright-failure-evidence.mjs"),
      "utf8",
    );
    expect(source).toContain("fsConstants.O_NOFOLLOW");
    expect(source).toContain("writeFileSync(descriptor, body, { encoding: 'utf8' })");
    expect(source).toContain("fsyncSync(descriptor)");
    expect(source).not.toContain("writeFileSync(filePath, body");

    const root = mkdtempSync(join(tmpdir(), "tzudong-runner-stage-symlink-"));
    const target = join(root, "target.json");
    const output = join(root, "evidence.json");
    try {
      writeFileSync(target, "unchanged", { mode: 0o600 });
      symlinkSync(target, output);
      expect(() => writeNightlyRunnerStageEvidence(
        output,
        "health",
        "health_timeout",
      )).toThrow("could not be written");
      expect(readFileSync(target, "utf8")).toBe("unchanged");
      expect(lstatSync(output).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("preserves sanitized Playwright failure evidence after a later diagnostics failure", () => {
    const root = mkdtempSync(join(tmpdir(), "tzudong-preserve-playwright-evidence-"));
    const output = join(root, "evidence.json");
    try {
      const playwrightEvidence = `${JSON.stringify({
        schema: "nightly-playwright-failure-evidence-v1",
        source: "playwright-json-report-v2",
        command_exit_code: 1,
        outcome: "failure",
      })}\n`;
      writeFileSync(output, playwrightEvidence, { mode: 0o600 });
      expect(replaceWithNightlyRunnerStageEvidence(
        output,
        "diagnostics",
        new Error("PRIVATE_DIAGNOSTICS_FAILURE"),
        true,
      )).toBe(false);
      expect(readFileSync(output, "utf8")).toBe(playwrightEvidence);

      expect(replaceWithNightlyRunnerStageEvidence(
        output,
        "diagnostics",
        new Error("PRIVATE_DIAGNOSTICS_FAILURE"),
        false,
      )).toBe(true);
      expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
        schema: "nightly-e2e-runner-stage-evidence-v1",
        stage: "diagnostics",
        failure_class: "diagnostics_rejected",
      });
      expect(readFileSync(output, "utf8")).not.toContain("PRIVATE_DIAGNOSTICS_FAILURE");
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("runs stop and log cleanup even when private report cleanup throws", async () => {
    const calls: string[] = [];
    expect(await completeNightlyCleanupTasks([
      () => {
        calls.push("private-report");
        throw new Error("PRIVATE_CLEANUP_FAILURE");
      },
      async () => {
        calls.push("stop-process");
      },
      () => {
        calls.push("close-log");
      },
    ])).toBe(true);
    expect(calls).toEqual(["private-report", "stop-process", "close-log"]);
    expect(await completeNightlyCleanupTasks([
      () => {},
      async () => {},
      () => {},
    ])).toBe(false);
    await expect(completeNightlyCleanupTasks([() => {}])).rejects.toThrow(
      "cleanup task contract mismatch",
    );
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
        "could not be written",
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

  test("writes fixed admission evidence when E2E input validation fails before browser startup", () => {
    const appRoot = resolve(import.meta.dir, "..");
    const fixtureRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-admission-evidence-"));
    const fixtureApp = join(fixtureRoot, "app");
    const fixtureScripts = join(fixtureApp, "scripts");
    const evidence = join(fixtureApp, "test-results/nightly-playwright-failure-evidence.json");
    try {
      mkdirSync(fixtureScripts, { recursive: true });
      copyFileSync(
        join(appRoot, "scripts/run-nightly-regression.mjs"),
        join(fixtureScripts, "run-nightly-regression.mjs"),
      );
      copyFileSync(
        join(appRoot, "scripts/nightly-playwright-failure-evidence.mjs"),
        join(fixtureScripts, "nightly-playwright-failure-evidence.mjs"),
      );
      const environment = { ...process.env };
      delete environment.NIGHTLY_ENV_FILE;
      delete environment.NIGHTLY_ENV_PROVENANCE_FILE;
      const result = spawnSync(process.execPath, [
        "scripts/run-nightly-regression.mjs",
        "--mode", "local",
        "--suite", "e2e",
      ], {
        cwd: fixtureApp,
        encoding: "utf8",
        env: environment,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("requires --env-file");
      expect(JSON.parse(readFileSync(evidence, "utf8"))).toEqual({
        schema: "nightly-e2e-runner-stage-evidence-v1",
        source: "nightly-runner-stage-v1",
        command_exit_code: 1,
        outcome: "failure",
        stage: "admission",
        failure_class: "unexpected_failure",
      });
    } finally {
      rmSync(fixtureRoot, { recursive: true });
    }
  });

  test("replaces prior evidence when stale private-report custody fails before main", () => {
    const appRoot = resolve(import.meta.dir, "..");
    const fixtureRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-stale-unsafe-"));
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
      writeFileSync(evidence, JSON.stringify({ stale: "previously-approved" }), { mode: 0o600 });
      writeFileSync(privateReport, "stale-private-report", { mode: 0o644 });
      chmodSync(privateReport, 0o644);
      const result = spawnSync(process.execPath, ["scripts/run-nightly-regression.mjs"], {
        cwd: fixtureApp,
        encoding: "utf8",
        env: { ...process.env },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Nightly browser artifact cleanup failed");
      expect(JSON.parse(readFileSync(evidence, "utf8"))).toEqual({
        schema: "nightly-e2e-runner-stage-evidence-v1",
        source: "nightly-runner-stage-v1",
        command_exit_code: 1,
        outcome: "failure",
        stage: "admission",
        failure_class: "custody_rejected",
      });
      expect(readFileSync(evidence, "utf8")).not.toContain("previously-approved");
    } finally {
      rmSync(fixtureRoot, { recursive: true });
    }
  });
});
