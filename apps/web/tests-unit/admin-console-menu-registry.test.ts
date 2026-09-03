import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_MENU_LIST,
  ADMIN_CONSOLE_MENUS,
  ADMIN_CONSOLE_SECTION_LABELS,
  ADMIN_CONSOLE_SECTION_LIST,
  ADMIN_MENU_OUTPUT_KINDS,
  RETIRED_ADMIN_SECTION_LABELS,
  findAdminConsoleMenu,
  getAdminConsoleMenu,
  getAdminConsoleMenuIdsBySection,
  getAdminConsoleMenuPendingDomains,
  getAdminConsoleSection,
  isRetiredAdminSectionLabel,
  type AdminConsoleMenuDefinition,
  type AdminMenuOutputKind,
} from "../lib/admin/console-menu-registry";
import { CONSOLE_FIXED_MESSAGES } from "../lib/admin/console-messages";
import {
  ADMIN_CONSOLE_MODULE_EMPTY_COPY,
  getAdminConsoleCompletenessMenuIds,
} from "../lib/admin/console-module-state";
import {
  ADMIN_CONSOLE_MODULE_IDS,
  buildCanonicalAdminModuleHref,
} from "../lib/admin/admin-module-routing";
import { ADMIN_SIDEBAR_ITEM_IDS } from "../lib/admin/sidebar-order";
import {
  CONSOLE_VIZ_BINDINGS,
  CONSOLE_VIZ_UNBOUND_MENU_IDS,
  getConsoleVizBindings,
} from "../lib/admin/console-visualization-map";
import { filterAdminConsoleMenus } from "../lib/admin/console-menu-search";

const MENU_FIELD_NAMES = [
  "id",
  "title",
  "purpose",
  "operationalDuty",
  "primarySources",
  "primaryActionLabel",
  "outputKind",
] as const;

const FORBIDDEN_WORDS = [
  "식당",
  "음식점",
  "업소",
  "가게",
  "신청",
  "문의",
  "심사",
  "경로",
  "루트",
] as const;

const ALLOWED_ROMAN = new Set(["KPI", "OCR"]);
const HANGUL = /[가-힣]/;
const ROMAN_WORD = /[A-Za-z]+/g;
const SECTION_COUNTS: Record<(typeof ADMIN_CONSOLE_SECTION_LABELS)[number], number> = {
  판단: 3,
  검수: 4,
  운영: 6,
  "콘텐츠 제작": 2,
};

function unicodeLength(value: string): number {
  return [...value].length;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function collectRegistryDefects(
  menus: readonly Partial<AdminConsoleMenuDefinition>[],
): string[] {
  const defects: string[] = [];
  const ids = menus.map((menu) => menu.id);
  if (menus.length !== 15) {
    defects.push(`count:${menus.length}`);
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) {
      defects.push("id");
      continue;
    }
    if (seen.has(id)) {
      defects.push("id:duplicate");
    }
    seen.add(id);
  }

  for (const menu of menus) {
    const menuId = typeof menu.id === "string" ? menu.id : "unknown";
    for (const field of MENU_FIELD_NAMES) {
      if (!(field in menu)) {
        defects.push(`${menuId}:${field}`);
        continue;
      }
      const value = menu[field];
      if (field === "primarySources") {
        if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
          defects.push(`${menuId}:primarySources`);
        } else if (value.some((source) => !isNonEmptyText(source))) {
          defects.push(`${menuId}:primarySources`);
        }
        continue;
      }
      if (field === "outputKind") {
        if (
          typeof value !== "string" ||
          !(ADMIN_MENU_OUTPUT_KINDS as readonly string[]).includes(value)
        ) {
          defects.push(`${menuId}:outputKind`);
        }
        continue;
      }
      if (!isNonEmptyText(value)) {
        defects.push(`${menuId}:${field}`);
      }
    }
    if (
      !menu.section ||
      !(ADMIN_CONSOLE_SECTION_LABELS as readonly string[]).includes(menu.section)
    ) {
      defects.push(`${menuId}:section`);
    }
  }
  return defects;
}

describe("admin console menu registry", () => {
  // Property 1: 레지스트리 형태 불변식
  // Validates: Requirements 1.1, 1.2, 1.3, 1.7, 1.8, 1.9, 1.10, 4.1, 5.1, 5.2, 5.3, 5.4, 21.1, 21.13
  test("keeps fifteen unique menus with seven required fields", () => {
    expect(ADMIN_CONSOLE_MENU_IDS).toHaveLength(15);
    expect(ADMIN_CONSOLE_MENU_LIST).toHaveLength(15);
    expect(new Set(ADMIN_CONSOLE_MENU_IDS).size).toBe(15);
    expect(Object.keys(ADMIN_CONSOLE_MENUS)).toHaveLength(15);
    expect(ADMIN_CONSOLE_SECTION_LABELS).toEqual([
      "판단",
      "검수",
      "운영",
      "콘텐츠 제작",
    ]);
    expect(ADMIN_CONSOLE_SECTION_LIST).toHaveLength(4);
    expect(RETIRED_ADMIN_SECTION_LABELS).toEqual(["홈", "실험실"]);

    for (const id of ADMIN_CONSOLE_MENU_IDS) {
      const menu = getAdminConsoleMenu(id);
      expect(menu.id).toBe(id);
      for (const field of MENU_FIELD_NAMES) {
        expect(menu[field], `${id}.${field}`).toBeDefined();
      }
      expect(isNonEmptyText(menu.title)).toBe(true);
      expect(isNonEmptyText(menu.purpose)).toBe(true);
      expect(isNonEmptyText(menu.operationalDuty)).toBe(true);
      expect(isNonEmptyText(menu.primaryActionLabel)).toBe(true);
      expect(menu.primarySources.length).toBeGreaterThanOrEqual(1);
      expect(menu.primarySources.length).toBeLessThanOrEqual(3);
      expect(
        (ADMIN_MENU_OUTPUT_KINDS as readonly AdminMenuOutputKind[]).includes(
          menu.outputKind,
        ),
      ).toBe(true);
      expect(
        (ADMIN_CONSOLE_SECTION_LABELS as readonly string[]).includes(menu.section),
      ).toBe(true);
    }

    expect(getAdminConsoleMenuIdsBySection("판단")).toHaveLength(3);
    expect(getAdminConsoleMenuIdsBySection("검수")).toHaveLength(4);
    expect(getAdminConsoleMenuIdsBySection("운영")).toHaveLength(6);
    expect(getAdminConsoleMenuIdsBySection("콘텐츠 제작")).toHaveLength(2);
    expect(getAdminConsoleMenuIdsBySection("운영")).toContain("audit");
    expect(getAdminConsoleMenuIdsBySection("콘텐츠 제작")).not.toContain("audit");

    expect(getAdminConsoleMenuPendingDomains("submissions")).toEqual([
      "restaurant_submissions",
      "restaurant_recommendation_requests",
    ]);
    expect(getAdminConsoleMenuPendingDomains("reviews")).toEqual(["reviews"]);
    expect(getAdminConsoleMenuPendingDomains("overview")).toEqual([]);

    expect(findAdminConsoleMenu("overview")?.id).toBe("overview");
    expect(findAdminConsoleMenu("")).toBeNull();
    expect(findAdminConsoleMenu("unknown")).toBeNull();
    expect(findAdminConsoleMenu(" overview")).toBeNull();
    expect(findAdminConsoleMenu("OVERVIEW")).toBeNull();
    expect(findAdminConsoleMenu("overview?x")).toBeNull();
    expect(isRetiredAdminSectionLabel("홈")).toBe(true);
    expect(isRetiredAdminSectionLabel("실험실")).toBe(true);
    expect(isRetiredAdminSectionLabel("판단")).toBe(false);

    for (const label of ADMIN_CONSOLE_SECTION_LABELS) {
      const section = getAdminConsoleSection(label);
      expect(section.label).toBe(label);
      expect(unicodeLength(section.label)).toBeLessThanOrEqual(8);
      expect(unicodeLength(section.purpose)).toBeLessThanOrEqual(60);
      expect(isNonEmptyText(section.purpose)).toBe(true);
      expect(SECTION_COUNTS[label]).toBe(
        getAdminConsoleMenuIdsBySection(label).length,
      );
    }

    expect(CONSOLE_VIZ_BINDINGS).toHaveLength(11);
    expect(CONSOLE_VIZ_UNBOUND_MENU_IDS).toHaveLength(6);
    for (const menuId of CONSOLE_VIZ_UNBOUND_MENU_IDS) {
      expect(getConsoleVizBindings(menuId)).toEqual([]);
    }
    expect(filterAdminConsoleMenus({ committedQuery: "", section: null })).toHaveLength(
      15,
    );
    expect(collectRegistryDefects(ADMIN_CONSOLE_MENU_LIST)).toEqual([]);
  });

  // Property 2: 표기 규칙 불변식
  // Validates: Requirements 1.3, 16.1, 16.2, 16.8, 16.10, 16.11
  test("keeps Korean restaurant-map copy within length and alphabet rules", () => {
    const titles = ADMIN_CONSOLE_MENU_LIST.map((menu) => menu.title);
    expect(new Set(titles).size).toBe(15);
    const titleLengths = titles.map(unicodeLength);
    expect(Math.max(...titleLengths)).toBe(10);
    expect(Math.max(...titleLengths)).toBeLessThanOrEqual(14);

    for (const menu of ADMIN_CONSOLE_MENU_LIST) {
      expect(unicodeLength(menu.title)).toBeLessThanOrEqual(14);
      expect(unicodeLength(menu.purpose)).toBeLessThanOrEqual(60);
      expect(unicodeLength(menu.operationalDuty)).toBeLessThanOrEqual(60);
      expect(unicodeLength(menu.primaryActionLabel)).toBeLessThanOrEqual(20);
      for (const field of [
        "title",
        "purpose",
        "operationalDuty",
        "primaryActionLabel",
      ] as const) {
        expect(HANGUL.test(menu[field]), `${menu.id}.${field}`).toBe(true);
        for (const word of FORBIDDEN_WORDS) {
          expect(menu[field].includes(word), `${menu.id}.${field}:${word}`).toBe(
            false,
          );
        }
        const roman = menu[field].match(ROMAN_WORD) ?? [];
        for (const token of roman) {
          expect(ALLOWED_ROMAN.has(token), `${menu.id}.${field}:${token}`).toBe(
            true,
          );
        }
      }
    }

    for (const label of ADMIN_CONSOLE_SECTION_LABELS) {
      const roman = label.match(ROMAN_WORD) ?? [];
      expect(roman).toEqual([]);
      for (const word of FORBIDDEN_WORDS) {
        expect(label.includes(word)).toBe(false);
      }
    }

    for (const message of Object.values(CONSOLE_FIXED_MESSAGES)) {
      expect(HANGUL.test(message)).toBe(true);
      expect(message.includes("확정")).toBe(false);
      expect(message.includes("사실")).toBe(false);
      expect(message.includes("완성")).toBe(false);
      expect(message.includes("최종")).toBe(false);
    }
  });

  function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values)].sort();
  }

  function derivedSetEqualsRegistry(values: readonly string[]): boolean {
    const unique = new Set(values);
    return (
      unique.size === ADMIN_CONSOLE_MENU_IDS.length &&
      ADMIN_CONSOLE_MENU_IDS.every((id) => unique.has(id))
    );
  }

  function extractObjectKeys(fileSource: string, constName: string): string[] {
    const start = fileSource.indexOf(`export const ${constName} = {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const afterStart = fileSource.slice(start);
    const end = afterStart.search(/\} as const satisfies/);
    expect(end).toBeGreaterThan(0);
    const body = afterStart.slice(0, end);
    const nestedFieldNames = new Set(["menuId", "regions", "variant"]);
    return [...body.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w-]*))\s*:/gm)]
      .map((match) => match[1] ?? match[2])
      .filter((key): key is string => typeof key === "string")
      .filter((key) => !nestedFieldNames.has(key));
  }

  // Property 3: 파생 집합 동일성
  // Validates: Requirements 2.1, 2.4, 2.7, 2.10, 21.1
  test("keeps derived menu-id sets equal to the registry set", () => {
    const registryIds = uniqueSorted(ADMIN_CONSOLE_MENU_IDS);
    const routingIds = uniqueSorted(ADMIN_CONSOLE_MODULE_IDS);
    const sidebarIds = uniqueSorted(
      ADMIN_CONSOLE_SECTION_LABELS.flatMap((label) =>
        getAdminConsoleMenuIdsBySection(label),
      ),
    );
    const canonicalIds = uniqueSorted(
      ADMIN_CONSOLE_MENU_IDS.filter((id) => {
        const href = buildCanonicalAdminModuleHref(id);
        return href === "/admin" || href.startsWith("/admin?");
      }),
    );
    const shellHeaderIds = uniqueSorted(getAdminConsoleCompletenessMenuIds());
    const gridIds = uniqueSorted(
      filterAdminConsoleMenus({ committedQuery: "", section: null }).map(
        (menu) => menu.id,
      ),
    );
    const orderAllowlistIds = uniqueSorted(ADMIN_SIDEBAR_ITEM_IDS);
    const skeletonSource = readFileSync(
      join(
        import.meta.dir,
        "..",
        "components/admin/console/AdminConsoleModuleSkeleton.tsx",
      ),
      "utf8",
    );
    const panelSource = readFileSync(
      join(
        import.meta.dir,
        "..",
        "components/admin/console/module-panel-registry.tsx",
      ),
      "utf8",
    );
    const skeletonIds = uniqueSorted(
      extractObjectKeys(skeletonSource, "ADMIN_CONSOLE_MODULE_SKELETON_SHAPES"),
    );
    const panelIds = uniqueSorted(
      extractObjectKeys(panelSource, "ADMIN_CONSOLE_MODULE_PANELS"),
    );
    const emptyCopyIds = uniqueSorted(Object.keys(ADMIN_CONSOLE_MODULE_EMPTY_COPY));

    const derivedSets = {
      routing: routingIds,
      sidebar: sidebarIds,
      canonical: canonicalIds,
      shellHeader: shellHeaderIds,
      moduleGrid: gridIds,
      orderAllowlist: orderAllowlistIds,
      skeleton: skeletonIds,
      panel: panelIds,
      emptyCopy: emptyCopyIds,
    } as const;

    for (const [label, values] of Object.entries(derivedSets)) {
      expect(values, label).toHaveLength(15);
      expect(derivedSetEqualsRegistry(values), label).toBe(true);
      expect(values, label).toEqual(registryIds);
    }

    expect(derivedSetEqualsRegistry([...registryIds, "extra-menu"])).toBe(false);
    expect(derivedSetEqualsRegistry(registryIds.slice(1))).toBe(false);
    expect(derivedSetEqualsRegistry([])).toBe(false);
  });

  test("reports damaged registry fields instead of treating them as passing", () => {
    const valid = ADMIN_CONSOLE_MENU_LIST[0];
    const emptyTitle = { ...valid, title: "   " };
    const duplicateId = [valid, { ...ADMIN_CONSOLE_MENU_LIST[1], id: valid.id }];
    const unknownSection = {
      ...valid,
      section: "홈" as AdminConsoleMenuDefinition["section"],
    };
    const missingField = { ...valid } as Partial<AdminConsoleMenuDefinition>;
    delete missingField.purpose;
    const invalidKind = {
      ...valid,
      outputKind: "초안" as AdminMenuOutputKind,
    };

    expect(collectRegistryDefects([emptyTitle])).toContain(`${valid.id}:title`);
    expect(collectRegistryDefects(duplicateId)).toContain("id:duplicate");
    expect(collectRegistryDefects([unknownSection])).toContain(
      `${valid.id}:section`,
    );
    expect(collectRegistryDefects([missingField])).toContain(
      `${valid.id}:purpose`,
    );
    expect(collectRegistryDefects([invalidKind])).toContain(
      `${valid.id}:outputKind`,
    );
  });
});
