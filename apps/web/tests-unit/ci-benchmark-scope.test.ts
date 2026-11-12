import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyPaths, SCOPE_FLAGS } from "../../../.github/scripts/classify-ci-scope.mjs";
import { WEB_JOB_SCOPES } from "../../../.github/scripts/verify-ci-results.mjs";

const root = resolve(import.meta.dir, "../../..");
const workflow = Bun.YAML.parse(readFileSync(resolve(root, ".github/workflows/web-admin-ci.yml"), "utf8")) as {
  on: { pull_request: null | { paths?: string[] }; push: { paths?: string[]; branches: string[] }; schedule: unknown[] };
  jobs: Record<string, {
    name?: string; needs?: string | string[]; if?: string; outputs?: Record<string, string>; "continue-on-error"?: boolean;
    steps: { id?: string; name?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, unknown>; "continue-on-error"?: boolean; "working-directory"?: string }[];
  }>;
};

describe("compiler CI coverage routing", () => {
  test("always emits the CI gate while the selector preserves schema, publication and source-contract coverage", () => {
    expect(Object.hasOwn(workflow.on, "pull_request")).toBe(true);
    expect(workflow.on.pull_request?.paths).toBeUndefined();
    expect(workflow.on.push.paths).toBeUndefined();
    expect(workflow.on.push.branches).toEqual(["main", "develop", "data"]);
    expect(workflow.on.schedule.length).toBeGreaterThan(0);
    for (const file of ["apps/web/app/admin/page.tsx", "apps/web/app/api/admin/evaluations/route.ts", "apps/web/tsconfig.json", "apps/web/package-lock.json", "apps/web/scripts/run-typecheck.mjs", "apps/web/tests-unit/typecheck-benchmark-source.test.ts", "apps/web/supabase/migrations/change.sql", "backend/supabase/migrations/change.sql", "backend/test-requirements.txt", "backend/bin/build_tzuyang_case_review_pack.mjs", "backend/bin/tests/node-dependency-compatibility.test.mjs", "backend/restaurant-crawling/scripts/worker.py", ".github/scripts/classify-ci-benchmark.mjs", ".github/dependabot.yml", ".github/nightly-local-publication-allowlist.txt", ".kiro/specs/receipt.json", ".agents/skills/ci/SKILL.md"]) {
      const selected = classifyPaths([file]);
      expect(selected.unit).toBe(true);
      expect(selected.admin).toBe(true);
    }
    const docs = classifyPaths(["docs/example.md"]);
    for (const flag of SCOPE_FLAGS) expect(docs[flag]).toBe(false);
  });

  test("connects every conditional lane and its complete result to the always-run aggregate", () => {
    const scope = workflow.jobs.scope;
    expect(scope.if).toBeUndefined();
    expect(scope.needs).toBeUndefined();
    expect(scope["continue-on-error"]).not.toBe(true);
    const select = scope.steps.find((step) => step.id === "select");
    expect(select?.run).toBe("node .github/scripts/classify-ci-scope.mjs");
    expect(select?.if).toBeUndefined();
    expect(select?.["continue-on-error"]).not.toBe(true);
    for (const flag of [...SCOPE_FLAGS, "reason", "fatal"])
      expect(scope.outputs?.[flag]).toBe("${{ steps.select.outputs." + flag + " }}");
    const proof = scope.steps.find((step) => step.run?.includes("classify-ci-scope.test.mjs"));
    expect(proof?.run).toContain("verify-ci-results.test.mjs");
    expect(proof?.if).toBeUndefined();
    expect(proof?.["continue-on-error"]).not.toBe(true);
    expect(scope.steps.indexOf(proof!)).toBeLessThan(scope.steps.indexOf(select!));

    for (const [name, flag] of Object.entries(WEB_JOB_SCOPES)) {
      const job = workflow.jobs[name];
      expect([job.needs].flat()).toEqual(["scope"]);
      expect(job.if).toBe(`needs.scope.outputs.${flag} == 'true'`);
      expect(job["continue-on-error"]).not.toBe(true);
    }
    const result = workflow.jobs["ci-result"];
    expect(Object.keys(workflow.jobs).sort()).toEqual(["scope", ...Object.keys(WEB_JOB_SCOPES), "ci-result"].sort());
    expect(result.name).toBe("CI");
    expect(result.if).toBe("${{ always() }}");
    expect(result["continue-on-error"]).not.toBe(true);
    expect(result.needs).toEqual(["scope", ...Object.keys(WEB_JOB_SCOPES)]);
    const verifier = result.steps.filter((step) => step.run === "node .github/scripts/verify-ci-results.mjs");
    expect(verifier).toHaveLength(1);
    expect(verifier[0].if).toBeUndefined();
    expect(verifier[0]["continue-on-error"]).not.toBe(true);
    expect(verifier[0].env).toEqual({ CI_RESULTS_MODE: "web", CI_NEEDS_JSON: "${{ toJSON(needs) }}" });
  });

  test("all four platform lanes choose exactly one parity owner and bind benchmark evidence to that choice", () => {
    const roots: Record<string, string> = {
      "ubuntu-npm-authority": "${{ github.workspace }}",
      "ubuntu-bun-compatibility": "${{ github.workspace }}/web-bun",
      "windows-npm-tooling": "${{ github.workspace }}/web-npm",
      "windows-bun-compatibility": "${{ github.workspace }}/web-bun",
    };
    for (const [id, checkoutRoot] of Object.entries(roots)) {
      const steps = workflow.jobs[id].steps;
      expect(steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with).toMatchObject({
        ref: "${{ github.event.pull_request.head.sha || github.sha }}",
        "persist-credentials": false,
        "fetch-depth": 0,
      });
      const scope = steps.find((step) => step.id === "scope");
      expect(scope?.["working-directory"]).toBe(checkoutRoot);
      const scopeTest = steps.find((step) => step.name === "Verify compiler scope classifier");
      expect(scopeTest?.["working-directory"]).toBe(checkoutRoot);
      expect(scopeTest?.run).toBe("node --test .github/scripts/classify-ci-benchmark.test.mjs");
      expect(steps.indexOf(scopeTest!)).toBeLessThan(steps.indexOf(scope!));
      expect(scope?.run).toContain("node .github/scripts/classify-ci-benchmark.mjs");
      const parity = steps.filter((step) => /run typecheck:parity$/.test(step.run ?? ""));
      const verify = steps.filter((step) => /run typecheck:verify$/.test(step.run ?? ""));
      expect(parity).toHaveLength(1);
      expect(verify).toHaveLength(1);
      expect(parity[0].if).toBe("steps.scope.outputs.benchmark == 'false'");
      expect(verify[0].if).toBe(parity[0].if);
      expect(steps.some((step) => /run typecheck:(native|compat)$/.test(step.run ?? ""))).toBe(false);
      const benchmark = steps.find((step) => step.id === "benchmark");
      const report = steps.find((step) => step.id === "report");
      expect(benchmark?.if).toBe("steps.scope.outputs.benchmark != 'false'");
      expect(report?.if).toBe(benchmark?.if);
      expect(benchmark?.["continue-on-error"]).toBe(true);
      expect(report?.["continue-on-error"]).toBe(true);
      const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
      const finalizer = steps.find((step) => step.name === "Fail closed on benchmark evidence");
      expect(upload?.if).toBe("always() && steps.scope.outputs.benchmark != 'false'");
      expect(finalizer?.if).toBe(upload?.if);
      expect(upload?.with?.["if-no-files-found"]).toBe("error");
      expect(finalizer?.run).toContain("steps.benchmark.outcome");
      expect(finalizer?.run).toContain("steps.report.outcome");
      expect(steps.indexOf(scope!)).toBeLessThan(steps.indexOf(benchmark!));
      // Missing classifier output cannot skip both owners or pretend to pass.
      for (const value of ["true", "false", "", "unknown"]) {
        const standaloneParity = value === "false";
        const benchmarkParity = value !== "false";
        expect(Number(standaloneParity) + Number(benchmarkParity)).toBe(1);
      }
    }
  });

  test("full benchmarking still owns the independent toolchain and diagnostic preflight", () => {
    const benchmark = readFileSync(resolve(root, "apps/web/scripts/measure-typecheck.mjs"), "utf8");
    expect(benchmark).toContain("async function preflight(stage)");
    expect(benchmark).toContain("runProcess(process.execPath, [VERIFY])");
    expect(benchmark).toContain("runProcess(process.execPath, [PARITY, 'parity'])");
    expect(benchmark).toContain("const receipts = await preflight(stage)");
    for (const id of ["ubuntu-npm-authority", "ubuntu-bun-compatibility", "windows-npm-tooling", "windows-bun-compatibility"]) {
      // A selected lane still executes all its lint/unit/build/platform probes.
      for (const step of workflow.jobs[id].steps.filter((step) => /run (lint|test:unit|build)$|bun test /.test(step.run ?? ""))) expect(step.if).toBeUndefined();
    }
  });
});
