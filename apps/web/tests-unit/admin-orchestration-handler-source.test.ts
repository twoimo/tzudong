import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// Feature: crawler-pipeline-orchestration, Requirement 9.6
// Source-contract test: any web admin API handler that exposes an orchestration
// operation MUST (1) require successful requireAdmin authorization before doing any
// orchestration work, and (2) return only bounded fixed-code responses that never
// embed provider or database error detail.

const root = process.cwd();

function source(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const ADMIN_API_DIR = "app/api/admin";

// Signals that a route.ts exposes a pipeline-orchestration operation. Any of these
// present in the source marks the file as an orchestration handler that this contract
// must cover. This is discovery-based so a future orchestration handler is caught too.
const ORCHESTRATION_SIGNALS = [
  "@/lib/admin/pipeline-control",
  "PIPELINE_API_BASE",
  "/v1/runs",
  "assertPipelineGuardedBody",
] as const;

// The known orchestration handler(s). Discovery must at minimum include this so the
// invariant can never pass vacuously.
const REQUIRED_ORCHESTRATION_HANDLERS = ["app/api/admin/pipeline/route.ts"] as const;

// Bounded HTTP status codes an orchestration handler is allowed to return as a numeric
// literal. Forwarded upstream status variables (response.status) are not literals and
// are intentionally not part of this closed set.
const ALLOWED_STATUS_CODES = new Set([
  200, 202, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504,
]);

// A bounded fixed error code is a short identifier token with no whitespace or free-form
// punctuation, so it cannot smuggle provider identifiers, DB error text, connection
// strings, or stack traces into the response.
const FIXED_CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;

// Response-leak patterns: putting a raw error/message/stack into a response body.
const RESPONSE_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "error: error.message", pattern: /error:\s*error\.message/ },
  { label: "error: err.message", pattern: /error:\s*err\.message/ },
  { label: "error: String(", pattern: /error:\s*String\(/ },
  { label: "error: JSON.stringify(", pattern: /error:\s*JSON\.stringify\(/ },
  { label: "error: `${...}`", pattern: /error:\s*`/ },
  { label: "message: <error> passthrough", pattern: /message:\s*(?:error|err)\b/ },
  { label: ".stack in response", pattern: /\.stack\b/ },
];

// Provider/database detail markers that must never appear in an admin orchestration
// handler's own source (it proxies an internal job API and must not touch these).
const PROVIDER_DETAIL_MARKERS = [
  "supabase",
  "postgres",
  "postgrest",
  "sqlstate",
  "connection string",
  "pg_",
];

function listAdminRouteFiles(): string[] {
  const abs = join(root, ADMIN_API_DIR);
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "route.ts")
    .map((entry) =>
      relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    )
    .sort();
}

function discoverOrchestrationHandlers(): string[] {
  return listAdminRouteFiles().filter((rel) => {
    const src = source(rel);
    return ORCHESTRATION_SIGNALS.some((signal) => src.includes(signal));
  });
}

type HandlerBody = { name: string; body: string };

// Split a route source into per-exported-HTTP-handler bodies.
function extractHandlerBodies(src: string): HandlerBody[] {
  const decl = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  const starts: Array<{ name: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = decl.exec(src)) !== null) {
    starts.push({ name: match[1], index: match.index });
  }
  return starts.map((entry, i) => ({
    name: entry.name,
    body: src.slice(entry.index, starts[i + 1]?.index ?? src.length),
  }));
}

// Markers that represent orchestration work — anything that inspects the request body,
// contacts the upstream job API, or mutates orchestration state. requireAdmin must run
// before all of them.
const ORCHESTRATION_WORK_MARKERS = [
  "pipelineFetch(",
  "readGithubCrawlerSnapshot(",
  "parsePipelinePreviewBody(",
  "assertPipelineGuardedBody(",
  "readBoundedJsonRequest(",
  "isTrustedSameOriginMutation(",
  "sealPreviewTicket(",
  "openPreviewTicket(",
];

function earliestWorkIndex(body: string): number {
  let earliest = Infinity;
  for (const marker of ORCHESTRATION_WORK_MARKERS) {
    const idx = body.indexOf(marker);
    if (idx >= 0 && idx < earliest) earliest = idx;
  }
  return earliest;
}

function fixedErrorCodeLiterals(src: string): string[] {
  const codes: string[] = [];
  const re = /error:\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    codes.push(match[1]);
  }
  return codes;
}

function numericStatusLiterals(src: string): number[] {
  const codes: number[] = [];
  const re = /status:\s*(\d{3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    codes.push(Number(match[1]));
  }
  return codes;
}

const orchestrationHandlers = discoverOrchestrationHandlers();

describe("admin orchestration handler source contract (R9.6)", () => {
  test("discovery is non-vacuous and includes the known orchestration handler", () => {
    expect(orchestrationHandlers.length).toBeGreaterThan(0);
    for (const required of REQUIRED_ORCHESTRATION_HANDLERS) {
      expect(orchestrationHandlers).toContain(required);
    }
  });

  test("every orchestration handler imports requireAdmin", () => {
    for (const rel of orchestrationHandlers) {
      const src = source(rel);
      expect(src).toContain("from \"@/lib/auth/require-admin\"");
      expect(src).toContain("requireAdmin");
    }
  });

  test("requireAdmin runs first and gates every exported orchestration handler", () => {
    for (const rel of orchestrationHandlers) {
      const src = source(rel);
      const handlers = extractHandlerBodies(src);
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        const authIndex = handler.body.indexOf("requireAdmin(");
        // requireAdmin must be invoked in the handler.
        expect(authIndex).toBeGreaterThanOrEqual(0);
        // The unauthorized result must short-circuit before any work.
        expect(handler.body).toContain("!auth.ok");
        const authGuardIndex = handler.body.indexOf("!auth.ok");
        expect(authGuardIndex).toBeGreaterThan(authIndex);
        // requireAdmin must precede any orchestration work in this handler.
        const workIndex = earliestWorkIndex(handler.body);
        if (workIndex !== Infinity) {
          expect(authIndex).toBeLessThan(workIndex);
          expect(authGuardIndex).toBeLessThan(workIndex);
        }
      }
    }
  });

  test("every response error code is a bounded fixed-code token", () => {
    for (const rel of orchestrationHandlers) {
      const codes = fixedErrorCodeLiterals(source(rel));
      // At least one fixed error code exists (bounded failure surface).
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) {
        expect(FIXED_CODE_SHAPE.test(code)).toBe(true);
      }
    }
  });

  test("every numeric status literal is within the bounded status set", () => {
    for (const rel of orchestrationHandlers) {
      const statuses = numericStatusLiterals(source(rel));
      expect(statuses.length).toBeGreaterThan(0);
      for (const status of statuses) {
        expect(ALLOWED_STATUS_CODES.has(status)).toBe(true);
      }
    }
  });

  test("caught errors are surfaced through the admin-safe bounded mapper", () => {
    for (const rel of orchestrationHandlers) {
      const src = source(rel);
      // Any handler with a catch block must map errors through the bounded helper
      // rather than returning raw error text.
      if (src.includes("catch")) {
        expect(src).toContain("getAdminSafeErrorName");
      }
    }
  });

  test("handlers never embed raw error text or provider/DB detail in responses", () => {
    for (const rel of orchestrationHandlers) {
      const src = source(rel);
      for (const leak of RESPONSE_LEAK_PATTERNS) {
        expect(leak.pattern.test(src)).toBe(false);
      }
      const lower = src.toLowerCase();
      for (const marker of PROVIDER_DETAIL_MARKERS) {
        expect(lower.includes(marker)).toBe(false);
      }
    }
  });
});
