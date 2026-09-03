import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_SECTION_LABELS,
} from "../lib/admin/console-menu-registry";
import { filterAdminConsoleMenus } from "../lib/admin/console-menu-search";
import { CONSOLE_FIXED_MESSAGES } from "../lib/admin/console-messages";
import { generateSearchQueryCases } from "./helpers/deterministic-generator";

const SEARCH_CASES = generateSearchQueryCases(120);
const SECTION_CASES = [null, ...ADMIN_CONSOLE_SECTION_LABELS] as const;
const REGISTRY_IDS = new Set<string>(ADMIN_CONSOLE_MENU_IDS);

function source(relativePath: string) {
  return readFileSync(join(import.meta.dir, "..", relativePath), "utf8");
}

describe("admin console module grid", () => {
  test("keeps search, IME, live region, and dashboard placement contracts", () => {
    const gridSource = source(
      "components/admin/console/AdminConsoleModuleGrid.tsx",
    );
    const overviewSource = source(
      "components/admin/AdminConsoleOverview.tsx",
    );

    expect(gridSource).toContain("filterAdminConsoleMenus");
    expect(gridSource).toContain("maxLength={64}");
    expect(gridSource).toContain("onCompositionStart");
    expect(gridSource).toContain("onCompositionEnd");
    expect(gridSource).toContain("isComposingRef.current");
    expect(gridSource).toContain("event.nativeEvent.isComposing");
    expect(gridSource).toContain('aria-live="polite"');
    expect(gridSource).toContain("data-admin-module-grid-count");
    expect(gridSource).toContain("전체 ${TOTAL_MENU_COUNT}개");
    expect(gridSource).toContain(
      "grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3",
    );
    expect(gridSource).toContain(
      "transition-[opacity,transform] duration-150 motion-reduce:transition-none",
    );
    expect(gridSource).toContain("CONSOLE_FIXED_MESSAGES.gridEmpty");
    expect(gridSource).toContain("htmlFor={SEARCH_INPUT_ID}");
    expect(gridSource).toContain("htmlFor={SECTION_FILTER_ID}");
    expect(gridSource).toContain(
      "aria-label={`${menu.title} ${menu.primaryActionLabel}`}",
    );
    expect(gridSource).toContain("min-w-0");
    expect(gridSource).toContain("break-keep");
    expect(CONSOLE_FIXED_MESSAGES.gridEmpty).toContain("메뉴");

    expect(overviewSource.indexOf("AdminDashboardManagementPanel")).toBeGreaterThan(
      -1,
    );
    expect(overviewSource.indexOf("<AdminConsoleModuleGrid")).toBeGreaterThan(
      overviewSource.indexOf("AdminDashboardManagementPanel"),
    );
    expect(overviewSource).toContain(
      "<AdminConsoleModuleGrid onSelectModule={onSelectModule} />",
    );
  });

  // Property 9: 모듈_그리드 결과 크기 한계
  // Validates: Requirements 13.11, 13.12, 21.7
  test("keeps filtered card counts between 0 and 15, and 15 when search is blank", () => {
    expect(SEARCH_CASES.length).toBeGreaterThanOrEqual(100);
    expect(SEARCH_CASES).toContain("");
    expect(SEARCH_CASES).toContain("   ");
    expect(SEARCH_CASES.some((value) => value.length === 1)).toBe(true);
    expect(SEARCH_CASES.some((value) => value.length > 64)).toBe(true);
    expect(SEARCH_CASES.some((value) => /[가-힣]/.test(value))).toBe(true);
    expect(SEARCH_CASES.some((value) => /[A-Za-z]/.test(value))).toBe(true);

    for (const committedQuery of SEARCH_CASES) {
      for (const section of SECTION_CASES) {
        const cards = filterAdminConsoleMenus({ committedQuery, section });
        expect(cards.length).toBeGreaterThanOrEqual(0);
        expect(cards.length).toBeLessThanOrEqual(15);
      }
    }

    expect(
      filterAdminConsoleMenus({ committedQuery: "", section: null }),
    ).toHaveLength(15);
    expect(
      filterAdminConsoleMenus({ committedQuery: "   ", section: null }),
    ).toHaveLength(15);
  });

  // Property 10: 모듈_그리드 결과 부분집합
  // Validates: Requirements 13.4, 13.13, 21.7
  test("keeps filtered cards inside the registry set and the selected section", () => {
    for (const committedQuery of SEARCH_CASES) {
      for (const section of SECTION_CASES) {
        const cards = filterAdminConsoleMenus({ committedQuery, section });
        for (const card of cards) {
          expect(REGISTRY_IDS.has(card.id)).toBe(true);
          if (section !== null) {
            expect(card.section).toBe(section);
          }
        }
      }
    }
  });

  // Property 11: 검색 단조성
  // Validates: Requirements 13.16
  test("keeps longer prefix queries as a subset of shorter queries", () => {
    const prefixes = SEARCH_CASES.flatMap((query) => [
      [query, `${query}x`] as const,
      [query, `${query}맛`] as const,
    ]);

    for (const [shorter, longer] of prefixes) {
      for (const section of SECTION_CASES) {
        const shorterIds = new Set(
          filterAdminConsoleMenus({
            committedQuery: shorter,
            section,
          }).map((menu) => menu.id),
        );
        const longerIds = filterAdminConsoleMenus({
          committedQuery: longer,
          section,
        }).map((menu) => menu.id);
        for (const id of longerIds) {
          expect(shorterIds.has(id)).toBe(true);
        }
      }
    }
  });
});
