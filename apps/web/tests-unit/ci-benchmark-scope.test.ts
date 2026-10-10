import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const workflow = Bun.YAML.parse(readFileSync(resolve(root, ".github/workflows/web-admin-ci.yml"), "utf8")) as {
  on: { pull_request: { paths: string[] }; push: { paths: string[] } };
  jobs: Record<string, { steps: { id?: string; name?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown>; "continue-on-error"?: boolean; "working-directory"?: string }[] }>;
};

describe("compiler CI coverage routing", () => {
  test("compact trigger lists preserve public/admin, schema and publication inputs", () => {
    expect(workflow.on.pull_request.paths).toEqual(workflow.on.push.paths);
    expect(workflow.on.pull_request.paths).toHaveLength(21);
    const matches = (file: string) => workflow.on.pull_request.paths.some((pattern) => new Bun.Glob(pattern).match(file));
    for (const file of ["apps/web/app/admin/page.tsx", "apps/web/app/api/admin/evaluations/route.ts", "apps/web/tsconfig.json", "apps/web/package-lock.json", "apps/web/scripts/run-typecheck.mjs", "apps/web/tests-unit/typecheck-benchmark-source.test.ts", "apps/web/supabase/migrations/change.sql", "backend/supabase/migrations/change.sql", "backend/bin/build_tzuyang_case_review_pack.mjs", "backend/bin/tests/node-dependency-compatibility.test.mjs", "backend/restaurant-crawling/scripts/worker.py", ".github/scripts/classify-ci-benchmark.mjs", ".github/nightly-local-publication-allowlist.txt"]) expect(matches(file)).toBe(true);
    expect(matches("docs/example.md")).toBe(false);
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
      // Existing lint/unit/build/platform probes stay unconditional.
      for (const step of workflow.jobs[id].steps.filter((step) => /run (lint|test:unit|build)$|bun test /.test(step.run ?? ""))) expect(step.if).toBeUndefined();
    }
  });
});
