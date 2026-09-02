import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";
import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
  type AdminSidebarOrderPreference,
  type AdminSidebarOrderRevertedReason,
} from "@/lib/admin/sidebar-order";
import { canPersistAdminSidebarOrder } from "@/lib/admin/sidebar-order-controls";

export const ORDER_SAVE_IN_PROGRESS_MESSAGE = "메뉴 순서를 저장하는 중입니다.";

export function resolveAdminSidebarOrderLoadFailure(): {
  order: AdminSidebarOrderPreference;
  loadFailed: true;
  message: string;
} {
  return {
    order: DEFAULT_ADMIN_SIDEBAR_ORDER,
    loadFailed: true,
    message: CONSOLE_FIXED_MESSAGES.orderLoadFailed,
  };
}

export function resolveAdminSidebarOrderRevertNotice(input: {
  revertedReason: AdminSidebarOrderRevertedReason;
  alreadyShown: boolean;
}): { show: boolean; alreadyShown: boolean; message: string | null } {
  if (input.revertedReason && !input.alreadyShown) {
    return {
      show: true,
      alreadyShown: true,
      message: CONSOLE_FIXED_MESSAGES.orderReset,
    };
  }

  return {
    show: false,
    alreadyShown: input.alreadyShown,
    message: null,
  };
}

export type BeginAdminSidebarOrderSaveInput = {
  enabled: boolean;
  loadFailed: boolean;
  isLoading: boolean;
  isSaving: boolean;
  saveLocked: boolean;
  nextOrder: AdminSidebarOrderPreference;
};

export type BeginAdminSidebarOrderSaveResult =
  | { accepted: false }
  | {
      accepted: true;
      order: AdminSidebarOrderPreference;
      saveLocked: true;
      savingMessage: string;
    };

export function beginAdminSidebarOrderSave(
  input: BeginAdminSidebarOrderSaveInput,
): BeginAdminSidebarOrderSaveResult {
  if (
    input.saveLocked ||
    !canPersistAdminSidebarOrder({
      enabled: input.enabled,
      loadFailed: input.loadFailed,
      isLoading: input.isLoading,
      isSaving: input.isSaving,
    })
  ) {
    return { accepted: false };
  }

  return {
    accepted: true,
    order: normalizeAdminSidebarOrder(input.nextOrder),
    saveLocked: true,
    savingMessage: ORDER_SAVE_IN_PROGRESS_MESSAGE,
  };
}

export function resolveAdminSidebarOrderSaveFailure(input: {
  optimisticOrder: AdminSidebarOrderPreference;
}): {
  order: AdminSidebarOrderPreference;
  retry: false;
  saveLocked: false;
  message: string;
} {
  return {
    order: input.optimisticOrder,
    retry: false,
    saveLocked: false,
    message: CONSOLE_FIXED_MESSAGES.orderSaveFailed,
  };
}

export function resolveAdminSidebarOrderSaveSuccess(input: {
  rawOrder: unknown;
  successMessage: string;
}): {
  order: AdminSidebarOrderPreference;
  saveLocked: false;
  message: string;
} {
  return {
    order: normalizeAdminSidebarOrder(input.rawOrder),
    saveLocked: false,
    message: input.successMessage,
  };
}
