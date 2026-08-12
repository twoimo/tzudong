import { createHash, createHmac, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "bun:test";
import { G009_ISSUER_PUBLIC_KEY } from "../scripts/assemble-release-visual-evidence.mjs";
import { fetchEvidence, manifestInputKeys, parseJson, publicUrl, validateComponent, validateFreshness, validateReleaseManifest, verifyFinalReceiptCheck, verifyFinalReleaseEvidence, verifyProtectedFinalHealth, verifyRemoteRefs } from "../scripts/verify-final-release-evidence.mjs";

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const REQUIRED_WORKFLOW_PATHS = [
  ".github/workflows/release-governance-ci.yml",
  ".github/workflows/ts7-release-evidence.yml",
  ".github/workflows/privacy-retention.yml",
  ".github/workflows/web-admin-ci.yml",
] as const;
const readRequiredWorkflow = (path: (typeof REQUIRED_WORKFLOW_PATHS)[number]) => {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) throw new Error(`REQUIRED_WORKFLOW_MISSING:${path}`);
  return readFileSync(absolutePath, "utf8");
};
const workflowSources = Object.fromEntries(
  REQUIRED_WORKFLOW_PATHS.map((path) => [path, readRequiredWorkflow(path)]),
) as Record<(typeof REQUIRED_WORKFLOW_PATHS)[number], string>;
const webCi = workflowSources[".github/workflows/web-admin-ci.yml"];
const governanceCi = workflowSources[".github/workflows/release-governance-ci.yml"];
const evidenceCi = workflowSources[".github/workflows/ts7-release-evidence.yml"];
const releaseConfig = read("apps/web/playwright.release.config.ts");
const finalEvidenceValidator = read("apps/web/scripts/verify-final-release-evidence.mjs");

function job(source: string, name: string) {
  const start = source.indexOf(`  ${name}:\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const afterHeader = source.indexOf("\n", start) + 1;
  const nextJob = /^  [A-Za-z0-9_-]+:\s*$/m.exec(source.slice(afterHeader));
  const end = nextJob ? afterHeader + nextJob.index : undefined;
  return source.slice(start, end);
}
const GOVERNANCE_ACTIONS = new Map([
  ["actions/checkout", "de0fac2e4500dabe0009e67214ff5f5447ce83dd"],
  ["actions/setup-node", "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e"],
  ["oven-sh/setup-bun", "0c5077e51419868618aeaa5fe8019c62421857d6"],
  ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
]);

function topLevelJobNames(source: string) {
  expect(source.match(/^jobs:\s*$/gm)).toHaveLength(1);
  const jobsStart = source.indexOf("\njobs:\n");
  expect(jobsStart).toBeGreaterThanOrEqual(0);
  const jobs = source.slice(jobsStart + "\njobs:\n".length);
  return Array.from(jobs.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm), ([, name]) => name);
}

function workflowUses(source: string) {
  const useProperties = source.match(/^\s*(?:-\s+)?uses\s*:/gim) ?? [];
  const uses = Array.from(
    source.matchAll(/^\s*(?:-\s+)?uses\s*:\s*([^\s#]+)(?:\s+#.*)?\s*$/gim),
    (match) => ({ value: match[1], offset: match.index ?? -1 }),
  );
  expect(uses).toHaveLength(useProperties.length);
  return uses;
}
type ParsedWorkflowJob = {
  block: string;
  permissions: string[];
};
type ParsedWorkflow = {
  source: string;
  triggers: string;
  concurrency: string;
  hasPullRequest: boolean;
  rootPermissions: string[];
  jobs: Map<string, ParsedWorkflowJob>;
  uses: Array<{ value: string; step: string }>;
  imageReferences: string[];
};

function parseWorkflowSource(path: (typeof REQUIRED_WORKFLOW_PATHS)[number]): ParsedWorkflow {
  const source = workflowSources[path];
  if (source.includes("\t")) throw new Error(`WORKFLOW_TABS_FORBIDDEN:${path}`);

  const onMatch = /^on:\n/m.exec(source);
  const jobsMarker = "\njobs:\n";
  const jobsStart = source.indexOf(jobsMarker);
  if (!onMatch || jobsStart < 0 || (source.match(/^jobs:\s*$/gm) ?? []).length !== 1) {
    throw new Error(`WORKFLOW_STRUCTURE_INVALID:${path}`);
  }

  const rootBeforeJobs = source.slice(0, jobsStart);
  const concurrent = /^concurrency:\n((?:^  [^\n]+\n?)+)/m.exec(rootBeforeJobs)?.[1];
  if (!concurrent) throw new Error(`WORKFLOW_CONCURRENCY_MISSING:${path}`);
  const concurrencyStart = rootBeforeJobs.indexOf("concurrency:\n");
  const triggers = rootBeforeJobs.slice(onMatch.index + "on:\n".length, concurrencyStart);
  if (concurrencyStart < 0) throw new Error(`WORKFLOW_TRIGGER_STRUCTURE_INVALID:${path}`);

  const jobsSection = source.slice(jobsStart + jobsMarker.length);
  const headers = Array.from(jobsSection.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm));
  if (headers.length === 0) throw new Error(`WORKFLOW_JOBS_MISSING:${path}`);
  const jobs = new Map<string, ParsedWorkflowJob>();
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    const name = header[1];
    const start = header.index ?? -1;
    const end = index + 1 < headers.length ? headers[index + 1].index : undefined;
    const block = jobsSection.slice(start, end);
    const permissionBlocks = Array.from(
      block.matchAll(/^    permissions:\n((?:^      [a-z-]+: [a-z]+\n?)+)/gm),
    );
    if (permissionBlocks.length !== 1) throw new Error(`JOB_PERMISSIONS_INVALID:${path}:${name}`);
    const permissions = Array.from(
      permissionBlocks[0][1].matchAll(/^      ([a-z-]+): ([a-z]+)$/gm),
      ([, scope, access]) => `${scope}: ${access}`,
    );
    if (permissions.length === 0) throw new Error(`JOB_PERMISSIONS_INVALID:${path}:${name}`);
    jobs.set(name, { block, permissions });
  }

  const useProperties = source.match(/^\s*(?:-\s+)?uses\s*:/gim) ?? [];
  const rawUses = Array.from(
    source.matchAll(/^\s*(?:-\s+)?uses\s*:\s*([^\s#]+)(?:\s+#.*)?\s*$/gim),
    (match) => ({ value: match[1], offset: match.index ?? -1 }),
  );
  if (rawUses.length !== useProperties.length) throw new Error(`WORKFLOW_USES_INVALID:${path}`);
  const uses = rawUses.map(({ value, offset }) => {
    const start = source.lastIndexOf("\n      - ", offset);
    const remainder = source.slice(offset + 1);
    const nextStepOffset = remainder.search(/\n      - /);
    const nextJobOffset = remainder.search(/\n  [A-Za-z0-9_-]+:\s*\n/);
    const boundaries = [nextStepOffset, nextJobOffset]
      .filter((boundary) => boundary >= 0)
      .map((boundary) => offset + 1 + boundary);
    const end = boundaries.length > 0 ? Math.min(...boundaries) : undefined;
    if (start < 0) throw new Error(`WORKFLOW_STEP_INVALID:${path}`);
    return { value, step: source.slice(start, end) };
  });

  return {
    source,
    triggers,
    concurrency: concurrent,
    hasPullRequest: /^  pull_request:\s*$/m.test(triggers),
    rootPermissions: source.match(/^permissions:\s*$/gm) ?? [],
    jobs,
    uses,
    imageReferences: Array.from(
      source.matchAll(/^\s*(?:image|container):\s*([^\s#]+)(?:\s+#.*)?\s*$/gm),
      ([, image]) => image,
    ),
  };
}


function validReport(report: unknown, tree: string, profile: string, platform: string, installer: string) {
  const value = report as { releaseId?: unknown; candidate?: Record<string, unknown>; acceptance?: Record<string, unknown> };
  return value.releaseId === tree && value.candidate?.tree === tree && value.candidate?.profile === profile && value.candidate?.platform === platform && value.candidate?.installer === installer && value.acceptance?.passed === true;
}

describe("release workflow governance source contracts", () => {
  it("binds every benchmark lane to its checkout tree and exact external report", () => {
    const lanes = [
      ["ubuntu-npm-authority", "ubuntu-npm", "linux-x64", "npm", 'git -C "$GITHUB_WORKSPACE" rev-parse HEAD^{tree}'],
      ["ubuntu-bun-compatibility", "ubuntu-bun", "linux-x64", "bun", 'git -C "$GITHUB_WORKSPACE/web-bun" rev-parse HEAD^{tree}'],
      ["windows-npm-tooling", "windows-npm", "win32-x64", "npm", "Join-Path $env:GITHUB_WORKSPACE 'web-npm'"],
      ["windows-bun-compatibility", "windows-bun", "win32-x64", "bun", "Join-Path $env:GITHUB_WORKSPACE 'web-bun'"],
    ] as const;
    for (const [name, profile, platform, installer, checkout] of lanes) {
      const lane = job(webCi, name);
      expect(lane).toContain("timeout-minutes: 45");
      expect(lane).toContain(checkout);
      expect(lane).toContain(`--profile ${profile} --release-id`);
      expect(lane).toContain("ts7-release");
      expect(lane).toMatch(new RegExp(`${profile}[/\\\\]report\\.json`));
      expect(lane).toContain("node scripts/verify-typecheck-benchmark-report.mjs");
      expect(lane).toContain(`--profile ${profile}`);
      expect(lane).toContain(`--platform ${platform}`);
      expect(lane).toContain(`--installer ${installer}`);
      expect(lane).not.toContain("workspace-receipt");
      expect(lane).not.toContain("workspace receipt");
      expect(lane).toContain("if-no-files-found: error");
      expect(lane).toContain("if: always()");
      expect(lane).toContain("Fail closed on benchmark evidence");
    }
    expect(webCi).toContain("path: web-npm");
    expect(webCi).toContain("path: web-bun");
  });
  it("pins npm authority before every governed web npm install", () => {
    for (const name of ["ubuntu-npm-authority", "windows-npm-tooling", "admin-address-consistency"]) {
      const lane = job(webCi, name);
      expect(lane.indexOf("npm install --global npm@11.6.2")).toBeLessThan(lane.indexOf("npm ci"));
      expect(lane).toContain("npm --version");
      expect(lane).toContain("11.6.2");
    }
    expect(governanceCi.indexOf("npm install --global npm@11.6.2")).toBeLessThan(governanceCi.indexOf("npm ci"));
    expect(governanceCi).toContain("npm --version");
  });

  it("rejects benchmark reports that are missing or bound to another lane", () => {
    const tree = "a".repeat(40);
    const report = { releaseId: tree, candidate: { tree, profile: "ubuntu-npm", platform: "linux-x64", installer: "npm" }, acceptance: { passed: true } };
    expect(validReport(report, tree, "ubuntu-npm", "linux-x64", "npm")).toBe(true);
    expect(validReport({ ...report, acceptance: { passed: false } }, tree, "ubuntu-npm", "linux-x64", "npm")).toBe(false);
    expect(validReport({ ...report, candidate: { ...report.candidate, tree: "b".repeat(40) } }, tree, "ubuntu-npm", "linux-x64", "npm")).toBe(false);
    expect(validReport({ ...report, candidate: { ...report.candidate, platform: "win32-x64" } }, tree, "ubuntu-npm", "linux-x64", "npm")).toBe(false);
  });

  it("limits remote visual origins to an explicit exact project hostname", () => {
    for (const token of ["RELEASE_VISUAL_TARGET must be remote or localhost", "RELEASE_PUBLIC_EXPECTED_HOSTNAME", "url.hostname !== expectedHostname", "tzudong.app", "www.tzudong.app", "/^tzudong-[a-z0-9-]+\\.vercel\\.app$/", "LOCALHOSTS"]) expect(releaseConfig).toContain(token);
    expect(releaseConfig).toContain("target === 'remote'");
    expect(releaseConfig).toContain("target === 'remote'\n    ?");
    expect(releaseConfig).not.toContain("process.env.RELEASE_PUBLIC_BASE_URL, 'RELEASE_PUBLIC_BASE_URL', false)\n");
  });

  it("gates checks-write publication behind a protected-main non-secret environment", () => {
    expect(evidenceCi).toContain("workflow_dispatch:");
    expect(evidenceCi).not.toMatch(/^\s+(?:pull_request|push|schedule):/m);
    expect(evidenceCi).not.toMatch(/^permissions:\s*$/m);
    const verifier = job(evidenceCi, "verify-release-evidence");
    const protectedLiveHealth = job(evidenceCi, "protected-final-live-health");
    const finalizer = job(evidenceCi, "publish-final-receipt");
    expect(verifier).not.toContain("checks: write");
    expect(verifier).toContain("github.sha == inputs.main_sha");
    expect(protectedLiveHealth).toContain("needs: verify-release-evidence");
    expect(protectedLiveHealth).toContain("environment: production-release-evidence");
    expect(protectedLiveHealth).toContain("github.ref == 'refs/heads/main'");
    expect(protectedLiveHealth).toContain("github.ref_protected");
    expect(protectedLiveHealth).toContain("github.sha == inputs.main_sha");
    expect(protectedLiveHealth).toContain("verifyProtectedFinalHealth");
    expect(protectedLiveHealth).toContain("VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.TS7_VERCEL_AUTOMATION_BYPASS_SECRET }}");
    expect(protectedLiveHealth).not.toMatch(/VERCEL_API_TOKEN|TS7_TRANSITION|SUPABASE_/);
    expect(finalizer).toContain("needs: [verify-release-evidence, protected-final-live-health]");
    expect(finalizer).toContain("environment: protected-main-check-publisher");
    expect(finalizer).toContain("External prerequisite: restrict this environment's deployment branches to protected main only.");
    expect(finalizer).toContain("github.repository == 'twoimo/tzudong'");
    expect(finalizer).toContain("github.ref == 'refs/heads/main'");
    expect(finalizer).toContain("github.ref_protected");
    expect(finalizer).toContain("github.sha == inputs.main_sha");
    expect(finalizer).toContain("needs.verify-release-evidence.outputs.initial_reason == 'VERIFIED'");
    expect(finalizer).toContain("needs.verify-release-evidence.outputs.terminal_reason == 'VERIFIED'");
    expect(finalizer).toContain("needs.protected-final-live-health.outputs.reason == 'VERIFIED'");
    expect(finalizer).not.toContain("if: always()");
    expect(finalizer).toContain("checks: write");
    expect(finalizer).toContain("verifyFinalReceiptCheck");
    expect(finalizer).toContain("PROTECTED_LIVE_OUTCOME");
    expect(finalizer).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(evidenceCi).not.toMatch(/pull-requests:|actions: read|id-token:|vercel\s+(?:deploy|promote|rollback)\b|--admin/i);
    expect(verifier).toContain("ref: ${{ github.sha }}");
    expect(verifier).not.toContain("ref: ${{ inputs.main_sha }}");
    expect(finalizer).toContain("contents: read");
    expect(finalizer).toContain("actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd");
    expect(finalizer).toContain("ref: ${{ github.sha }}");
    expect(finalizer).toContain("persist-credentials: false");
    expect(finalizer).toContain("import(`${process.env.GITHUB_WORKSPACE}/apps/web/scripts/verify-final-release-evidence.mjs`)");
    for (const token of ["github.rest.repos.getBranch", "refsMatch", "outputsValid", "VERIFY_JOB_RESULT", "UPLOAD_OUTCOME", "AbortSignal.timeout(5000)", "freshAndExact", "status: \"in_progress\"", "strictFinalizerJson", "16384", "terminalAuthenticated", "trustedHosts", "x-vercel-protection-bypass", "PROTECTED_LIVE_OUTCOME"]) expect(finalEvidenceValidator).toContain(token);
    expect(finalEvidenceValidator.indexOf("terminalAuthenticated")).toBeLessThan(finalEvidenceValidator.indexOf("x-vercel-protection-bypass"));
    expect(verifier).toContain("- id: upload");
    expect(verifier).toContain("upload_outcome: ${{ steps.upload.outcome }}");
  });

  it("uses bounded immutable component fetches and validates the real artifact contracts", () => {
    const verifier = job(evidenceCi, "verify-release-evidence");
    for (const token of ["timeout: 5000", "setTimeout", "262144", "response.headers.location", "raw.githubusercontent.com", "release-evidence.tzudong.app", "release-visual-verification", "performance-backlog-scored.v2", "revocationOperationId", "revocationBindingSha256", "authProofSha256", "read_release_auth_revocation_by_operation", "SUPABASE_REVOCATION_RPC_URL", "COMPONENT_HASH_MISMATCH", "COMPONENT_SCHEMA_INVALID"]) expect(finalEvidenceValidator).toContain(token);
    expect(finalEvidenceValidator).not.toContain("sanitizerApproved");
    expect(finalEvidenceValidator).not.toContain("nonSensitive");
    expect(finalEvidenceValidator).toContain("const rootKeys =");
    expect(finalEvidenceValidator).toContain("finalBundle.kind !== \"ts7-release-evidence-v1\"");
    expect(finalEvidenceValidator).not.toContain('"receiptSha256", ...Object.keys(detached)');
    expect(finalEvidenceValidator).toContain('publicUrl(bundle.url, ["release-evidence.tzudong.app"]');
    expect(finalEvidenceValidator).toContain("terminalEvent.observedAt");
    expect(verifier).toContain("node apps/web/scripts/verify-final-release-evidence.mjs");
    expect(evidenceCi).not.toContain("<<:");
    expect(evidenceCi).not.toContain("&evidence_env");
    expect(evidenceCi).not.toContain("visual_verification_bundle_url");
    expect(finalEvidenceValidator).toContain("VERCEL_GITHUB_CREATOR");
    expect(finalEvidenceValidator).toContain('const VERCEL_GITHUB_APP_ID = "8329"');
    expect(finalEvidenceValidator).toContain("id: 35613825");
    expect(finalEvidenceValidator).toContain('environment: "Preview"');
    expect(finalEvidenceValidator).toContain("performed_via_github_app");
    expect(finalEvidenceValidator).toContain('publicUrl(component.url, ["release-evidence.tzudong.app"]');
    expect(finalEvidenceValidator).toContain("github.rest.checks.update");
    expect(finalEvidenceValidator).toContain("vercel_deployment:");
    expect(finalEvidenceValidator).toContain("x-vercel-protection-bypass");
    expect(finalEvidenceValidator).toContain("vercel_project");
    expect(finalEvidenceValidator).toContain("v9/projects");
    expect(finalEvidenceValidator).toContain("v4/aliases");
    expect(finalEvidenceValidator).toContain("terminalEvidenceExpiresAt");
    expect(finalEvidenceValidator).toContain("TS7_TRANSITION_HMAC");
    expect(finalEvidenceValidator).toContain("VISUAL_LEDGER_MISMATCH");
    expect(finalEvidenceValidator).not.toContain("release_auth_revocations");
    expect(finalEvidenceValidator).not.toContain("revocationRecordId");
    expect(evidenceCi).toContain("SUPABASE_REVOCATION_RPC_URL");
    expect(finalEvidenceValidator).toContain("SUPABASE_REVOCATION_READ_CAPABILITY");
    expect(finalEvidenceValidator).toContain("aqlcofblfxdrjhhdmarw.supabase.co");
    expect(finalEvidenceValidator).not.toContain("SUPABASE_REVOCATION_SERVICE_ROLE");
  });
  it("pins G009 visual signing and routes revocation reads with a publishable gateway key plus the scoped capability", () => {
    expect(finalEvidenceValidator).toContain('g009-release-visual-verifier-ed25519-2026-07');
    expect(finalEvidenceValidator).toContain("fd0a3adcd714d800cc372274c51cd694515e7f2e6c8eab909f4c9d14fbc79040");
    expect(finalEvidenceValidator).toContain("release-visual-bundle-v3");
    expect(finalEvidenceValidator).toContain("G009_SCREENSHOT_ARTIFACTS");
    expect(finalEvidenceValidator).toContain("checkoutIssuerBinding");
    expect(evidenceCi).toContain("SUPABASE_REVOCATION_READ_CAPABILITY: ${{ secrets.TS7_SUPABASE_REVOCATION_READ_CAPABILITY }}");
    expect(evidenceCi).toContain("SUPABASE_REVOCATION_PUBLISHABLE_GATEWAY_KEY: ${{ vars.TS7_SUPABASE_REVOCATION_PUBLISHABLE_GATEWAY_KEY }}");
    expect(finalEvidenceValidator).toContain("apikey: revocationGatewayKey");
    expect(finalEvidenceValidator).toContain("publishableGatewayKey");
    expect(finalEvidenceValidator).toContain("SUPABASE_SERVICE_ROLE");
    expect(finalEvidenceValidator).toContain("result.capturedAt * 1000 > revokedAt");
    expect(finalEvidenceValidator).toContain("revokedAt > (now + 60) * 1000");
    expect(evidenceCi).toContain("SUPABASE_REVOCATION_RPC_URL: https://aqlcofblfxdrjhhdmarw.supabase.co/rest/v1/rpc/read_release_auth_revocation_by_operation");
    expect(evidenceCi).not.toContain("SUPABASE_REVOCATION_SERVICE_ROLE");
    expect(evidenceCi).not.toMatch(/SUPABASE_(?:SERVICE_ROLE|API_KEY)/);
  });

  it("dispatches a detached immutable manifest with identical trust inputs", () => {
    const inputs = Array.from(evidenceCi.matchAll(/^      ([a-z0-9_]+): \{ description:/gm), ([, name]) => name);
    expect(inputs).toEqual(["release_id", "main_sha", "release_tree", "manifest_url", "manifest_sha256"]);
    expect(inputs).toHaveLength(5);
    const initial = job(evidenceCi, "verify-release-evidence").match(/- id: initial[\s\S]*?run: node apps\/web\/scripts\/verify-final-release-evidence\.mjs/)?.[0] ?? "";
    const terminal = job(evidenceCi, "verify-release-evidence").match(/- id: terminal[\s\S]*?run: node apps\/web\/scripts\/verify-final-release-evidence\.mjs/)?.[0] ?? "";
    const envMap = (step: string) => Object.fromEntries(Array.from(step.matchAll(/^          ([A-Z0-9_]+):\s+(.+)$/gm), ([, name, value]) => [name, value]).filter(([name]) => name !== "FINAL_BUNDLE_PATH"));
    expect(envMap(initial)).toEqual(envMap(terminal));
    expect(Object.keys(envMap(initial))).toContain("MANIFEST_SHA256");
    expect(terminal).toContain("FINAL_BUNDLE_PATH: ${{ runner.temp }}/ts7-release-evidence.json");
  });

  it("rejects real visual, standalone-auth, and scored-backlog mutations", () => {
    const canonical = (value: unknown): string => {
      if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
      return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
    };
    const expected = { releaseId: "ts7-release-1", mainSha: "a".repeat(40), releaseTree: "b".repeat(40), productionDeploymentId: "dpl_123", certificationId: "c".repeat(64), visualDomainReceiptSha256: "d".repeat(64), visualBundleSha256: "e".repeat(64), authDomainReceiptSha256: { "preview-admin-auth-smoke-metadata": "1".repeat(64), "production-admin-auth-smoke-metadata": "2".repeat(64), "alias-admin-auth-smoke-metadata": "3".repeat(64) }, domainReceiptSha256: "", deploymentReceiptSha256: "8".repeat(64), deploymentId: "dpl_123", deploymentEnvironment: "production", host: "tzudong-a.vercel.app", aliasHost: "tzudong.app", observedAt: 1, origin: "https://tzudong.app", issuedAt: 1, expiresAt: 2, now: 1 };
    const legacyVisual = { schemaVersion: 1, kind: "legacy-release-visual-verification", claim: "legacy-visual-evidence", releaseId: expected.releaseId, certificationId: expected.certificationId, gitSha: expected.mainSha, verifiedAt: 1, ledgerSha256: "4".repeat(64), bundleSha256: expected.visualBundleSha256, authReceiptSha256: expected.authDomainReceiptSha256, receiptSha256: "d".repeat(64) };
    expect(validateComponent("visualReceipt", Buffer.from(`${canonical(legacyVisual)}\n`), expected)).toBe(false);
    expect(finalEvidenceValidator).toContain("release-visual-verification-v3");
    expect(finalEvidenceValidator).toContain("G009-release-visual-evidence-v1");
    expect(finalEvidenceValidator).toContain("G009_VERIFIER_PUBLIC_KEY");
    expect(finalEvidenceValidator).toContain("verify(null");
    const backlog = { schemaVersion: "performance-backlog-scored.v2", releaseId: expected.releaseId, candidate: { sha: expected.mainSha, tree: expected.releaseTree }, configSha256: "5".repeat(64), dataProfileSha256: "6".repeat(64), frozenAsOf: "2026-01-01T00:00:00.000000Z", generatedAt: "2026-01-01T00:00:00.000000Z", raw: { path: "performance/raw.json", sha256: "7".repeat(64) }, releaseBlocked: false, ranking: { eligibleCount: 0, admittedIds: [], deferredIds: [] }, items: [] };
    expect(validateComponent("backlog", Buffer.from(`${canonical(backlog)}\n`), expected)).toBe(true);
    expect(validateComponent("backlog", Buffer.from(`${canonical({ ...backlog, releaseBlocked: true })}\n`), expected)).toBe(false);
    const result = { ok: true, reasonCode: "OK", authProofSha256: "a".repeat(64), revocationOperationId: "11111111-1111-4111-8111-111111111111", revocationBindingSha256: "", revocationReceipt: "b".repeat(64), shellHeight: 1, shellWidth: 1, headingCount: 1, navigationCount: 1, status: 200, capturedAt: 1 };
    result.revocationBindingSha256 = createHash("sha256").update(`tzudong:release-auth-revocation-binding:v1\n${canonical({ releaseId: expected.releaseId, certificationId: expected.certificationId, gitSha: expected.mainSha, cellId: "alias-admin-auth-smoke-metadata", origin: "https://tzudong.app/", challenge: "A".repeat(43), issuedAt: 1, expiresAt: 2, deploymentReceiptSha256: "8".repeat(64), capturedAt: 1, authProofSha256: result.authProofSha256, revocationOperationId: result.revocationOperationId, outcome: "certified" })}`).digest("hex");
    const payload = { release: { releaseId: expected.releaseId, certificationId: expected.certificationId, gitSha: expected.mainSha, challenge: "A".repeat(43), issuedAt: 1, expiresAt: 2 }, cell: { id: "alias-admin-auth-smoke-metadata", environment: "alias", route: "/admin", origin: "https://tzudong.app/", finalUrl: "https://tzudong.app/admin" }, deployment: { receiptSha256: "8".repeat(64), deploymentId: expected.productionDeploymentId, environment: "production", host: "tzudong-a.vercel.app", aliasHost: "tzudong.app", observedAt: 1 }, result };
    const auth = { schemaVersion: 2, id: "alias-admin-auth-smoke-metadata", status: "required", execution: "standalone-auth", evidence: "metadata-only", artifact: "metadata-only", sha256: "metadata-only", metadata: { receiptVersion: 1, receiptSha256: createHash("sha256").update(`tzudong:release-auth-receipt:v1\n${canonical(payload)}`).digest("hex"), payload } };
    expect(validateComponent("authAlias", Buffer.from(JSON.stringify(auth)), { ...expected, domainReceiptSha256: auth.metadata.receiptSha256 })).toBe(true);
    const revokedPayload = { ...payload, result: { ...payload.result, revocationOperationId: "invalid" } };
    const revokedAuth = { ...auth, metadata: { ...auth.metadata, receiptSha256: createHash("sha256").update(`tzudong:release-auth-receipt:v1\n${canonical(revokedPayload)}`).digest("hex"), payload: revokedPayload } };
    expect(validateComponent("authAlias", Buffer.from(JSON.stringify(revokedAuth)), { ...expected, domainReceiptSha256: revokedAuth.metadata.receiptSha256 })).toBe(false);
    const legacyPayload = { ...payload, result: { ...payload.result, revocationRecordId: "legacy" } };
    const legacyAuth = { ...auth, metadata: { ...auth.metadata, receiptSha256: createHash("sha256").update(`tzudong:release-auth-receipt:v1\n${canonical(legacyPayload)}`).digest("hex"), payload: legacyPayload } };
    expect(validateComponent("authAlias", Buffer.from(JSON.stringify(legacyAuth)), { ...expected, domainReceiptSha256: legacyAuth.metadata.receiptSha256 })).toBe(false);
  });
  it("accepts GitHub Raw text/plain only without redirects and bounds injected responses", async () => {
    const response = (status: number, contentType: string, body: string, location?: string) => {
      const listeners = new Map<string, ((value?: any) => void)[]>();
      const stream: any = { statusCode: status, headers: { "content-type": contentType, ...(location ? { location } : {}) }, resume() {}, on(name: string, listener: (value?: any) => void) { listeners.set(name, [...(listeners.get(name) ?? []), listener]); return stream; }, destroy(error: Error) { for (const listener of listeners.get("error") ?? []) listener(error); } };
      queueMicrotask(() => { for (const listener of listeners.get("data") ?? []) listener(Buffer.from(body)); for (const listener of listeners.get("end") ?? []) listener(); });
      return stream;
    };
    const request = (status: number, type: string, body: string, location?: string) => (_url: URL, _options: unknown, callback: (stream: any) => void) => { const handle: any = { on() { return handle; }, end() { callback(response(status, type, body, location)); } }; return handle; };
    await expect(fetchEvidence("https://raw.githubusercontent.com/twoimo/tzudong/" + "a".repeat(40) + "/receipt.json", { request: request(200, "text/plain; charset=utf-8", "{}") as any })).resolves.toEqual(Buffer.from("{}"));
    await expect(fetchEvidence("https://raw.githubusercontent.com/twoimo/tzudong/" + "a".repeat(40) + "/receipt.json", { request: request(302, "text/plain", "{}", "/other") as any })).rejects.toMatchObject({ code: "EVIDENCE_FETCH_FAILED" });
    await expect(fetchEvidence("https://raw.githubusercontent.com/twoimo/tzudong/" + "a".repeat(40) + "/receipt.json", { request: request(200, "text/plain", "x".repeat(262145)) as any })).rejects.toMatchObject({ code: "EVIDENCE_FETCH_FAILED" });
  });
  it("rejects GitHub Raw JSON MIME and stale or future evidence", async () => {
    const request = (_url: URL, _options: unknown, callback: (stream: any) => void) => { const stream: any = { statusCode: 200, headers: { "content-type": "application/json" }, resume() {}, on() { return stream; } }; const handle: any = { on() { return handle; }, end() { callback(stream); } }; return handle; };
    await expect(fetchEvidence("https://raw.githubusercontent.com/twoimo/tzudong/" + "a".repeat(40) + "/receipt.json", { request: request as any })).rejects.toMatchObject({ code: "EVIDENCE_FETCH_FAILED" });
    expect(validateFreshness({ issuedAt: 100, observedAt: 100, capturedAt: 101, verifiedAt: 102, expiresAt: 200 }, 150)).toBe(true);
    expect(validateFreshness({ issuedAt: 100, observedAt: 100, capturedAt: 101, verifiedAt: 102, expiresAt: 200 }, 201)).toBe(false);
    expect(validateFreshness({ issuedAt: 100, observedAt: 300, capturedAt: 301, verifiedAt: 302, expiresAt: 400 }, 100)).toBe(false);
  });
  it("rejects manifest identity overrides, escaped duplicate keys, and mismatched content-addressed URLs", () => {
    const expected = {
      releaseId: "ts7-release-1",
      mainSha: "a".repeat(40),
      releaseTree: "b".repeat(40),
    };
    const inputs = Object.fromEntries(
      manifestInputKeys.map((key) => [key, "fixture"]),
    );
    const manifest = {
      schemaVersion: 1,
      ...expected,
      inputs,
    };
    expect(validateReleaseManifest(manifest, expected)).toEqual(inputs);
    expect(() =>
      validateReleaseManifest(
        { ...manifest, inputs: { ...inputs, EXPECTED_SHA: "c".repeat(40) } },
        expected,
      ),
    ).toThrow("INPUT_GRAMMAR_INVALID");
    const missing = { ...inputs };
    delete missing.PREVIEW_HOST;
    expect(() =>
      validateReleaseManifest({ ...manifest, inputs: missing }, expected),
    ).toThrow("INPUT_GRAMMAR_INVALID");
    expect(() =>
      parseJson(
        Buffer.from('{"id":1,"\\u0069d":2}'),
        "RECEIPT_JSON_INVALID",
      ),
    ).toThrow("RECEIPT_JSON_INVALID");
    for (const malformed of ['\ufeff{"id":1}', '{"id":1}\r\n', '{"id":1} trailing']) {
      expect(() => parseJson(Buffer.from(malformed), "RECEIPT_JSON_INVALID")).toThrow("RECEIPT_JSON_INVALID");
    }
    expect(() =>
      publicUrl(
        `https://release-evidence.tzudong.app/releases/${"c".repeat(64)}.json`,
        ["release-evidence.tzudong.app"],
        true,
        expected.mainSha,
        "d".repeat(64),
      ),
    ).toThrow("COMPONENT_URL_INVALID");
  });
  it("rejects a moved main ref even when every remote tree is unchanged", () => {
    const sha = "a".repeat(40);
    const tree = "b".repeat(40);
    const stable = (_command: string, ref: string) => ref === "origin/main" ? sha : tree;
    expect(() => verifyRemoteRefs(sha, tree, stable)).not.toThrow();
    const sameTreeMovedMain = (_command: string, ref: string) => ref === "origin/main" ? "c".repeat(40) : tree;
    expect(() => verifyRemoteRefs(sha, tree, sameTreeMovedMain)).toThrow("CHECKOUT_IDENTITY_MISMATCH");
  });

  it("fails closed on required workflow security invariants", () => {
    const workflows = new Map(
      REQUIRED_WORKFLOW_PATHS.map((path) => [path, parseWorkflowSource(path)]),
    );
    expect([...workflows.keys()]).toEqual([...REQUIRED_WORKFLOW_PATHS]);

    const expectedJobPermissions: Record<(typeof REQUIRED_WORKFLOW_PATHS)[number], Record<string, string[]>> = {
      ".github/workflows/release-governance-ci.yml": {
        "governance-contract": ["contents: read"],
      },
      ".github/workflows/ts7-release-evidence.yml": {
        "verify-release-evidence": ["contents: read"],
        "protected-final-live-health": ["contents: read"],
        "publish-final-receipt": ["checks: write", "contents: read"],
      },
      ".github/workflows/privacy-retention.yml": {
        retain: ["contents: read"],
      },
      ".github/workflows/web-admin-ci.yml": {
        "dependency-modernization-proof": ["contents: read"],
        "ubuntu-npm-authority": ["contents: read"],
        "ubuntu-bun-compatibility": ["contents: read"],
        "windows-npm-tooling": ["contents: read"],
        "windows-bun-compatibility": ["contents: read"],
        "admin-address-consistency": ["contents: read"],
      },
    };

    for (const [path, workflow] of workflows) {
      expect(workflow.source).not.toMatch(/^\s*pull_request_target\s*:/m);
      expect(workflow.rootPermissions).toEqual([]);
      expect(workflow.concurrency).toMatch(/^  group: \S.+\n  cancel-in-progress: (?:true|false)\n?$/);
      expect([...workflow.jobs.keys()]).toEqual(Object.keys(expectedJobPermissions[path]));
      for (const [name, expectedPermissions] of Object.entries(expectedJobPermissions[path])) {
        expect(workflow.jobs.get(name)?.permissions).toEqual(expectedPermissions);
      }

      expect(workflow.uses.length).toBeGreaterThan(0);
      for (const { value } of workflow.uses) {
        expect(value).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/);
      }
      for (const image of workflow.imageReferences) {
        expect(image).toMatch(/^[A-Za-z0-9./_-]+@sha256:[a-f0-9]{64}$/);
      }
      expect(workflow.source).not.toMatch(/^\s*id-token:\s*[a-z]+\s*$/m);
      expect(workflow.source).not.toMatch(/\bactions\/attest-[^@\s]+@/);
      expect(workflow.source).not.toMatch(/^\s*(?:attest|provenance):/m);

      const checkouts = workflow.uses.filter(({ value }) => value.startsWith("actions/checkout@"));
      for (const checkout of checkouts) {
        expect(checkout.step).toContain("persist-credentials: false");
      }
      if (workflow.hasPullRequest) {
        expect(checkouts.length).toBeGreaterThan(0);
        for (const checkout of checkouts) {
          expect(checkout.step).toContain("ref: ${{ github.event.pull_request.head.sha || github.sha }}");
        }
      }

      const artifacts = workflow.uses.filter(({ value }) => value.startsWith("actions/upload-artifact@"));
      for (const artifact of artifacts) {
        expect(artifact.step).toContain("if-no-files-found: error");
        expect(artifact.step).toMatch(/\n          retention-days: [1-9][0-9]*\n?$/);
        expect(artifact.step).not.toMatch(/(?:secrets\.|(?:TOKEN|SECRET|CAPABILITY|PASSWORD|COOKIE))/i);
      }
    }

    const governance = workflows.get(".github/workflows/release-governance-ci.yml")!;
    expect(governance.triggers).toBe("  pull_request:\n  push:\n    branches: [main, develop, data]\n\n");
    const governanceJob = governance.jobs.get("governance-contract")!.block;
    expect(governanceJob).toContain("EXPECTED_SHA: ${{ github.event.pull_request.head.sha || github.sha }}");
    expect(governanceJob).toContain('test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"');
    expect(governanceJob).toContain('test "$(git rev-parse HEAD^{tree})" = "$(git rev-parse "$EXPECTED_SHA^{tree}")"');
    const web = workflows.get(".github/workflows/web-admin-ci.yml")!;
    expect(web.imageReferences).toEqual([
      "postgres@sha256:be01cf82fc7dbba824acf0a82e150b4b360f3ff93c6631d7844af431e841a95c",
    ]);

    const evidence = workflows.get(".github/workflows/ts7-release-evidence.yml")!;
    const verifier = evidence.jobs.get("verify-release-evidence")!.block;
    expect(verifier).toContain("github.sha == inputs.main_sha");
    expect(verifier).toContain("EXPECTED_SHA: ${{ inputs.main_sha }}");
    expect(verifier).toContain("MANIFEST_SHA256: ${{ inputs.manifest_sha256 }}");
    expect(verifier).toContain("Verify final bundle digest before retention");
    expect(verifier).toContain("sha256sum --check --status");
    expect(verifier).toContain("steps.verify-bundle-digest.outcome == 'success'");
    expect(verifier).toContain("${{ runner.temp }}/ts7-release-evidence.json.sha256");
    for (const checkout of evidence.uses.filter(({ value }) => value.startsWith("actions/checkout@"))) {
      expect(checkout.step).toContain("ref: ${{ github.sha }}");
    }
    for (const name of ["verify-release-evidence", "protected-final-live-health", "publish-final-receipt"]) {
      expect(evidence.jobs.get(name)!.block).toMatch(/^\s{4}environment:/m);
    }

    const privacy = workflows.get(".github/workflows/privacy-retention.yml")!;
    expect(privacy.triggers).toContain("schedule:");
    expect(privacy.triggers).toContain("workflow_dispatch:\n    inputs:\n      dry_run:");
    expect(privacy.hasPullRequest).toBe(false);
    const retain = privacy.jobs.get("retain")!.block;
    expect(retain).toContain("github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.dry_run == true)");
    expect(retain).toMatch(/^    environment:\n      name: production-retention$/m);
    expect(retain).toContain("Run scheduled privacy retention");
    const manualDryRun = retain.match(/      - name: Run manual privacy retention dry run[\s\S]*?(?=\n      - |\n?$)/)?.[0] ?? "";
    expect(manualDryRun).toContain("action: 'preview'");
    expect(manualDryRun).not.toContain("action: 'apply'");
    expect(manualDryRun).toContain("PRIVACY_RETENTION_DRY_RUN_FAILED");
    for (const checkout of privacy.uses.filter(({ value }) => value.startsWith("actions/checkout@"))) {
      expect(checkout.step).toContain("ref: ${{ github.sha }}");
    }
  });

  it("retains the approved governance action and artifact contract", () => {
    expect(topLevelJobNames(governanceCi)).toEqual(["governance-contract"]);
    const uses = workflowUses(governanceCi);
    expect(uses).toHaveLength(GOVERNANCE_ACTIONS.size);
    const actionIdentities = uses.map(({ value }) => value.split("@", 1)[0]);
    expect(actionIdentities).toEqual([...GOVERNANCE_ACTIONS.keys()]);
    for (const { value } of uses) {
      const [identity, sha, ...extra] = value.split("@");
      expect(extra).toHaveLength(0);
      expect(sha).toBe(GOVERNANCE_ACTIONS.get(identity));
      expect(value).toBe(`${identity}@${GOVERNANCE_ACTIONS.get(identity)}`);
    }
    const upload = uses.find(({ value }) => value.startsWith("actions/upload-artifact@"));
    const uploadOffset = upload?.offset;
    expect(uploadOffset).toBeDefined();
    const uploadStart = governanceCi.lastIndexOf("\n      - ", uploadOffset);
    const uploadEnd = governanceCi.indexOf("\n      - ", uploadOffset);
    const uploadStep = governanceCi.slice(uploadStart, uploadEnd === -1 ? undefined : uploadEnd);
    expect(uploadStep).toContain("${{ runner.temp }}/performance-governance/backlog.scored.json");
    expect(uploadStep).toContain("${{ runner.temp }}/performance-governance/backlog.scored.json.sha256");
    expect(uploadStep).toContain("retention-days: 7");
  });
  it("executes the injected verifier graph with provider-backed evidence", async () => {
    const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
    const digest = (value: any, prefix = "") => createHash("sha256").update(`${prefix}${typeof value === "string" ? value : canonical(value)}`).digest("hex");
    const bytes = (value: any, canonicalize = true) => Buffer.from(`${canonicalize ? canonical(value) : JSON.stringify(value)}\n`);
    const sha = "a".repeat(40);
    const tree = "b".repeat(40);
    const knownSha = "c".repeat(40);
    const certification = "d".repeat(64);
    const releaseId = "ts7-release-graph";
    const transitionSecret = "provider-transition-secret-0123456789abcdef";
    const visualVerifierPrivateKey = createPrivateKey({ key: { crv: "Ed25519", d: "xaqN9D-fg3vtt0QvMdy3sWbThTUHbwlLhc46LgtEWPc", x: "_FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU", kty: "OKP" }, format: "jwk" });
    const visualVerifierPublicKey = createPublicKey(visualVerifierPrivateKey).export({ type: "spki", format: "pem" }).toString();
    expect(visualVerifierPublicKey).not.toBe(G009_ISSUER_PUBLIC_KEY);
    const deployment = (id: string, gitSha: string, host: string, environment = "production") => ({ schemaVersion: 2, releaseId, certificationId: certification, project: "tzudong", projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", orgId: "team_OUj64KeLxJI3PkEbOaFZnorA", teamSlug: "twoimos-projects", framework: "nextjs", environment, deploymentId: id, gitSha, host, aliasHost: environment === "production" ? (id === "dpl_Known" ? host : "tzudong.app") : host, observedAt: 100, expiresAt: 900 });
    const preview = deployment("dpl_Preview", sha, "tzudong-preview.vercel.app", "preview");
    const production = deployment("dpl_Production", sha, "tzudong-production.vercel.app");
    const knownGood = deployment("dpl_Known", knownSha, "tzudong-known.vercel.app");
    const domain = (value: any) => digest(value, "tzudong:deployment-receipt:v2\n");
    const pBytes = bytes(preview);
    const prodBytes = bytes(production);
    const knownBytes = bytes(knownGood);
    const revocationReadbacks = new Map<string, any>();
    const auth = (id: string, environment: string, receiptSha256: string, record: any, origin: string, challenge: string, operationId: string) => {
      const result: any = { ok: true, reasonCode: "OK", authProofSha256: digest(id), revocationOperationId: operationId, revocationBindingSha256: "", revocationReceipt: "", shellHeight: 1, shellWidth: 1, headingCount: 1, navigationCount: 1, status: 200, capturedAt: 110 };
      const release = { releaseId, certificationId: certification, gitSha: sha, challenge, issuedAt: 100, expiresAt: 900 };
      const cell = { id, environment, route: "/admin", origin: `${origin}/`, finalUrl: `${origin}/admin` };
      const deployment = { receiptSha256, deploymentId: record.deploymentId, environment: record.environment, host: record.host, aliasHost: record.aliasHost, observedAt: 100 };
      result.revocationBindingSha256 = digest({ releaseId, certificationId: certification, gitSha: sha, cellId: id, origin: cell.origin, challenge, issuedAt: 100, expiresAt: 900, deploymentReceiptSha256: receiptSha256, capturedAt: result.capturedAt, authProofSha256: result.authProofSha256, revocationOperationId: result.revocationOperationId, outcome: "certified" }, "tzudong:release-auth-revocation-binding:v1\n");
      const readback = { schemaVersion: 1, operationId, bindingSha256: result.revocationBindingSha256, status: "revoked_verified", refreshTokensDeleted: 1, sessionsDeleted: 1, sessionAbsent: true, refreshTokensAbsent: true, revokedAt: "1970-01-01T00:02:00.000Z" };
      result.revocationReceipt = digest(readback, "tzudong:release-auth-revocation:v1\n");
      revocationReadbacks.set(operationId, readback);
      const payload = { release, cell, deployment, result };
      return { schemaVersion: 2, id, status: "required", execution: "standalone-auth", evidence: "metadata-only", artifact: "metadata-only", sha256: "metadata-only", metadata: { receiptVersion: 1, receiptSha256: digest(payload, "tzudong:release-auth-receipt:v1\n"), payload } };
    };
    const ap = auth("preview-admin-auth-smoke-metadata", "preview", domain(preview), preview, "https://tzudong-preview.vercel.app", "A".repeat(43), "11111111-1111-4111-8111-111111111111");
    const ao = auth("production-admin-auth-smoke-metadata", "production", domain(production), production, "https://tzudong-production.vercel.app", "B".repeat(43), "22222222-2222-4222-8222-222222222222");
    const aa = auth("alias-admin-auth-smoke-metadata", "alias", domain(production), production, "https://tzudong.app", "C".repeat(43), "33333333-3333-4333-8333-333333333333");
    const apBytes = bytes(ap, false);
    const aoBytes = bytes(ao, false);
    const aaBytes = bytes(aa, false);
    const authDomains = { "preview-admin-auth-smoke-metadata": ap.metadata.receiptSha256, "production-admin-auth-smoke-metadata": ao.metadata.receiptSha256, "alias-admin-auth-smoke-metadata": aa.metadata.receiptSha256 };
    const backlog = { schemaVersion: "performance-backlog-scored.v2", releaseId, candidate: { sha, tree }, configSha256: "1".repeat(64), dataProfileSha256: "2".repeat(64), frozenAsOf: "2026-01-01T00:00:00.000000Z", generatedAt: "2026-01-01T00:00:00.000000Z", raw: { path: "performance/raw.json", sha256: "3".repeat(64) }, releaseBlocked: false, ranking: { eligibleCount: 0, admittedIds: [], deferredIds: [] }, items: [] };
    const backlogBytes = bytes(backlog);
    const issuerPaths = ["playwright.release.config.ts", "scripts/assemble-release-visual-evidence.mjs", "scripts/run-release-visual-evidence.mjs", "scripts/verify-release-visual-evidence.mjs", "tests/release-visual-cells.template.json", "tests/release-visual.spec.ts"];
    const executableDigests = Object.fromEntries(issuerPaths.map((name) => [name, digest(read(`apps/web/${name}`))]));
    const issuerManifest = { schemaVersion: 1, commitSha: sha, treeSha: tree, executableDigests };
    const issuerBinding = { ...issuerManifest, manifestSha256: digest(issuerManifest) };
    const cellSpecs = [
      ["local-public-home-desktop", "playwright-synthetic", "screenshot", "local-public-home-desktop.png"],
      ["local-synthetic-admin-console", "playwright-synthetic", "screenshot", "local-synthetic-admin-console.png"],
      ["local-reduced-motion", "playwright-synthetic", "screenshot", "local-reduced-motion.png"],
      ["preview-public-home-desktop", "playwright-public", "screenshot", "preview-public-home-desktop.png"],
      ["preview-admin-auth-smoke-metadata", "standalone-auth", "metadata-only", "metadata-only"],
      ["preview-reduced-motion", "playwright-public", "screenshot", "preview-reduced-motion.png"],
      ["production-public-home-desktop", "playwright-public", "screenshot", "production-public-home-desktop.png"],
      ["production-admin-auth-smoke-metadata", "standalone-auth", "metadata-only", "metadata-only"],
      ["production-reduced-motion", "playwright-public", "screenshot", "production-reduced-motion.png"],
      ["alias-public-home-desktop", "playwright-public", "screenshot", "alias-public-home-desktop.png"],
      ["alias-admin-auth-smoke-metadata", "standalone-auth", "metadata-only", "metadata-only"],
      ["alias-reduced-motion", "playwright-public", "screenshot", "alias-reduced-motion.png"],
    ] as const;
    const authById: Record<string, any> = {
      "preview-admin-auth-smoke-metadata": ap.metadata,
      "production-admin-auth-smoke-metadata": ao.metadata,
      "alias-admin-auth-smoke-metadata": aa.metadata,
    };
    const visualFiles: Record<string, string> = {};
    const captureReceipts: Record<string, any> = {};
    const visualCells = cellSpecs.map(([id, execution, evidence, artifact]) => {
      if (evidence === "metadata-only") {
        return { id, status: "required", execution, evidence, artifact, sha256: "metadata-only", captureReceiptSha256: "metadata-only", metadata: authById[id] };
      }
      const environment = id.startsWith("local-") ? "local" : id.startsWith("preview-") ? "preview" : id.startsWith("production-") ? "production" : "alias";
      const route = id === "local-synthetic-admin-console" ? "/admin" : "/";
      const origin = environment === "local" ? "http://localhost:3000" : environment === "preview" ? `https://${preview.host}` : environment === "production" ? `https://${production.host}` : "https://tzudong.app";
      const deploymentId = environment === "local" ? "dpl_local" : environment === "preview" ? preview.deploymentId : production.deploymentId;
      const deploymentReceiptSha256 = environment === "local" ? "9".repeat(64) : environment === "preview" ? domain(preview) : domain(production);
      const artifactSha256 = digest(`artifact:${id}`);
      const metadata = { fixture: id };
      const captureReceipt = {
        version: 1,
        cellId: id,
        environment,
        releaseId,
        certificationId: certification,
        gitSha: sha,
        deploymentId,
        deploymentReceiptSha256,
        origin,
        route,
        finalUrl: new URL(route, `${origin}/`).toString(),
        artifactSha256,
        metadataSha256: digest(canonical(metadata)),
        challenge: createHash("sha256").update(`capture:${id}`).digest("base64url"),
        issuedAt: 100,
        capturedAt: 110,
        expiresAt: 900,
      };
      const captureReceiptSha256 = digest(captureReceipt, "tzudong:release-visual-capture-receipt:v1\n");
      visualFiles[artifact] = artifactSha256;
      captureReceipts[id] = captureReceipt;
      return { id, status: "required", execution, evidence, artifact, sha256: artifactSha256, captureReceiptSha256, metadata };
    });
    const visualLedger = { schemaVersion: 5, templateSha256: "fd0a3adcd714d800cc372274c51cd694515e7f2e6c8eab909f4c9d14fbc79040", cells: visualCells, files: visualFiles, captureReceipts };
    const visualLedgerBytes = bytes(visualLedger);
    const visualBundle = { schemaVersion: 3, kind: "release-visual-bundle-v3", claim: "G009-release-visual-bundle-v1", releaseId, certificationId: certification, gitSha: sha, channelId: "fixture-channel-01", runNonce: "A".repeat(43), channelSha256: "e".repeat(64), issuerBinding, ledgerSha256: digest(visualLedgerBytes.toString()), actualArtifactHashes: visualFiles, authReceiptSha256: authDomains };
    const visualBundleBytes = bytes(visualBundle);
    const visualUnsigned = { schemaVersion: 3, kind: "release-visual-verification-v3", claim: "G009-release-visual-evidence-v1", domainSeparator: "tzudong:g009:release-visual-verification:v3", verifierKeyId: "g009-release-visual-verifier-ed25519-2026-07", releaseId, certificationId: certification, gitSha: sha, verifiedAt: 120, expiresAt: 420, verificationNonce: createHash("sha256").update("verification-nonce").digest("base64url"), channelId: visualBundle.channelId, runNonce: visualBundle.runNonce, channelSha256: visualBundle.channelSha256, issuerBinding, ledgerSha256: digest(visualLedgerBytes.toString()), bundleSha256: digest(visualBundleBytes.toString()), actualArtifactHashes: visualFiles, authReceiptSha256: authDomains };
    const receiptSha256 = digest(visualUnsigned, "tzudong:g009:release-visual-verification:v3\n");
    const visualSigned = { ...visualUnsigned, receiptSha256 };
    const visual = { ...visualSigned, verifierSignature: sign(null, Buffer.from(`tzudong:g009:release-visual-verification:v3\n${canonical(visualSigned)}`), visualVerifierPrivateKey).toString("base64url") };
    const visualBytes = bytes(visual);
    const inputs: any = Object.fromEntries(manifestInputKeys.map((key) => [key, "x"]));
    const url = (hash: string) => `https://release-evidence.tzudong.app/${hash}.json`;
    Object.assign(inputs, {
      GITHUB_DEPLOYMENT_ID: "5378843839",
      KNOWN_GOOD_DEPLOYMENT_ID: knownGood.deploymentId,
      KNOWN_GOOD_GIT_SHA: knownSha,
      KNOWN_GOOD_HOST: knownGood.host,
      KNOWN_GOOD_DEPLOYMENT_DOMAIN_RECEIPT_SHA256: domain(knownGood),
      KNOWN_GOOD_DEPLOYMENT_RECEIPT_SHA256: digest(knownBytes.toString()),
      KNOWN_GOOD_DEPLOYMENT_RECEIPT_URL: url(digest(knownBytes.toString())),
      PREVIEW_DEPLOYMENT_ID: preview.deploymentId,
      PREVIEW_HOST: preview.host,
      PREVIEW_DEPLOYMENT_DOMAIN_RECEIPT_SHA256: domain(preview),
      PREVIEW_DEPLOYMENT_RECEIPT_SHA256: digest(pBytes.toString()),
      PREVIEW_DEPLOYMENT_RECEIPT_URL: url(digest(pBytes.toString())),
      PRODUCTION_DEPLOYMENT_ID: production.deploymentId,
      PRODUCTION_DEPLOYMENT_URL: "https://tzudong-production.vercel.app",
      PRODUCTION_DEPLOYMENT_DOMAIN_RECEIPT_SHA256: domain(production),
      PRODUCTION_ALIAS_DEPLOYMENT_DOMAIN_RECEIPT_SHA256: domain(production),
      PRODUCTION_DEPLOYMENT_RECEIPT_SHA256: digest(prodBytes.toString()),
      PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_SHA256: digest(prodBytes.toString()),
      PRODUCTION_DEPLOYMENT_RECEIPT_URL: url(digest(prodBytes.toString())),
      PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_URL: url(digest(prodBytes.toString())),
      PROMOTION_EVENT_ID: "promotion",
      REPROMOTION_EVENT_ID: "",
      ROLLBACK_EVENT_ID: "",
      ROLLBACK_STATE: "normal",
      VISUAL_CERTIFICATION_ID: certification,
      STANDALONE_AUTH_PREVIEW_DOMAIN_RECEIPT_SHA256: ap.metadata.receiptSha256,
      STANDALONE_AUTH_PRODUCTION_DOMAIN_RECEIPT_SHA256: ao.metadata.receiptSha256,
      STANDALONE_AUTH_ALIAS_DOMAIN_RECEIPT_SHA256: aa.metadata.receiptSha256,
      STANDALONE_AUTH_PREVIEW_RECEIPT_SHA256: digest(apBytes.toString()),
      STANDALONE_AUTH_PRODUCTION_RECEIPT_SHA256: digest(aoBytes.toString()),
      STANDALONE_AUTH_ALIAS_RECEIPT_SHA256: digest(aaBytes.toString()),
      STANDALONE_AUTH_PREVIEW_RECEIPT_URL: url(digest(apBytes.toString())),
      STANDALONE_AUTH_PRODUCTION_RECEIPT_URL: url(digest(aoBytes.toString())),
      STANDALONE_AUTH_ALIAS_RECEIPT_URL: url(digest(aaBytes.toString())),
      VISUAL_DOMAIN_RECEIPT_SHA256: visual.receiptSha256,
      VISUAL_LEDGER_SHA256: digest(visualLedgerBytes.toString()),
      VISUAL_LEDGER_URL: url(digest(visualLedgerBytes.toString())),
      VISUAL_VERIFICATION_BUNDLE_SHA256: digest(visualBundleBytes.toString()),
      VISUAL_VERIFICATION_BUNDLE_URL: url(digest(visualBundleBytes.toString())),
      VISUAL_VERIFICATION_RECEIPT_SHA256: digest(visualBytes.toString()),
      VISUAL_VERIFICATION_RECEIPT_URL: url(digest(visualBytes.toString())),
      SCORED_BACKLOG_SHA256: digest(backlogBytes.toString()),
      SCORED_BACKLOG_URL: url(digest(backlogBytes.toString())),
    });
    const detached: any = { visualVerificationReceiptSha256: inputs.VISUAL_VERIFICATION_RECEIPT_SHA256, visualVerificationBundleSha256: inputs.VISUAL_VERIFICATION_BUNDLE_SHA256, visualDomainReceiptSha256: inputs.VISUAL_DOMAIN_RECEIPT_SHA256, standaloneAuthPreviewReceiptSha256: inputs.STANDALONE_AUTH_PREVIEW_RECEIPT_SHA256, standaloneAuthPreviewDomainReceiptSha256: inputs.STANDALONE_AUTH_PREVIEW_DOMAIN_RECEIPT_SHA256, standaloneAuthProductionReceiptSha256: inputs.STANDALONE_AUTH_PRODUCTION_RECEIPT_SHA256, standaloneAuthProductionDomainReceiptSha256: inputs.STANDALONE_AUTH_PRODUCTION_DOMAIN_RECEIPT_SHA256, standaloneAuthAliasReceiptSha256: inputs.STANDALONE_AUTH_ALIAS_RECEIPT_SHA256, standaloneAuthAliasDomainReceiptSha256: inputs.STANDALONE_AUTH_ALIAS_DOMAIN_RECEIPT_SHA256, scoredBacklogSha256: inputs.SCORED_BACKLOG_SHA256 };
    const finalBundle = { kind: "ts7-release-evidence-v1", releaseId, mainSha: sha, releaseTree: tree, productionDeploymentId: production.deploymentId, knownGoodDeploymentId: knownGood.deploymentId, githubDeploymentId: inputs.GITHUB_DEPLOYMENT_ID, ...detached };
    const finalBytes = bytes(finalBundle);
    const health = (host: string) => ({ ok: true, service: "tzudong-web", releaseId, gitSha: sha, deploymentId: production.deploymentId, projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", host });
    const providerDeployments = {
      preview: { githubDeploymentId: "5378843840", statusId: "637000001", vercelDeploymentId: preview.deploymentId },
      production: { githubDeploymentId: inputs.GITHUB_DEPLOYMENT_ID, statusId: "637000002", vercelDeploymentId: production.deploymentId },
      knownGood: { githubDeploymentId: "5378843841", statusId: "637000003", vercelDeploymentId: knownGood.deploymentId },
    };
    const creator = { login: "vercel[bot]", type: "Bot", id: 35613825 };
    const providerBody = (name: "preview" | "production" | "knownGood", gitSha: string, environment: string, environmentUrl: string) => ({ deployment: { id: Number(providerDeployments[name].githubDeploymentId), sha: gitSha, environment, task: "deploy", creator, performed_via_github_app: null }, statuses: [{ id: Number(providerDeployments[name].statusId), state: "success", environment, environment_url: environmentUrl, deployment_url: `https://api.github.com/repos/twoimo/tzudong/deployments/${providerDeployments[name].githubDeploymentId}`, creator, performed_via_github_app: null, updated_at: "1970-01-01T00:02:00Z" }] });
    const providerBodies = {
      preview: providerBody("preview", sha, "Preview", `https://${preview.host}`),
      production: providerBody("production", sha, "Production", inputs.PRODUCTION_DEPLOYMENT_URL),
      knownGood: providerBody("knownGood", knownSha, "Production", `https://${knownGood.host}`),
    };
    const vercelProject = { id: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", accountId: "team_OUj64KeLxJI3PkEbOaFZnorA", name: "tzudong", rootDirectory: "apps/web", framework: "nextjs", nodeVersion: "24.x", installCommand: "npm ci" };
    const vercelBody = (name: "preview" | "production" | "knownGood", record: any, gitSha: string) => ({ id: providerDeployments[name].vercelDeploymentId, projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", ownerId: "team_OUj64KeLxJI3PkEbOaFZnorA", url: record.host, target: name === "preview" ? null : "production", readyState: "READY", alias: [record.host, `tzudong-git-main-twoimos-projects.vercel.app`, ...(name === "production" ? ["tzudong.app", "www.tzudong.app"] : [])], meta: { githubCommitSha: gitSha, githubCommitRef: "main" } });
    const evidenceBodies: any = { vercel_project: vercelProject, "vercel_alias:tzudong.app": { alias: "tzudong.app", deploymentId: production.deploymentId, projectId: vercelProject.id, createdAt: 100 }, "vercel_alias:www.tzudong.app": { alias: "www.tzudong.app", deploymentId: production.deploymentId, projectId: vercelProject.id, createdAt: 100 } };
    for (const [name, body] of Object.entries(providerBodies)) {
      evidenceBodies[`github_deployment:${name}`] = body.deployment;
      evidenceBodies[`github_deployment_status:${name}`] = body.statuses;
    }
    evidenceBodies["vercel_deployment:preview"] = vercelBody("preview", preview, sha);
    evidenceBodies["vercel_deployment:production"] = vercelBody("production", production, sha);
    evidenceBodies["vercel_deployment:knownGood"] = vercelBody("knownGood", knownGood, knownSha);
    for (const host of ["tzudong-production.vercel.app", "tzudong.app", "www.tzudong.app"]) {
      evidenceBodies[`health:${host}`] = health(host);
      evidenceBodies[`identity:${host}`] = health(host);
    }
    const expectedEvidenceUrl = (kind: string) => kind === "vercel_project"
      ? "https://api.vercel.com/v9/projects/prj_sau35J5uUtShIQ9OKofRtOVVnTSl?teamId=team_OUj64KeLxJI3PkEbOaFZnorA"
      : kind.startsWith("vercel_alias:")
        ? `https://api.vercel.com/v4/aliases/${kind.slice("vercel_alias:".length)}?teamId=team_OUj64KeLxJI3PkEbOaFZnorA`
        : kind.startsWith("github_deployment")
          ? `https://api.github.com/repos/twoimo/tzudong/deployments/${providerDeployments[kind.split(":")[1] as keyof typeof providerDeployments].githubDeploymentId}${kind.startsWith("github_deployment_status") ? "/statuses" : ""}`
          : kind.startsWith("vercel_deployment:")
            ? `https://api.vercel.com/v13/deployments/${providerDeployments[kind.split(":")[1] as keyof typeof providerDeployments].vercelDeploymentId}?teamId=team_OUj64KeLxJI3PkEbOaFZnorA`
            : `https://${kind.split(":")[1]}/api/health`;
    const evidence = Object.entries(evidenceBodies).map(([kind, body]) => ({ kind, url: expectedEvidenceUrl(kind), sha256: digest(bytes(body, false).toString()) }));
    const unsignedEvent = { kind: "promotion", id: "promotion", releaseId, sequence: 1, previousDigest: digest(`tzudong:release-transition:genesis:v1\n${releaseId}`), projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", orgId: "team_OUj64KeLxJI3PkEbOaFZnorA", fromDeploymentId: knownGood.deploymentId, toDeploymentId: production.deploymentId, gitSha: sha, aliases: ["tzudong.app", "www.tzudong.app"], observedAt: 101 };
    const signedEvent = { ...unsignedEvent, signature: createHmac("sha256", transitionSecret).update("tzudong:release-transition:v2\n").update(canonical(unsignedEvent)).digest("hex") };
    const transitionJournalRoot = digest([signedEvent], "tzudong:release-transition-journal:v1\n");
    const receipt: any = { releaseId, mainSha: sha, releaseTree: tree, productionDeploymentId: production.deploymentId, githubDeploymentId: inputs.GITHUB_DEPLOYMENT_ID, productionDeploymentUrl: inputs.PRODUCTION_DEPLOYMENT_URL, knownGoodDeploymentId: knownGood.deploymentId, expectedRollbackState: "normal", derivedRollbackState: "normal", transitionJournalRoot, vercel: { project: "tzudong", projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", orgId: "team_OUj64KeLxJI3PkEbOaFZnorA", teamSlug: "twoimos-projects", rootDirectory: "apps/web", framework: "nextjs", nodeVersion: "24.x", npmVersion: "11.6.2", branch: "main", environment: "production", deploymentId: production.deploymentId, knownGoodDeploymentId: knownGood.deploymentId, gitSha: sha, url: inputs.PRODUCTION_DEPLOYMENT_URL, immutableHost: "tzudong-production.vercel.app", productionAliases: ["tzudong.app", "www.tzudong.app"], health: "healthy", knownGoodEligible: true, observedAt: 100, expiresAt: 900, rollbackState: "normal", automaticProductionDomainAssignment: "normal" }, providerDeployments, events: [signedEvent], previewDeploymentReceiptSha256: inputs.PREVIEW_DEPLOYMENT_RECEIPT_SHA256, productionDeploymentReceiptSha256: inputs.PRODUCTION_DEPLOYMENT_RECEIPT_SHA256, productionAliasDeploymentReceiptSha256: inputs.PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_SHA256, knownGoodDeploymentReceiptSha256: inputs.KNOWN_GOOD_DEPLOYMENT_RECEIPT_SHA256, ...detached, evidence, visualEvidence: { ledger: { url: inputs.VISUAL_LEDGER_URL, sha256: inputs.VISUAL_LEDGER_SHA256 }, bundle: { url: inputs.VISUAL_VERIFICATION_BUNDLE_URL, sha256: inputs.VISUAL_VERIFICATION_BUNDLE_SHA256 } }, finalBundle: { url: url(digest(finalBytes.toString())), sha256: digest(finalBytes.toString()) } };
    const receiptBytes = bytes(receipt);
    const manifest = { schemaVersion: 1, releaseId, mainSha: sha, releaseTree: tree, inputs: { ...inputs, RECEIPT_SHA256: digest(receiptBytes.toString()), RECEIPT_URL: url(digest(receiptBytes.toString())) } };
    const manifestBytes = bytes(manifest);
    const objects = new Map<string, Buffer>([
      [url(digest(manifestBytes.toString())), manifestBytes],
      [manifest.inputs.RECEIPT_URL, receiptBytes],
      [inputs.PREVIEW_DEPLOYMENT_RECEIPT_URL, pBytes],
      [inputs.PRODUCTION_DEPLOYMENT_RECEIPT_URL, prodBytes],
      [inputs.KNOWN_GOOD_DEPLOYMENT_RECEIPT_URL, knownBytes],
      [inputs.STANDALONE_AUTH_PREVIEW_RECEIPT_URL, apBytes],
      [inputs.STANDALONE_AUTH_PRODUCTION_RECEIPT_URL, aoBytes],
      [inputs.STANDALONE_AUTH_ALIAS_RECEIPT_URL, aaBytes],
      [inputs.VISUAL_VERIFICATION_RECEIPT_URL, visualBytes],
      [inputs.VISUAL_LEDGER_URL, visualLedgerBytes],
      [inputs.VISUAL_VERIFICATION_BUNDLE_URL, visualBundleBytes],
      [inputs.SCORED_BACKLOG_URL, backlogBytes],
      [receipt.finalBundle.url, finalBytes],
    ]);
    for (const row of evidence) objects.set(row.url, bytes(evidenceBodies[row.kind], false));
    const env: any = { DISPATCH_REF: "refs/heads/main", WORKFLOW_REF: "twoimo/tzudong/.github/workflows/ts7-release-evidence.yml@refs/heads/main", REPOSITORY: "twoimo/tzudong", RELEASE_ID: releaseId, EXPECTED_SHA: sha, EXPECTED_TREE: tree, DISPATCH_SHA: sha, MANIFEST_URL: url(digest(manifestBytes.toString())), MANIFEST_SHA256: digest(manifestBytes.toString()), VERCEL_API_TOKEN: "test-vercel-token", VERCEL_AUTOMATION_BYPASS_SECRET: "test-bypass-secret", SUPABASE_REVOCATION_RPC_URL: "https://aqlcofblfxdrjhhdmarw.supabase.co/rest/v1/rpc/read_release_auth_revocation_by_operation", SUPABASE_REVOCATION_READ_CAPABILITY: "test-release-evidence-read-capability-0123456789", SUPABASE_REVOCATION_PUBLISHABLE_GATEWAY_KEY: `sb_publishable_${"a".repeat(32)}` };
    const gitAdapter = (_command: string, ref: string) => ref === "origin/main" || ref === "HEAD" ? sha : ref === "HEAD^{tree}" || ref.includes("origin/") ? tree : "";
    const transportCalls: any[] = [];
    const rpcFetch = async (value: string, options?: any) => {
      if (value !== env.SUPABASE_REVOCATION_RPC_URL) {
        const found = objects.get(value);
        if (!found) throw new Error("missing");
        return found;
      }
      return fetchEvidence(value, {
        ...options,
        request: (requestUrl: URL, requestOptions: any, callback: (response: any) => void) => {
          transportCalls.push({ requestUrl, requestOptions });
          const operationId = JSON.parse(Buffer.from(options.body).toString()).p_operation_id;
          const readback = revocationReadbacks.get(operationId);
          const listeners = new Map<string, ((value?: any) => void)[]>();
          const response: any = { statusCode: readback ? 200 : 404, headers: { "content-type": "application/json" }, resume() {}, on(name: string, listener: (value?: any) => void) { listeners.set(name, [...(listeners.get(name) ?? []), listener]); return response; }, destroy(error: Error) { for (const listener of listeners.get("error") ?? []) listener(error); } };
          const handle: any = { on() { return handle; }, end(sentBody: Buffer) { expect(sentBody.equals(options.body)).toBe(true); callback(response); queueMicrotask(() => { if (readback) for (const listener of listeners.get("data") ?? []) listener(bytes(readback)); for (const listener of listeners.get("end") ?? []) listener(); }); } };
          return handle;
        },
      });
    };
    const run = (overrides: any = {}) => verifyFinalReleaseEvidence({ env, transitionSecret, transitionJournalRoot, visualVerifierPublicKey, clock: () => 150, gitAdapter, fetch: rpcFetch, workflowAtHead: () => Buffer.from("workflow"), workflowBytes: () => Buffer.from("workflow"), output: () => {}, ...overrides });
    const componentCommon = { releaseId, mainSha: sha, releaseTree: tree, productionDeploymentId: production.deploymentId, certificationId: certification, now: 150, visualVerifierPublicKey };
    expect(validateComponent("visualReceipt", visualBytes, { ...componentCommon, observedAt: production.observedAt, expiresAt: production.expiresAt, visualBundleSha256: digest(visualBundleBytes.toString()), visualDomainReceiptSha256: visual.receiptSha256, authDomainReceiptSha256: authDomains })).toBe(true);
    expect(validateComponent("authPreview", apBytes, { ...componentCommon, domainReceiptSha256: ap.metadata.receiptSha256, deploymentReceiptSha256: domain(preview), deploymentId: preview.deploymentId, deploymentEnvironment: preview.environment, host: preview.host, aliasHost: preview.aliasHost, observedAt: preview.observedAt, origin: `https://${preview.host}`, expiresAt: preview.expiresAt })).toBe(true);
    expect(validateComponent("authProduction", aoBytes, { ...componentCommon, domainReceiptSha256: ao.metadata.receiptSha256, deploymentReceiptSha256: domain(production), deploymentId: production.deploymentId, deploymentEnvironment: production.environment, host: production.host, aliasHost: production.aliasHost, observedAt: production.observedAt, origin: `https://${production.host}`, expiresAt: production.expiresAt })).toBe(true);
    expect(validateComponent("authAlias", aaBytes, { ...componentCommon, domainReceiptSha256: aa.metadata.receiptSha256, deploymentReceiptSha256: domain(production), deploymentId: production.deploymentId, deploymentEnvironment: production.environment, host: production.host, aliasHost: production.aliasHost, observedAt: production.observedAt, origin: "https://tzudong.app", expiresAt: production.expiresAt })).toBe(true);
    await run();
    expect(transportCalls).toHaveLength(3);
    for (const call of transportCalls) {
      expect(call.requestUrl.origin).toBe("https://aqlcofblfxdrjhhdmarw.supabase.co");
      expect(call.requestOptions.method).toBe("POST");
      expect(call.requestOptions.headers).toMatchObject({ accept: "application/json", "content-type": "application/json", apikey: env.SUPABASE_REVOCATION_PUBLISHABLE_GATEWAY_KEY, authorization: `Bearer ${env.SUPABASE_REVOCATION_READ_CAPABILITY}` });
      expect(JSON.parse(call.requestOptions.headers["content-length"])).toBeGreaterThan(0);
    }
    const normalBypassDestinations: string[] = [];
    await run({ fetch: async (value: string, options?: any) => {
      if (options?.headers?.["x-vercel-protection-bypass"]) normalBypassDestinations.push(new URL(value).hostname);
      return value === env.SUPABASE_REVOCATION_RPC_URL ? rpcFetch(value, options) : objects.get(value) ?? (() => { throw new Error("missing"); })();
    } });
    expect(new Set(normalBypassDestinations)).toEqual(new Set(["tzudong-production.vercel.app", "tzudong.app", "www.tzudong.app"]));
    await expect(run({ env: { ...env, SUPABASE_REVOCATION_RPC_URL: "https://evil.supabase.co/rest/v1/rpc/read_release_auth_revocation_by_operation" } })).rejects.toThrow("AUTH_REVOCATION_MISMATCH");
    let visualExpiryClockSamples = 0;
    await expect(run({ clock: () => ++visualExpiryClockSamples === 1 ? 150 : 421 })).rejects.toThrow("FRESHNESS_MISMATCH");
    await expect(run({ env: { ...env, SUPABASE_REVOCATION_PUBLISHABLE_GATEWAY_KEY: env.SUPABASE_REVOCATION_READ_CAPABILITY } })).rejects.toThrow("AUTH_REVOCATION_MISMATCH");
    const serviceRoleGatewayKey = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
    await expect(run({ env: { ...env, SUPABASE_REVOCATION_PUBLISHABLE_GATEWAY_KEY: serviceRoleGatewayKey } })).rejects.toThrow("AUTH_REVOCATION_MISMATCH");
    let advancingClock = 145;
    await run({ clock: () => ++advancingClock });
    const rebindReceipt = (nextReceipt: any, overrides: [string, Buffer][] = []) => {
      const nextReceiptBytes = bytes(nextReceipt);
      const nextInputs = { ...inputs, RECEIPT_SHA256: digest(nextReceiptBytes.toString()), RECEIPT_URL: url(digest(nextReceiptBytes.toString())) };
      const nextManifest = { ...manifest, inputs: nextInputs };
      const nextManifestBytes = bytes(nextManifest);
      const nextObjects = new Map(objects);
      nextObjects.set(url(digest(nextManifestBytes.toString())), nextManifestBytes);
      nextObjects.set(nextInputs.RECEIPT_URL, nextReceiptBytes);
      for (const [objectUrl, objectBytes] of overrides) nextObjects.set(objectUrl, objectBytes);
      return { env: { ...env, MANIFEST_URL: url(digest(nextManifestBytes.toString())), MANIFEST_SHA256: digest(nextManifestBytes.toString()) }, objects: nextObjects };
    };
    const providerMutation = { ...evidenceBodies["github_deployment:production"], creator: { ...creator, id: 1 } };
    const providerMutationBytes = bytes(providerMutation, false);
    const mutatedEvidence = receipt.evidence.map((row: any) => row.kind === "github_deployment:production" ? { ...row, sha256: digest(providerMutationBytes.toString()) } : row);
    const mutatedProviderGraph = rebindReceipt({ ...receipt, evidence: mutatedEvidence }, [[expectedEvidenceUrl("github_deployment:production"), providerMutationBytes]]);
    await expect(run({ env: mutatedProviderGraph.env, fetch: async (value: string, options?: any) => value === env.SUPABASE_REVOCATION_RPC_URL ? rpcFetch(value, options) : mutatedProviderGraph.objects.get(value) ?? (() => { throw new Error("missing"); })() })).rejects.toThrow("GITHUB_DEPLOYMENT_MISMATCH");
    const appMutation = { ...evidenceBodies["github_deployment:production"], performed_via_github_app: { id: 999, slug: "evil" } };
    const appMutationBytes = bytes(appMutation, false);
    const appMutationEvidence = receipt.evidence.map((row: any) => row.kind === "github_deployment:production" ? { ...row, sha256: digest(appMutationBytes.toString()) } : row);
    const mutatedAppGraph = rebindReceipt({ ...receipt, evidence: appMutationEvidence }, [[expectedEvidenceUrl("github_deployment:production"), appMutationBytes]]);
    await expect(run({ env: mutatedAppGraph.env, fetch: async (value: string, options?: any) => value === env.SUPABASE_REVOCATION_RPC_URL ? rpcFetch(value, options) : mutatedAppGraph.objects.get(value) ?? (() => { throw new Error("missing"); })() })).rejects.toThrow("GITHUB_DEPLOYMENT_MISMATCH");
    const vercelMutation = { ...evidenceBodies["vercel_deployment:production"], ownerId: "team_untrusted" };
    const vercelMutationBytes = bytes(vercelMutation, false);
    const vercelMutationEvidence = receipt.evidence.map((row: any) => row.kind === "vercel_deployment:production" ? { ...row, sha256: digest(vercelMutationBytes.toString()) } : row);
    const mutatedVercelGraph = rebindReceipt({ ...receipt, evidence: vercelMutationEvidence }, [[expectedEvidenceUrl("vercel_deployment:production"), vercelMutationBytes]]);
    await expect(run({ env: mutatedVercelGraph.env, fetch: async (value: string, options?: any) => value === env.SUPABASE_REVOCATION_RPC_URL ? rpcFetch(value, options) : mutatedVercelGraph.objects.get(value) ?? (() => { throw new Error("missing"); })() })).rejects.toThrow("VERCEL_DEPLOYMENT_MISMATCH");
    const projectMutation = { ...evidenceBodies.vercel_project, rootDirectory: "backend" };
    const projectMutationBytes = bytes(projectMutation, false);
    const projectMutationEvidence = receipt.evidence.map((row: any) => row.kind === "vercel_project" ? { ...row, sha256: digest(projectMutationBytes.toString()) } : row);
    const mutatedProjectGraph = rebindReceipt({ ...receipt, evidence: projectMutationEvidence }, [[expectedEvidenceUrl("vercel_project"), projectMutationBytes]]);
    await expect(run({ env: mutatedProjectGraph.env, fetch: async (value: string, options?: any) => value === env.SUPABASE_REVOCATION_RPC_URL ? rpcFetch(value, options) : mutatedProjectGraph.objects.get(value) ?? (() => { throw new Error("missing"); })() })).rejects.toThrow("VERCEL_DEPLOYMENT_MISMATCH");
    await expect(run({ fetch: async (value: string, options?: any) => value === inputs.VISUAL_LEDGER_URL ? Buffer.from("tampered") : rpcFetch(value, options) })).rejects.toThrow("VISUAL_LEDGER_MISMATCH");
    await expect(run({ fetch: async (value: string, options?: any) => value === inputs.VISUAL_VERIFICATION_BUNDLE_URL ? (() => { throw new Error("missing visual bundle"); })() : rpcFetch(value, options) })).rejects.toThrow("VISUAL_LEDGER_MISMATCH");
    const reorderedReceipt = { ...receipt, evidence: [...receipt.evidence].sort((left: any, right: any) => Number(right.kind.startsWith("health:")) - Number(left.kind.startsWith("health:"))) };
    const reorderedGraph = rebindReceipt(reorderedReceipt);
    const bypassCalls: any[] = [];
    await expect(run({ env: reorderedGraph.env, fetch: async (value: string, options?: any) => {
      if (options?.headers?.["x-vercel-protection-bypass"]) bypassCalls.push({ value, options });
      if (value === env.SUPABASE_REVOCATION_RPC_URL) return rpcFetch(value, options);
      if (value.startsWith("https://api.vercel.com/")) return Buffer.from("{}");
      return reorderedGraph.objects.get(value) ?? (() => { throw new Error("missing"); })();
    } })).rejects.toThrow("EVIDENCE_HASH_MISMATCH");
    expect(bypassCalls).toHaveLength(0);
    const untrustedReceipt = { ...receipt, evidence: receipt.evidence.map((row: any) => row.kind === "health:tzudong-production.vercel.app" ? { ...row, kind: "health:evil.example", url: "https://evil.example/api/health" } : row) };
    const untrustedGraph = rebindReceipt(untrustedReceipt);
    const untrustedBypassCalls: any[] = [];
    await expect(run({ env: untrustedGraph.env, fetch: async (value: string, options?: any) => {
      if (options?.headers?.["x-vercel-protection-bypass"]) untrustedBypassCalls.push({ value, options });
      if (value === env.SUPABASE_REVOCATION_RPC_URL) return rpcFetch(value, options);
      return untrustedGraph.objects.get(value) ?? (() => { throw new Error("must not fetch untrusted host"); })();
    } })).rejects.toThrow("EVIDENCE_SCHEMA_INVALID");
    expect(untrustedBypassCalls).toHaveLength(0);
    const rollbackUnsigned = { kind: "rollback", id: "rollback", releaseId, sequence: 2, previousDigest: digest(signedEvent), projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", orgId: "team_OUj64KeLxJI3PkEbOaFZnorA", fromDeploymentId: production.deploymentId, toDeploymentId: knownGood.deploymentId, gitSha: knownSha, aliases: ["tzudong.app", "www.tzudong.app"], observedAt: 130 };
    const signedRollback = { ...rollbackUnsigned, signature: createHmac("sha256", transitionSecret).update("tzudong:release-transition:v2\n").update(canonical(rollbackUnsigned)).digest("hex") };
    const rollbackRoot = digest([signedEvent, signedRollback], "tzudong:release-transition-journal:v1\n");
    const rollbackBodies: any = { ...evidenceBodies, "vercel_deployment:production": { ...evidenceBodies["vercel_deployment:production"], alias: ["tzudong-production.vercel.app", "tzudong-git-main-twoimos-projects.vercel.app"] }, "vercel_deployment:knownGood": { ...evidenceBodies["vercel_deployment:knownGood"], alias: ["tzudong-known.vercel.app", "tzudong-git-main-twoimos-projects.vercel.app", "tzudong.app", "www.tzudong.app"] }, "vercel_alias:tzudong.app": { ...evidenceBodies["vercel_alias:tzudong.app"], deploymentId: knownGood.deploymentId }, "vercel_alias:www.tzudong.app": { ...evidenceBodies["vercel_alias:www.tzudong.app"], deploymentId: knownGood.deploymentId } };
    delete rollbackBodies["health:tzudong-production.vercel.app"];
    delete rollbackBodies["identity:tzudong-production.vercel.app"];
    for (const host of [knownGood.host, "tzudong.app", "www.tzudong.app"]) {
      rollbackBodies[`health:${host}`] = { ok: true, service: "tzudong-web", releaseId, gitSha: knownSha, deploymentId: knownGood.deploymentId, projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", host };
      rollbackBodies[`identity:${host}`] = rollbackBodies[`health:${host}`];
    }
    const rollbackEvidence = Object.entries(rollbackBodies).map(([kind, body]) => ({ kind, url: expectedEvidenceUrl(kind), sha256: digest(bytes(body, false).toString()) }));
    const rollbackReceipt = { ...receipt, expectedRollbackState: "rolled_back", derivedRollbackState: "rolled_back", transitionJournalRoot: rollbackRoot, vercel: { ...receipt.vercel, rollbackState: "rolled_back" }, events: [signedEvent, signedRollback], evidence: rollbackEvidence };
    const rollbackReceiptBytes = bytes(rollbackReceipt);
    const rollbackInputs = { ...inputs, ROLLBACK_STATE: "rolled_back", ROLLBACK_EVENT_ID: "rollback", REPROMOTION_EVENT_ID: "", RECEIPT_SHA256: digest(rollbackReceiptBytes.toString()), RECEIPT_URL: url(digest(rollbackReceiptBytes.toString())) };
    const rollbackManifestBytes = bytes({ ...manifest, inputs: rollbackInputs });
    const rollbackObjects = new Map(objects);
    rollbackObjects.set(url(digest(rollbackManifestBytes.toString())), rollbackManifestBytes);
    rollbackObjects.set(rollbackInputs.RECEIPT_URL, rollbackReceiptBytes);
    for (const [kind, body] of Object.entries(rollbackBodies)) rollbackObjects.set(expectedEvidenceUrl(kind), bytes(body, false));
    const rollbackEnv = { ...env, MANIFEST_URL: url(digest(rollbackManifestBytes.toString())), MANIFEST_SHA256: digest(rollbackManifestBytes.toString()) };
    await expect(run({ env: rollbackEnv, transitionJournalRoot: rollbackRoot, fetch: async (value: string, options?: any) => value === env.SUPABASE_REVOCATION_RPC_URL ? rpcFetch(value, options) : rollbackObjects.get(value) ?? (() => { throw new Error("missing"); })() })).rejects.toThrow("ROLLED_BACK");
    const reconciledRollbackUnsigned = { ...rollbackUnsigned, observedAt: 102 };
    const reconciledRollback = { ...reconciledRollbackUnsigned, signature: createHmac("sha256", transitionSecret).update("tzudong:release-transition:v2\n").update(canonical(reconciledRollbackUnsigned)).digest("hex") };
    const repromotionUnsigned = { kind: "promotion", id: "repromotion", releaseId, sequence: 3, previousDigest: digest(reconciledRollback), projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", orgId: "team_OUj64KeLxJI3PkEbOaFZnorA", fromDeploymentId: knownGood.deploymentId, toDeploymentId: production.deploymentId, gitSha: sha, aliases: ["tzudong.app", "www.tzudong.app"], observedAt: 103 };
    const signedRepromotion = { ...repromotionUnsigned, signature: createHmac("sha256", transitionSecret).update("tzudong:release-transition:v2\n").update(canonical(repromotionUnsigned)).digest("hex") };
    const reconciledRoot = digest([signedEvent, reconciledRollback, signedRepromotion], "tzudong:release-transition-journal:v1\n");
    const reconciledReceipt = { ...receipt, expectedRollbackState: "reconciled", derivedRollbackState: "reconciled", transitionJournalRoot: reconciledRoot, vercel: { ...receipt.vercel, rollbackState: "reconciled" }, events: [signedEvent, reconciledRollback, signedRepromotion] };
    const reconciledReceiptBytes = bytes(reconciledReceipt);
    const reconciledInputs = { ...inputs, ROLLBACK_STATE: "reconciled", ROLLBACK_EVENT_ID: "rollback", REPROMOTION_EVENT_ID: "repromotion", RECEIPT_SHA256: digest(reconciledReceiptBytes.toString()), RECEIPT_URL: url(digest(reconciledReceiptBytes.toString())) };
    const reconciledManifestBytes = bytes({ ...manifest, inputs: reconciledInputs });
    const reconciledObjects = new Map(objects);
    reconciledObjects.set(url(digest(reconciledManifestBytes.toString())), reconciledManifestBytes);
    reconciledObjects.set(reconciledInputs.RECEIPT_URL, reconciledReceiptBytes);
    const reconciledEnv = { ...env, MANIFEST_URL: url(digest(reconciledManifestBytes.toString())), MANIFEST_SHA256: digest(reconciledManifestBytes.toString()) };
    await expect(run({ env: reconciledEnv, transitionJournalRoot: reconciledRoot, fetch: async (value: string, options?: any) => value === env.SUPABASE_REVOCATION_RPC_URL ? rpcFetch(value, options) : reconciledObjects.get(value) ?? (() => { throw new Error("missing"); })() })).resolves.toBeUndefined();
    const staleOperationId = ap.metadata.payload.result.revocationOperationId;
    revocationReadbacks.set(staleOperationId, { ...revocationReadbacks.get(staleOperationId), bindingSha256: "0".repeat(64) });
    await expect(run()).rejects.toThrow("AUTH_REVOCATION_MISMATCH");
    const tamperedTransition = JSON.parse(receiptBytes.toString());
    tamperedTransition.events[0].signature = "0".repeat(64);
    const tamperedBytes = bytes(tamperedTransition);
    const tamperedObjects = new Map(objects);
    tamperedObjects.set(manifest.inputs.RECEIPT_URL, tamperedBytes);
    await expect(run({ fetch: async (value: string) => tamperedObjects.get(value) ?? (() => { throw new Error("missing"); })() })).rejects.toThrow("RECEIPT_HASH_MISMATCH");
    await expect(run({ gitAdapter: (_command: string, ref: string) => ref === "origin/main" || ref === "HEAD" ? sha : ref === "HEAD^{tree}" ? tree : "z".repeat(40) })).rejects.toThrow("TARGET_TREE_MISMATCH");
  });
  it("keeps protected final health secret-bearing and makes the publisher non-secret", async () => {
    const sha = "a".repeat(40);
    const tree = "b".repeat(40);
    const bypass = "finalizer-bypass-secret";
    const env: any = { INITIAL_OUTCOME: "success", INITIAL_REASON: "VERIFIED", TERMINAL_OUTCOME: "success", TERMINAL_REASON: "VERIFIED", VERIFY_JOB_RESULT: "success", UPLOAD_OUTCOME: "success", RELEASE_ID: "ts7-finalizer", RECEIPT_SHA256: "c".repeat(64), BUNDLE_SHA256: "d".repeat(64), EXPIRES_AT: "200", PRODUCTION_DEPLOYMENT_ID: "dpl_Final", IMMUTABLE_HOST: "tzudong-final.vercel.app", DISPATCH_SHA: sha, RELEASE_TREE: tree, RUN_URL: "https://github.test/run", VERCEL_AUTOMATION_BYPASS_SECRET: bypass };
    const updates: any[] = [];
    const github: any = {
      rest: {
        checks: { create: async () => ({ data: { id: 1 } }), update: async (value: any) => { updates.push(value); } },
        repos: { getBranch: async () => ({ data: { commit: { sha } } }), getCommit: async () => ({ data: { commit: { tree: { sha: tree } } } }) },
      },
    };
    const calls: any[] = [];
    const fetch = async (value: string, options: any) => {
      calls.push({ value, options });
      const host = new URL(value).hostname;
      return new Response(JSON.stringify({ ok: true, service: "tzudong-web", releaseId: env.RELEASE_ID, gitSha: sha, deploymentId: env.PRODUCTION_DEPLOYMENT_ID, projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl", host }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await expect(verifyProtectedFinalHealth({ env, fetch, now: () => 150 })).resolves.toEqual({ passed: true, reason: "VERIFIED" });
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(["tzudong-final.vercel.app", "tzudong.app", "www.tzudong.app"]).toContain(new URL(call.value).hostname);
      expect(call.options).toMatchObject({ redirect: "manual", headers: { accept: "application/json", "x-vercel-protection-bypass": bypass } });
    }
    await expect(verifyFinalReceiptCheck({ env: { ...env, VERCEL_AUTOMATION_BYPASS_SECRET: undefined, PROTECTED_LIVE_OUTCOME: "success", PROTECTED_LIVE_REASON: "VERIFIED" }, github, context: { repo: { owner: "twoimo", repo: "tzudong" } }, now: () => 150 })).resolves.toEqual({ passed: true, reason: "VERIFIED" });
    expect(updates.at(-1)).toMatchObject({ conclusion: "success" });
    const blockedCalls: any[] = [];
    await expect(verifyProtectedFinalHealth({ env: { ...env, TERMINAL_OUTCOME: "failure", TERMINAL_REASON: "ROLLED_BACK" }, fetch: async (...args: any[]) => { blockedCalls.push(args); throw new Error("must not fetch"); }, now: () => 150 })).resolves.toEqual({ passed: false, reason: "ROLLED_BACK" });
    expect(blockedCalls).toHaveLength(0);
    await expect(verifyFinalReceiptCheck({ env: { ...env, PROTECTED_LIVE_OUTCOME: "skipped", PROTECTED_LIVE_REASON: "", VERCEL_AUTOMATION_BYPASS_SECRET: undefined }, github, context: { repo: { owner: "twoimo", repo: "tzudong" }, }, now: () => 150 })).resolves.toEqual({ passed: false, reason: "UNKNOWN_VALIDATION_FAILURE" });
    expect(updates.at(-1)).toMatchObject({ conclusion: "action_required" });
  });
});
