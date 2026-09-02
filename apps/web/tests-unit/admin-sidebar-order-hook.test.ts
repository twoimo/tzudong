import { describe, expect, test } from "bun:test";

import { CONSOLE_FIXED_MESSAGES } from "../lib/admin/console-messages";
import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
} from "../lib/admin/sidebar-order";
import { moveAdminSidebarItem } from "../lib/admin/sidebar-order-controls";
import {
  beginAdminSidebarOrderSave,
  resolveAdminSidebarOrderLoadFailure,
  resolveAdminSidebarOrderRevertNotice,
  resolveAdminSidebarOrderSaveFailure,
  resolveAdminSidebarOrderSaveSuccess,
} from "../lib/admin/sidebar-order-session";

// Validates: Requirements 7.2, 7.6, 7.15, 5.7, 5.10

function idleSaveInput(
  nextOrder: typeof DEFAULT_ADMIN_SIDEBAR_ORDER,
): Parameters<typeof beginAdminSidebarOrderSave>[0] {
  return {
    enabled: true,
    loadFailed: false,
    isLoading: false,
    isSaving: false,
    saveLocked: false,
    nextOrder,
  };
}

function movedSidebarOrder() {
  const section = DEFAULT_ADMIN_SIDEBAR_ORDER.sections[0];
  const itemId = DEFAULT_ADMIN_SIDEBAR_ORDER.items[section]?.[0];
  if (!section || !itemId) {
    throw new Error("default sidebar order is missing a movable item");
  }
  return moveAdminSidebarItem(DEFAULT_ADMIN_SIDEBAR_ORDER, section, itemId, 1);
}

describe("admin sidebar order load/save hook", () => {
  test("skips persist after a load failure and keeps the default order", () => {
    const failed = resolveAdminSidebarOrderLoadFailure();

    expect(failed.loadFailed).toBe(true);
    expect(failed.order).toEqual(DEFAULT_ADMIN_SIDEBAR_ORDER);
    expect(failed.message).toBe(CONSOLE_FIXED_MESSAGES.orderLoadFailed);
    expect(
      beginAdminSidebarOrderSave({
        ...idleSaveInput(movedSidebarOrder()),
        loadFailed: failed.loadFailed,
      }),
    ).toEqual({ accepted: false });
  });

  test("locks in-flight saves to one request", () => {
    const first = beginAdminSidebarOrderSave(idleSaveInput(movedSidebarOrder()));
    expect(first.accepted).toBe(true);
    if (!first.accepted) {
      throw new Error("expected the first save to be accepted");
    }

    expect(
      beginAdminSidebarOrderSave({
        ...idleSaveInput(DEFAULT_ADMIN_SIDEBAR_ORDER),
        saveLocked: first.saveLocked,
      }),
    ).toEqual({ accepted: false });
    expect(
      beginAdminSidebarOrderSave({
        ...idleSaveInput(DEFAULT_ADMIN_SIDEBAR_ORDER),
        isSaving: true,
      }),
    ).toEqual({ accepted: false });
  });

  test("keeps the temporary order on save failure and does not retry", () => {
    const optimisticOrder = movedSidebarOrder();
    const started = beginAdminSidebarOrderSave(idleSaveInput(optimisticOrder));
    expect(started.accepted).toBe(true);
    if (!started.accepted) {
      throw new Error("expected the save to start");
    }

    const failed = resolveAdminSidebarOrderSaveFailure({
      optimisticOrder: started.order,
    });

    expect(failed.order).toEqual(normalizeAdminSidebarOrder(optimisticOrder));
    expect(failed.order).not.toEqual(DEFAULT_ADMIN_SIDEBAR_ORDER);
    expect(failed.retry).toBe(false);
    expect(failed.saveLocked).toBe(false);
    expect(failed.message).toBe(CONSOLE_FIXED_MESSAGES.orderSaveFailed);
  });

  test("shows the revert notice once for a console load", () => {
    const first = resolveAdminSidebarOrderRevertNotice({
      revertedReason: "retired-section",
      alreadyShown: false,
    });
    expect(first).toEqual({
      show: true,
      alreadyShown: true,
      message: CONSOLE_FIXED_MESSAGES.orderReset,
    });

    expect(
      resolveAdminSidebarOrderRevertNotice({
        revertedReason: "retired-section",
        alreadyShown: first.alreadyShown,
      }),
    ).toEqual({
      show: false,
      alreadyShown: true,
      message: null,
    });
    expect(
      resolveAdminSidebarOrderRevertNotice({
        revertedReason: "cross-section-item",
        alreadyShown: true,
      }),
    ).toEqual({
      show: false,
      alreadyShown: true,
      message: null,
    });
    expect(
      resolveAdminSidebarOrderRevertNotice({
        revertedReason: null,
        alreadyShown: false,
      }),
    ).toEqual({
      show: false,
      alreadyShown: false,
      message: null,
    });
  });

  test("replaces the order from a successful save response", () => {
    const saved = resolveAdminSidebarOrderSaveSuccess({
      rawOrder: DEFAULT_ADMIN_SIDEBAR_ORDER,
      successMessage: CONSOLE_FIXED_MESSAGES.orderSaved,
    });

    expect(saved.order).toEqual(DEFAULT_ADMIN_SIDEBAR_ORDER);
    expect(saved.saveLocked).toBe(false);
    expect(saved.message).toBe(CONSOLE_FIXED_MESSAGES.orderSaved);
  });
});
