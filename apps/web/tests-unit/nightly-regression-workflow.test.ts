import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const read = (relativePath: string) => readFileSync(resolve(appRoot, relativePath), "utf8");

const packageSource = read("package.json");
const packageJson = JSON.parse(packageSource) as {
  scripts?: Record<string, unknown>;
};
const nightlyRunnerSource = read("scripts/run-nightly-regression.mjs");
const playwrightEvidenceSource = read("scripts/nightly-playwright-failure-evidence.mjs");
const playwrightConfigSource = read("playwright.config.ts");
const healthRouteSource = read("app/api/health/route.ts");
const nightlyFixtureSource = read("tests/nightly/nightly-test.ts");
const profileReadRpcBoundarySource = read("tests/nightly/local-profile-read-rpc-boundary.ts");
const profileMutationRpcBoundarySource = read("tests/nightly/local-profile-mutation-rpc-boundary.ts");
const localSupabaseAdminSpecSource = read("tests/local-supabase-admin.spec.ts");
const mobileHomeMapSpecSource = read("tests/mobile-home-map.spec.ts");
const mobileHomeMapHelpersSource = read("tests/mobile-home-map-helpers.ts");
const localWorkflowSource = read("../../.github/workflows/nightly-local-regression.yml");
const packageLockSource = read("package-lock.json");
const bunLockSource = read("bun.lock");
const publicationAllowlistSource = read("../../.github/nightly-local-publication-allowlist.txt");
const publicationVerifierSource = read("../../.github/scripts/verify-nightly-local-publication.py");
const publicationBuilderSource = read("../../.github/scripts/build-nightly-local-publication.py");
const lifecycleStageWriterSource = read(
  "../../.github/scripts/write-nightly-lifecycle-stage.py",
);
const localOverlayBoundaryMigrationSource = read(
  "../../backend/supabase/migrations/20260812000400_local_admin_map_overlay_boundary_convergence.sql",
);
const localThumbnailRpcAllowlistMigrationSource = read(
  "../../backend/supabase/migrations/20260812000500_local_youtube_thumbnail_rpc_allowlist_convergence.sql",
);
const operationsDocSource = read("../../docs/operations/nightly-regression.md");
const hostedWorkflowSource = readFileSync(
  resolve(appRoot, "../../.github/workflows/nightly-regression.yml"),
  "utf8",
);
const webAdminWorkflowSource = read("../../.github/workflows/web-admin-ci.yml");
const curatedSpecs = [
  "tests/smoke.spec.ts",
  "tests/navigation.spec.ts",
  "tests/browser-title.spec.ts",
  "tests/mobile-home-map.spec.ts",
  "tests/local-supabase-admin.spec.ts",
] as const;

function sourceBlock(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function embeddedPython(block: string): string {
  const match = block.match(/python3 - <<'PY'\n([\s\S]*?)\n\s+PY/);
  expect(match).not.toBeNull();
  return (match?.[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

describe("nightly regression package and source contracts", () => {
  test("publishes one package entry point for the explicit nightly runner", () => {
    expect(packageJson.scripts?.["test:nightly"]).toBe(
      "node scripts/run-nightly-regression.mjs",
    );
    expect(packageSource).toContain('"test:nightly": "node scripts/run-nightly-regression.mjs"');
    expect(nightlyRunnerSource).toContain("function parseArguments(argumentsList)");
    expect(nightlyRunnerSource).toContain("function main()");
    expect(nightlyRunnerSource).toContain("function clearStaleNightlyBrowserArtifacts()");
    expect(nightlyRunnerSource).toContain("async function cleanupBrowserRegressionResources(");
  });

  test("passes the verified Node 24 supervisor into the unit lane", () => {
    expect(nightlyRunnerSource).toContain(
      "const supervisorExecutable = process.env.TZUDONG_NODE24_EXECUTABLE?.trim();",
    );
    expect(nightlyRunnerSource).toContain(
      "TZUDONG_NODE24_EXECUTABLE: supervisorExecutable",
    );
  });

  test("passes only validated GitHub socket admission context to local stack children", () => {
    const block = sourceBlock(
      nightlyRunnerSource,
      "const localDockerBaseEnvironmentKeys =",
      "function localComposeArguments",
    );
    const buildEnvironment = new Function(
      "pickEnvironment",
      `${block}\nreturn localDockerEnvironment;`,
    )((environment: Record<string, string>, keys: string[]) => Object.fromEntries(
      keys.flatMap((key) => environment[key] === undefined ? [] : [[key, environment[key]]]),
    )) as (environment: Record<string, string>) => Record<string, string>;
    const admission = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "twoimo/tzudong",
      GITHUB_RUN_ID: "123456",
      GITHUB_RUN_ATTEMPT: "2",
      TZUDONG_DOCKER_SOCKET_ADMISSION_FILE: "/run/tzudong-nightly-local-admission-123456-2",
    };
    const environment = buildEnvironment({
      PATH: "/fixture/bin",
      HOME: "/fixture/home",
      LANG: "C.UTF-8",
      ...admission,
      DOCKER_HOST: "tcp://hosted.invalid:2375",
      DOCKER_CONTEXT: "remote-context",
      COMPOSE_FILE: "/hosted/compose.yml",
      NEXT_PUBLIC_SUPABASE_URL: "https://hosted.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "hosted-service-role",
      DATABASE_URL: "postgresql://hosted.invalid/database",
      PGHOST: "hosted.invalid",
      PGPASSWORD: "hosted-password",
    });
    expect(environment).toEqual({
      PATH: "/fixture/bin",
      HOME: "/fixture/home",
      LANG: "C.UTF-8",
      ...admission,
    });

    expect(buildEnvironment({ PATH: "/fixture/bin", CI: "true" })).toEqual({
      PATH: "/fixture/bin",
    });
    for (const mutation of [
      { CI: "false" },
      { GITHUB_ACTIONS: "false" },
      { GITHUB_REPOSITORY: "other/repository" },
      { GITHUB_RUN_ID: "0" },
      { GITHUB_RUN_ATTEMPT: "+2" },
      { TZUDONG_DOCKER_SOCKET_ADMISSION_FILE: "/run/other-admission" },
    ]) {
      expect(() => buildEnvironment({ PATH: "/fixture/bin", ...admission, ...mutation })).toThrow(
        "Local Docker socket admission context is invalid.",
      );
    }

    const privateRuntimeKeys = [
      "GITHUB_ACTIONS",
      "GITHUB_REPOSITORY",
      "GITHUB_RUN_ID",
      "GITHUB_RUN_ATTEMPT",
      "TZUDONG_DOCKER_SOCKET_ADMISSION_FILE",
    ];
    const runtimeKeyBlock = sourceBlock(
      nightlyRunnerSource,
      "const browserEnvironmentKeys = [",
      "const curatedBrowserSpecs = [",
    );
    for (const key of privateRuntimeKeys) expect(runtimeKeyBlock).not.toContain(`'${key}'`);
    expect(block.match(/'CI'|'GITHUB_ACTIONS'|'GITHUB_REPOSITORY'|'GITHUB_RUN_ID'|'GITHUB_RUN_ATTEMPT'|'TZUDONG_DOCKER_SOCKET_ADMISSION_FILE'/g)).toHaveLength(6);
  });

  test("keeps hosted regression as an explicit manual fallback", () => {
    expect(hostedWorkflowSource).toContain("name: Nightly Regression (Hosted Manual)");
    expect(hostedWorkflowSource).not.toContain("\n  schedule:");
    expect(hostedWorkflowSource).toContain("workflow_dispatch:");
    expect(hostedWorkflowSource).toContain("- all");
    expect(hostedWorkflowSource).toContain("- unit");
    expect(hostedWorkflowSource).toContain("- e2e");
    expect(hostedWorkflowSource).toContain("NIGHTLY_SUPABASE_PROJECT_REF");
    expect(hostedWorkflowSource).toContain("Nightly Supabase URL does not identify the configured isolated project.");
    expect(hostedWorkflowSource).toContain("/api/health");
    expect(hostedWorkflowSource).toContain("Application did not become ready.");
    expect(hostedWorkflowSource).toContain("tests/smoke.spec.ts");
    expect(hostedWorkflowSource).toContain("tests/mobile-home-map.spec.ts");
    expect(hostedWorkflowSource).toContain("if: always()");
    expect(hostedWorkflowSource).toContain("nightly-playwright-diagnostics");
    expect(hostedWorkflowSource).toContain("retention-days: 14");
    expect(hostedWorkflowSource).toContain("[TRUNCATED TO LAST 256 KIB]");
    expect(hostedWorkflowSource).toContain("[REDACTED PAYLOAD-SHAPED LOG LINE]");
    expect(hostedWorkflowSource).not.toContain("destination / 'nightly-web-redacted.log'");
    expect(hostedWorkflowSource).toContain("contents: read");
    expect(hostedWorkflowSource).toContain("actions: read");
    expect(hostedWorkflowSource).toContain("Scheduling: disabled; this workflow runs only when explicitly dispatched.");
    expect(hostedWorkflowSource).toContain("Canonical nightly: Nightly Regression (Local Supabase).");
    expect(hostedWorkflowSource).toContain("Notification failed; see GitHub summary.");
    const summaryIndex = hostedWorkflowSource.indexOf("\n  summary:");
    expect(summaryIndex).toBeGreaterThan(0);
    expect(hostedWorkflowSource).not.toContain("environment: nightly-hosted");
    expect(hostedWorkflowSource).not.toMatch(/^\s{4}environment:/m);
    for (const action of [
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      "actions/upload-artifact@65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08",
    ]) {
      expect(hostedWorkflowSource).toContain(action);
    }
    expect(hostedWorkflowSource).not.toMatch(/^\s*uses:\s+\S+@v\d+\b/gm);
  });

  test("routes publication script changes through web admin pull and push CI", () => {
    const pullPaths = sourceBlock(webAdminWorkflowSource, "  pull_request:", "  push:");
    const pushPaths = sourceBlock(webAdminWorkflowSource, "  push:", "  schedule:");
    expect(pullPaths).toContain("      - '.github/scripts/**'");
    expect(pushPaths).toContain("      - '.github/scripts/**'");
    expect(webAdminWorkflowSource.match(/      - '\.github\/scripts\/\*\*'/g)).toHaveLength(2);
  });

  test("parses local and hosted mode only from explicit command arguments", () => {
    const parser = sourceBlock(
      nightlyRunnerSource,
      "function parseArguments(argumentsList)",
      "function resolveExplicitPath",
    );
    expect(parser).toContain("if (argument === '--mode')");
    expect(parser).toContain("if (argument.startsWith('--mode='))");
    expect(parser).toContain("if (!['local', 'hosted'].includes(mode))");
    expect(parser).toContain("Nightly mode is required. Use --mode local or --mode hosted.");
    expect(parser).not.toContain("process.env");
    expect(nightlyRunnerSource).toContain("function validateLocalEnvironment(environment)");
    expect(nightlyRunnerSource).toContain("function validateHostedEnvironment(environment)");
    expect(nightlyRunnerSource).toContain("return validateHostedEnvironment(environment);");
    for (const variable of [
      "NIGHTLY_SUPABASE_PROJECT_REF",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NIGHTLY_ADMIN_EMAIL",
      "NIGHTLY_ADMIN_PASSWORD",
    ]) {
      expect(nightlyRunnerSource).toContain(`'${variable}'`);
    }
  });

  test("requires dedicated nightly inputs instead of silently falling back to ambient env files", () => {
    const environmentLoader = sourceBlock(
      nightlyRunnerSource,
      "function loadExplicitEnvironment(mode, envFileArgument)",
      "function parseProvenanceHash",
    );
    expect(environmentLoader).toContain("const inheritedFile = process.env.NIGHTLY_ENV_FILE?.trim();");
    expect(environmentLoader).toContain("const selectedArgument = envFileArgument ?? inheritedFile;");
    expect(environmentLoader).toContain(
      "Local nightly mode requires --env-file (or NIGHTLY_ENV_FILE) for generated inputs.",
    );
    expect(environmentLoader).toContain("isDedicatedNightlyEnvFile(envFilePath)");
    expect(environmentLoader).toContain(".env.local and backend/.env are rejected");
    expect(environmentLoader).toContain("process.env.NIGHTLY_LOCAL_ENV_ONLY = '1'");
    expect(environmentLoader).toContain("process.env.NIGHTLY_ENV_FILE_ONLY = '1'");
    expect(environmentLoader).toContain("process.env.NODE_ENV = 'test'");
    expect(environmentLoader).not.toContain("loadEnv()");
    expect(environmentLoader).not.toContain("path: '.env'");
    expect(nightlyRunnerSource).toContain("function loadProvenance(mode, envFilePath, provenanceFileArgument)");
    expect(nightlyRunnerSource).toContain("Nightly env provenance does not match the explicit env file.");
  });

  test("keeps the browser lane pinned to curated public and real-local admin specs", () => {
    const curatedBlock = sourceBlock(
      nightlyRunnerSource,
      "const curatedBrowserSpecs = [",
      "const hostedRequiredEnvironment",
    );
    expect(curatedBlock.match(/'tests\/[a-z0-9-]+\.spec\.ts'/g)).toHaveLength(curatedSpecs.length);
    for (const spec of curatedSpecs) expect(curatedBlock).toContain(`'${spec}'`);
    expect(nightlyRunnerSource).toContain("...curatedBrowserSpecs");
    expect(nightlyRunnerSource).toContain("'--project=chromium'");
  });

  test("keeps mobile emulation inside the selected Chromium project", () => {
    expect(mobileHomeMapSpecSource).toContain("const IPHONE_SE_DEVICE = devices['iPhone SE'];");
    for (const option of [
      "userAgent: IPHONE_SE_DEVICE.userAgent",
      "viewport: IPHONE_SE_DEVICE.viewport",
      "deviceScaleFactor: IPHONE_SE_DEVICE.deviceScaleFactor",
      "isMobile: IPHONE_SE_DEVICE.isMobile",
      "hasTouch: IPHONE_SE_DEVICE.hasTouch",
    ]) {
      expect(mobileHomeMapSpecSource).toContain(option);
    }
    expect(mobileHomeMapSpecSource).not.toContain("...devices['iPhone SE']");
    expect(mobileHomeMapSpecSource).not.toContain('defaultBrowserType');
    expect(mobileHomeMapSpecSource).not.toContain('browserName:');
    for (const [project, browser] of [
      ['chromium', 'chromium'],
      ['firefox', 'firefox'],
      ['webkit', 'webkit'],
    ]) {
      expect(playwrightConfigSource).toContain(`name: '${project}'`);
      expect(playwrightConfigSource).toContain(`browserName: '${browser}'`);
    }
    expect(mobileHomeMapSpecSource).toContain("window.sessionStorage.removeItem(`tzudong:home-restore:${key}`);");
    expect(mobileHomeMapSpecSource).toContain('await page.goBack();');
    expect(mobileHomeMapSpecSource).not.toContain("new PopStateEvent('popstate'");
  });

  test("requires loopback local endpoints and blocks third-party browser destinations", () => {
    for (const token of [
      "function isLoopbackHostname(hostname)",
      "function assertLoopbackUrl(value, label)",
      "function assertLoopbackDatabaseUrl(value)",
      "function containsCloudEndpoint(value)",
      "Local nightly mode rejects cloud endpoint",
      "Local nightly mode requires an explicit loopback Supabase URL.",
    ]) {
      expect(nightlyRunnerSource).toContain(token);
    }
    for (const token of [
      "function isLoopbackUrl(url: URL)",
      "function classifyDeniedDestination(url: URL)",
      "third-party-provider-denied",
      "await route.abort('blockedbyclient')",
      "if (!isLoopbackUrl(url))",
      "function isAllowedApplicationUrl(url: URL)",
      "function isAllowedSupabaseWebSocketUrl(url: URL)",
      "function isAllowedHostedSupabaseUrl(url: URL)",
      "function isAllowedHostedSupabaseWebSocketUrl(url: URL)",
      "HOSTED_SUPABASE_ORIGIN",
      "(?:rest|auth|storage|realtime|functions)",
      "application-path-denied",
      "isAllowedSupabaseFixturePath",
      "SUPABASE_FIXTURE_CORS_HEADERS",
      "requestHeaders.origin !== LOCAL_APP_ORIGIN",
      "access-control-request-method",
      "access-control-request-headers",
      "Nightly Supabase fixture rejected an unexpected preflight header.",
      "'access-control-allow-origin': LOCAL_APP_ORIGIN",
      "'access-control-expose-headers': 'Content-Range, Link, Location'",
      "vary: 'Origin, Access-Control-Request-Headers'",
      "FORBIDDEN_PUBLIC_DATA_CONSOLE_ERRORS",
      "applicationConsoleErrorCount += 1",
      "Nightly browser emitted a bounded Supabase announcement console error.",
    ]) {
      expect(nightlyFixtureSource).toContain(token);
    }
    expect(nightlyFixtureSource).not.toContain("'access-control-allow-headers': '*'");
    expect(nightlyFixtureSource).not.toContain("'access-control-allow-origin': '*'");
    for (const spec of curatedSpecs) {
      expect(read(spec)).toContain("./nightly/nightly-test");
    }
    for (const token of [
      "type DiagnosticDestination =",
      "destination: DiagnosticDestination",
      "count: number",
      "const DIAGNOSTIC_COMPATIBILITY = new Set([",
      "function classifyDestination(url: URL): DiagnosticDestination",
      "LOCAL_SUPABASE_ORIGIN.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')",
      "Nightly route diagnostic class and destination are incompatible.",
      "Nightly route diagnostic tuple count exceeded its bound.",
    ]) {
      expect(nightlyFixtureSource).toContain(token);
    }
    expect(nightlyFixtureSource).not.toContain("host: url.hostname");
    expect(nightlyFixtureSource).not.toContain("host: 'invalid'");
    expect(nightlyRunnerSource).toContain("Object.keys(record).sort().join(',') !== 'class,count,destination,method,status'");
    expect(nightlyRunnerSource).toContain("request_count: requestCount");
    expect(nightlyRunnerSource).toContain("DIAGNOSTIC_COMPATIBILITY.has(`${record.class}:${record.destination}`)");
  });

  test("keeps the real local admin browser mutation exception exact and browser-originated", () => {
    for (const token of [
      "const LOCAL_ADMIN_MUTATION_PATHS = new Set([",
      "'/api/admin/map-overlays/preview'",
      "'/api/admin/map-overlays/apply'",
      "testInfo.file.replaceAll('\\\\', '/').endsWith('/tests/local-supabase-admin.spec.ts')",
      "method === 'POST'",
      "!url.search",
      "LOCAL_ADMIN_MUTATION_PATHS.has(url.pathname)",
      "const LOCAL_ADMIN_READ_PATHS = new Set([",
      "'/admin'",
      "'/api/admin/pending-counts'",
      "'/api/admin/evaluations'",
      "'/api/admin/map-overlays'",
      "'/api/admin/preferences/dashboard-widget-order'",
      "'/api/admin/preferences/sidebar-order'",
      "'/api/admin/system-status'",
      "'/api/admin/youtube-channel'",
      "'/api/admin/youtube-kpis'",
      "'/api/dashboard/summary'",
      "const LOCAL_ADMIN_YOUTUBE_KPI_SEARCHES = new Set([",
      "'?period=1M&viewMode=all&metricMode=views&scope=channel-growth'",
      "function isAllowedLocalAdminRead(url: URL, method: string): boolean",
      "url.pathname === '/api/admin/evaluations'",
      "return !url.search;",
      "url.search === '?restaurantIds=00000000-0000-4000-8000-000000000101&types=trend'",
      "diagnosticForUrl(url, method, 0, 'mutation-denied')",
      "const LOCAL_NIGHTLY_PRIVACY_ELIGIBILITY_BODY = '{}'",
      "isAllowedLocalProfileReadRpcRequest({",
      "isAllowedLocalProfileReadRpcPreflightRequest({",
      "isAllowedLocalProfileMutationRpcRequest({",
      "isAllowedLocalProfileMutationRpcPreflightRequest({",
      "isExactLocalDirectProfileTablePath(url)",
      "isExactLocalProfileMutationRpcPath(url)",
      "hasEncodedOrMalformedPath(url)",
      "isExactLocalProfileReadRpcPath(url)",
      "LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH",
      "allowedOrigin: LOCAL_SUPABASE_ORIGIN",
      "contentType: headers['content-type']",
      "isAllowedLocalProfileReadRpc(",
      "await fulfillJson(route, [], 200, true)",
      "url.pathname === '/rest/v1/rpc/get_current_privacy_eligibility'",
      "postData?.toString('utf8') === LOCAL_NIGHTLY_PRIVACY_ELIGIBILITY_BODY",
      "url.search === '?grant_type=password'",
      "url.pathname === '/functions/v1/naver-geocode'",
      "postData?.toString('utf8') === LOCAL_NIGHTLY_FUNCTION_BODY",
      "LOCAL_NIGHTLY_STORAGE_UPLOAD_PATH.test(url.pathname)",
      "postData?.toString('base64') === LOCAL_NIGHTLY_STORAGE_WEBP_BASE64",
      "LOCAL_NIGHTLY_PROFILE_AVATAR_UPLOAD_PATH.test(url.pathname)",
      "postData?.toString('base64') === LOCAL_NIGHTLY_PROFILE_AVATAR_JPEG_BASE64",
      "function isAllowedLocalStorageCleanup(",
      "LOCAL_NIGHTLY_PROFILE_AVATAR_OBJECT_PREFIX",
      "url.pathname === '/storage/v1/object/profile-avatars'",
      "url.pathname === '/storage/v1/object/review-photos'",
      "request.postDataBuffer()",
      "request.headers()",
      "url.searchParams.get('vsn') === '2.0.0'",
    ]) {
      expect(nightlyFixtureSource).toContain(token);
    }
    const fulfillSupabaseSource = nightlyFixtureSource.slice(
      nightlyFixtureSource.indexOf('async function fulfillSupabase('),
      nightlyFixtureSource.indexOf('async function fulfillNaverSdk('),
    );
    const exactProfileGate = fulfillSupabaseSource.indexOf(
      'if (isProfileReadRpc && !isAllowedProfileReadRpc && !isAllowedProfileReadRpcPreflight)',
    );
    const encodedSupabasePathGate = fulfillSupabaseSource.indexOf(
      'if (hasEncodedOrMalformedPath(url))',
    );
    const genericOptionsGate = fulfillSupabaseSource.indexOf("if (request.method() === 'OPTIONS')");
    const profileSuccess = fulfillSupabaseSource.indexOf('case LOCAL_PROFILE_SUMMARIES_RPC_PATH:');
    expect(encodedSupabasePathGate).toBeGreaterThan(-1);
    expect(encodedSupabasePathGate).toBeLessThan(exactProfileGate);
    expect(encodedSupabasePathGate).toBeLessThan(genericOptionsGate);
    expect(exactProfileGate).toBeGreaterThan(-1);
    expect(exactProfileGate).toBeLessThan(genericOptionsGate);
    expect(exactProfileGate).toBeLessThan(profileSuccess);
    expect(fulfillSupabaseSource.slice(exactProfileGate, genericOptionsGate)).toContain(
      "await route.abort('blockedbyclient');\n        return;",
    );
    expect(profileReadRpcBoundarySource).toContain("method === 'POST'");
    expect(profileReadRpcBoundarySource).toContain('&& !url.search');
    expect(profileReadRpcBoundarySource).toContain("url.pathname.includes('%')");
    expect(profileReadRpcBoundarySource).toContain('hasDuplicateOrInvalidJsonMemberNames(rawBody)');
    expect(profileMutationRpcBoundarySource).toContain("method === 'POST'");
    expect(profileMutationRpcBoundarySource).toContain("MAX_PROFILE_MUTATION_RPC_BODY_BYTES = 32_768");
    expect(profileMutationRpcBoundarySource).toContain("utf8Length(value) <= 4_096");
    expect(profileMutationRpcBoundarySource).toContain('hasDuplicateOrInvalidJsonMemberNames(rawBody)');
    expect(profileMutationRpcBoundarySource).toContain("LOCAL_DIRECT_PROFILE_TABLE_PATH = '/rest/v1/profiles'");
    const outerRouterSource = nightlyFixtureSource.slice(
      nightlyFixtureSource.indexOf("await page.route('**/*'"),
      nightlyFixtureSource.indexOf("const diagnosticsPath = testInfo.outputPath"),
    );
    const outerProfilePathGate = outerRouterSource.indexOf(
      'const isLocalProfileReadRpcPath = isAllowedLocalSupabaseUrl(url)',
    );
    const outerProfileDeny = outerRouterSource.indexOf(
      'isLocalProfileReadRpcPath\n                && !isAllowedProfileReadRpc',
    );
    const outerDirectProfileDeny = outerRouterSource.indexOf(
      'if (isLocalDirectProfileTablePath)',
    );
    const outerProfileMutationDeny = outerRouterSource.indexOf(
      'isLocalProfileMutationRpcPath\n                && !isAllowedProfileMutationRpc',
    );
    const outerProfileStorageDeny = outerRouterSource.indexOf(
      'if (isLocalProfileStoragePath(url) && !isAllowedProfileStorageRequest)',
    );
    const outerEncodedPathDeny = outerRouterSource.indexOf('if (hasEncodedLocalSupabasePath)');
    const outerMutationGate = outerRouterSource.indexOf('isMutationMethod(method)\n                && !(');
    const realLocalContinue = outerRouterSource.indexOf(
      'if (usesRealLocalSupabase && isAllowedLocalSupabaseUrl(url))',
    );
    expect(outerProfilePathGate).toBeGreaterThan(-1);
    expect(outerEncodedPathDeny).toBeGreaterThan(outerProfilePathGate);
    expect(outerEncodedPathDeny).toBeLessThan(outerProfileDeny);
    expect(outerEncodedPathDeny).toBeLessThan(outerMutationGate);
    expect(outerEncodedPathDeny).toBeLessThan(realLocalContinue);
    expect(outerDirectProfileDeny).toBeGreaterThan(outerEncodedPathDeny);
    expect(outerDirectProfileDeny).toBeLessThan(outerMutationGate);
    expect(outerProfileMutationDeny).toBeGreaterThan(outerDirectProfileDeny);
    expect(outerProfileMutationDeny).toBeLessThan(outerMutationGate);
    expect(outerProfileStorageDeny).toBeGreaterThan(outerProfileMutationDeny);
    expect(outerProfileStorageDeny).toBeLessThan(outerMutationGate);
    expect(outerProfileDeny).toBeGreaterThan(outerProfilePathGate);
    expect(outerProfileDeny).toBeLessThan(outerMutationGate);
    expect(outerProfileDeny).toBeLessThan(realLocalContinue);
    expect(outerRouterSource.slice(outerProfileDeny, outerMutationGate)).toContain(
      "await route.abort('blockedbyclient');\n                return;",
    );
    for (const token of [
      "buildAdminMapOverlayPayloadHash({",
      "buildAdminMapOverlayPreviewHash(expectedNormalized)",
      "mapAdminMapOverlayRouteActionToRpcAction(expectedNormalized.action)",
      "normalizeAdminMapOverlayPreviewRequest(normalized)",
      "page.evaluate(async ({ payload, payloadHash, previewHash }) =>",
      "const correlationId = '00000000-0000-4000-8000-000000000904'",
      "idempotencyKey: 'local-nightly-map-overlay-v1'",
      "body: JSON.stringify(applyBody)",
      "replayed.ok === true && replayed.replayed === true",
      "replayed.audit?.auditId === applied.audit?.auditId",
      "fetch('/api/admin/map-overlays/preview'",
      "fetch('/api/admin/map-overlays/apply'",
      "exactFixture:",
      "recordCount:",
      "hasAccessToken",
      "hasRefreshToken",
      "userIdIsUuid",
      "readbackHasFixture:",
      "const pendingCountsResponsePromise = page.waitForResponse(",
      "url.pathname === '/api/admin/pending-counts'",
      "url.pathname === '/api/dashboard/summary'",
      "await page.goto('/admin')",
      "[data-admin-dashboard-kpi-value-size=\"bounded\"]",
      "[data-admin-dashboard-management-skeleton=\"true\"]",
    ]) {
      expect(localSupabaseAdminSpecSource).toContain(token);
    }
    expect(localSupabaseAdminSpecSource).not.toContain("const canonical = (value: unknown)");
    expect(localSupabaseAdminSpecSource).not.toContain("crypto.subtle.digest");
    expect(localSupabaseAdminSpecSource).not.toContain("crypto.randomUUID");
    expect(localSupabaseAdminSpecSource).not.toContain("page.request.post");
    expect(localSupabaseAdminSpecSource).not.toContain("return { status: response.status, body:");
  });

  test("proves local browser function, owned Storage cleanup, and Realtime without raw evidence", () => {
    const browserBoundary = sourceBlock(
      localSupabaseAdminSpecSource,
      "test('proves real browser CORS for the local function, owned Storage lifecycle, and Realtime self-broadcast'",
      "test('proves authenticated profile nickname and avatar CAS with exact readback and cleanup'",
    );
    for (const token of [
      "page.on('response', (response) =>",
      "headers['access-control-allow-origin'] === localAppOrigin",
      "headers['access-control-allow-credentials'] === undefined",
      "headers['access-control-allow-credentials'] === 'true'",
      "authCredentialed: true",
      "fetch(`${supabaseUrl}/functions/v1/naver-geocode`",
      "LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:naver-geocode-fixture-v1",
      "functionResponse.headers.get('cache-control') === 'no-store'",
      "const objectPrefix = `${userId}/nightly-browser-cors/review.webp`;",
      "'Content-Type': 'image/webp'",
      "storagePublicReadOk = publicReadResponse.ok",
      "} finally {",
      "method: 'DELETE'",
      "body: JSON.stringify({ prefixes: [objectPrefix] })",
      "await cleanupResponse.body?.cancel()",
      "endpoint.pathname = '/realtime/v1/websocket'",
      "endpoint.searchParams.set('vsn', '2.0.0')",
      "broadcast: { ack: true, self: true }",
      "result.sendAcknowledged && result.selfBroadcastReceived",
      "sendAcknowledged: true",
      "selfBroadcastReceived: true",
    ]) {
      expect(browserBoundary).toContain(token);
    }
    expect(browserBoundary).not.toContain("console.");
    expect(browserBoundary).not.toContain("return loginPayload");
    expect(browserBoundary).not.toContain("return accessToken");
    expect(browserBoundary).not.toContain("return userId");
    expect(browserBoundary).not.toContain("response.text()");
  });

  test("proves the real local current-profile mutation lifecycle without raw evidence", () => {
    const profileMutationBoundary = sourceBlock(
      localSupabaseAdminSpecSource,
      "test('proves authenticated profile nickname and avatar CAS with exact readback and cleanup'",
      "test('authenticates the real synthetic admin, hydrates the console, and proves guarded read, preview, apply, readback and audit'",
    );
    for (const token of [
      "LOCAL_DIRECT_PROFILE_TABLE_PATH",
      "LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH",
      "LOCAL_PROFILE_AVATAR_CAS_RPC_PATH",
      "LOCAL_PROFILE_SUMMARIES_RPC_PATH",
      "p_nickname: 'Nightly CI 검증'",
      "p_expected_avatar_reference: null",
      "p_next_avatar_operation_id: avatarOperationId",
      "marker = `profile-avatar://${storageKey}`",
      "'Content-Type': 'image/jpeg'",
      "'x-upsert': 'false'",
      "p_expected_avatar_reference: marker",
      "p_next_avatar_operation_id: null",
      "method: 'HEAD'",
      "absence.status === 400 || absence.status === 404",
      "p_nickname: 'Nightly CI'",
      "directProfilesDenied: true",
      "finalReadback: true",
      "} finally {",
    ]) {
      expect(profileMutationBoundary).toContain(token);
    }
    expect(localSupabaseAdminSpecSource).toContain(
      "const localProfileAvatarOperationId = '00000000-0000-4000-8000-000000000905'",
    );
    expect(profileMutationBoundary).not.toContain("console.");
    expect(profileMutationBoundary).not.toContain("return loginPayload");
    expect(profileMutationBoundary).not.toContain("return accessToken");
    expect(profileMutationBoundary).not.toContain("return userId");
    expect(profileMutationBoundary).not.toContain("response.text()");
  });

  test("requires an explicit non-conflicting local browser port", () => {
    expect(nightlyRunnerSource).toContain("Local nightly mode requires an explicit APP_PORT that is not the protected 8080 listener.");
    expect(nightlyRunnerSource).toContain("Local nightly APP_PORT must not overlap a generated Supabase service port.");
    expect(nightlyRunnerSource).toContain("KONG_HTTP_PORT");
    expect(nightlyRunnerSource).toContain("POSTGRES_HOST_PORT");
    expect(nightlyRunnerSource).toContain("const requestedPort = Number(environment.APP_PORT);");
    expect(nightlyRunnerSource).toContain("APP_PORT: requestedPortEnvironment");
    expect(nightlyRunnerSource).toContain("NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: '/__local/naver-maps.js'");
    expect(nightlyRunnerSource).toContain("assertRepositoryInputFile");
    expect(nightlyRunnerSource).toContain("inputMetadata.source_manifest_mode !== manifestMode");
    expect(nightlyRunnerSource).toContain("const expectedHost = `${projectRef}.supabase.co`;");
    expect(nightlyRunnerSource).toContain("NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${appPort}`");
    expect(nightlyRunnerSource).toContain("TZUDONG_NEXT_DIST_DIR: `.next-nightly-${mode}-${appPort}`");
    expect(nightlyRunnerSource).toContain("'--hostname'");
    expect(nightlyRunnerSource).toContain("'127.0.0.1'");
  });

  test("requires current owner-only local stack and migration receipts before browser admission", () => {
    for (const token of [
      "const localMigrationReceiptFilename = 'local-receipt-v1.json';",
      "async function assertLocalMigrationReceipt(stateRoot, stackReceipt)",
      "receipt.schema !== 'local-receipt-v1'",
      "receipt.serializer !== 'receipt-v1'",
      "receipt.ledger.length !== 77",
      "localReceiptSequenceMarkers = ['prerequisite', 'migration', 'closure', 'platform-bootstrap', 'seed']",
      "  'platform_bootstrap_evidence_sha256',",
      "  'platform_bootstrap_sha256',",
      "module._load_receipt_file(pathlib.Path(sys.argv[2]))",
      "localServicesWithoutDockerHealthcheck.has(service.service)",
      'any(item.get("health") != "healthy" for item in services)',
      "Local stack readiness evidence contains a non-running or unhealthy service.",
    ]) {
      expect(nightlyRunnerSource).toContain(token);
    }
    expect(createHash("sha256").update(localOverlayBoundaryMigrationSource).digest("hex")).toBe(
      "f61595514b4218bfa47e3fb5c529f648fe4d16efef1f5ef02f216aff6dd08bcb",
    );
    expect(createHash("sha256").update(localThumbnailRpcAllowlistMigrationSource).digest("hex")).toBe(
      "33735c6661ff8b555424bc2ccc28467baee182dd455f8283bfced356c0793ff7",
    );
    expect(operationsDocSource).toContain("77-unit migration ledger");
  });

  test("keeps nightly web log custody owner-only and symlink-safe", () => {
    for (const token of [
      "function openNightlyWebLog(logPath)",
      "fsConstants.O_NOFOLLOW",
      "fsConstants.O_CREAT | fsConstants.O_EXCL",
      "fstatSync(descriptor)",
      "ftruncateSync(descriptor, 0)",
      "nightly-web.log must be an owner-only regular file.",
      "logStream = openNightlyWebLog(logPath);",
    ]) {
      expect(nightlyRunnerSource).toContain(token);
    }
  });
  test("keeps local Supabase fixture routing fail-closed", () => {
    for (const token of [
      "const LOCAL_NIGHTLY_MODE",
      "function isAllowedLocalNightlyUrl(url: URL)",
      "blockedbyclient",
      "increment_search_count",
      "search_restaurants_by_youtube_title",
      "read_public_profile_leaderboard_page",
      "method === 'OPTIONS'",
      "method !== 'GET'",
      "method === 'POST'",
      "const LOCAL_REST_FIXTURE_PATHS",
      "const LOCAL_AUTH_FIXTURE_PATHS",
      "if (!LOCAL_REST_FIXTURE_PATHS.has(url.pathname))",
      "if (!LOCAL_AUTH_FIXTURE_PATHS.has(url.pathname))",
      "Object.keys(payload).sort().join(',') !== expectedKeys.join(',')",
      "requestBody.p_after_quality_score === null",
      "Number.isFinite(requestBody.p_after_quality_score)",
      "PROFILE_SUMMARY_UUID.test(requestBody.p_after_user_id)",
      "hasDuplicateOrInvalidJsonMemberNames(rawBody.toString('utf8'))",
      "hasEncodedOrMalformedPath(url)",
      "isExactLocalProfileReadRpcPath(url)",
      "'/rest/v1/announcements'",
      "'/rest/v1/ad_banners'",
      "url.pathname.endsWith('/rest/v1/announcements')",
      "url.pathname.endsWith('/rest/v1/ad_banners')",
      "SUPABASE_FIXTURE_CORS_HEADERS",
      "requestHeaders.origin !== LOCAL_APP_ORIGIN",
      "Mobile Supabase fixture rejected an unexpected preflight header.",
      "'access-control-allow-origin': LOCAL_APP_ORIGIN",
      "'access-control-expose-headers': 'Content-Range, Link, Location'",
      "vary: 'Origin, Access-Control-Request-Headers'",
    ]) {
      expect(mobileHomeMapHelpersSource).toContain(token);
    }
    expect(mobileHomeMapHelpersSource).not.toContain("'access-control-allow-headers': '*'");
    expect(mobileHomeMapHelpersSource).not.toContain("'access-control-allow-origin': '*'");
    expect(
      mobileHomeMapHelpersSource.match(/hasDuplicateOrInvalidJsonMemberNames\(rawBody\.toString\('utf8'\)\)/g),
    ).toHaveLength(2);
    const mobileRestRouterSource = mobileHomeMapHelpersSource.slice(
      mobileHomeMapHelpersSource.indexOf('async function handleSupabaseRestRoute('),
      mobileHomeMapHelpersSource.indexOf('async function handleSupabaseAuthRoute('),
    );
    const mobileProfileGate = mobileRestRouterSource.indexOf(
      'if (isProfileReadRpc && !isAllowedProfileReadRpc && !isAllowedProfileReadRpcPreflight)',
    );
    const mobileEncodedPathGate = mobileRestRouterSource.indexOf(
      'if (hasEncodedOrMalformedPath(url))',
    );
    const mobileFixturePathGate = mobileRestRouterSource.indexOf(
      'if (!LOCAL_REST_FIXTURE_PATHS.has(url.pathname))',
    );
    const mobileGenericOptions = mobileRestRouterSource.indexOf("if (method === 'OPTIONS')");
    const mobilePageSuccess = mobileRestRouterSource.indexOf(
      "if (url.pathname.endsWith('/rest/v1/rpc/read_public_profile_leaderboard_page'))",
    );
    expect(mobileEncodedPathGate).toBeGreaterThan(-1);
    expect(mobileEncodedPathGate).toBeLessThan(mobileFixturePathGate);
    expect(mobileEncodedPathGate).toBeLessThan(mobileProfileGate);
    expect(mobileEncodedPathGate).toBeLessThan(mobileGenericOptions);
    expect(mobileProfileGate).toBeGreaterThan(-1);
    expect(mobileProfileGate).toBeLessThan(mobileGenericOptions);
    expect(mobileProfileGate).toBeLessThan(mobilePageSuccess);
    expect(mobileRestRouterSource.slice(mobileProfileGate, mobileGenericOptions)).toContain(
      "await route.abort('blockedbyclient');\n        return;",
    );
    expect(mobileRestRouterSource).toContain('isAllowedLocalProfileReadRpcRequest({');
    expect(mobileRestRouterSource).toContain('isAllowedLocalProfileReadRpcPreflightRequest({');
  });

  test("keeps local health responses redacted to the stable three-field contract", () => {
    expect(healthRouteSource).toContain("const localMarker = process.env.NIGHTLY_LOCAL_ENV_ONLY === '1';");
    expect(healthRouteSource).toContain("const localTestGate = localMarker");
    expect(healthRouteSource).toContain("process.env.NODE_ENV === 'test' || localBrowserRuntimeGate");
    expect(healthRouteSource).toContain("&& LOOPBACK_HOSTS.has(host);");
    expect(healthRouteSource).toContain("{ ok: true, service: 'tzudong-web', mode: 'local' }");
    const localResponse = sourceBlock(
      healthRouteSource,
      "if (localTestGate)",
      "// A local marker is never valid",
    );
    expect(localResponse).not.toContain("releaseId");
    expect(localResponse).not.toContain("gitSha");
    expect(localResponse).not.toContain("deploymentId");
    expect(localResponse).not.toContain("projectId");
    expect(nightlyRunnerSource).toContain("Object.keys(payload).length === 3");
  });

  test("accepts the runner base URL and forwards only the local admin credentials needed by the real DB lane", () => {
    expect(playwrightConfigSource).toContain("process.env.PLAYWRIGHT_BASE_URL");
    expect(playwrightConfigSource).toContain("new URL('/api/health', PLAYWRIGHT_BASE_URL).toString()");
    expect(playwrightConfigSource).toContain("const PLAYWRIGHT_NIGHTLY_MODE = process.env.NIGHTLY_MODE?.trim();");
    for (const variable of [
      "NIGHTLY_MODE",
      "NIGHTLY_LOCAL_ENV_ONLY",
      "NIGHTLY_ENV_FILE_ONLY",
      "NIGHTLY_ENV_PROVENANCE",
      "NIGHTLY_ENV_PROVENANCE_SHA256",
      "NIGHTLY_ENV_FILE",
    ]) {
      expect(playwrightConfigSource).toContain(`'${variable}'`);
    }
    expect(playwrightConfigSource).toContain("const playwrightWebServerEnvironment = isNightlyRegressionRun");
    expect(playwrightConfigSource).toContain("...playwrightWebServerEnvironment");
    expect(playwrightConfigSource).not.toContain("...process.env");
    for (const localSecret of [
      "NIGHTLY_ADMIN_PASSWORD",
    ]) {
      expect(playwrightConfigSource).toContain(`'${localSecret}'`);
    }
    expect(playwrightConfigSource).not.toContain("'SUPABASE_SERVICE_ROLE_KEY'");
    for (const secret of [
      "SUPABASE_ACCESS_TOKEN",
      "VERCEL_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]) {
      expect(playwrightConfigSource).not.toContain(secret);
    }
    expect(playwrightConfigSource).toContain("baseURL: PLAYWRIGHT_BASE_URL");
  });

  test("leaves the existing Playwright projects and server controls intact", () => {
    for (const project of ["admin-setup", "chromium", "firefox", "webkit", "...responsiveProjects"]) {
      expect(playwrightConfigSource).toContain(project);
    }
    expect(playwrightConfigSource).toContain("PLAYWRIGHT_WEB_SERVER_COMMAND");
    expect(playwrightConfigSource).toContain("PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS");
    expect(playwrightConfigSource).toContain("PLAYWRIGHT_REUSE_EXISTING_SERVER");
  });

  test("reduces the private Playwright JSON report before diagnostics persistence", () => {
    for (const token of [
      "--reporter=line,json",
      "PLAYWRIGHT_JSON_OUTPUT_FILE: privatePlaywrightReportPath",
      "preparePrivatePlaywrightReport(privatePlaywrightReportPath)",
      "removeSanitizedPlaywrightFailureEvidence(playwrightFailureEvidencePath)",
      "sanitizePrivatePlaywrightReport(",
      "writeNightlyRunnerStageEvidence(",
      "replaceWithNightlyRunnerStageEvidence(",
      "removePrivatePlaywrightReport(privatePlaywrightReportPath)",
      "nightly-playwright-failure-evidence.json",
    ]) {
      expect(nightlyRunnerSource).toContain(token);
    }
    expect(nightlyRunnerSource.indexOf("sanitizePrivatePlaywrightReport("))
      .toBeLessThan(nightlyRunnerSource.indexOf("collectLocalBrowserDiagnostics(diagnosticsStartedAt)"));
    const browserRunner = sourceBlock(
      nightlyRunnerSource,
      "async function runBrowserRegression(environment, mode)",
      "async function main()",
    );
    const startup = sourceBlock(
      nightlyRunnerSource,
      "async function start()",
      "start().catch((error) =>",
    );
    expect(startup.indexOf("clearStaleNightlyBrowserArtifacts()"))
      .toBeLessThan(startup.indexOf("await main()"));
    const staleCleanup = sourceBlock(
      nightlyRunnerSource,
      "function clearStaleNightlyBrowserArtifacts()",
      "async function cleanupBrowserRegressionResources(",
    );
    expect(staleCleanup).toContain(
      "removePrivatePlaywrightReport(privatePlaywrightReportPath)",
    );
    expect(staleCleanup).toContain(
      "removeSanitizedPlaywrightFailureEvidence(playwrightFailureEvidencePath)",
    );
    const signalHandler = sourceBlock(
      nightlyRunnerSource,
      "async function terminateChildren(signal)",
      "process.once('SIGINT'",
    );
    expect(signalHandler).toContain("removePrivatePlaywrightReport(privatePlaywrightReportPath)");
    expect(signalHandler).toContain("removeSanitizedPlaywrightFailureEvidence(playwrightFailureEvidencePath)");
    expect(signalHandler.indexOf("removePrivatePlaywrightReport(privatePlaywrightReportPath)"))
      .toBeLessThan(signalHandler.indexOf("process.exit(cleanupFailed"));
    expect(playwrightEvidenceSource).toContain("nightly-playwright-failure-evidence-v1");
    expect(playwrightEvidenceSource).toContain("playwright-json-report-v2");
    expect(playwrightEvidenceSource).toContain("nightly-e2e-runner-stage-evidence-v1");
    expect(playwrightEvidenceSource).toContain("nightly-runner-stage-v1");
    for (const stage of [
      "admission", "log_open", "app_spawn", "health", "report_prepare",
      "playwright", "sanitize", "diagnostics",
    ]) {
      expect(playwrightEvidenceSource).toContain(`'${stage}'`);
    }
    const cleanupResources = sourceBlock(
      nightlyRunnerSource,
      "async function cleanupBrowserRegressionResources(",
      "async function runBrowserRegression(environment, mode)",
    );
    expect(cleanupResources).toContain("removePrivatePlaywrightReport(privatePlaywrightReportPath)");
    expect(cleanupResources).toContain("await stopProcess(appProcess)");
    expect(cleanupResources).toContain("logStream.end()");
    expect(cleanupResources).toContain("return completeNightlyCleanupTasks([");
    expect(browserRunner).toContain("preservePlaywrightEvidence = result.code !== 0");
    expect(browserRunner.indexOf("preservePlaywrightEvidence = result.code !== 0"))
      .toBeLessThan(browserRunner.indexOf("collectLocalBrowserDiagnostics(diagnosticsStartedAt)"));
    for (const specId of ["PW-SMOKE", "PW-NAV", "PW-TITLE", "PW-MAP", "PW-ADMIN"]) {
      expect(playwrightEvidenceSource).toContain(specId);
    }
    for (const rawField of ["test.title", "result.stdout", "result.stderr", "result.attachments"]) {
      expect(playwrightEvidenceSource).not.toContain(rawField);
    }
  });

  test("reconstructs local Docker nightly and uploads only sanitized artifacts", () => {
    for (const token of [
      "name: Nightly Regression (Local Supabase)",
      "cron: '30 18 * * *'",
      "runs-on: ubuntu-24.04",
      "docker-compose-linux-${compose_arch}",
      "sha256sum --check --status",
      "7af95166a730b87e172d4fc9aefea8725d3c6c7327d59149267b452114ddb7d4",
      "49082844b87f03cdcd5f5bbef1ba8c9c897b7a2dfb80cea18d61ec8ca6117e0c",
      "docker compose version --short",
      "Enable disposable runner user namespaces",
      "kernel.apparmor_restrict_unprivileged_userns=0",
      "kernel.unprivileged_userns_clone=1",
      "user.max_user_namespaces=28633",
      "python3 backend/supabase/scripts/local-stack.py reset",
      "python3 backend/supabase/scripts/local-migrate.py apply-prerequisite",
      "python3 backend/supabase/scripts/local-migrate.py verify-prerequisite",
      "python3 backend/supabase/scripts/local-migrate.py apply",
      "python3 backend/supabase/scripts/local-function-runtime-scan.py smoke",
      "backend/supabase/tests/local_profile_mutation_boundary.sql",
      '"$state/local-profile-mutation-boundary.log"',
      "python3 backend/supabase/scripts/local-migrate.py receipt",
      "Verify generated Supabase types match the local catalog",
      "bun run supabase:gen-types:local",
      "git diff --exit-code -- integrations/supabase/database.types.ts",
      "Install Chromium for the browser lane",
      "bunx playwright install --with-deps chromium",
      "Run local nightly unit regression",
      "--suite unit",
      "Run local nightly browser regression",
      "--suite e2e",
      "continue-on-error: true",
      "Aggregate local nightly lane outcomes",
      "UNIT_OUTCOME: ${{ steps.nightly-unit.outcome }}",
      "E2E_OUTCOME: ${{ steps.nightly-e2e.outcome }}",
      "--mode local",
      "actions/upload-artifact@v4",
      "publication-boundary.txt",
      "failure-diagnostics/local-stack-failure-diagnostics.json",
      "steps.prepare-lifecycle-diagnostic.outputs.path",
      "write-nightly-lifecycle-stage.py",
      "Prepare bounded lifecycle diagnostic for failure persistence",
      "--prepare-upload",
      "trap fail_lifecycle_stage ERR",
      "record_lifecycle_stage failed \"$exit_code\" || true",
      "local-stack-failure-diagnostics-v1",
      "allowed_services",
      "allowed_states",
      "allowed_health",
      "Pull pinned Compose images",
      "docker', 'pull'",
      "'cli_version': '2.109.1'",
      "cli_returncode != 0",
      "'image': 'public.ecr.aws/supabase/postgres-meta:v0.96.6'",
      "public.ecr.aws/supabase/postgres-meta@sha256:b9edad6fff2d4fb991ecd57837dbe3f21d2efa0f0ccb186f6ccf0e2d57192fed",
      "sha256:c496f84f24947250e706f03aca4af956a099d8f7e5521279f47e4077964d339a",
      "'platform': 'linux/amd64'",
      "'registry': 'public.ecr.aws'",
      "['docker', 'image', 'tag'",
      "'docker', 'image', 'inspect'",
      "source_readback[:4] != tag_readback[:4]",
      "typegen_image_readback",
      "local-image-pull-preflight-v1",
      "container_probe",
      "docker', 'run'",
      "registry_auth",
      "registry_network",
      "Probe Compose container creation",
      "backend/supabase/scripts/local-stack.py render",
      "local-compose-create-preflight-v1",
      "create', '--pull=never'",
      "mount_invalid",
      "network_create",
      "runtime_create",
      "Probe Compose service startup",
      "local-compose-start-preflight-v1",
      "collective",
      "up', '-d', '--pull=never'",
      "docker', 'compose",
      "'start', service",
      "exec_invalid",
      "Create scoped Docker socket admission",
      "TZUDONG_DOCKER_SOCKET_ADMISSION_FILE",
      "sudo install -o root -g root -m 0400",
      "Capture bounded Compose runtime diagnostics",
      "local-compose-runtime-diagnostics-v1",
      "container_discovery",
      "container_inspection",
      "container_not_running",
      "supabase_db_missing",
      "analytics_schema_missing",
      "health_failing_streak",
      "health_log_exit_codes",
      "log_failure_class",
      "oom_killed",
      "restart_count",
      "database_bootstrap",
      "database_presence",
      "database_init_files",
      "database_permission",
      "config_permission",
      "auth_failure",
      "tini_runtime",
      "thread_create",
      "scheduler_permission",
      "procfs_permission",
      "socket_permission",
      "signal_permission",
      "namespace_permission",
      "operation_not_permitted",
      "erl_runtime",
      "runtime_input_checks",
      "runtime_env_presence",
      "RLIMIT_NOFILE",
      "nonempty",
      "empty",
      "entrypoint_class",
      "log_signatures",
      "supabase_db_present",
      "supabase_db_missing",
      "analytics_schema_present",
      "analytics_schema_missing",
      "down --volumes --remove-orphans",
      "docker volume rm -f",
      "${LOCAL_PROJECT}-db-data",
      "${LOCAL_PROJECT}-db-config",
      "${LOCAL_PROJECT}-db-init-migrations",
      "${LOCAL_PROJECT}-db-init-scripts",
      "${LOCAL_PROJECT}-functions",
      "${LOCAL_PROJECT}-kong-config",
      "${LOCAL_PROJECT}-pooler-config",
      "${LOCAL_PROJECT}-storage-data",
      "${LOCAL_PROJECT}-vector-config",
      "docker network ls -q --filter",
      "Docker socket admission remains after cleanup.",
      "Project-labeled volumes remain after cleanup or readback failed.",
      "Project-labeled networks remain after cleanup or readback failed.",
    ]) {
      expect(localWorkflowSource).toContain(token);
    }
    const leaderboardBoundary = localWorkflowSource.indexOf(
      "backend/supabase/tests/local_profile_leaderboard_page.sql",
    );
    const mutationBoundary = localWorkflowSource.indexOf(
      "backend/supabase/tests/local_profile_mutation_boundary.sql",
    );
    const migrationReceipt = localWorkflowSource.indexOf(
      "python3 backend/supabase/scripts/local-migrate.py receipt",
    );
    expect(leaderboardBoundary).toBeGreaterThanOrEqual(0);
    expect(mutationBoundary).toBeGreaterThan(leaderboardBoundary);
    expect(migrationReceipt).toBeGreaterThan(mutationBoundary);
    expect(localWorkflowSource).toContain(
      "psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \\\n" +
        "            < backend/supabase/tests/local_profile_mutation_boundary.sql",
    );
    for (const token of [
      'SCHEMA: Final = "nightly-lifecycle-stage-v1"',
      "MAX_RECEIPT_BYTES: Final = 1024",
      '"attempt_count"',
      '"exit_code"',
      '"failure_class"',
      '"stage_index"',
      '"status"',
      "prepare_upload_copy",
      "os.replace(temporary, target)",
      "os.fsync(descriptor)",
      "info.st_nlink != 1",
      "O_NOFOLLOW",
    ]) {
      expect(lifecycleStageWriterSource).toContain(token);
    }
    const successUpload = sourceBlock(
      localWorkflowSource,
      "- name: Upload verified sanitized local nightly artifacts",
      "- name: Prepare bounded lifecycle diagnostic for failure persistence",
    );
    const prepareLifecycleUpload = sourceBlock(
      localWorkflowSource,
      "- name: Prepare bounded lifecycle diagnostic for failure persistence",
      "- name: Upload bounded failed or partial local nightly diagnostics",
    );
    const failureUpload = sourceBlock(
      localWorkflowSource,
      "- name: Upload bounded failed or partial local nightly diagnostics",
      "- name: Upload allowlisted publication bundle",
    );
    expect(successUpload).not.toContain("local-lifecycle-stage.json");
    expect(prepareLifecycleUpload).toContain("--prepare-upload");
    expect(prepareLifecycleUpload).toContain(
      "path=nightly-artifacts/validated-failure-diagnostics/local-lifecycle-stage.json",
    );
    expect(failureUpload).toContain("${{ steps.prepare-lifecycle-diagnostic.outputs.path }}");
    expect(failureUpload).not.toContain(
      "nightly-artifacts/failure-diagnostics/local-lifecycle-stage.json",
    );
    expect(publicationAllowlistSource).not.toContain("local-lifecycle-stage");
    for (const action of [
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      "actions/upload-artifact@65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08",
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
    ]) {
      expect(localWorkflowSource).toContain(action);
    }
    const publishIndex = localWorkflowSource.indexOf("\n  publish:");
    expect(publishIndex).toBeGreaterThan(0);
    const regressionWorkflowSource = localWorkflowSource.slice(0, publishIndex);
    expect(regressionWorkflowSource).toContain("contents: read");
    expect(regressionWorkflowSource).not.toContain("contents: write");
    expect(localWorkflowSource).toContain("needs: local");
    expect(localWorkflowSource).toContain("if: ${{ needs.local.result == 'success' && github.ref == 'refs/heads/main' && (github.event_name == 'schedule' || inputs.suite == 'all') }}");
    expect(localWorkflowSource).toContain('test "${GITHUB_SHA}" = "$main_sha"');
    expect(localWorkflowSource).toContain("actions/download-artifact@v4");
    expect(localWorkflowSource).not.toContain("nightly-artifacts/nightly-run.log");
    expect(localWorkflowSource).not.toContain("nightly-artifacts/nightly-web.log");
    expect(localWorkflowSource).not.toContain("(Path('apps/web/nightly-run.log')");
    expect(localWorkflowSource).not.toContain("(Path('apps/web/nightly-web.log')");
    for (const token of [
      ".github/nightly-local-publication-allowlist.txt",
      "Prepare allowlisted publication bundle",
      "Verify publication bundle before artifact persistence",
      "python3 -m unittest backend.supabase.tests.test_local_publication_verifier",
      "python3 .github/scripts/verify-nightly-local-publication.py",
      "nightly-local-publication-${{ github.run_id }}",
      "mapfile -t publication_files",
    ]) {
      expect(localWorkflowSource).toContain(token);
    }
    expect(publicationBuilderSource).toContain(
      "Local-only sanitized receipts; stack.env and credentials excluded.",
    );
    expect(localWorkflowSource).toContain("contents: write");
    expect(localWorkflowSource).toContain("issues: write");
    expect(localWorkflowSource).toContain("Manage scheduled nightly incident");
    expect(localWorkflowSource).toContain("[nightly] Local regression incident");
    expect(localWorkflowSource).toContain("REPOSITORY_OWNER: ${{ github.repository_owner }}");
    expect(localWorkflowSource).toContain('--add-assignee "$REPOSITORY_OWNER"');
    expect(localWorkflowSource).not.toContain("--assignee '@me'");
    expect(localWorkflowSource).toContain("nightly-local-diagnostics-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(localWorkflowSource).toContain("nightly-local-publication-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(localWorkflowSource).toContain("failure-diagnostics/nightly-unit-run-summary.json");
    expect(localWorkflowSource).toContain("failure-diagnostics/nightly-e2e-run-summary.json");
    expect(localWorkflowSource).toContain("failure-diagnostics/nightly-e2e-failure-evidence.json");
    expect(localWorkflowSource).toContain("'schema': 'nightly-lane-outcome-v1'");
    expect(localWorkflowSource).toContain("'failure_code': 'none' if exit_code == 0 else 'command_failed'");
    expect(localWorkflowSource).toContain("'attempt_count': 1");
    expect(localWorkflowSource).toContain("'failure_count': 0 if exit_code == 0 else 1");
    expect(localWorkflowSource).toContain("UNIT_EXIT_CODE: ${{ steps.nightly-unit.outputs.exit_code }}");
    expect(localWorkflowSource).toContain("E2E_EXIT_CODE: ${{ steps.nightly-e2e.outputs.exit_code }}");
    expect(localWorkflowSource).toContain("(exit_code == 0) != (outcome == 'success')");
    expect(localWorkflowSource).toContain("GH_TOKEN: ${{ github.token }}");
    expect(localWorkflowSource).toContain("CURRENT_JOB_STATUS: ${{ job.status }}");
    expect(localWorkflowSource).toContain("CLEANUP_OUTCOME: ${{ steps.nightly-cleanup.outcome }}");
    expect(localWorkflowSource).toContain("if [[ \"$CURRENT_JOB_STATUS\" == 'success'");
    expect(localWorkflowSource).toContain("\"$CLEANUP_OUTCOME\" == 'success'");
    expect(localWorkflowSource.indexOf("Stop and remove disposable local stack"))
      .toBeLessThan(localWorkflowSource.indexOf("Manage scheduled nightly incident"));
    expect(localWorkflowSource.indexOf("Manage scheduled nightly incident"))
      .toBeLessThan(localWorkflowSource.indexOf("Fail when disposable stack cleanup failed"));
    expect(localWorkflowSource).toContain("gh release create");
    expect(localWorkflowSource).toContain("--prerelease");
    expect(localWorkflowSource).toContain('tag="v1.2.3-nightly.${GITHUB_RUN_ID}.g${short_sha}"');
    expect(localWorkflowSource).toContain('title="Tzudong Nightly 1.2.3-nightly.${GITHUB_RUN_ID}.g${short_sha}"');
    expect(localWorkflowSource).toContain("## Highlights");
    expect(localWorkflowSource).toContain("**Full Changelog**");
    expect(localWorkflowSource).not.toContain("stack.env/\\n");
    for (const token of [
      'all_paths = list(root.rglob("*"))',
      "publication artifact tree contains a symlink",
      "files != allowed",
      "publication artifact exceeds size bound",
      "CREDENTIAL_VALUE = re.compile(",
      "EXPECTED_LEDGER_UNITS = 77",
      "def verify_manifest(",
      "def verify_migration_summary(",
      "def verify_runtime_receipt(",
      "def verify_image_preflight(",
      "EXPECTED_TYPEGEN_IMAGE = {",
      "def verify_e2e_failure_evidence(",
      "def verify_e2e_failure_evidence_file(",
    ]) {
      expect(publicationVerifierSource).toContain(token);
    }
    expect(publicationBuilderSource).toContain("EXPECTED_LEDGER_UNITS = 77");
    expect(localWorkflowSource.match(/verify-nightly-local-publication\.py/g)).toHaveLength(3);
    expect(localWorkflowSource.indexOf("Verify publication bundle before artifact persistence"))
      .toBeLessThan(localWorkflowSource.indexOf("Upload allowlisted publication bundle"));
    expect(localWorkflowSource.indexOf("Verify publication bundle before artifact persistence"))
      .toBeLessThan(localWorkflowSource.indexOf("Upload verified sanitized local nightly artifacts"));
    expect(localWorkflowSource.indexOf("Build row-free local publication evidence"))
      .toBeLessThan(localWorkflowSource.indexOf("Upload verified sanitized local nightly artifacts"));
    expect(localWorkflowSource.indexOf("Build row-free local publication evidence"))
      .toBeLessThan(localWorkflowSource.indexOf("Upload bounded failed or partial local nightly diagnostics"));
    expect(localWorkflowSource.indexOf("Build row-free local publication evidence"))
      .toBeLessThan(localWorkflowSource.indexOf("Upload allowlisted publication bundle"));

    const captureBlock = sourceBlock(
      localWorkflowSource,
      "- name: Capture bounded local diagnostics",
      "- name: Build row-free local publication evidence",
    );
    expect(captureBlock).not.toContain("local-receipt-v1.json");
    expect(captureBlock).not.toContain("nightly-unit-run.log");
    expect(captureBlock).not.toContain("nightly-e2e-run.log");
    expect(captureBlock).not.toContain('. "$LOCAL_STATE/stack.env"');
    expect(captureBlock).not.toContain("set -a");
    const verifiedDiagnosticsUploadBlock = sourceBlock(
      localWorkflowSource,
      "- name: Upload verified sanitized local nightly artifacts",
      "- name: Upload bounded failed or partial local nightly diagnostics",
    );
    expect(verifiedDiagnosticsUploadBlock).not.toContain(".log");
    expect(verifiedDiagnosticsUploadBlock).not.toContain("local-receipt-v1.json");
    expect(verifiedDiagnosticsUploadBlock).toContain("local-migration-summary.json");
    expect(verifiedDiagnosticsUploadBlock).toContain("nightly-e2e-failure-evidence.json");
    expect(verifiedDiagnosticsUploadBlock).not.toContain("nightly-playwright-private-report.json");
    expect(verifiedDiagnosticsUploadBlock).toContain("if-no-files-found: error");
    const failedDiagnosticsUploadBlock = sourceBlock(
      localWorkflowSource,
      "- name: Upload bounded failed or partial local nightly diagnostics",
      "- name: Upload allowlisted publication bundle",
    );
    expect(failedDiagnosticsUploadBlock).toContain(
      "if: ${{ always() && (failure() || cancelled() || env.NIGHTLY_SUITE != 'all') }}",
    );
    expect(failedDiagnosticsUploadBlock).not.toContain(".log");
    expect(failedDiagnosticsUploadBlock).not.toContain("local-receipt-v1.json");
    expect(failedDiagnosticsUploadBlock).not.toContain("local-migration-summary.json");
    expect(failedDiagnosticsUploadBlock).toContain(
      "nightly-artifacts/local-image-pull-preflight.json",
    );
    expect(packageLockSource).toContain('"node_modules/supabase": {\n      "version": "2.109.1"');
    expect(packageLockSource).toContain(
      '"node_modules/@supabase/cli-linux-x64": {\n      "version": "2.109.1"',
    );
    expect(bunLockSource).toContain('"supabase": ["supabase@2.109.1"');
    expect(bunLockSource).toContain(
      '"@supabase/cli-linux-x64": ["@supabase/cli-linux-x64@2.109.1"',
    );
    expect(failedDiagnosticsUploadBlock).not.toContain("local-browser-route-diagnostics.json");
    expect(failedDiagnosticsUploadBlock).toContain("nightly-unit-run-summary.json");
    expect(failedDiagnosticsUploadBlock).toContain("nightly-e2e-run-summary.json");
    expect(failedDiagnosticsUploadBlock).toContain("nightly-e2e-failure-evidence.json");
    expect(failedDiagnosticsUploadBlock).not.toContain("nightly-playwright-private-report.json");

    const installBlock = sourceBlock(
      localWorkflowSource,
      "- name: Install pinned Docker Compose",
      "- name: Enable disposable runner user namespaces",
    );
    expect(installBlock.indexOf("curl --fail")).toBeLessThan(
      installBlock.indexOf("sha256sum --check --status"),
    );
    expect(installBlock.indexOf("sha256sum --check --status")).toBeLessThan(
      installBlock.indexOf("chmod 0755"),
    );

    const startupBlock = sourceBlock(
      localWorkflowSource,
      "- name: Probe Compose service startup",
      "- name: Reset disposable local stack",
    );
    expect(startupBlock.indexOf("local_stack._stage_input_files(project, state)")).toBeLessThan(
      startupBlock.indexOf("[*command_prefix, 'up', '-d', '--pull=never', *services]"),
    );
    expect(startupBlock.indexOf("[*command_prefix, 'up', '-d', '--pull=never', *services]")).toBeLessThan(
      startupBlock.indexOf("[*command_prefix, 'down', '--volumes', '--remove-orphans']"),
    );
    expect(startupBlock.indexOf("[*command_prefix, 'down', '--volumes', '--remove-orphans']")).toBeLessThan(
      startupBlock.indexOf("[*command_prefix, 'create', '--pull=never', *services]"),
    );
    expect(startupBlock).toContain("for phase in service_phases if not failed else ():");

    const cleanupBlock = sourceBlock(
      localWorkflowSource,
      "- name: Stop and remove disposable local stack",
      "- name: Manage scheduled nightly incident",
    );
    expect(cleanupBlock).toContain("set -uo pipefail");
    expect(cleanupBlock.indexOf("local-stack.py stop")).toBeLessThan(
      cleanupBlock.indexOf("down --volumes --remove-orphans"),
    );
    expect(cleanupBlock.indexOf("docker network rm")).toBeLessThan(
      cleanupBlock.indexOf("Project-labeled networks remain after cleanup or readback failed."),
    );
    expect(cleanupBlock.indexOf('rm -rf -- "$state"')).toBeLessThan(
      cleanupBlock.indexOf("sudo rm -f -- \"$expected_admission\""),
    );
  });

  test("uses one exact publication allowlist from capture through release", () => {
    const allowlist = publicationAllowlistSource.trim().split("\n");
    expect(allowlist).toEqual([
      "local-stack-reset.json",
      "local-image-pull-preflight.json",
      "local-stack-status.json",
      "local-migration-manifest.json",
      "local-migration-summary.json",
      "local-closure-rescan.json",
      "local-closure-smoke.json",
      "local-browser-route-diagnostics.json",
      "publication-boundary.txt",
    ]);
    expect(new Set(allowlist).size).toBe(allowlist.length);
    expect(allowlist).not.toContain("nightly-e2e-failure-evidence.json");
    expect(localWorkflowSource.match(/nightly-local-publication-allowlist\.txt/g)).toHaveLength(3);
    expect(publicationVerifierSource.match(/nightly-local-publication-allowlist\.txt/g)).toHaveLength(1);
    expect(localWorkflowSource).not.toContain("nightly-artifacts/local-stack-reset.json \\\n");
    expect(localWorkflowSource).not.toContain("nightly-artifacts/local-receipt-v1.json");
    expect(localWorkflowSource).not.toContain("Path('local-receipt-v1.json')");
    expect(localWorkflowSource).toContain("python3 .github/scripts/build-nightly-local-publication.py");
    expect(localWorkflowSource).toContain('--browser-source "apps/web/test-results/local-browser-route-diagnostics.json"');
    expect(publicationBuilderSource).toContain('artifacts_root / "local-migration-summary.json"');
    expect(publicationBuilderSource).not.toContain('artifacts_root / "local-receipt-v1.json"');
    const publicationBuilderIndex = localWorkflowSource.indexOf(
      "python3 .github/scripts/build-nightly-local-publication.py",
    );
    expect(publicationBuilderIndex).toBeGreaterThan(0);
    expect(publicationBuilderIndex).toBeLessThan(
      localWorkflowSource.indexOf("Verify publication bundle before artifact persistence"),
    );
    expect(publicationVerifierSource).toContain("publication bundle exceeds aggregate size bound");
    expect(publicationVerifierSource).toContain("credential-shaped value");
    expect(publicationVerifierSource).not.toContain("|jwt");
  });

  test("attempts both requested local lanes before aggregating their raw outcomes", () => {
    const unitIndex = localWorkflowSource.indexOf("- name: Run local nightly unit regression");
    const e2eIndex = localWorkflowSource.indexOf("- name: Run local nightly browser regression");
    const aggregateIndex = localWorkflowSource.indexOf("- name: Aggregate local nightly lane outcomes");
    expect(unitIndex).toBeGreaterThan(0);
    expect(e2eIndex).toBeGreaterThan(unitIndex);
    expect(aggregateIndex).toBeGreaterThan(e2eIndex);
    const laneBlock = localWorkflowSource.slice(unitIndex, aggregateIndex);
    expect(laneBlock.match(/continue-on-error: true/g)).toHaveLength(2);
    expect(laneBlock.match(/set \+e/g)).toHaveLength(2);
    for (const lane of ["unit", "e2e"] as const) {
      const block = sourceBlock(
        localWorkflowSource,
        `- name: Run local nightly ${lane === "unit" ? "unit" : "browser"} regression`,
        lane === "unit"
          ? "- name: Run local nightly browser regression"
          : "- name: Aggregate local nightly lane outcomes",
      );
      expect(block.indexOf("set +e")).toBeLessThan(block.indexOf("bun run test:nightly"));
      expect(block.indexOf("bun run test:nightly")).toBeLessThan(block.indexOf("exit_code=$?"));
      expect(block.indexOf("exit_code=$?")).toBeLessThan(block.indexOf('>> "$GITHUB_OUTPUT"'));
    }
    expect(laneBlock).not.toContain('--suite "$NIGHTLY_SUITE"');
    expect(localWorkflowSource.slice(aggregateIndex)).toContain("steps.nightly-unit.outcome");
    expect(localWorkflowSource.slice(aggregateIndex)).toContain("steps.nightly-e2e.outcome");
  });

  test("captures a failing lane exit code even when the workflow shell inherits errexit", () => {
    const block = sourceBlock(
      localWorkflowSource,
      "- name: Run local nightly unit regression",
      "- name: Run local nightly browser regression",
    );
    const scriptStart = block.indexOf("          set -uo pipefail\n");
    const scriptEnd = block.indexOf('          exit "$exit_code"', scriptStart);
    expect(scriptStart).toBeGreaterThanOrEqual(0);
    expect(scriptEnd).toBeGreaterThan(scriptStart);
    const script = block
      .slice(scriptStart, scriptEnd + '          exit "$exit_code"'.length)
      .split("\n")
      .map((line) => line.replace(/^ {10}/, ""))
      .join("\n")
      .replace(
        /bun run test:nightly -- \\\n(?: {2}.*\\\n){4} {2}> nightly-unit-run\.log 2>&1/,
        "bash -c 'exit 37'",
      );
    expect(script).toContain("bash -c 'exit 37'");
    expect(script).not.toContain("bun run test:nightly");

    const temporaryRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-errexit-"));
    const outputPath = join(temporaryRoot, "github-output");
    try {
      const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
        cwd: temporaryRoot,
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: outputPath },
      });
      expect(result.status).toBe(37);
      expect(readFileSync(outputPath, "utf8")).toBe("exit_code=37\n");
    } finally {
      rmSync(temporaryRoot, { recursive: true });
    }
  });

  test("emits only fixed-schema lane summaries and rejects inconsistent outcomes", () => {
    const block = sourceBlock(
      localWorkflowSource,
      "- name: Write bounded nightly lane diagnostics",
      "- name: Capture bounded Compose runtime diagnostics",
    );
    const script = embeddedPython(block);
    const temporaryRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-lanes-"));
    try {
      const successful = spawnSync("python3", ["-c", script], {
        cwd: temporaryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          NIGHTLY_SUITE: "all",
          UNIT_OUTCOME: "success",
          UNIT_EXIT_CODE: "0",
          E2E_OUTCOME: "failure",
          E2E_EXIT_CODE: "7",
          NIGHTLY_ADMIN_EMAIL: "private@example.invalid",
          NIGHTLY_ADMIN_PASSWORD: "private-test-password",
        },
      });
      expect(successful.status).toBe(0);
      const unit = JSON.parse(readFileSync(
        join(temporaryRoot, "nightly-artifacts/failure-diagnostics/nightly-unit-run-summary.json"),
        "utf8",
      )) as Record<string, unknown>;
      const e2e = JSON.parse(readFileSync(
        join(temporaryRoot, "nightly-artifacts/failure-diagnostics/nightly-e2e-run-summary.json"),
        "utf8",
      )) as Record<string, unknown>;
      expect(Object.keys(unit).sort()).toEqual([
        "attempt_count", "exit_code", "failure_code", "failure_count", "lane", "outcome", "schema",
      ]);
      expect(unit).toEqual({
        schema: "nightly-lane-outcome-v1",
        lane: "unit",
        outcome: "success",
        failure_code: "none",
        exit_code: 0,
        attempt_count: 1,
        failure_count: 0,
      });
      expect(e2e).toEqual({
        schema: "nightly-lane-outcome-v1",
        lane: "e2e",
        outcome: "failure",
        failure_code: "command_failed",
        exit_code: 7,
        attempt_count: 1,
        failure_count: 1,
      });
      expect(JSON.stringify([unit, e2e])).not.toMatch(/@|password|token|body|error/i);

      const inconsistentRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-lanes-bad-"));
      try {
        const inconsistent = spawnSync("python3", ["-c", script], {
          cwd: inconsistentRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            NIGHTLY_SUITE: "unit",
            UNIT_OUTCOME: "success",
            UNIT_EXIT_CODE: "9",
            E2E_OUTCOME: "skipped",
            E2E_EXIT_CODE: "",
          },
        });
        expect(inconsistent.status).not.toBe(0);
        expect(inconsistent.stderr).toContain("requested nightly lane exit/outcome mismatch");
      } finally {
        rmSync(inconsistentRoot, { recursive: true });
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true });
    }
  });

  test("verifies and copies only bounded E2E failure evidence into diagnostics", () => {
    const block = sourceBlock(
      localWorkflowSource,
      "- name: Write bounded nightly lane diagnostics",
      "- name: Capture bounded Compose runtime diagnostics",
    );
    const script = embeddedPython(block);
    const evidence = {
      schema: "nightly-playwright-failure-evidence-v1",
      source: "playwright-json-report-v2",
      command_exit_code: 1,
      outcome: "failure",
      test_count: 2,
      test_status_counts: { expected: 1, flaky: 0, skipped: 0, unexpected: 1 },
      result_status_counts: { failed: 1, interrupted: 0, passed: 1, skipped: 0, timedOut: 0 },
      report_error_count: 0,
      failure_count: 1,
      failure_class_counts: {
        failed: 1,
        interrupted: 0,
        no_result: 0,
        runner_error: 0,
        timed_out: 0,
        unexpected_pass: 0,
      },
      failures: [{
        spec_id: "PW-NAV",
        test_index: 2,
        classification: "failed",
        attempt_count: 1,
        result_error_count: 1,
      }],
    };
    const repositoryRoot = resolve(appRoot, "../..");
    const temporaryRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-e2e-evidence-"));
    try {
      const sourceDirectory = join(temporaryRoot, "apps/web/test-results");
      mkdirSync(sourceDirectory, { recursive: true });
      writeFileSync(
        join(sourceDirectory, "nightly-playwright-failure-evidence.json"),
        `${JSON.stringify(evidence)}\n`,
        { mode: 0o600 },
      );
      const result = spawnSync("python3", ["-c", script], {
        cwd: temporaryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_WORKSPACE: repositoryRoot,
          NIGHTLY_SUITE: "e2e",
          UNIT_OUTCOME: "skipped",
          UNIT_EXIT_CODE: "",
          E2E_OUTCOME: "failure",
          E2E_EXIT_CODE: "1",
        },
      });
      expect(result.status).toBe(0);
      const target = join(
        temporaryRoot,
        "nightly-artifacts/failure-diagnostics/nightly-e2e-failure-evidence.json",
      );
      expect(lstatSync(target).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(evidence);

      const runnerRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-runner-evidence-"));
      try {
        const runnerDirectory = join(runnerRoot, "apps/web/test-results");
        mkdirSync(runnerDirectory, { recursive: true });
        const runnerEvidence = {
          schema: "nightly-e2e-runner-stage-evidence-v1",
          source: "nightly-runner-stage-v1",
          command_exit_code: 1,
          outcome: "failure",
          stage: "health",
          failure_class: "application_exit",
        };
        writeFileSync(
          join(runnerDirectory, "nightly-playwright-failure-evidence.json"),
          `${JSON.stringify(runnerEvidence)}\n`,
          { mode: 0o600 },
        );
        const runnerResult = spawnSync("python3", ["-c", script], {
          cwd: runnerRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_WORKSPACE: repositoryRoot,
            NIGHTLY_SUITE: "e2e",
            UNIT_OUTCOME: "skipped",
            UNIT_EXIT_CODE: "",
            E2E_OUTCOME: "failure",
            E2E_EXIT_CODE: "1",
            GITHUB_STEP_SUMMARY: join(runnerRoot, "github-step-summary.md"),
          },
        });
        expect(runnerResult.status).toBe(0);
        expect(JSON.parse(readFileSync(join(
          runnerRoot,
          "nightly-artifacts/failure-diagnostics/nightly-e2e-failure-evidence.json",
        ), "utf8"))).toEqual(runnerEvidence);
        expect(readFileSync(join(runnerRoot, "github-step-summary.md"), "utf8")).toBe(
          "- E2E fixed runner stage: health\n"
          + "- E2E fixed runner failure class: application_exit\n",
        );

        for (const impossibleRunnerEvidence of [
          { ...runnerEvidence, failure_class: "custody_rejected" },
          { ...runnerEvidence, stage: "sanitize", failure_class: "health_timeout" },
        ]) {
          const impossibleRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-impossible-runner-"));
          try {
            const impossibleDirectory = join(impossibleRoot, "apps/web/test-results");
            mkdirSync(impossibleDirectory, { recursive: true });
            writeFileSync(
              join(impossibleDirectory, "nightly-playwright-failure-evidence.json"),
              `${JSON.stringify(impossibleRunnerEvidence)}\n`,
              { mode: 0o600 },
            );
            const impossibleResult = spawnSync("python3", ["-c", script], {
              cwd: impossibleRoot,
              encoding: "utf8",
              env: {
                ...process.env,
                GITHUB_WORKSPACE: repositoryRoot,
                NIGHTLY_SUITE: "e2e",
                UNIT_OUTCOME: "skipped",
                UNIT_EXIT_CODE: "",
                E2E_OUTCOME: "failure",
                E2E_EXIT_CODE: "1",
                GITHUB_STEP_SUMMARY: join(impossibleRoot, "github-step-summary.md"),
              },
            });
            expect(impossibleResult.status).not.toBe(0);
            expect(impossibleResult.stderr).toContain(
              "nightly E2E runner stage evidence contract mismatch",
            );
            expect(() => lstatSync(join(
              impossibleRoot,
              "nightly-artifacts/failure-diagnostics/nightly-e2e-failure-evidence.json",
            ))).toThrow();
            expect(() => lstatSync(join(impossibleRoot, "github-step-summary.md"))).toThrow();
          } finally {
            rmSync(impossibleRoot, { recursive: true });
          }
        }
      } finally {
        rmSync(runnerRoot, { recursive: true });
      }

      const rejectedRoot = mkdtempSync(join(tmpdir(), "tzudong-nightly-e2e-rejected-"));
      try {
        const rejectedDirectory = join(rejectedRoot, "apps/web/test-results");
        mkdirSync(rejectedDirectory, { recursive: true });
        writeFileSync(
          join(rejectedDirectory, "nightly-playwright-failure-evidence.json"),
          `${JSON.stringify({ ...evidence, title: "PRIVATE_TITLE_MARKER" })}\n`,
          { mode: 0o600 },
        );
        const rejected = spawnSync("python3", ["-c", script], {
          cwd: rejectedRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_WORKSPACE: repositoryRoot,
            NIGHTLY_SUITE: "e2e",
            UNIT_OUTCOME: "skipped",
            UNIT_EXIT_CODE: "",
            E2E_OUTCOME: "failure",
            E2E_EXIT_CODE: "1",
          },
        });
        expect(rejected.status).not.toBe(0);
        expect(rejected.stderr).toContain("nightly E2E failure evidence contract mismatch");
        expect(() => lstatSync(join(
          rejectedRoot,
          "nightly-artifacts/failure-diagnostics/nightly-e2e-failure-evidence.json",
        ))).toThrow();
      } finally {
        rmSync(rejectedRoot, { recursive: true });
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true });
    }
  });

  test("routes public web and local Supabase changes into Web Admin CI", () => {
    for (const path of [
      "apps/web/**",
      "apps/web/app/**",
      "apps/web/components/**",
      "apps/web/hooks/**",
      "apps/web/integrations/**",
      "apps/web/lib/**",
      "apps/web/public/**",
      "apps/web/supabase/**",
      "backend/supabase/**",
      ".github/workflows/nightly-regression.yml",
      ".github/workflows/nightly-local-regression.yml",
      ".github/nightly-local-publication-allowlist.txt",
    ]) {
      expect(webAdminWorkflowSource.match(new RegExp(path.replaceAll("*", "\\*"), "g"))).toHaveLength(2);
    }
  });
});
