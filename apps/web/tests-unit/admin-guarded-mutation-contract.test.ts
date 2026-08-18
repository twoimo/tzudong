import { describe, expect, test } from "bun:test";

import {
  GUARDED_MUTATION_DOMAINS,
  GUARDED_MUTATION_CONFIRMATION,
  GUARDED_MUTATION_SEMANTICS,
  GUARDED_MUTATION_STEPS,
  assertLegacyBrowserAdminMutationEnabled,
  buildGuardedMutationRequiredResponse,
  isInlineOcrProcessEnabled,
  isGuardedMutationConfirmationValid,
  isLegacyBrowserAdminMutationEnabled,
} from "../lib/admin/guarded-mutation-contract";

function withEnv<T>(
  values: Record<string, string | undefined>,
  callback: () => T,
): T {
  const previous = new Map<string, string | undefined>();

  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("admin guarded mutation contract", () => {
  test("defines the required server-side guard sequence and domains", () => {
    expect(GUARDED_MUTATION_STEPS).toEqual([
      "Preview",
      "Confirm",
      "Apply",
      "Readback",
      "Audit",
    ]);
    expect(GUARDED_MUTATION_SEMANTICS).toBe("Preview -> Confirm -> Apply -> Readback -> Audit");
    expect(GUARDED_MUTATION_CONFIRMATION).toBe("Preview -> Confirm -> Apply -> Readback -> Audit");
    expect(GUARDED_MUTATION_DOMAINS).toEqual([
      "review_moderation",
      "restaurant_record",
      "restaurant_submission",
      "ocr_receipt",
      "restaurant_request_review",
      "pipeline_control",
    ]);
  });

  test("builds bounded guarded-contract-required responses", () => {
    const payload = buildGuardedMutationRequiredResponse(
      "ocr_receipt",
      `process-${"x".repeat(120)}`,
    );

    expect(payload).toMatchObject({
      requiresGuardedContract: true,
      steps: ["Preview", "Confirm", "Apply", "Readback", "Audit"],
      domain: "ocr_receipt",
      readbackRequired: true,
      auditRequired: true,
    });
    expect(payload.error).toContain("Preview -> Confirm -> Apply -> Readback -> Audit");
    expect(payload.error).toContain("guarded server contract required");
    expect(payload.error).toContain("관리자 변경");
    expect(payload.action.length).toBeLessThanOrEqual(81);
    expect(payload.action.endsWith("…")).toBe(true);
  });

  test("accepts only the exact guarded mutation confirmation token", () => {
    expect(isGuardedMutationConfirmationValid(GUARDED_MUTATION_CONFIRMATION)).toBe(true);
    expect(isGuardedMutationConfirmationValid("Preview -> Apply -> Audit")).toBe(false);
    expect(isGuardedMutationConfirmationValid(null)).toBe(false);
    expect(isGuardedMutationConfirmationValid(undefined)).toBe(false);
  });

  test("feature-gates legacy browser admin mutations off by default", () => {
    withEnv({ NEXT_PUBLIC_ADMIN_LEGACY_BROWSER_MUTATIONS: undefined }, () => {
      expect(isLegacyBrowserAdminMutationEnabled()).toBe(false);
      expect(() =>
        assertLegacyBrowserAdminMutationEnabled("review_moderation", "approve_review"),
      ).toThrow(/guarded server contract required/);
      expect(() =>
        assertLegacyBrowserAdminMutationEnabled("review_moderation", "approve_review"),
      ).toThrow(/domain=review_moderation action=approve_review/);
    });

    withEnv({ NEXT_PUBLIC_ADMIN_LEGACY_BROWSER_MUTATIONS: "enabled" }, () => {
      expect(isLegacyBrowserAdminMutationEnabled()).toBe(true);
      expect(() =>
        assertLegacyBrowserAdminMutationEnabled("review_moderation", "approve_review"),
      ).not.toThrow();
    });
  });

  test("keeps inline OCR processing disabled unless explicitly enabled outside production", () => {
    withEnv({ NODE_ENV: "production", ADMIN_OCR_INLINE_PROCESS_ENABLED: "enabled" }, () => {
      expect(isInlineOcrProcessEnabled()).toBe(false);
    });

    withEnv({ NODE_ENV: "test", ADMIN_OCR_INLINE_PROCESS_ENABLED: undefined }, () => {
      expect(isInlineOcrProcessEnabled()).toBe(false);
    });

    withEnv({ NODE_ENV: "test", ADMIN_OCR_INLINE_PROCESS_ENABLED: "enabled" }, () => {
      expect(isInlineOcrProcessEnabled()).toBe(true);
    });
  });
});
