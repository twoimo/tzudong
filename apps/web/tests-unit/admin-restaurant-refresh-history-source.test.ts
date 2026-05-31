import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

    expect(consoleSource).toContain('| "restaurant-refresh-history"');
    expect(consoleSource).toContain('title: "맛집 최신화"');
    expect(consoleSource).toContain('href: "/admin?module=restaurant-refresh-history"');
    expect(consoleSource).toContain('AdminRestaurantRefreshHistoryModule');
    expect(consoleSource).toContain('case "restaurant-refresh-history"');
    expect(sidebarOrderSource).toContain('"restaurant-refresh-history"');
    expect(sidebarOrderSource).toContain('검수: ["restaurants", "restaurant-refresh-history", "submissions", "reviews"]');
  });

  test("panel keeps refresh workflow history-first and operator guarded", () => {
    const panelSource = source("components/admin/AdminRestaurantRefreshHistoryPanel.tsx");

    expect(panelSource).toContain('data-admin-restaurant-refresh-history="true"');
    expect(panelSource).toContain('상호명·전화번호·폐업·이전');
    expect(panelSource).toContain('후보 생성 → 운영자 판단 → guarded apply → readback/recrawl');
    expect(panelSource).toContain('승인 맛집 점검 job 또는 수동 후보 기록');
    expect(panelSource).toContain('운영자 결정 기록');
    expect(panelSource).toContain('결정 저장');
    expect(panelSource).toContain('승인과 동시에 현재 맛집 값 guarded apply');
    expect(panelSource).toContain('candidate.candidate_status !== "needs_review"');
  });

  test("admin API is admin gated, no-store, and separates record from guarded apply", () => {
    const routeSource = source("app/api/admin/restaurant-refresh-history/route.ts");

    expect(routeSource).toContain('import { requireAdmin }');
    expect(routeSource).toContain('createSupabaseServiceRoleClient');
    expect(routeSource).toContain('if (!auth.ok) return auth.response');
    expect(routeSource).toContain('action === "record_candidate"');
    expect(routeSource).toContain('action === "decide_candidate"');
    expect(routeSource).toContain('body.apply === true');
    expect(routeSource).toContain('.eq("status", "approved")');
    expect(routeSource).toContain('!updatedRestaurant');
    expect(routeSource).toContain('"Cache-Control": "no-store"');
    expect(routeSource).not.toContain('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE');
  });

  test("migration stores immutable refresh runs/candidates with RLS and explicit grants", () => {
    const migrationSource = repoSource("backend/supabase/migrations/20260531105250_restaurant_refresh_history.sql");

    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.restaurant_refresh_runs');
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.restaurant_refresh_candidates');
    expect(migrationSource).toContain('previous_snapshot jsonb NOT NULL');
    expect(migrationSource).toContain('candidate_snapshot jsonb NOT NULL');
    expect(migrationSource).toContain('candidate_status IN');
    expect(migrationSource).toContain('ALTER TABLE public.restaurant_refresh_runs ENABLE ROW LEVEL SECURITY');
    expect(migrationSource).toContain('ALTER TABLE public.restaurant_refresh_candidates ENABLE ROW LEVEL SECURITY');
    expect(migrationSource).toContain('GRANT SELECT, INSERT, UPDATE ON public.restaurant_refresh_runs TO authenticated');
    expect(migrationSource).toContain('GRANT SELECT, INSERT, UPDATE ON public.restaurant_refresh_candidates TO authenticated');
    expect(migrationSource).toContain('public.is_user_admin(auth.uid())');
    expect(migrationSource).toContain('restaurant_refresh_candidates_change_types_gin_idx');
  });
});
