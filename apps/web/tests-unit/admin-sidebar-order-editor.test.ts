import { describe, expect, test } from "bun:test";

import {
  canPersistAdminSidebarOrder,
  moveAdminSidebarItem,
  moveAdminSidebarSection,
} from "../lib/admin/sidebar-order-controls";
import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
} from "../lib/admin/sidebar-order";

describe("admin sidebar order editor helpers", () => {
  test("locks persistence while loading, saving, or after a load failure", () => {
    expect(
      canPersistAdminSidebarOrder({
        enabled: true,
        loadFailed: false,
        isLoading: false,
        isSaving: false,
      }),
    ).toBe(true);
    expect(
      canPersistAdminSidebarOrder({
        enabled: false,
        loadFailed: false,
        isLoading: false,
        isSaving: false,
      }),
    ).toBe(false);
    expect(
      canPersistAdminSidebarOrder({
        enabled: true,
        loadFailed: true,
        isLoading: false,
        isSaving: false,
      }),
    ).toBe(false);
    expect(
      canPersistAdminSidebarOrder({
        enabled: true,
        loadFailed: false,
        isLoading: true,
        isSaving: false,
      }),
    ).toBe(false);
    expect(
      canPersistAdminSidebarOrder({
        enabled: true,
        loadFailed: false,
        isLoading: false,
        isSaving: true,
      }),
    ).toBe(false);
  });

  test("moves sections and items one step without crossing section boundaries", () => {
    const start = DEFAULT_ADMIN_SIDEBAR_ORDER;
    const movedSection = moveAdminSidebarSection(start, start.sections[0], 1);
    expect(movedSection.sections[1]).toBe(start.sections[0]);
    expect(movedSection.sections[0]).toBe(start.sections[1]);

    const section = start.sections[1];
    const items = start.items[section] ?? [];
    const movedItem = moveAdminSidebarItem(start, section, items[0], 1);
    expect(movedItem.items[section]?.[1]).toBe(items[0]);
    expect(movedItem.items[section]?.[0]).toBe(items[1]);

    const unchanged = moveAdminSidebarItem(start, section, items[0], -1);
    expect(normalizeAdminSidebarOrder(unchanged)).toEqual(start);
  });
});
