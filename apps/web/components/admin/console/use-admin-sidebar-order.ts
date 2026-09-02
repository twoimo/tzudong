"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";
import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
  normalizeAdminSidebarOrderWithReason,
  type AdminSidebarOrderPreference,
} from "@/lib/admin/sidebar-order";
import { canPersistAdminSidebarOrder } from "@/lib/admin/sidebar-order-controls";

export {
  canPersistAdminSidebarOrder,
  moveAdminSidebarItem,
  moveAdminSidebarSection,
} from "@/lib/admin/sidebar-order-controls";

const ORDER_ACCOUNT_HINT = "메뉴 순서는 관리자 계정별로 저장됩니다.";

async function readSidebarOrderPayload(response: Response): Promise<unknown> {
  const payload = (await response.json()) as { order?: unknown };
  return payload.order;
}

export function useAdminSidebarOrder(enabled: boolean) {
  const [order, setOrder] = useState<AdminSidebarOrderPreference>(
    DEFAULT_ADMIN_SIDEBAR_ORDER,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [message, setMessage] = useState(ORDER_ACCOUNT_HINT);
  const revertNoticeShownRef = useRef(false);
  const saveLockRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadSidebarOrder() {
      setIsLoading(true);
      setLoadFailed(false);
      try {
        const response = await fetch("/api/admin/preferences/sidebar-order", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("sidebar-order-load-failed");
        }

        const rawOrder = await readSidebarOrderPayload(response);
        if (controller.signal.aborted) return;

        const normalized = normalizeAdminSidebarOrderWithReason(rawOrder);
        setOrder(normalized.order);
        if (normalized.revertedReason && !revertNoticeShownRef.current) {
          revertNoticeShownRef.current = true;
          setMessage(CONSOLE_FIXED_MESSAGES.orderReset);
        }
      } catch {
        if (!controller.signal.aborted) {
          setOrder(DEFAULT_ADMIN_SIDEBAR_ORDER);
          setLoadFailed(true);
          setMessage(CONSOLE_FIXED_MESSAGES.orderLoadFailed);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadSidebarOrder();

    return () => {
      controller.abort();
    };
  }, [enabled]);

  const persist = useCallback(
    async (nextOrder: AdminSidebarOrderPreference, successMessage: string) => {
      if (
        !canPersistAdminSidebarOrder({
          enabled,
          loadFailed,
          isLoading,
          isSaving: saveLockRef.current || isSaving,
        })
      ) {
        return;
      }

      const normalizedOrder = normalizeAdminSidebarOrder(nextOrder);
      saveLockRef.current = true;
      setOrder(normalizedOrder);
      setIsSaving(true);
      setMessage("메뉴 순서를 저장하는 중입니다.");

      try {
        const response = await fetch("/api/admin/preferences/sidebar-order", {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ order: normalizedOrder }),
        });

        if (!response.ok) {
          throw new Error("sidebar-order-save-failed");
        }

        const rawOrder = await readSidebarOrderPayload(response);
        setOrder(normalizeAdminSidebarOrder(rawOrder));
        setMessage(successMessage);
      } catch {
        setMessage(CONSOLE_FIXED_MESSAGES.orderSaveFailed);
      } finally {
        saveLockRef.current = false;
        setIsSaving(false);
      }
    },
    [enabled, isLoading, isSaving, loadFailed],
  );

  return {
    order,
    isLoading,
    isSaving,
    loadFailed,
    message,
    setMessage,
    isEditMode,
    setIsEditMode,
    persist,
    canPersist: canPersistAdminSidebarOrder({
      enabled,
      loadFailed,
      isLoading,
      isSaving,
    }),
  };
}

export type AdminSidebarOrderState = ReturnType<typeof useAdminSidebarOrder>;
