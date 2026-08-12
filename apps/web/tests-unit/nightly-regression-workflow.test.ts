import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const read = (relativePath: string) => readFileSync(resolve(appRoot, relativePath), "utf8");

const packageSource = read("package.json");
const packageJson = JSON.parse(packageSource) as {
  scripts?: Record<string, unknown>;
};
const nightlyRunnerSource = read("scripts/run-nightly-regression.mjs");
const playwrightConfigSource = read("playwright.config.ts");
const healthRouteSource = read("app/api/health/route.ts");
const nightlyFixtureSource = read("tests/nightly/nightly-test.ts");
const mobileHomeMapHelpersSource = read("tests/mobile-home-map-helpers.ts");
const localWorkflowSource = read("../../.github/workflows/nightly-local-regression.yml");
const hostedWorkflowSource = readFileSync(
  resolve(appRoot, "../../.github/workflows/nightly-regression.yml"),
  "utf8",
);
const curatedSpecs = [
  "tests/smoke.spec.ts",
  "tests/navigation.spec.ts",
  "tests/browser-title.spec.ts",
  "tests/mobile-home-map.spec.ts",
] as const;

function sourceBlock(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("nightly regression package and source contracts", () => {
  test("publishes one package entry point for the explicit nightly runner", () => {
    expect(packageJson.scripts?.["test:nightly"]).toBe(
      "node scripts/run-nightly-regression.mjs",
    );
    expect(packageSource).toContain('"test:nightly": "node scripts/run-nightly-regression.mjs"');
    expect(nightlyRunnerSource).toContain("function parseArguments(argumentsList)");
    expect(nightlyRunnerSource).toContain("function main()");
  });

  test("passes the verified Node 24 supervisor into the unit lane", () => {
    expect(nightlyRunnerSource).toContain(
      "const supervisorExecutable = process.env.TZUDONG_NODE24_EXECUTABLE?.trim();",
    );
    expect(nightlyRunnerSource).toContain(
      "TZUDONG_NODE24_EXECUTABLE: supervisorExecutable",
    );
  });

  test("preserves the hosted nightly schedule and bounded diagnostics", () => {
    expect(hostedWorkflowSource).toContain("cron: '30 18 * * *'");
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
    expect(hostedWorkflowSource).toContain("contents: read");
    expect(hostedWorkflowSource).toContain("actions: read");
    expect(hostedWorkflowSource).toContain("Notification failed; see GitHub summary.");
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
    expect(environmentLoader).not.toContain("loadEnv()");
    expect(environmentLoader).not.toContain("path: '.env'");
    expect(nightlyRunnerSource).toContain("function loadProvenance(mode, envFilePath, provenanceFileArgument)");
    expect(nightlyRunnerSource).toContain("Nightly env provenance does not match the explicit env file.");
  });

  test("keeps the browser lane pinned to exactly four curated specs", () => {
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
      "application-path-denied",
      "isAllowedSupabaseFixturePath",
    ]) {
      expect(nightlyFixtureSource).toContain(token);
    }
    for (const spec of curatedSpecs) {
      expect(read(spec)).toContain("./nightly/nightly-test");
    }
  });
  test("requires an explicit non-conflicting local browser port", () => {
    expect(nightlyRunnerSource).toContain("Local nightly mode requires an explicit APP_PORT that is not the protected 8080 listener.");
    expect(nightlyRunnerSource).toContain("Local nightly APP_PORT must not overlap a generated Supabase service port.");
    expect(nightlyRunnerSource).toContain("KONG_HTTP_PORT");
    expect(nightlyRunnerSource).toContain("POSTGRES_HOST_PORT");
    expect(nightlyRunnerSource).toContain("const requestedPort = Number(environment.APP_PORT);");
    expect(nightlyRunnerSource).toContain("assertRepositoryInputFile");
    expect(nightlyRunnerSource).toContain("inputMetadata.source_manifest_mode !== manifestMode");
    expect(nightlyRunnerSource).toContain("const expectedHost = `${projectRef}.supabase.co`;");
  });

  test("requires current owner-only local stack and migration receipts before browser admission", () => {
    for (const token of [
      "const localMigrationReceiptFilename = 'local-receipt-v1.json';",
      "async function assertLocalMigrationReceipt(stateRoot, stackReceipt)",
      "receipt.schema !== 'local-receipt-v1'",
      "receipt.serializer !== 'receipt-v1'",
      "receipt.ledger.length !== 69",
      "localReceiptSequenceMarkers = ['prerequisite', 'migration', 'closure', 'platform-bootstrap', 'seed']",
      "  'platform_bootstrap_evidence_sha256',",
      "  'platform_bootstrap_sha256',",
      "module._load_receipt_file(pathlib.Path(sys.argv[2]))",
      "service.health !== 'healthy'",
      'any(item.get("health") != "healthy" for item in services)',
      "Local stack readiness evidence contains a non-running or unhealthy service.",
    ]) {
      expect(nightlyRunnerSource).toContain(token);
    }
  });

  test("keeps nightly web log custody owner-only and symlink-safe", () => {
    for (const token of [
      "function openNightlyWebLog(logPath)",
      "fsConstants.O_NOFOLLOW",
      "fsConstants.O_CREAT | fsConstants.O_EXCL",
      "fstatSync(descriptor)",
      "ftruncateSync(descriptor, 0)",
      "nightly-web.log must be an owner-only regular file.",
      "const logStream = openNightlyWebLog(logPath);",
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
      "method === 'OPTIONS'",
      "method !== 'GET'",
      "method === 'POST'",
      "const LOCAL_REST_FIXTURE_PATHS",
      "const LOCAL_AUTH_FIXTURE_PATHS",
      "if (!LOCAL_REST_FIXTURE_PATHS.has(url.pathname))",
      "if (!LOCAL_AUTH_FIXTURE_PATHS.has(url.pathname))",
    ]) {
      expect(mobileHomeMapHelpersSource).toContain(token);
    }
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

  test("accepts the runner base URL and forwards nightly provenance without service-key leakage", () => {
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
    for (const secret of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ACCESS_TOKEN",
      "NIGHTLY_ADMIN_PASSWORD",
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

  test("reconstructs local Docker nightly and uploads only sanitized artifacts", () => {
    for (const token of [
      "runs-on: ubuntu-24.04",
      "docker-compose-linux-${compose_arch}",
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
      "python3 backend/supabase/scripts/local-migrate.py receipt",
      "--mode local",
      "actions/upload-artifact@v4",
      "publication-boundary.txt",
      "failure-diagnostics/local-stack-failure-diagnostics.json",
      "local-stack-failure-diagnostics-v1",
      "allowed_services",
      "allowed_states",
      "allowed_health",
      "Pull pinned Compose images",
      "docker', 'pull'",
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
      "Capture bounded Compose runtime diagnostics",
      "local-compose-runtime-diagnostics-v1",
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
      "stack.env and credentials excluded",
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
    ]) {
      expect(localWorkflowSource).toContain(token);
    }
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
    expect(localWorkflowSource).toContain("if: ${{ needs.local.result == 'success' && github.ref == 'refs/heads/main' }}");
    expect(localWorkflowSource).toContain('test "${GITHUB_SHA}" = "$main_sha"');
    expect(localWorkflowSource).toContain("actions/download-artifact@v4");
    expect(localWorkflowSource).not.toContain("nightly-artifacts/nightly-run.log");
    expect(localWorkflowSource).not.toContain("nightly-artifacts/nightly-web.log");
    expect(localWorkflowSource).not.toContain("(Path('apps/web/nightly-run.log')");
    expect(localWorkflowSource).not.toContain("(Path('apps/web/nightly-web.log')");
    for (const token of [
      "all_paths = list(root.rglob('*'))",
      "publication artifact tree contains a symlink",
      "files != allowed",
      "publication artifact exceeds size bound",
      "forbidden = re.compile",
      "Local-only sanitized receipts; stack.env and credentials excluded.",
    ]) {
      expect(localWorkflowSource).toContain(token);
    }
    expect(localWorkflowSource).toContain("contents: write");
    expect(localWorkflowSource).toContain("GH_TOKEN: ${{ github.token }}");
    expect(localWorkflowSource).toContain("gh release create");
    expect(localWorkflowSource).toContain("--prerelease");
    expect(localWorkflowSource).not.toContain("stack.env/\\n");
  });
});
