import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertEvidenceSafe,
  collectForbiddenEvidenceKinds,
  EvidenceGuardError,
  FORBIDDEN_EVIDENCE_KINDS,
  writeEvidenceIfSafe,
} from "../tests/helpers/evidence-guard";

const SAFE_EVIDENCE = {
  schemaVersion: 1,
  kind: "playwright-browser-automation-report",
  maskedMarkerPresent: true,
  elementCounts: { cards: 15, sections: 4 },
  dataAttributes: {
    activeModule: "overview",
    headerSelector: '[data-admin-module-header-module="overview"]',
  },
  computedStyleNumbers: { overflowDelta: 0, contrastRatio: 4.6 },
  focusOrder: ["skip-link", "sidebar", "canvas", "module-actions"],
};

describe("admin console evidence guard", () => {
  test("exposes the six forbidden kinds from the design contract", () => {
    expect(FORBIDDEN_EVIDENCE_KINDS).toEqual([
      "cookie",
      "request-header",
      "local-storage",
      "admin-response-body",
      "table-content",
      "database-response",
    ]);
  });

  test("accepts masked counts, data attributes, style numbers, and focus order", () => {
    expect(collectForbiddenEvidenceKinds(SAFE_EVIDENCE)).toEqual([]);
    expect(() => assertEvidenceSafe(SAFE_EVIDENCE)).not.toThrow();
  });

  test("does not treat headerSelector as a request header", () => {
    expect(
      collectForbiddenEvidenceKinds({
        visited: [{ headerSelector: '[data-admin-module-header-module="llm"]' }],
      }),
    ).toEqual([]);
  });

  test("names every forbidden kind found and skips the write", () => {
    const root = mkdtempSync(join(tmpdir(), "evidence-guard-"));
    const dest = join(root, "rejected.json");
    const forbidden = {
      cookie: "session=redacted",
      requestHeaders: { accept: "application/json" },
      localStorage: { theme: "dark" },
      adminResponseBody: { error: "ADMIN_CONFLICT" },
      tableContent: ["row"],
      supabasePayload: { rows: [] },
    };

    try {
      expect(collectForbiddenEvidenceKinds(forbidden)).toEqual([
        ...FORBIDDEN_EVIDENCE_KINDS,
      ]);
      expect(() => writeEvidenceIfSafe(dest, forbidden)).toThrow(
        EvidenceGuardError,
      );
      try {
        writeEvidenceIfSafe(dest, forbidden);
      } catch (error) {
        expect(error).toBeInstanceOf(EvidenceGuardError);
        expect((error as EvidenceGuardError).message).toContain(
          "evidence-guard: forbidden kinds present: cookie, request-header, local-storage, admin-response-body, table-content, database-response",
        );
      }
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes only after the six-kind scan passes", () => {
    const root = mkdtempSync(join(tmpdir(), "evidence-guard-"));
    const dest = join(root, "accepted.json");

    try {
      writeEvidenceIfSafe(dest, SAFE_EVIDENCE);
      expect(existsSync(dest)).toBe(true);
      expect(JSON.parse(readFileSync(dest, "utf8"))).toEqual(SAFE_EVIDENCE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
