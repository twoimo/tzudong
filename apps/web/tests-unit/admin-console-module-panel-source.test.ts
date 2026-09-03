import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ADMIN_CONSOLE_MENU_IDS } from "../lib/admin/console-menu-registry";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

const skeletonSource = source(
  "components/admin/console/AdminConsoleModuleSkeleton.tsx",
);
const panelRegistrySource = source(
  "components/admin/console/module-panel-registry.tsx",
);
const completenessSource = source(
  "components/admin/console/AdminConsoleModuleCompleteness.tsx",
);
const moduleStateSource = source("lib/admin/console-module-state.ts");

function recordKeyLiteral(menuId: string) {
  return menuId.includes("-") ? `"${menuId}"` : menuId;
}

function extractObjectKeys(fileSource: string, constName: string): string[] {
  const start = fileSource.indexOf(`export const ${constName} = {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const afterStart = fileSource.slice(start);
  const end = afterStart.search(/\} as const satisfies/);
  expect(end).toBeGreaterThan(0);
  const body = afterStart.slice(0, end);
  const nestedFieldNames = new Set(["menuId", "regions", "variant"]);
  const keys = [
    ...body.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w-]*))\s*:/gm),
  ]
    .map((match) => match[1] ?? match[2])
    .filter((key): key is string => typeof key === "string")
    .filter((key) => !nestedFieldNames.has(key));
  return keys;
}

describe("admin console module panel source contract", () => {
  test("declares 15 dynamic() panels, no null loaders, and matching menu keys", () => {
    expect((panelRegistrySource.match(/dynamic\(/g) ?? []).length).toBe(15);
    expect(panelRegistrySource).not.toContain("loading: () => null");
    expect(panelRegistrySource).toContain(
      "loading: () => completenessLoading(",
    );
    expect(panelRegistrySource).toContain("AdminConsoleModuleCompleteness");
    expect(panelRegistrySource).toContain("withCompleteness(");
    expect(panelRegistrySource).toContain(
      "CONSOLE_FIXED_MESSAGES.modulePanelMissing",
    );
    expect(panelRegistrySource).toContain(
      "satisfies Record<\n  AdminConsoleMenuId,\n  AdminConsoleModulePanelComponent\n>",
    );

    expect(skeletonSource).toContain(
      "as const satisfies Record<AdminConsoleMenuId, ModuleSkeletonShape>",
    );
    expect(skeletonSource).toContain("readonly regions: readonly string[]");
    expect(skeletonSource).toContain(
      "data-admin-module-skeleton-region={region}",
    );
    expect(skeletonSource).toContain('px-2 py-1.5');

    const skeletonKeys = extractObjectKeys(
      skeletonSource,
      "ADMIN_CONSOLE_MODULE_SKELETON_SHAPES",
    ).sort();
    const panelKeys = extractObjectKeys(
      panelRegistrySource,
      "ADMIN_CONSOLE_MODULE_PANELS",
    ).sort();
    const menuIds = [...ADMIN_CONSOLE_MENU_IDS].sort();

    expect(skeletonKeys).toEqual(menuIds);
    expect(panelKeys).toEqual(menuIds);
    expect(skeletonKeys).toHaveLength(15);
    expect(panelKeys).toHaveLength(15);

    for (const menuId of ADMIN_CONSOLE_MENU_IDS) {
      expect(skeletonSource).toContain(`menuId: "${menuId}"`);
      expect(skeletonSource).toContain(`${recordKeyLiteral(menuId)}: {`);
      expect(panelRegistrySource).toContain(
        `${recordKeyLiteral(menuId)}:`,
      );
    }

    expect(skeletonSource).toContain("kpi-card-1");
    expect(skeletonSource).toContain("gauge");
    expect(skeletonSource).toContain("grid-card-6");
    expect(skeletonSource).toContain("scene-1");
    expect(skeletonSource).toContain("scene-4");
    expect(skeletonSource).toContain("tool-12");
    expect(skeletonSource).toContain("evaluation-table");
    expect(skeletonSource).toContain("overlay-tab-manual");

    expect(completenessSource).toContain('data-admin-module-state={state}');
    expect(completenessSource).toContain("data-admin-module-state-menu={menuId}");
    expect(completenessSource).toContain(
      "data-admin-module-output-kind={getAdminConsoleModuleOutputKind(menuId)}",
    );
    expect(moduleStateSource).toContain('"loading"');
    expect(moduleStateSource).toContain('"empty"');
    expect(moduleStateSource).toContain('"error"');
    expect(moduleStateSource).toContain('"unauthorized"');
    expect(moduleStateSource).toContain('"ready"');
    expect(completenessSource).toContain("ADMIN_CONSOLE_MODULE_ERROR_MESSAGE");
    expect(completenessSource).toContain("ADMIN_CONSOLE_MODULE_UNAUTHORIZED_MESSAGE");
    expect(completenessSource).toContain("buildAdminConsoleReloginHref(menuId)");
    expect(completenessSource).toContain("data-admin-module-retry");
    expect(completenessSource).toContain("data-admin-module-relogin");
    expect((completenessSource.match(/data-admin-module-state=/g) ?? []).length).toBe(1);
  });
});
