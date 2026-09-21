import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsRoot = join(import.meta.dir, "..", "..", "..", "backend", "supabase", "migrations");
const migrationNames = readdirSync(migrationsRoot).filter((name) => name.endsWith(".sql")).sort();
const migrationSource = (name: string) => readFileSync(join(migrationsRoot, name), "utf8");
const allMigrations = migrationNames.map(migrationSource).join("\n");

describe("privacy consent row-lock privilege", () => {
  test("the consent RPC locks its idempotency row on the private ledger", () => {
    const workflows = migrationSource("20260713002100_g014_privacy_workflows.sql");
    const rpcStart = workflows.indexOf("CREATE OR REPLACE FUNCTION public.submit_privacy_consent(");
    expect(rpcStart).toBeGreaterThanOrEqual(0);
    const rpc = workflows.slice(rpcStart, workflows.indexOf("$function$;", rpcStart));
    expect(rpc).toContain("FROM privacy_retention.privacy_consent_events AS event");
    expect(rpc).toContain("FOR UPDATE");
  });

  test("the workflow owner holds the UPDATE privilege that row lock requires", () => {
    expect(allMigrations).toContain("GRANT UPDATE ON TABLE privacy_retention.privacy_consent_events");

    const lockMigration = migrationSource("20260921123000_g041_privacy_consent_lock_privilege.sql");
    expect(lockMigration).toContain("TO privacy_workflow_owner");
    expect(lockMigration).toMatch(
      /has_table_privilege\(\s*'privacy_workflow_owner',\s*'privacy_retention\.privacy_consent_events',\s*'UPDATE'\s*\)/,
    );
    expect(lockMigration).toContain("'relation', 'privacy_consent_events'");
    expect(lockMigration).toContain("'privilege', 'UPDATE'");
  });

  test("the ledger stays append-only so the lock privilege cannot rewrite history", () => {
    const foundation = migrationSource("20260712000100_g010_privacy_foundation.sql");
    expect(foundation).toMatch(
      /CREATE TRIGGER privacy_consent_events_append_only\s+BEFORE UPDATE OR DELETE ON public\.privacy_consent_events/,
    );

    const lockMigration = migrationSource("20260921123000_g041_privacy_consent_lock_privilege.sql");
    expect(lockMigration).toContain("privacy_consent_events_append_only");
    expect(lockMigration).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(lockMigration).toContain(
      "has_table_privilege(\n    'service_role',\n    'privacy_retention.privacy_consent_events',\n    'UPDATE'\n  )",
    );
  });
});
