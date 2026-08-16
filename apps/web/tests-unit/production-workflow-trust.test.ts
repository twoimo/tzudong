import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const releaseManifestPath = join(
  root,
  ".github",
  "supabase-migration-release-manifest.v1.json",
);
const releaseManifest = readFileSync(releaseManifestPath);
const RELEASE_MANIFEST_SHA256 = "515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d";
const workflow = (name: string) =>
  readFileSync(join(root, ".github", "workflows", name), "utf8");

describe("production workflow trust boundaries", () => {
  test("database migration apply is externally manifest-bound, canonical, and direct-credentialed", () => {
    const source = workflow("supabase-migration-apply.yml");

    expect(createHash("sha256").update(releaseManifest).digest("hex")).toBe(
      RELEASE_MANIFEST_SHA256,
    );
    expect(source).toContain(
      `RELEASE_MIGRATION_MANIFEST_SHA256: "${RELEASE_MANIFEST_SHA256}"`,
    );
    expect(source).toContain(".github/supabase-migration-release-manifest.v1.json");
    expect(source.match(/sha256sum \.github\/supabase-migration-release-manifest\.v1\.json/g))
      .toHaveLength(2);
    expect(source).toContain("manifest_sha256: ${{ steps.manifest.outputs.manifest_sha256 }}");
    expect(source).toContain(
      "expected_manifest_sha256: ${{ steps.manifest.outputs.expected_manifest_sha256 }}",
    );
    expect(source).toContain(
      "needs.validate.outputs.manifest_sha256 == needs.validate.outputs.expected_manifest_sha256",
    );
    expect(source).toContain("migration_id:");
    expect(source).toContain("type: string");
    expect(source).toContain("github.repository == 'twoimo/tzudong'");
    expect(source).toContain("github.event.repository.default_branch == 'main'");
    expect(source).toContain("github.ref == 'refs/heads/main'");
    expect(source).toContain("github.ref_name == 'main'");
    expect(source).toContain("ref: ${{ github.sha }}");
    expect(source).toContain("ref: ${{ needs.validate.outputs.validated_sha }}");
    expect(source).toContain("test \"$GITHUB_SHA\" = \"$(git rev-parse --verify HEAD)\"");
    expect(source).toContain("test -z \"$(git symbolic-ref --quiet HEAD || true)\"");
    expect(source).toContain("Validate reviewed manifest without production credentials");
    expect(source).toContain("--migration-id \"$MIGRATION_ID\"");
    expect(source).toContain("postgresql-client");
    expect(source).not.toContain("type: choice");
    expect(source).not.toContain("restaurant_refresh_history");
    expect(source).not.toContain("migration_file:");
    expect(source).not.toContain("migration_name:");
    expect(source).not.toContain("restaurant_refresh_candidates");
    expect(source).not.toContain("SUPABASE_ACCESS_TOKEN");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("SUPABASE_PROJECT_REF");
    expect(source).not.toContain("secrets.SUPABASE_URL");

    const applyStep = source.slice(
      source.indexOf("- name: Apply reviewed migration or verify provider-applied terminal state"),
    );
    expect(applyStep).toContain("secrets.SUPABASE_DB_URL");
    expect(applyStep).not.toContain("secrets.SUPABASE_ACCESS_TOKEN");
    expect(source).not.toContain("pull_request_target");
  });

  test("privacy retention is default-branch protected and step-scopes its capability", () => {
    const source = workflow("privacy-retention.yml");

    expect(source).toContain("github.ref_name == github.event.repository.default_branch");
    expect(source).not.toContain("environment:");
    expect(source).not.toContain("production-retention");
    expect(source).toContain("ref: ${{ github.sha }}");
    expect(source).toContain("persist-credentials: false");
    expect(source).not.toContain("pull_request_target");

    const jobEnvironment = source.slice(source.indexOf("    env:"), source.indexOf("    steps:"));
    expect(jobEnvironment).not.toContain("PRIVACY_RETENTION_INTERNAL_CAPABILITY");
    expect(source.match(/PRIVACY_RETENTION_INTERNAL_CAPABILITY: \$\{\{ secrets\.PRIVACY_RETENTION_INTERNAL_CAPABILITY \}\}/g)).toHaveLength(2);
  });

  test("refresh and KPI writers isolate secrets behind protected default-branch jobs", () => {
    for (const name of [
      "restaurant-refresh-cron.yml",
      "youtube-kpi-snapshot.yml",
    ] as const) {
      const source = workflow(name);
      expect(source, name).toContain(
        "if: github.ref_name == github.event.repository.default_branch",
      );
      expect(source, name).not.toContain("environment:");
      expect(source, name).toContain("ref: ${{ github.sha }}");
      expect(source, name).toContain("persist-credentials: false");
      expect(source, name).not.toContain("pull_request_target");

      const jobHeader = source.slice(source.indexOf("  capture:") >= 0
        ? source.indexOf("  capture:")
        : source.indexOf("  refresh:"), source.indexOf("    steps:"));
      expect(jobHeader, name).not.toContain("secrets.");
    }
    const refresh = workflow("restaurant-refresh-cron.yml");
    expect(refresh).toContain("if-no-files-found: error");
    expect(refresh).toContain("retention-days: 30");
  });

  test("crawler and backfill production lanes are branch constrained", () => {
    const crawler = workflow("daily-crawler.yml");
    expect(crawler).toContain(
      "github.ref_name == github.event.repository.default_branch",
    );
    expect(crawler).not.toContain("environment:");
    expect(crawler).not.toContain("pull_request_target");

    const backfill = workflow("gdrive-frame-backfill.yml");
    expect(backfill).toContain(
      "github.event.workflow_run.head_branch == github.event.repository.default_branch",
    );
    expect(backfill).not.toContain("environment:");
    expect(backfill).toContain("persist-credentials: false");
    expect(backfill).not.toContain("pull_request_target");
  });

  test("all referenced third-party actions use immutable commit hashes", () => {
    for (const name of [
      "supabase-migration-apply.yml",
      "privacy-retention.yml",
      "restaurant-refresh-cron.yml",
      "youtube-kpi-snapshot.yml",
      "daily-crawler.yml",
      "gdrive-frame-backfill.yml",
    ]) {
      const source = workflow(name);
      const refs = [...source.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)].map((match) => match[1]);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ref, `${name}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});
