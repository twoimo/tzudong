import { describe, expect, test } from "bun:test";

import {
  ADMIN_MODULE_TITLES,
  getAdminModuleTitle,
  getAdminPageMetadata,
} from "../lib/admin/admin-module-metadata";
import {
  ADMIN_CONSOLE_MODULE_IDS,
  type AdminConsoleRouteModuleId,
} from "../lib/admin/admin-module-routing";
import { ADMIN_SIDEBAR_ITEM_IDS } from "../lib/admin/sidebar-order";

describe("admin module title metadata", () => {
  test("covers every route and all 15 sidebar modules with a non-empty title", () => {
    expect(ADMIN_SIDEBAR_ITEM_IDS).toHaveLength(15);
    expect(Object.keys(ADMIN_MODULE_TITLES).sort()).toEqual(
      [...ADMIN_CONSOLE_MODULE_IDS].sort(),
    );

    for (const moduleId of ADMIN_CONSOLE_MODULE_IDS) {
      expect(getAdminModuleTitle(moduleId).trim()).not.toBe("");
    }
  });

  test("uses the restaurant root title for its legacy refresh-history route", () => {
    expect(getAdminModuleTitle("restaurant-refresh-history")).toBe(
      getAdminModuleTitle("restaurants"),
    );
  });

  test("server titles match every module and retain the admin no-index policy", () => {
    for (const moduleId of ADMIN_CONSOLE_MODULE_IDS) {
      const metadata = getAdminPageMetadata({ module: moduleId });
      expect(metadata.title).toBe(`${getAdminModuleTitle(moduleId)} - 관리자 콘솔 - 쯔동여지도`);
      expect(metadata.robots).toMatchObject({ index: false, follow: false });
    }
  });

  test("uses the same default and legacy routing precedence as the client", () => {
    const cases: Array<[
      Record<string, string | string[] | undefined>,
      AdminConsoleRouteModuleId,
    ]> = [
      [{}, "overview"],
      [{ module: "unknown" }, "overview"],
      [{ view: "submissions" }, "submissions"],
      [{ view: "submissions", tab: "reviews" }, "reviews"],
      [{ module: "unknown", view: "submissions", tab: "reviews" }, "reviews"],
      [{ module: "users", view: "submissions", tab: "reviews" }, "users"],
      [{ module: ["reviews", "users"] }, "reviews"],
      [{ module: [], view: ["submissions"], tab: ["reviews", "other"] }, "reviews"],
    ];
    for (const [query, expectedModule] of cases) {
      expect(getAdminPageMetadata(query).title).toBe(
        `${getAdminModuleTitle(expectedModule)} - 관리자 콘솔 - 쯔동여지도`,
      );
    }
  });

  test("never reflects unknown query values or record identifiers in the title", () => {
    expect(getAdminPageMetadata({
      module: "<script>unknown</script>",
      video_id: "private-record-reference",
      issue: "private-issue-reference",
    }).title).toBe("대시보드 (KPI) - 관리자 콘솔 - 쯔동여지도");
  });
});
