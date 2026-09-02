import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminRestaurantRefreshHistoryPanel } from "../components/admin/AdminRestaurantRefreshHistoryPanel";

const root = process.cwd();
const repoRoot = join(root, "../..");

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function repoSource(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("admin restaurant refresh history source contracts", () => {
  test("adds a dedicated admin sidebar module for approved restaurant refresh history", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const sidebarOrderSource = source("lib/admin/sidebar-order.ts");
    const routeSource = source("lib/admin/admin-module-routing.ts");
    const registrySource = source("lib/admin/console-menu-registry.ts");

    expect(routeSource).toContain("ADMIN_CONSOLE_MODULE_IDS");
    expect(registrySource).toContain('"restaurant-refresh-history"');
    expect(registrySource).toContain('title: "맛집 최신화"');
    expect(consoleSource).toContain("buildCanonicalAdminModuleHref");
    expect(consoleSource).not.toContain("/admin/restaurant-refresh-history");
    expect(consoleSource).toContain("AdminRestaurantRefreshHistoryModule");
    expect(consoleSource).toContain('case "restaurant-refresh-history"');
    expect(sidebarOrderSource).toContain("ADMIN_CONSOLE_MENU_IDS");
    expect(sidebarOrderSource).toContain("ADMIN_CONSOLE_MENUS");
  });

  test("panel keeps refresh workflow history-first and operator guarded", () => {
    const panelSource = source(
      "components/admin/AdminRestaurantRefreshHistoryPanel.tsx",
    );

    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-history="true"',
    );
    expect(panelSource).toContain(
      'data-admin-embedded-module-shell="true"',
    );
    expect(panelSource).toContain(
      'data-admin-embedded-module-id="restaurant-refresh-history"',
    );
    expect(panelSource).toContain('data-admin-module-header="compact"');
    expect(panelSource).toContain(
      'data-admin-module-header-module="restaurant-refresh-history"',
    );
    expect(panelSource).toContain('data-admin-module-summary="true"');
    expect(panelSource).toContain('data-admin-module-actions="top-right"');
    expect(panelSource).toContain('data-admin-module-content="bounded"');
    expect(panelSource).not.toContain(
      'data-admin-restaurant-refresh-headerless="true"',
    );
    expect(panelSource).not.toMatch(
      /<h1[\s\S]*?>[\s\S]*?맛집 최신화[\s\S]*?<\/h1>/,
    );
    expect(panelSource).toContain("기록 관리");
    expect(panelSource).toContain("상호명·전화번호·폐업·이전");
    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-management-structure="header-list-detail"',
    );
    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-list="management-like"',
    );
    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-detail="management-like"',
    );
    expect(panelSource).toContain("맛집 관리 동일 구조");
    expect(panelSource).toContain("후보 생성 → 운영자 판단 →");
    expect(panelSource).toContain("guarded apply → readback/recrawl");
    expect(panelSource).toContain(
      "왼쪽 목록에서 후보를 선택하고 오른쪽 상세 패널에서",
    );
    expect(panelSource).toContain("왼쪽 목록에서 후보를 선택하세요");
    expect(panelSource).toContain("승인 맛집 점검 job 또는 수동");
    expect(panelSource).toContain("후보 기록이 생성되면");
    expect(panelSource).toContain("운영자 결정 기록");
    expect(panelSource).toContain("결정 저장");
    expect(panelSource).toContain("승인과 동시에 현재 맛집 값 guarded apply");
    expect(panelSource).toContain("function isClosureCandidate");
    expect(panelSource).toContain(
      "폐업 의심 후보는 네이버 미검색 신호일 뿐 폐업 확정이",
    );
    expect(panelSource).toContain("guarded apply를 막습니다.");
    expect(panelSource).toContain("disabled={!canApplySelectedCandidate}");
    expect(panelSource).toContain("function reviewChecklistForCandidate");
    expect(panelSource).toContain(
      "주소/이전: 도로명·지번·좌표·주변 가게/거리 단서를 영상·지도 리뷰 이미지와 교차 확인",
    );
    expect(panelSource).toContain(
      "readbackLabel(selectedCandidate.readback_state)",
    );
    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-evidence-summary="true"',
    );
    expect(panelSource).toContain("function evidenceText");
    expect(panelSource).toContain("출처 미기록");
    expect(panelSource).toContain("snapshotText(");
    expect(panelSource).toContain("candidate.previous_snapshot,");
    expect(panelSource).toContain('"road_address"');
    expect(panelSource).toContain("candidate.candidate_snapshot,");
    expect(panelSource).toContain("selectedCandidate.previous_snapshot,");
    expect(panelSource).toContain('"jibun_address"');
    expect(panelSource).toContain("selectedCandidate.candidate_snapshot,");
    expect(panelSource).toContain(
      'candidate.candidate_status !== "needs_review"',
    );
  });

  test("panel renders inside the compact embedded module shell without the old h1 title", () => {
    const html = renderToStaticMarkup(
      createElement(AdminRestaurantRefreshHistoryPanel),
    );

    expect(html).toContain('data-admin-embedded-module-shell="true"');
    expect(html).toContain(
      'data-admin-embedded-module-id="restaurant-refresh-history"',
    );
    expect(html).toContain('data-admin-module-header="compact"');
    expect(html).toContain(
      'data-admin-module-header-module="restaurant-refresh-history"',
    );
    expect(html).toContain('data-admin-module-summary="true"');
    expect(html).toContain('data-admin-module-actions="top-right"');
    expect(html).toContain('data-admin-module-content="bounded"');
    expect(html).not.toContain('data-admin-restaurant-refresh-headerless="true"');
    expect(html).toContain('aria-labelledby="admin-restaurant-refresh-history-title"');
    expect(html).toContain("기록 관리");
    expect(html).not.toMatch(/<h1[\s\S]*?>[\s\S]*?맛집 최신화[\s\S]*?<\/h1>/);
  });

  test("admin API is admin gated, no-store, and separates record from guarded apply", () => {
    const routeSource = source(
      "app/api/admin/restaurant-refresh-history/route.ts",
    );

    expect(routeSource).toContain("import { requireAdmin }");
    expect(routeSource).toContain("createSupabaseServiceRoleClient");
    expect(routeSource).toContain("if (!auth.ok) return auth.response");
    expect(routeSource).toContain('action === "record_candidate"');
    expect(routeSource).toContain('action === "decide_candidate"');
    expect(routeSource).toContain("body.apply === true");
    expect(routeSource).toContain("detected_change_types, candidate_snapshot");
    expect(routeSource).toContain("function hasClosureChange");
    expect(routeSource).toContain(
      "폐업 의심 후보는 자동 guarded apply 대상이 아닙니다.",
    );
    expect(routeSource).toContain("function hasMaterialRestaurantPatch");
    expect(routeSource).toContain("type ReadbackRunRow");
    expect(routeSource).toContain("function readbackStateForCandidate");
    expect(routeSource).toContain(
      "fetchReadbackRunMap(supabase, candidateRows)",
    );
    expect(routeSource).toContain("readback_state: readbackStateForCandidate(");
    expect(routeSource).toContain("readbackRunMap.get(candidate.id)");
    expect(routeSource).toContain('.eq("status", "approved")');
    expect(routeSource).toContain("!isIdRow(updatedRestaurant)");
    expect(routeSource).toContain('"Cache-Control": "no-store"');
    expect(routeSource).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE");
  });

  test("migration stores immutable refresh runs/candidates with RLS and explicit grants", () => {
    const migrationSource = repoSource(
      "backend/supabase/migrations/20260531105250_restaurant_refresh_history.sql",
    );

    expect(migrationSource).toContain(
      "CREATE TABLE IF NOT EXISTS public.restaurant_refresh_runs",
    );
    expect(migrationSource).toContain(
      "CREATE TABLE IF NOT EXISTS public.restaurant_refresh_candidates",
    );
    expect(migrationSource).toContain("previous_snapshot jsonb NOT NULL");
    expect(migrationSource).toContain("candidate_snapshot jsonb NOT NULL");
    expect(migrationSource).toContain("candidate_status IN");
    expect(migrationSource).toContain(
      "ALTER TABLE public.restaurant_refresh_runs ENABLE ROW LEVEL SECURITY",
    );
    expect(migrationSource).toContain(
      "ALTER TABLE public.restaurant_refresh_candidates ENABLE ROW LEVEL SECURITY",
    );
    expect(migrationSource).toContain(
      "GRANT SELECT, INSERT, UPDATE ON public.restaurant_refresh_runs TO authenticated",
    );
    expect(migrationSource).toContain(
      "GRANT SELECT, INSERT, UPDATE ON public.restaurant_refresh_candidates TO authenticated",
    );
    expect(migrationSource).toContain("public.is_user_admin(auth.uid())");
    expect(migrationSource).toContain(
      "restaurant_refresh_candidates_change_types_gin_idx",
    );
  });
});
