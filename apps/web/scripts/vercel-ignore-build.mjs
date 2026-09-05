import { readFileSync } from "node:fs";

const PRODUCTION_BRANCHES = new Set(["main"]);
const PREVIEW_BRANCHES = new Set(["develop"]);

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

  if (PREVIEW_BRANCHES.has(ref)) {
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
    reason: "preview deployments are limited to develop; skipping non-production branch",
    vercelEnv,
  };
}

const decision = getVercelBuildDecision(process.env);
const action = decision.ignore ? "skip" : "build";
const environment = decision.vercelEnv || "unknown";
const branch = decision.ref || "unknown";

console.log(`[vercel-ignore-build] ${action}: ${decision.reason} (env=${environment}, ref=${branch})`);

process.exit(decision.ignore ? 0 : 1);
