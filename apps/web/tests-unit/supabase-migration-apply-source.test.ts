import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  RELEASE_MIGRATION_MANIFEST_PATH,
  assertExactReadback,
  assertExpectedPriorState,
  loadReleaseMigrationManifest,
  loadReviewedMigration,
  main,
  resolveReviewedMigration,
  selectDirectDatabaseTransport,
  validateReleaseMigrationManifest,
} from "../scripts/apply-supabase-migration.mjs";

const MANIFEST_SHA256 = "25e9000825b6f739d400c416f18627142b461aa14b95ec663dd5dcf35c5fc2f4";
const manifestBytes = readFileSync(RELEASE_MIGRATION_MANIFEST_PATH);
const manifestDocument = JSON.parse(manifestBytes.toString("utf8"));
const migration = manifestDocument.migrations[0];
const migrationScriptSource = readFileSync(
  new URL("../scripts/apply-supabase-migration.mjs", import.meta.url),
  "utf8",
);
expect(migrationScriptSource).toContain("input: `\\\\set VERBOSITY verbose\\n${query}`");
expect(migrationScriptSource).toContain("MIGRATION_PSQL_FAILED_${sqlstate}");
expect(migrationScriptSource).toContain("const sqlstate = /ERROR:\\s+([0-9A-Z]{5}):/m");
expect(migrationScriptSource).toContain("function ([a-z_][a-z0-9_.]*\\([a-z0-9_., ]*\\)) does not exist");
expect(migrationScriptSource).toContain("?.slice(0, 96)");
expect(migrationScriptSource).toContain(".replace(/[^a-z0-9_]+/gi, '_')");
expect(migrationScriptSource).toContain("operator does not exist:");
expect(migrationScriptSource).toContain("undefinedFunction ?? undefinedOperator");
expect(migrationScriptSource).not.toContain("result.stderr.trim()");

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const canonicalBytes = (document: unknown) =>
  Buffer.from(`${JSON.stringify(document, null, 2)}\n`);

describe("reviewed Supabase migration apply contract", () => {
  test("loads only the exact committed external manifest and rejects manifest drift", async () => {
    expect(digest(manifestBytes)).toBe(MANIFEST_SHA256);
    expect(migrationScriptSource).toContain("RELEASE_MIGRATION_MANIFEST_RELATIVE_PATH");
    expect(migrationScriptSource).not.toContain("export const RELEASE_MIGRATION_MANIFEST =");
    expect(migrationScriptSource).not.toContain(migration.path);
    expect(migrationScriptSource).not.toContain(migration.sha256);
    expect(migration.terminalReadback.query).toContain(
      "array_agg(attname::text ORDER BY attnum)",
    );
    expect(migration.terminalReadback.query).toContain(
      "array_agg(conname::text ORDER BY conname)",
    );
    expect(migration.terminalReadback.query).not.toContain(
      "array_agg(attname ORDER BY attnum)",
    );
    expect(migration.terminalReadback.query).not.toContain(
      "array_agg(conname ORDER BY conname)",
    );

    const loaded = await loadReleaseMigrationManifest({
      expectedManifestSha256: MANIFEST_SHA256,
    });
    expect(loaded).toMatchObject({
      sha256: MANIFEST_SHA256,
      migrations: [expect.objectContaining({
        id: "restaurant_refresh_history",
        path: "backend/supabase/migrations/20260531105250_restaurant_refresh_history.sql",
        sha256: "64201f056af79128975045bb47b521fa99a211b3bdede4d0ea9277a33bceacd3",
      })],
    });

    const driftedManifestBytes = Buffer.concat([manifestBytes, Buffer.from(" ")]);
    await expect(loadReleaseMigrationManifest({
      expectedManifestSha256: MANIFEST_SHA256,
      readFileImpl: async () => driftedManifestBytes,
    })).rejects.toThrow("MIGRATION_MANIFEST_DIGEST_MISMATCH");
  });

  test("rejects duplicate manifest schema and duplicate migration identities", async () => {
    const duplicateKeyBytes = Buffer.from(
      manifestBytes.toString("utf8").replace(
        '  "version": 1,',
        '  "version": 1,\n  "version": 1,',
      ),
    );
    await expect(loadReleaseMigrationManifest({
      expectedManifestSha256: digest(duplicateKeyBytes),
      readFileImpl: async () => duplicateKeyBytes,
    })).rejects.toThrow("MIGRATION_MANIFEST_INVALID");

    const duplicateMigrationDocument = {
      ...manifestDocument,
      migrations: [migration, { ...migration }],
    };
    const duplicateMigrationBytes = canonicalBytes(duplicateMigrationDocument);
    await expect(loadReleaseMigrationManifest({
      expectedManifestSha256: digest(duplicateMigrationBytes),
      readFileImpl: async () => duplicateMigrationBytes,
    })).rejects.toThrow("MIGRATION_MANIFEST_DUPLICATE");
    expect(() => validateReleaseMigrationManifest(duplicateMigrationDocument)).toThrow(
      "MIGRATION_MANIFEST_DUPLICATE",
    );
  });

  test("accepts only a manifest identity, never caller path or migration digest", async () => {
    const { migrations } = await loadReleaseMigrationManifest({
      expectedManifestSha256: MANIFEST_SHA256,
    });
    expect(resolveReviewedMigration("restaurant_refresh_history", migrations)).toMatchObject({
      id: "restaurant_refresh_history",
      path: "backend/supabase/migrations/20260531105250_restaurant_refresh_history.sql",
      sha256: "64201f056af79128975045bb47b521fa99a211b3bdede4d0ea9277a33bceacd3",
    });
    expect(() => resolveReviewedMigration("unreviewed_migration", migrations)).toThrow(
      "MIGRATION_ID_NOT_ALLOWLISTED",
    );
    await expect(main([])).rejects.toThrow("MIGRATION_ID_REQUIRED");
    await expect(main([
      "--migration-file",
      migration.path,
    ])).rejects.toThrow("MIGRATION_ARGUMENT_INVALID");
    await expect(main([
      "--migration-id",
      migration.id,
      "--sha256",
      migration.sha256,
    ])).rejects.toThrow("MIGRATION_ARGUMENT_INVALID");
    await expect(main([
      "--migration-id",
      migration.id,
      "--migration-id",
      migration.id,
    ])).rejects.toThrow("MIGRATION_ARGUMENT_DUPLICATE");
  });

  test("keeps dry-run credential-free after external manifest and migration byte validation", async () => {
    const result = await main(
      ["--migration-id", migration.id, "--dry-run"],
      {
        environment: {
          RELEASE_MIGRATION_MANIFEST_SHA256: MANIFEST_SHA256,
          SUPABASE_ACCESS_TOKEN: "must-not-select-a-transport",
        },
      },
    );
    expect(result).toMatchObject({
      manifest_sha256: MANIFEST_SHA256,
      migration_id: migration.id,
      dry_run: true,
      migration_applied: false,
      terminal_readback: null,
    });
  });

  test("rejects migration byte drift and symbolic checkouts before transport selection", async () => {
    await expect(loadReviewedMigration(migration.id, {
      expectedManifestSha256: MANIFEST_SHA256,
      readFileImpl: async (file) => file === RELEASE_MIGRATION_MANIFEST_PATH
        ? manifestBytes
        : Buffer.from("drifted migration bytes"),
    })).rejects.toThrow("MIGRATION_FILE_DIGEST_MISMATCH");

    await expect(loadReviewedMigration(migration.id, {
      expectedManifestSha256: MANIFEST_SHA256,
      lstatImpl: async (file) => ({
        isSymbolicLink: () => file !== RELEASE_MIGRATION_MANIFEST_PATH,
      }),
    })).rejects.toThrow("MIGRATION_FILE_SYMBOLIC");
  });

  test("distinguishes wrong prior state, already-applied state, and terminal readback drift", () => {
    const wrongPriorState = {
      restaurant_refresh_runs_absent: false,
      restaurant_refresh_candidates_absent: true,
    };

    expect(() => assertExpectedPriorState(
      wrongPriorState,
      migration.terminalReadback.expected,
      migration,
    )).toThrow("MIGRATION_ALREADY_APPLIED");
    expect(() => assertExpectedPriorState(
      wrongPriorState,
      { restaurant_refresh_history_terminal_state: false },
      migration,
    )).toThrow("MIGRATION_PRIOR_STATE_MISMATCH");
    expect(() => assertExactReadback(
      { restaurant_refresh_history_terminal_state: false },
      migration.terminalReadback.expected,
      "MIGRATION_TERMINAL_READBACK_FAILED",
    )).toThrow("MIGRATION_TERMINAL_READBACK_FAILED");
  });

  test("rejects management or service credentials alongside direct Postgres", () => {
    expect(() => selectDirectDatabaseTransport({
      SUPABASE_DB_URL: "postgres://direct",
      SUPABASE_ACCESS_TOKEN: "management-token",
    })).toThrow("MIGRATION_TRANSPORT_CREDENTIAL_OVERLAP");
    expect(() => selectDirectDatabaseTransport({
      SUPABASE_DB_URL: "postgres://direct",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    })).toThrow("MIGRATION_TRANSPORT_CREDENTIAL_OVERLAP");
    expect(() => selectDirectDatabaseTransport({})).toThrow("MIGRATION_CREDENTIALS_MISSING");
  });
});