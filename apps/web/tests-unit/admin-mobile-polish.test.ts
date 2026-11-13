import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");

describe("admin mobile visual polish", () => {
  test("mobile shell has one visible brand line and retains its live screen announcement", () => {
    const source = read("components/admin/AdminConsoleOverview.tsx");
    const mobileHeaderStart = source.indexOf('data-admin-console-mobile-header="true"');
    const mobileHeaderEnd = source.indexOf('{renderAdminMenuContent("admin-console-menu-dropdown")}', mobileHeaderStart);
    const mobileHeader = source.slice(mobileHeaderStart, mobileHeaderEnd);

    expect(mobileHeaderStart).toBeGreaterThanOrEqual(0);
    expect(mobileHeaderEnd).toBeGreaterThan(mobileHeaderStart);
    expect(mobileHeader).toContain("관리자 콘솔");
    expect(mobileHeader).toContain('data-admin-console-menu-trigger="hamburger"');
    expect(mobileHeader).not.toContain("현재 화면 ·");
    expect(source).toContain('<p className="sr-only" aria-live="polite">');
    expect(source).toContain("{activeModuleLabel} 작업 화면으로 전환됨");
  });

  test("mobile KPI titles get the full row and trend actions move to a separate row", () => {
    const adminCss = read("styles/admin-ui.css");
    expect(adminCss).toContain(
      '[data-admin-dashboard-kpi-title-row="single-line"] { display: grid; grid-template-columns: minmax(0, 1fr);',
    );
    expect(adminCss).toContain(
      '[data-admin-dashboard-kpi-title-row="single-line"] > div:first-child { width: 100%;',
    );
    expect(adminCss).toContain(
      '[data-admin-dashboard-kpi-title-actions="single-line-scroll"] { width: 100%; max-width: 100%;',
    );
    expect(adminCss).toContain("@media (max-width: 767px)");
  });

  test("shared badges are square only inside the admin shell; account avatars stay round", () => {
    const badgeSource = read("components/ui/badge.tsx");
    const adminCss = read("styles/admin-ui.css");
    const consoleSource = read("components/admin/AdminConsoleOverview.tsx");

    expect(badgeSource).toContain('data-slot="badge"');
    expect(adminCss).toContain(
      '[data-admin-console-shell="true"] [data-slot="badge"] { border-radius: 0; }',
    );
    expect(consoleSource).toContain('rounded-full bg-primary/10 text-primary');
    expect(consoleSource).toContain('data-admin-sidebar-account-avatar="true"');
  });
});
