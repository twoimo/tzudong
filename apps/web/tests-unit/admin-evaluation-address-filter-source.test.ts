import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("admin evaluation address filter source contract", () => {
  test("review filter absorbs internal candidate status while candidate label stays hidden", () => {
    const pageSource = source("app/admin/evaluations/admin-evaluation-page.tsx");
    const tableSource = source("components/admin/EvaluationTableNew.tsx");
    const addressSource = source("lib/admin-address-consistency.ts");

    expect(pageSource).toContain("review: ['review', 'candidate']");
    expect(tableSource).toContain("{ value: 'true', label: '일치' }");
    expect(tableSource).toContain("{ value: 'review', label: '검토' }");
    expect(tableSource).not.toContain("{ value: 'candidate'");

    expect(tableSource).not.toContain("{ value: 'true', label: '확인됨' }");
    expect(tableSource).not.toContain("{ value: 'review', label: '추가 확인' }");
    expect(tableSource).not.toContain("{ value: 'candidate', label: '승격 후보' }");

    for (const legacyLabel of ["확인됨", "추가 확인", "승격 후보", "후보군"]) {
      expect(addressSource).not.toContain(legacyLabel);
    }
  });
});
