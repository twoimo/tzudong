import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { ADMIN_API_STATUS_CODES } from "../lib/admin/admin-api-status";
import {
  ADMIN_LIST_MAX,
  ADMIN_UPSTREAM_TIMEOUT,
} from "../lib/admin/admin-json";
import {
  RISKY_WORK_FORBIDDEN_STEP_NAMES,
  RISKY_WORK_MENU_IDS,
  RISKY_WORK_MISMATCH_LIMIT,
  RISKY_WORK_PREVIEW_TTL_SECONDS,
  RISKY_WORK_STEPS,
  RISKY_WORK_TARGET_LIMIT,
  createEmptyRiskyWorkConfirmation,
  createRiskyWorkProcedure,
} from "../lib/admin/risky-work-procedure";

const appRoot = join(import.meta.dir, "..");

function read(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function collectAdminRouteFiles(directory = join(appRoot, "app/api/admin")): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectAdminRouteFiles(fullPath));
      continue;
    }
    if (entry === "route.ts") files.push(fullPath);
  }
  return files;
}

function extractExportedHandlers(source: string): Array<{ name: string; body: string }> {
  const handlers: Array<{ name: string; body: string }> = [];
  const pattern =
    /export async function (GET|POST|PUT|PATCH|DELETE)\s*\([^)]*\)\s*\{/g;
  let match = pattern.exec(source);
  while (match) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let end = start;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    handlers.push({
      name: match[1] ?? "GET",
      body: source.slice(start, end + 1),
    });
    match = pattern.exec(source);
  }
  return handlers;
}

function stripTypeOnly(body: string) {
  return body
    .replace(/ReturnType<\s*typeof\s+createSupabaseServiceRoleClient\s*>/g, "")
    .replace(/typeof\s+createSupabaseServiceRoleClient/g, "");
}

const EXAGGERATED_AUDIT_PHRASES = [
  "전체 감사",
  "모든 변경",
  "모든 관리자 작업",
  "완전한 감사",
  "전수 감사",
  "범용 감사 로그입니다",
] as const;

const FORBIDDEN_DISPLAY_LOG_MARKERS = [
  'type="password"',
  "document.cookie",
  "navigator.geolocation",
  "getCurrentPosition(",
  "watchPosition(",
  "rawOcr",
  "ocr_text",
  "residentRegistration",
  "주민등록번호",
] as const;

const DISPLAY_LOG_PATHS = [
  "components/admin/console/AdminOpsAssistPanel.tsx",
  "components/admin/console/AdminAuditEventsPanel.tsx",
  "components/admin/console/RiskyWorkProcedureSteps.tsx",
  "lib/admin/admin-json.ts",
  "lib/admin/admin-client-error.ts",
  "lib/admin/risky-work-procedure.ts",
  "lib/admin/admin-user-display.ts",
  "lib/admin/admin-audit-events.ts",
  "components/admin/AdminUsersPanel.tsx",
  "app/api/admin/users/route.ts",
  "app/api/admin/system-status/route.ts",
  "app/api/admin/preferences/sidebar-order/route.ts",
] as const;

describe("admin console guardrail source contract", () => {
  test("keeps requireAdmin first in each exported admin API handler", () => {
    const routes = collectAdminRouteFiles();
    expect(routes.length).toBeGreaterThan(10);

    for (const filePath of routes) {
      const source = readFileSync(filePath, "utf8");
      const hasDirectAdminAuth = source.includes("requireAdmin");
      const hasDelegatedAdminAuth = source.includes(
        "authenticateStoryboardRagAction",
      );
      expect(hasDirectAdminAuth || hasDelegatedAdminAuth).toBe(true);
      const handlers = extractExportedHandlers(source);
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        const body = stripTypeOnly(handler.body);
        const requireIndex = body.search(
          /(?:requireAdmin|authenticateStoryboardRagAction)\s*\(/,
        );
        expect(requireIndex).toBeGreaterThan(-1);
        for (const marker of [
          "readBoundedJsonRequest",
          "createSupabaseServiceRoleClient",
          ".from(",
          "fetch(",
        ]) {
          const markerIndex = body.indexOf(marker);
          if (markerIndex === -1) continue;
          expect(requireIndex).toBeLessThan(markerIndex);
        }
      }
    }
  });

  test("keeps shared adminJson no-store helper and fixed status codes", () => {
    const helperSource = read("lib/admin/admin-json.ts");
    const statusSource = read("lib/admin/admin-api-status.ts");
    expect(ADMIN_API_STATUS_CODES).toEqual([
      200, 400, 401, 403, 413, 415, 500, 504,
    ]);
    expect(ADMIN_UPSTREAM_TIMEOUT).toBe(10_000);
    expect(ADMIN_LIST_MAX).toBe(50);
    expect(helperSource).toContain('headers: { "Cache-Control": "no-store" }');
    expect(helperSource).toContain("ADMIN_API_STATUS_CODES");
    expect(statusSource).toContain("ADMIN_UPSTREAM_TIMEOUT = 10_000");
    expect(read("app/api/admin/preferences/sidebar-order/route.ts")).toContain(
      "adminJson",
    );
  });

  test("keeps forbidden privacy classes off display and log paths", () => {
    for (const relativePath of DISPLAY_LOG_PATHS) {
      const source = read(relativePath);
      for (const marker of FORBIDDEN_DISPLAY_LOG_MARKERS) {
        expect(source).not.toContain(marker);
      }
    }
    const usersPanel = read("components/admin/AdminUsersPanel.tsx");
    expect(usersPanel).not.toContain("selectedUser.email ||");
    expect(usersPanel).not.toContain("managedUser.email ||");
    expect(usersPanel).not.toContain("{selectedUser.email}");
    expect(usersPanel).not.toContain("{managedUser.email}");
    expect(usersPanel).toContain("emailMaskToken");
    expect(usersPanel).toContain("sanitizePrivacyValue");
    const vizState = read("lib/admin/console-viz-state.ts");
    expect(vizState).toContain("readonly label: string");
    expect(vizState).toContain("readonly points: readonly number[]");
    expect(vizState).not.toContain("ocr");
    expect(vizState).not.toContain("latitude");
    expect(vizState).not.toContain("accountId");
    const clientError = read("lib/admin/admin-client-error.ts");
    expect(clientError).toContain("menuId");
    expect(clientError).toContain("code");
    expect(clientError).not.toContain("error.message");
  });

  test("keeps audit panel name free of placeholder words and exaggerated coverage", () => {
    const panelSource = read("components/admin/console/AdminAuditEventsPanel.tsx");
    const registrySource = read(
      "components/admin/console/module-panel-registry.tsx",
    );
    expect(panelSource).toContain("export function AdminAuditEventsPanel");
    expect(panelSource).not.toContain("Placeholder");
    expect(panelSource).not.toContain("준비중");
    expect(panelSource).not.toContain("준비 중");
    expect(registrySource).toContain("AdminAuditEventsPanel");
    expect(registrySource).not.toContain("AuditPlaceholder");
    for (const phrase of EXAGGERATED_AUDIT_PHRASES) {
      expect(panelSource).not.toContain(phrase);
    }
  });

  test("wires the five-step risky work procedure onto the eight guarded menus", () => {
    const registrySource = read(
      "components/admin/console/module-panel-registry.tsx",
    );
    const procedureSource = read("lib/admin/risky-work-procedure.ts");
    expect(RISKY_WORK_STEPS).toEqual([
      "미리보기",
      "확인",
      "적용",
      "재확인",
      "감사 기록",
    ]);
    for (const forbidden of RISKY_WORK_FORBIDDEN_STEP_NAMES) {
      expect((RISKY_WORK_STEPS as readonly string[]).includes(forbidden)).toBe(
        false,
      );
    }
    const stepsUi = read(
      "components/admin/console/RiskyWorkProcedureSteps.tsx",
    );
    for (const forbidden of RISKY_WORK_FORBIDDEN_STEP_NAMES) {
      expect(stepsUi).not.toContain(forbidden);
    }
    expect(registrySource).toContain("RiskyWorkProcedureSteps");
    expect(registrySource).toContain("isRiskyWorkMenuId(menuId)");
    for (const menuId of RISKY_WORK_MENU_IDS) {
      expect(procedureSource).toContain(`"${menuId}"`);
    }
  });
});

describe("risky work procedure unit contract", () => {
  test("preview shows hash, count, capped targets, and 600s expiry", () => {
    const clock = { now: Date.parse("2026-09-03T00:00:00.000Z") };
    const procedure = createRiskyWorkProcedure(() => clock.now);
    const targets = Array.from({ length: 60 }, (_, index) => `target-${index}`);
    const preview = procedure.createPreview({
      menuId: "users",
      intent: "role-grant",
      targetIds: targets,
    });
    expect(preview.previewHash).toHaveLength(64);
    expect(preview.totalCount).toBe(60);
    expect(preview.targets).toHaveLength(RISKY_WORK_TARGET_LIMIT);
    expect(Date.parse(preview.expiresAt)).toBe(
      clock.now + RISKY_WORK_PREVIEW_TTL_SECONDS * 1000,
    );
    expect(createEmptyRiskyWorkConfirmation()).toBe("");
  });

  test("rejects mismatched confirmation and invalidates the hash after three failures", () => {
    const procedure = createRiskyWorkProcedure();
    const preview = procedure.createPreview({
      menuId: "restaurants",
      intent: "delete",
      targetIds: ["r1"],
    });
    const first = procedure.apply({
      previewHash: preview.previewHash,
      confirmation: "wrong",
      expectedConfirmation: "삭제확인",
      currentTargetIds: ["r1"],
      applyFn: () => ({ appliedCount: 1, targets: ["r1"] }),
    });
    expect(first).toEqual({
      ok: false,
      code: "ADMIN_CONFIRMATION_MISMATCH",
      requireNewPreview: false,
    });
    procedure.apply({
      previewHash: preview.previewHash,
      confirmation: "wrong",
      expectedConfirmation: "삭제확인",
      currentTargetIds: ["r1"],
      applyFn: () => ({ appliedCount: 1, targets: ["r1"] }),
    });
    const third = procedure.apply({
      previewHash: preview.previewHash,
      confirmation: "wrong",
      expectedConfirmation: "삭제확인",
      currentTargetIds: ["r1"],
      applyFn: () => ({ appliedCount: 1, targets: ["r1"] }),
    });
    expect(third).toEqual({
      ok: false,
      code: "ADMIN_CONFIRMATION_MISMATCH",
      requireNewPreview: true,
    });
    const afterInvalidate = procedure.apply({
      previewHash: preview.previewHash,
      confirmation: "삭제확인",
      expectedConfirmation: "삭제확인",
      currentTargetIds: ["r1"],
      applyFn: () => ({ appliedCount: 1, targets: ["r1"] }),
    });
    expect(afterInvalidate.ok).toBe(false);
    if (!afterInvalidate.ok) {
      expect(afterInvalidate.code).toBe("ADMIN_PREVIEW_STALE");
      expect(afterInvalidate.requireNewPreview).toBe(true);
    }
    expect(RISKY_WORK_MISMATCH_LIMIT).toBe(3);
  });

  test("apply returns readback and a single audit, then blocks duplicate apply", () => {
    const procedure = createRiskyWorkProcedure();
    const preview = procedure.createPreview({
      menuId: "pipeline",
      intent: "enqueue",
      targetIds: ["job-1"],
    });
    let applyCount = 0;
    const first = procedure.apply({
      previewHash: preview.previewHash,
      confirmation: "미리보기 -> 확인 -> 적용 -> 재확인 -> 감사 기록",
      expectedConfirmation: "미리보기 -> 확인 -> 적용 -> 재확인 -> 감사 기록",
      currentTargetIds: ["job-1"],
      applyFn: () => {
        applyCount += 1;
        return { appliedCount: 1, targets: ["job-1"] };
      },
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.duplicate).toBe(false);
      expect(first.readback.appliedCount).toBe(1);
      expect(first.readback.operationId.length).toBeGreaterThan(0);
      expect(first.audits).toHaveLength(1);
      expect(first.audits[0]?.previewHash).toBe(preview.previewHash);
      expect(first.audits[0]?.status).toBe("applied");
    }
    const second = procedure.apply({
      previewHash: preview.previewHash,
      confirmation: "미리보기 -> 확인 -> 적용 -> 재확인 -> 감사 기록",
      expectedConfirmation: "미리보기 -> 확인 -> 적용 -> 재확인 -> 감사 기록",
      currentTargetIds: ["job-1"],
      applyFn: () => {
        applyCount += 1;
        return { appliedCount: 1, targets: ["job-1"] };
      },
    });
    expect(applyCount).toBe(1);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.duplicate).toBe(true);
      expect(second.readback).toEqual(first.readback);
      expect(second.audits).toEqual(first.audits);
    }
  });

  test("expiry and target-state change require a new preview", () => {
    const clock = { now: Date.parse("2026-09-03T00:00:00.000Z") };
    const procedure = createRiskyWorkProcedure(() => clock.now);
    const preview = procedure.createPreview({
      menuId: "banners",
      intent: "publish",
      targetIds: ["banner-1"],
    });
    clock.now += RISKY_WORK_PREVIEW_TTL_SECONDS * 1000;
    const expired = procedure.apply({
      previewHash: preview.previewHash,
      confirmation: "공개변경",
      expectedConfirmation: "공개변경",
      currentTargetIds: ["banner-1"],
      applyFn: () => ({ appliedCount: 1, targets: ["banner-1"] }),
    });
    expect(expired).toEqual({
      ok: false,
      code: "ADMIN_PREVIEW_STALE",
      requireNewPreview: true,
    });

    const fresh = procedure.createPreview({
      menuId: "banners",
      intent: "publish",
      targetIds: ["banner-1"],
    });
    const changed = procedure.apply({
      previewHash: fresh.previewHash,
      confirmation: "공개변경",
      expectedConfirmation: "공개변경",
      currentTargetIds: ["banner-2"],
      applyFn: () => ({ appliedCount: 1, targets: ["banner-2"] }),
    });
    expect(changed).toEqual({
      ok: false,
      code: "ADMIN_PREVIEW_STALE",
      requireNewPreview: true,
    });
  });
});
