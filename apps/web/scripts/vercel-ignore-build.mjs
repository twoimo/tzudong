import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PRODUCTION_BRANCHES = new Set(["main"]);
// Retain the existing preview lane during the final protected serial transition.
const PREVIEW_BRANCHES = new Set(["develop"]);
// A one-level prefix is an explicit preview request; arbitrary feature and
// dependency branches still do not create Vercel builds.
const PREVIEW_BRANCH_PATTERN = /^preview\/[^/]+$/;
const NON_APP_PREVIEW_FILES = new Set([
  "AGENTS.md", "README.md", "README.ko.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "TASKS.md",
  ".github/dependabot.yml", ".github/CODEOWNERS", ".github/PROMOTION_POLICY.md",
  ".github/PULL_REQUEST_TEMPLATE.md", ".github/pull_request_template.md",
]);

function isNonAppPreviewPath(filePath) {
  if (!filePath || /[\\\x00-\x1f\x7f\ufffd]/.test(filePath)
    || filePath.split("/").some((part) => !part || part === "." || part === "..")) return false;
  // External backend sources participate in the web runtime/source binding.
  // Every web path, other manifest, and unknown path must continue to build.
  return NON_APP_PREVIEW_FILES.has(filePath)
    || /^docs\/.+\.md$/.test(filePath)
    || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(filePath)
    || /^\.github\/ISSUE_TEMPLATE\/.+\.(?:md|ya?ml)$/.test(filePath)
    || /^\.github\/PULL_REQUEST_TEMPLATE\/.+\.md$/.test(filePath)
    || filePath.startsWith(".github/cloudflare/");
}

function readPreviewChangedPaths(env) {
  const previousSha = String(env.VERCEL_GIT_PREVIOUS_SHA ?? "");
  const currentSha = String(env.VERCEL_GIT_COMMIT_SHA ?? "");
  if (!/^[0-9a-f]{40}$/.test(previousSha) || !/^[0-9a-f]{40}$/.test(currentSha)
    || previousSha === currentSha) return null;

  const readGit = (args) => {
    const result = spawnSync("git", args, {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 2_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return !result.error && result.status === 0 ? result.stdout : null;
  };
  if (readGit(["rev-parse", "--verify", "HEAD"])?.trim() !== currentSha) return null;
  // Vercel supplies the last successful deployment for this project/branch.
  // HEAD^ would lose an earlier app change after a failed or skipped build.
  if (readGit(["merge-base", "--is-ancestor", previousSha, currentSha]) === null) return null;
  const output = readGit([
    "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z",
    previousSha, currentSha, "--",
  ]);
  if (!output || !output.endsWith("\0")) return null;
  // NUL delimiters preserve filenames; --no-renames retains both changed paths.
  return output.slice(0, -1).split("\0");
}

function productionGitDeploymentEnabled() {
  try {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    return config.git?.deploymentEnabled?.main === true;
  } catch {
    return false;
  }
}

function normalizeBranchRef(value) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("refs/heads/")) return raw.slice("refs/heads/".length);
  return raw;
}

function resolveBranchRef(env) {
  for (const candidate of [
    env.VERCEL_GIT_COMMIT_REF,
    env.GITHUB_HEAD_REF,
    env.GITHUB_REF_NAME,
  ]) {
    const ref = normalizeBranchRef(candidate);
    if (ref) return ref;
  }
  return "";
}


function getVercelBuildDecision(env) {
  const vercelEnv = String(env.VERCEL_ENV ?? "").trim();
  const ref = resolveBranchRef(env);

  if (!ref) {
    return {
      ignore: true,
      ref,
      reason: "branch ref unavailable; fail closed to prevent non-allowlisted deployments",
      vercelEnv,
    };
  }

  if (vercelEnv === "production") {
    if (PRODUCTION_BRANCHES.has(ref)) {
      if (!productionGitDeploymentEnabled()) {
        return {
          ignore: true,
          ref,
          reason: "production Git deployment held by the reviewed release configuration",
          vercelEnv,
        };
      }
      const approvedSha = String(env.TZUDONG_APPROVED_PRODUCTION_SHA ?? "");
      const currentSha = String(env.VERCEL_GIT_COMMIT_SHA ?? "");
      if (!/^[0-9a-f]{40}$/.test(approvedSha) || approvedSha !== currentSha) {
        return {
          ignore: true,
          ref,
          reason: "production commit lacks matching release authorization",
          vercelEnv,
        };
      }
      return {
        ignore: false,
        ref,
        reason: "production branch deployment",
        vercelEnv,
      };
    }

    return {
      ignore: true,
      ref,
      reason: "production deployments are limited to main; skipping non-production branch",
      vercelEnv,
    };
  }

  if (PREVIEW_BRANCHES.has(ref) || PREVIEW_BRANCH_PATTERN.test(ref)) {
    const changedPaths = vercelEnv === "preview" ? readPreviewChangedPaths(env) : null;
    if (changedPaths?.length && changedPaths.every(isNonAppPreviewPath)) {
      return {
        ignore: true,
        ref,
        reason: "only documentation or independent CI changes since the last successful preview",
        vercelEnv,
      };
    }
    return {
      ignore: false,
      ref,
      reason: "allowed preview branch deployment",
      vercelEnv,
    };
  }

  return {
    ignore: true,
    ref,
    reason: "preview deployments require preview/* or the transition develop lane; skipping non-allowlisted branch",
    vercelEnv,
  };
}

const decision = getVercelBuildDecision(process.env);
const action = decision.ignore ? "skip" : "build";
const environment = decision.vercelEnv || "unknown";
const branch = decision.ref || "unknown";

console.log(`[vercel-ignore-build] ${action}: ${decision.reason} (env=${environment}, ref=${branch})`);

process.exit(decision.ignore ? 0 : 1);
