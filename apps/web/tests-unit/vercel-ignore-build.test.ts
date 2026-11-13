import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import minimatch from "minimatch";

import { describe, expect, it } from "bun:test";

const APPROVED_SHA = "a".repeat(40);

const WEB_ROOT = resolve(import.meta.dir, "..");

function runIgnoreCommand(env: Record<string, string>, webRoot = WEB_ROOT) {
  return spawnSync("node", ["scripts/vercel-ignore-build.mjs"], {
    cwd: webRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TZUDONG_APPROVED_PRODUCTION_SHA: "",
      VERCEL_GIT_COMMIT_SHA: "",
      VERCEL_GIT_PREVIOUS_SHA: "",
      ...env,
    },
  });
}

type PreviewFixture = {
  root: string;
  git: (...args: string[]) => string;
  commitFiles: (files: Record<string, string>) => string;
  run: (previousSha: string, env?: Record<string, string>) => ReturnType<typeof runIgnoreCommand>;
};

function withPreviewRepository(check: (fixture: PreviewFixture) => void) {
  const root = mkdtempSync(resolve(tmpdir(), "tzudong-vercel-preview-"));
  const webRoot = resolve(root, "apps/web");
  const git = (...args: string[]) => {
    const result = spawnSync("git", [
      "-c", "user.name=Preview fixture", "-c", "user.email=fixture@example.invalid",
      "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args,
    ], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`fixture git ${args[0]} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const commitFiles = (files: Record<string, string>) => {
    for (const [file, contents] of Object.entries(files)) {
      const target = resolve(root, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    git("add", "--all");
    git("commit", "--quiet", "--allow-empty", "-m", "preview fixture");
    return git("rev-parse", "HEAD");
  };
  try {
    mkdirSync(resolve(webRoot, "scripts"), { recursive: true });
    copyFileSync(resolve(WEB_ROOT, "scripts/vercel-ignore-build.mjs"), resolve(webRoot, "scripts/vercel-ignore-build.mjs"));
    copyFileSync(resolve(WEB_ROOT, "vercel.json"), resolve(webRoot, "vercel.json"));
    git("init", "--quiet");
    commitFiles({ "README.md": "preview fixture\n" });
    check({
      root,
      git,
      commitFiles,
      run: (previousSha, env = {}) => runIgnoreCommand({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "develop",
        VERCEL_GIT_COMMIT_SHA: git("rev-parse", "HEAD"),
        VERCEL_GIT_PREVIOUS_SHA: previousSha,
        ...env,
      }, webRoot),
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

describe("Vercel ignored build branch policy", () => {
  it("is wired through the project vercel.json", () => {
    const config = JSON.parse(readFileSync(resolve(WEB_ROOT, "vercel.json"), "utf8")) as {
      git?: {
        deploymentEnabled?: Record<string, boolean>;
      };
      ignoreCommand?: string;
      regions?: string[];
    };

    expect(config.git?.deploymentEnabled).toEqual({
      "**": false,
      main: true,
      develop: true,
      "preview/*": true,
    });
    expect(config.regions).toEqual(["icn1"]);
    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
  });

  it("blocks slash branches with Vercel's minimatch and any-matching-true rules", () => {
    const rules = JSON.parse(readFileSync(resolve(WEB_ROOT, "vercel.json"), "utf8"))
      .git.deploymentEnabled as Record<string, boolean>;
    const enabled = (branch: string) => {
      const matches = Object.entries(rules).filter(([pattern]) => minimatch(branch, pattern));
      return matches.length === 0 || matches.some(([, value]) => value === true);
    };
    expect(minimatch("feature/admin-shell", "*")).toBe(false);
    expect(minimatch("feature/admin-shell", "**")).toBe(true);
    for (const branch of ["main", "develop", "preview/admin-shell"]) expect(enabled(branch)).toBe(true);
    for (const branch of ["data", "unknown", "feature/admin-shell", "sync/develop-from-main",
      "dependabot/npm_and_yarn/apps/web/example-1.0.1", "codex/preview/change", "preview", "preview/", "preview/nested/change"]) {
      expect(enabled(branch)).toBe(false);
    }
  });

  it("continues exactly authorized production builds from main", () => {
    const result = runIgnoreCommand({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: APPROVED_SHA,
      TZUDONG_APPROVED_PRODUCTION_SHA: APPROVED_SHA,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("build: production branch deployment");
    expect(result.stdout).toContain("ref=main");
  });

  it("holds production when authorization is missing, malformed, or for another commit", () => {
    for (const [approved, current] of [
      ["", APPROVED_SHA],
      [APPROVED_SHA, ""],
      ["short", "short"],
      ["A".repeat(40), "A".repeat(40)],
      [APPROVED_SHA, "b".repeat(40)],
      [` ${APPROVED_SHA}`, APPROVED_SHA],
    ]) {
      const result = runIgnoreCommand({
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: current,
        TZUDONG_APPROVED_PRODUCTION_SHA: approved,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("production commit lacks matching release authorization");
    }
  });

  it("requires an explicit true configuration and fails closed on unreadable or malformed configuration", () => {
    const root = mkdtempSync(resolve(tmpdir(), "tzudong-vercel-gate-"));
    try {
      mkdirSync(resolve(root, "scripts"));
      copyFileSync(resolve(WEB_ROOT, "scripts/vercel-ignore-build.mjs"), resolve(root, "scripts/vercel-ignore-build.mjs"));
      for (const [config, expected] of [
        [null, 0],
        ["invalid-json", 0],
        [JSON.stringify({ git: { deploymentEnabled: { main: false } } }), 0],
        [JSON.stringify({ git: { deploymentEnabled: { main: "true" } } }), 0],
        [JSON.stringify({ git: { deploymentEnabled: { main: true } } }), 1],
      ] as const) {
        if (config !== null) writeFileSync(resolve(root, "vercel.json"), config);
        const result = spawnSync("node", ["scripts/vercel-ignore-build.mjs"], {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, VERCEL_GIT_COMMIT_SHA: APPROVED_SHA, TZUDONG_APPROVED_PRODUCTION_SHA: APPROVED_SHA, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" },
        });
        expect(result.status).toBe(expected);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips preview builds from main", () => {
    const result = runIgnoreCommand({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "main",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skip: preview deployments require preview/* or the transition develop lane");
    expect(result.stdout).toContain("ref=main");
  });

  it("skips accidental production deployments from non-main branches", () => {
    const result = runIgnoreCommand({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "data",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skip: production deployments are limited to main");
    expect(result.stdout).toContain("ref=data");
  });

  it("retains the develop preview lane for the final protected transition", () => {
    const result = runIgnoreCommand({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "develop",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("build: allowed preview branch deployment");
    expect(result.stdout).toContain("ref=develop");
  });

  it("builds explicitly requested one-level preview branches and keeps production closed", () => {
    for (const ref of ["preview/admin-shell", "refs/heads/preview/map-fix"]) {
      const preview = runIgnoreCommand({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ref });
      expect(preview.status).toBe(1);
      expect(preview.stdout).toContain("build: allowed preview branch deployment");
      const production = runIgnoreCommand({
        VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: ref,
        VERCEL_GIT_COMMIT_SHA: APPROVED_SHA, TZUDONG_APPROVED_PRODUCTION_SHA: APPROVED_SHA,
      });
      expect(production.status).toBe(0);
      expect(production.stdout).toContain("production deployments are limited to main");
    }
    for (const ref of ["preview", "preview/", "preview/nested/change", "feature/preview", "preview-change"]) {
      expect(runIgnoreCommand({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ref }).status).toBe(0);
    }
  });

  it("applies the same last-successful-build diff guard to requested preview branches", () => {
    withPreviewRepository(({ git, commitFiles, run }) => {
      const previous = git("rev-parse", "HEAD");
      commitFiles({ "docs/notes.md": "documentation only\n" });
      expect(run(previous, { VERCEL_GIT_COMMIT_REF: "preview/map-fix" }).status).toBe(0);
      commitFiles({ "apps/web/app/page.tsx": "application change\n" });
      expect(run(previous, { VERCEL_GIT_COMMIT_REF: "preview/map-fix" }).status).toBe(1);
    });
  });

  it("skips only documented non-app changes since the last successful preview", () => {
    withPreviewRepository(({ git, commitFiles, run }) => {
      const previous = git("rev-parse", "HEAD");
      commitFiles({
        "README.md": "updated guide\n",
        "docs/operations/release.md": "release notes\n",
        ".github/workflows/check.yml": "name: Check\n",
        ".github/ISSUE_TEMPLATE/bug.yml": "name: Bug\n",
        ".github/PULL_REQUEST_TEMPLATE/release.md": "release template\n",
        ".github/dependabot.yml": "version: 2\n",
        ".github/cloudflare/worker.mjs": "export default {};\n",
      });
      const result = run(previous);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("skip: only documentation or independent CI changes since the last successful preview");
    });
  });

  it("builds web, backend bindings, other manifests and unknown inputs", () => {
    withPreviewRepository(({ git, commitFiles, run }) => {
      for (const file of [
        "apps/web/app/page.tsx", "apps/web/package-lock.json", "apps/web/next.config.mjs",
        "apps/web/tests-unit/new.test.ts", "apps/web/performance/report.json",
        "backend/utils/provider-budget.mjs", "backend/utils/provider_budget.py",
        ".github/receipt-ocr-recovery108-sql-successor.v1.json", ".github/scripts/build-input.mjs",
        "package.json", "docs/runtime-input.json", "unknown/input.txt",
      ]) {
        const previous = git("rev-parse", "HEAD");
        commitFiles({ [file]: "changed input\n", "docs/note.md": file });
        const result = run(previous);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("build: allowed preview branch deployment");
      }
    });
  }, 15_000);

  it("does not lose an undeployed app change when the latest commit changes only docs", () => {
    withPreviewRepository(({ git, commitFiles, run }) => {
      const lastSuccessful = git("rev-parse", "HEAD");
      const appChange = commitFiles({ "apps/web/app/page.tsx": "app change\n" });
      commitFiles({ "docs/notes.md": "later documentation\n" });
      expect(run(lastSuccessful).status).toBe(1);
      expect(run(appChange).status).toBe(0);
    });
  });

  it("builds same-SHA redeploys and empty changes for environment-only releases", () => {
    withPreviewRepository(({ git, commitFiles, run }) => {
      const previous = git("rev-parse", "HEAD");
      expect(run(previous).status).toBe(1);
      commitFiles({});
      expect(run(previous).status).toBe(1);
    });
  });

  it("builds when deployment SHAs are missing, malformed, unavailable or inconsistent with HEAD", () => {
    withPreviewRepository(({ git, commitFiles, run }) => {
      const previous = git("rev-parse", "HEAD");
      commitFiles({ "docs/note.md": "docs only\n" });
      for (const env of [
        { VERCEL_GIT_PREVIOUS_SHA: "" }, { VERCEL_GIT_PREVIOUS_SHA: "short" },
        { VERCEL_GIT_PREVIOUS_SHA: "A".repeat(40) }, { VERCEL_GIT_PREVIOUS_SHA: "f".repeat(40) },
        { VERCEL_GIT_COMMIT_SHA: "" }, { VERCEL_GIT_COMMIT_SHA: previous },
      ]) expect(run(previous, env).status).toBe(1);
      const unrelated = git("commit-tree", git("rev-parse", "HEAD^{tree}"), "-m", "unrelated history");
      expect(run(unrelated).status).toBe(1);
    });
  });

  it("keeps both sides of a rename so moving application code into docs still builds", () => {
    withPreviewRepository(({ root, commitFiles, run }) => {
      const previous = commitFiles({ "apps/web/lib/renamed.ts": "export const value = 1;\n" });
      mkdirSync(resolve(root, "docs"), { recursive: true });
      renameSync(resolve(root, "apps/web/lib/renamed.ts"), resolve(root, "docs/renamed.md"));
      commitFiles({});
      expect(run(previous).status).toBe(1);
    });
  });

  it("preserves production authorization and limits path skips to the preview environment", () => {
    withPreviewRepository(({ git, commitFiles, run }) => {
      const previous = git("rev-parse", "HEAD");
      const current = commitFiles({ "docs/note.md": "docs only\n" });
      const allowed = run(previous, {
        VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", TZUDONG_APPROVED_PRODUCTION_SHA: current,
      });
      expect(allowed.status).toBe(1);
      expect(allowed.stdout).toContain("build: production branch deployment");
      const held = run(previous, { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" });
      expect(held.status).toBe(0);
      expect(held.stdout).toContain("production commit lacks matching release authorization");
      expect(run(previous, { VERCEL_ENV: "development" }).status).toBe(1);
    });
  });

  it("skips data, sync, and arbitrary feature branch preview builds", () => {
    for (const ref of ["data", "sync/develop-from-main", "feature/admin-shell"]) {
      const result = runIgnoreCommand({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: ref,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("skip: preview deployments require preview/* or the transition develop lane");
      expect(result.stdout).toContain(`ref=${ref}`);
    }
  });

  it("normalizes full refs and fails closed when the branch is unavailable", () => {
    const fullRefResult = runIgnoreCommand({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "refs/heads/develop",
    });

    expect(fullRefResult.status).toBe(1);
    expect(fullRefResult.stdout).toContain("ref=develop");

    const fallbackRefResult = runIgnoreCommand({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "",
      GITHUB_HEAD_REF: "",
      GITHUB_REF_NAME: "develop",
    });

    expect(fallbackRefResult.status).toBe(1);
    expect(fallbackRefResult.stdout).toContain("ref=develop");

    const headRefPriorityResult = runIgnoreCommand({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "",
      GITHUB_HEAD_REF: "develop",
      GITHUB_REF_NAME: "main",
    });

    expect(headRefPriorityResult.status).toBe(1);
    expect(headRefPriorityResult.stdout).toContain("ref=develop");

    const missingRefResult = runIgnoreCommand({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "",
      GITHUB_HEAD_REF: "",
      GITHUB_REF_NAME: "",
    });

    expect(missingRefResult.status).toBe(0);
    expect(missingRefResult.stdout).toContain("branch ref unavailable; fail closed");
  });
});
