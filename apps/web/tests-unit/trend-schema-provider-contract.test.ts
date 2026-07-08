import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const webRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(webRoot, "..", "..");

const source = (relativePathFromWebRoot: string) =>
  readFileSync(path.join(webRoot, relativePathFromWebRoot), "utf8");

const repoSource = (relativePathFromRepoRoot: string) =>
  readFileSync(path.join(repoRoot, relativePathFromRepoRoot), "utf8");

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();
const normalizeContractText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s*([(),:|])\s*/g, "$1")
    .toLowerCase();


const requiredTrendTables = [
  "admin_trend_signal_runs",
  "admin_trend_signal_observations",
  "admin_restaurant_map_overlay_proposals",
  "admin_trend_job_requests",
  "admin_restaurant_map_overlay_proposal_review_events",
] as const;

const allowedDomains = [
  "korean.visitkorea.or.kr",
  "www.korea.net",
  "www.mafra.go.kr",
  "www.kma.go.kr",
  "www.nongsaro.go.kr",
  "www.foodsafetykorea.go.kr",
  "www.mcst.go.kr",
  "www.youtube.com",
] as const;

const queryTemplateIds = [
  "seasonal_food_month_ko",
  "holiday_food_context_ko",
  "region_food_season_ko",
  "tzuyang_video_context_ko",
  "category_trend_context_ko",
] as const;

const forbiddenRawContentKeys = [
  "rawHtml",
  "html",
  "body",
  "rawContent",
  "pageContent",
  "raw",
  "content",
] as const;

const expectIncludesContract = (actual: string, expected: string) => {
  expect(normalizeContractText(actual)).toContain(normalizeContractText(expected));
};

const expectSqlIncludes = (normalizedSql: string, expected: string) => {
  expectIncludesContract(normalizedSql, expected);
};

const expectSqlMatches = (sql: string, pattern: RegExp) => {
  expect(sql.toLowerCase()).toMatch(pattern);
};

const collectObjects = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.flatMap(collectObjects);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record, ...Object.values(record).flatMap(collectObjects)];
  }
  return [];
};

function tableInsertBlock(typesSource: string, tableName: string) {
  const tableStart = typesSource.indexOf(`${tableName}: {`);
  expect(tableStart, `${tableName} table should exist`).toBeGreaterThanOrEqual(0);
  const insertStart = typesSource.indexOf("Insert: {", tableStart);
  expect(insertStart, `${tableName} Insert block should exist`).toBeGreaterThanOrEqual(0);
  const updateStart = typesSource.indexOf("Update: {", insertStart);
  expect(updateStart, `${tableName} Update block should exist`).toBeGreaterThan(insertStart);
  return typesSource.slice(insertStart, updateStart);
}

describe("Package E trend schema and provider source contracts", () => {
  test("migration defines trend foundation tables, RLS, grants, constraints, indexes, and v1 job status", () => {
    const migration = repoSource(
      "backend/supabase/migrations/20260707000300_admin_trend_schema_foundation.sql",
    );
    const normalized = normalizeSql(migration);

    for (const table of requiredTrendTables) {
      expectSqlIncludes(normalized, `create table if not exists public.${table}`);
      expectSqlIncludes(normalized, `alter table public.${table} enable row level security`);
      expectSqlIncludes(
        normalized,
        `revoke all on table public.${table} from public, anon, authenticated`,
      );
      expectSqlMatches(
        migration,
        new RegExp(`grant\\s+[^;]+\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+service_role`, "i"),
      );
    }

    expect(migration).not.toContain("cancel_requested");
    expect(migration).not.toMatch(/grant\s+[^;]+to\s+(public|anon|authenticated)\s*;/i);

    expectSqlIncludes(
      normalized,
      "run_kind text not null check (run_kind in ('scheduled','manual_request','backfill','dry_run'))",
    );
    expectSqlIncludes(
      normalized,
      "status text not null check (status in ('running','succeeded','failed','partial','cancelled'))",
    );
    expectSqlIncludes(
      normalized,
      "source_type text not null check (source_type in ('youtube_kpi','web_search','seasonal_rule','internal_search_rank','review_activity'))",
    );
    expectSqlIncludes(
      normalized,
      "overlay_type text not null check (overlay_type in ('trend','seasonal'))",
    );
    expectSqlIncludes(
      normalized,
      "proposal_status text not null default 'pending' check (proposal_status in ('pending','approved','rejected','superseded','expired'))",
    );
    expectSqlIncludes(
      normalized,
      "request_kind text not null check (request_kind in ('trend_proposal_run','dry_run'))",
    );
    expectSqlIncludes(
      normalized,
      "status text not null default 'queued' check (status in ('queued','claimed','succeeded','failed','cancelled'))",
    );
    expectSqlIncludes(
      normalized,
      "to_status text not null check (to_status in ('rejected','superseded','expired'))",
    );

    for (const expectedConstraint of [
      "char_length(raw_excerpt) <= 500",
      "char_length(trim(label)) between 1 and 80",
      "char_length(description) <= 500",
      "score >= 0 and score <= 100",
      "unique (restaurant_id, overlay_type, proposal_hash)",
      "unique (requested_by_admin_id, idempotency_key)",
      "unique (actor_user_id, idempotency_key)",
    ]) {
      expectSqlIncludes(normalized, expectedConstraint);
    }

    for (const expectedIndex of [
      "admin_trend_signal_observations_run_id_idx",
      "admin_trend_signal_observations_restaurant_observed_idx",
      "admin_trend_signal_observations_source_signal_idx",
      "admin_restaurant_map_overlay_proposals_status_created_idx",
      "admin_restaurant_map_overlay_proposals_restaurant_status_idx",
      "admin_trend_job_requests_status_created_idx",
      "admin_restaurant_map_overlay_proposal_review_events_proposal_id_idx",
    ]) {
      expect(normalized).toContain(expectedIndex);
    }
  });

  test("Supabase generated types expose matching Package E tables and v1 unions", () => {
    const typesSource = source("integrations/supabase/types.ts");

    for (const table of requiredTrendTables) {
      expect(typesSource).toContain(`${table}: {`);
      expect(typesSource).toContain("Row: {");
      expect(typesSource).toContain("Insert: {");
      expect(typesSource).toContain("Update: {");
    }

    expect(typesSource).not.toContain("cancel_requested");
    for (const unionToken of [
      "run_kind",
      "'scheduled'",
      "'manual_request'",
      "'backfill'",
      "'dry_run'",
      "source_type",
      "'youtube_kpi'",
      "'web_search'",
      "'seasonal_rule'",
      "'internal_search_rank'",
      "'review_activity'",
      "overlay_type",
      "'trend'",
      "'seasonal'",
      "proposal_status",
      "'pending'",
      "'approved'",
      "'rejected'",
      "'superseded'",
      "'expired'",
      "request_kind",
      "'trend_proposal_run'",
      "status: 'queued' | 'claimed' | 'succeeded' | 'failed' | 'cancelled'",
      "to_status",
    ]) {
      expect(typesSource).toContain(unionToken);
    }

    const runInsert = tableInsertBlock(typesSource, "admin_trend_signal_runs");
    expect(runInsert).toContain("status: 'running' | 'succeeded' | 'failed' | 'partial' | 'cancelled'");
    expect(runInsert).not.toContain("status?: 'running'");

    const proposalInsert = tableInsertBlock(typesSource, "admin_restaurant_map_overlay_proposals");
    expect(proposalInsert).toContain("score_breakdown: Json");
    expect(proposalInsert).toContain("evidence: Json");
    expect(proposalInsert).not.toContain("score_breakdown?: Json");
    expect(proposalInsert).not.toContain("evidence?: Json");
  });

  test("Google CSE provider docs lock v1 provider, fail-soft states, allowlist, templates, and fixture policy", () => {
    const docs = repoSource("backend/docs/trend-web-search-provider.md");
    const normalized = docs.toLowerCase();

    expect(normalized).toContain("google_cse");
    expect(normalized).toContain("google programmable search json api");
    expect(normalized).toContain("only v1 live provider");
    expect(normalized).toContain("web_search_disabled");
    expect(normalized).toContain("web_search_provider_missing");
    expect(normalized).toContain("non-fatal");

    for (const envName of [
      "TREND_WEB_SEARCH_ENABLED",
      "TREND_WEB_SEARCH_PROVIDER",
      "GOOGLE_CSE_API_KEY",
      "GOOGLE_CSE_CX",
      "TREND_WEB_SEARCH_ALLOWED_DOMAINS",
      "TREND_WEB_SEARCH_MAX_QUERIES_PER_RUN",
      "TREND_WEB_SEARCH_MAX_RESULTS_PER_QUERY",
      "TREND_WEB_SEARCH_TIMEOUT_MS",
      "TREND_WEB_SEARCH_FIXTURE_PATH",
    ]) {
      expect(docs).toContain(envName);
    }

    for (const domain of allowedDomains) {
      expect(normalized).toContain(domain);
    }

    for (const templateId of queryTemplateIds) {
      expect(normalized).toContain(templateId);
    }

    expect(normalized).toContain("no raw page fetch");
    expect(normalized).toContain("no raw scraping");
    expect(normalized).toContain("no result body fetch");
    expect(normalized).toContain("provider-returned title/link/snippet/displaylink metadata");
    expect(normalized).toContain("fixture update process");
    expect(normalized).toContain("google-cse-allowlist.fixture.json");
  });

  test("Google CSE allowlist fixture is bounded JSON metadata without raw page content", () => {
    const fixtureSource = repoSource(
      "backend/fixtures/trend-web-search/google-cse-allowlist.fixture.json",
    );
    const fixture = JSON.parse(fixtureSource) as Record<string, unknown>;
    const objects = collectObjects(fixture);
    const displayLinks = objects
      .map((item) => item.displayLink)
      .filter((item): item is string => typeof item === "string");

    expect(fixture.provider).toBe("google_cse");
    expect(fixtureSource).toContain("google_cse");
    expect(displayLinks.some((displayLink) => allowedDomains.includes(displayLink as typeof allowedDomains[number]))).toBe(true);
    expect(displayLinks.some((displayLink) => !allowedDomains.includes(displayLink as typeof allowedDomains[number]))).toBe(true);

    for (const object of objects) {
      for (const forbiddenKey of forbiddenRawContentKeys) {
        expect(object).not.toHaveProperty(forbiddenKey);
      }

      if (typeof object.snippet === "string") {
        expect(object.snippet.length).toBeLessThanOrEqual(500);
      }
    }
  });
});
