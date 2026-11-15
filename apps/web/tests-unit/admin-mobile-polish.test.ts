import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");

describe("admin mobile visual polish", () => {
  test("mobile shell names the active module once and retains its live screen announcement", () => {
    const source = read("components/admin/AdminConsoleOverview.tsx");
    const mobileHeaderStart = source.indexOf('data-admin-console-mobile-header="true"');
    const mobileHeaderEnd = source.indexOf('{renderAdminMenuContent("admin-console-menu-dropdown")}', mobileHeaderStart);
    const mobileHeader = source.slice(mobileHeaderStart, mobileHeaderEnd);

    expect(mobileHeaderStart).toBeGreaterThanOrEqual(0);
    expect(mobileHeaderEnd).toBeGreaterThan(mobileHeaderStart);
    expect(mobileHeader).toContain('data-admin-mobile-module-title="true"');
    expect(mobileHeader).toContain("{activeSidebarLabel}");
    expect(mobileHeader).not.toContain(">관리자 콘솔<");
    expect(mobileHeader).toContain('data-admin-console-menu-trigger="hamburger"');
    expect(mobileHeader).not.toContain("현재 화면 ·");
    expect(source).toContain('<p className="sr-only" aria-live="polite">');
    expect(source).toContain("{activeModuleLabel} 작업 화면으로 전환됨");
  });

  test("mobile KPI values and variable-width changes occupy separate flow rows", () => {
    const adminCss = read("styles/admin-ui.css");
    expect(adminCss).toContain(
      '[data-admin-dashboard-kpi-title-row="single-line"] { display: grid; grid-template-columns: minmax(0, 1fr);',
    );
    expect(adminCss).toContain(
      '[data-admin-dashboard-kpi-title-row="single-line"] > div:first-child { width: 100%;',
    );
    expect(adminCss).toContain(
      '[data-admin-dashboard-kpi-title-actions="single-line-scroll"] { position: static; width: 100%; max-width: 100%;',
    );
    expect(adminCss).not.toContain('[data-admin-dashboard-kpi-title-actions="single-line-scroll"] { position: absolute;');
    expect(adminCss).toContain("@media (max-width: 767px)");
  });

  test("touch chart toolbars wrap within cards and do not clip their hit targets", () => {
    const adminCss = read("styles/admin-ui.css");
    expect(adminCss).toContain('[data-admin-dashboard-card-title-row="single-line"] { flex-wrap: wrap; overflow: visible; }');
    expect(adminCss).toContain('[data-admin-dashboard-card-title-actions="single-line-scroll"] { flex: 1 1 100%; width: 100%; max-width: 100%; min-height: 44px; overflow: visible; }');
    expect(adminCss).toContain('[data-admin-dashboard-card-title-actions="single-line-scroll"] > div { min-width: 0; max-width: 100%; flex-wrap: wrap; gap: 8px; }');
    expect(adminCss).toContain('[data-admin-dashboard-series-toggle="true"] { height: auto; min-height: 44px; }');
  });

  test("admin badge geometry stays scoped and the account avatar keeps its compact neutral treatment", () => {
    const badgeSource = read("components/ui/badge.tsx");
    const adminCss = read("styles/admin-ui.css");
    const consoleSource = read("components/admin/AdminConsoleOverview.tsx");

    expect(badgeSource).toContain('data-slot="badge"');
    expect(badgeSource).toContain('inline-flex items-center rounded-full');
    const badgeRules = [...adminCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((rule) => rule[1].includes('[data-slot="badge"]'));
    expect(badgeRules.map((rule) => rule[1].trim())).toEqual([
      '[data-admin-console-shell="true"] [data-slot="badge"]',
    ]);
    expect(badgeRules[0]?.[2]).toMatch(/border-radius:\s*8px\s*;/);
    const avatarClass = consoleSource.match(/const sidebarAccountAvatarClassName\s*=\s*"([^"]+)"/)?.[1].split(/\s+/) ?? [];
    for (const token of ['h-8', 'w-8', 'shrink-0', 'rounded-lg', 'border-border', 'bg-muted', 'text-muted-foreground']) {
      expect(avatarClass).toContain(token);
    }
    expect(consoleSource).toContain('data-admin-sidebar-account-avatar="true"');
    expect(consoleSource).toContain('aria-hidden="true"\n          data-admin-sidebar-account-avatar="true"');
  });
});
