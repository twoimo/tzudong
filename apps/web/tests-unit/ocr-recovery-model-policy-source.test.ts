import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const migrations = join(root, "backend/supabase/migrations");
const alignment = "20261111020000_receipt_ocr_recovery_model_policy_alignment.sql";

const read = (file: string) => readFileSync(join(migrations, file), "utf8");

describe("receipt OCR recovery model policy contract", () => {
  test("the recovery path delegates every model policy check to the canonical predicate", () => {
    const source = read(alignment);
    expect(source).toContain("DROP CONSTRAINT IF EXISTS receipt_ocr_indeterminate_recoveries_model_policy_check");
    expect(source).toContain("CHECK (ocr_private.valid_model_policy(model_policy))");
    expect(source).toContain("CREATE OR REPLACE FUNCTION ocr_private.recover_review_receipt_ocr_indeterminate(");
    expect(source).toContain("OR NOT ocr_private.valid_model_policy(p_model_policy)");
    // The 1..3 / 120-character guard and table check must not survive anywhere.
    expect(source).not.toContain("BETWEEN 1 AND 3");
    expect(source).not.toContain("BETWEEN 1 AND 120");
  });

  test("the alignment is the newest definition of both constraints", () => {
    const files = readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort();
    expect(files.at(-1)).toBe(alignment);
    const later = files.filter((file) => file > alignment);
    expect(later).toHaveLength(0);
  });

  test("the canonical predicate still allows the full contract range", () => {
    const durable = read("20261013190000_durable_receipt_ocr_results.sql");
    expect(durable).toContain("pg_catalog.jsonb_array_length(p_policy) BETWEEN 1 AND 8");
    expect(durable).toContain("NOT BETWEEN 1 AND 160");
  });
});
