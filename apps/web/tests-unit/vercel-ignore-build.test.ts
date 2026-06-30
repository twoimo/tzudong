import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "bun:test";

const WEB_ROOT = resolve(import.meta.dir, "..");

function runIgnoreCommand(env: Record<string, string>) {
  return spawnSync("node", ["scripts/vercel-ignore-build.mjs"], {
    cwd: WEB_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("Vercel ignored build branch policy", () => {
  it("is wired through the project vercel.json", () => {
    const config = JSON.parse(readFileSync(resolve(WEB_ROOT, "vercel.json"), "utf8")) as {
      ignoreCommand?: string;
    };

    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
  });

  it("continues production builds from main", () => {
    const result = runIgnoreCommand({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("build: production branch deployment");
    expect(result.stdout).toContain("ref=main");
  });

  it("continues preview builds only for develop", () => {
    const result = runIgnoreCommand({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "develop",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("build: allowed preview branch deployment");
    expect(result.stdout).toContain("ref=develop");
  });

  it("skips data, sync, and arbitrary feature branch preview builds", () => {
    for (const ref of ["data", "sync/develop-from-main", "feature/admin-shell"]) {
      const result = runIgnoreCommand({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: ref,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("skip: preview deployments are limited to develop");
      expect(result.stdout).toContain(`ref=${ref}`);
    }
  });

  it("normalizes full refs and fails open when the branch is unavailable", () => {
    const fullRefResult = runIgnoreCommand({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "refs/heads/develop",
    });

    expect(fullRefResult.status).toBe(1);
    expect(fullRefResult.stdout).toContain("ref=develop");

    const missingRefResult = runIgnoreCommand({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "",
      GITHUB_HEAD_REF: "",
      GITHUB_REF_NAME: "",
    });

    expect(missingRefResult.status).toBe(1);
    expect(missingRefResult.stdout).toContain("branch ref unavailable; fail open");
  });
});
