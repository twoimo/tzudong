"use client";

import { useLayoutEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  getAdminConsoleMenu,
  type AdminConsoleMenuId,
  type AdminConsoleSectionLabel,
} from "@/lib/admin/console-menu-registry";
import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";
import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
} from "@/lib/admin/sidebar-order";

import {
  moveAdminSidebarItem,
  moveAdminSidebarSection,
  type AdminSidebarOrderState,
} from "./use-admin-sidebar-order";

const EDIT_ON_MESSAGE =
  "메뉴 순서 편집을 켰습니다. 화살표로 변경 후 자동 저장됩니다.";
const EDIT_OFF_MESSAGE = "메뉴 순서 편집을 잠갔습니다.";
const EDIT_LOCK_MESSAGE = "순서 편집을 켜야 이동 버튼이 활성화됩니다.";
const USER_RESET_MESSAGE = "처음 상태로 되돌렸습니다.";

type OrderEditorPlacement = "dropdown" | "sidebar";

type AdminConsoleSidebarOrderEditorProps = {
  placement: OrderEditorPlacement;
  orderState: AdminSidebarOrderState;
};

function orderedEditorSections(orderState: AdminSidebarOrderState) {
  const normalized = normalizeAdminSidebarOrder(orderState.order);
  return normalized.sections.map((label) => ({
    label: label as AdminConsoleSectionLabel,
    items: (normalized.items[label] ?? []).map((id) => ({
      id,
      title: getAdminConsoleMenu(id).title,
    })),
  }));
}

export function AdminConsoleSidebarOrderEditor({
  placement,
  orderState,
}: AdminConsoleSidebarOrderEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<{ moveKey: string; fallbackKey: string } | null>(
    null,
  );
  const isEditMode = orderState.isEditMode;
  const sections = orderedEditorSections(orderState);
  const controlsLocked = !isEditMode || !orderState.canPersist;

  function restoreFocus(moveKey: string, fallbackKey: string) {
    const root = editorRef.current;
    if (!root) return;
    const preferred = root.querySelector<HTMLButtonElement>(
      `[data-admin-sidebar-order-move="${moveKey}"]`,
    );
    if (preferred && !preferred.disabled) {
      preferred.focus();
      return;
    }
    const fallback = root.querySelector<HTMLButtonElement>(
      `[data-admin-sidebar-order-move="${fallbackKey}"]`,
    );
    fallback?.focus();
  }

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    restoreFocus(pending.moveKey, pending.fallbackKey);
  }, [orderState.order, orderState.isSaving]);

  async function persistAndKeepFocus(
    nextOrder: ReturnType<typeof normalizeAdminSidebarOrder>,
    successMessage: string,
    moveKey: string,
    fallbackKey: string,
  ) {
    pendingFocusRef.current = { moveKey, fallbackKey };
    await orderState.persist(nextOrder, successMessage);
    restoreFocus(moveKey, fallbackKey);
  }

  return (
    <div
      ref={editorRef}
      id={`admin-sidebar-order-editor-${placement}`}
      className="rounded-2xl bg-background/85 p-2"
      aria-label="메뉴 순서 설정"
      data-admin-sidebar-order-editor={placement}
      data-admin-sidebar-order-edit-mode={isEditMode ? "enabled" : "locked"}
      data-admin-sidebar-order-editor-density="compact"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-foreground">메뉴 순서</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant={isEditMode ? "default" : "outline"}
            size="sm"
            className="h-6 shrink-0 rounded-full px-2 text-[11px] font-bold"
            aria-pressed={isEditMode}
            data-admin-sidebar-order-edit-toggle="true"
            onClick={() => {
              const nextEditMode = !isEditMode;
              orderState.setIsEditMode(nextEditMode);
              orderState.setMessage(nextEditMode ? EDIT_ON_MESSAGE : EDIT_OFF_MESSAGE);
            }}
          >
            {isEditMode ? "편집 잠금" : "편집 켜기"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 shrink-0 rounded-full px-2 text-[11px] font-bold"
            disabled={controlsLocked}
            data-admin-sidebar-order-loading={orderState.isLoading ? "true" : "false"}
            onClick={() => {
              void orderState.persist(
                DEFAULT_ADMIN_SIDEBAR_ORDER,
                USER_RESET_MESSAGE,
              );
            }}
          >
            초기화
          </Button>
        </div>
      </div>

      {!isEditMode && (
        <p
          className="mb-1.5 rounded-lg border border-dashed border-border bg-muted/25 px-2 py-1 text-[11px] leading-5 text-muted-foreground"
          data-admin-sidebar-order-edit-lock-message="true"
        >
          {EDIT_LOCK_MESSAGE}
        </p>
      )}

      <div className="space-y-2">
        {sections.map((section, sectionIndex) => (
          <div
            key={section.label}
            className="space-y-0.5 border-t border-border/55 pt-2 first:border-t-0 first:pt-0"
            data-admin-sidebar-order-section="compact"
          >
            <div className="flex h-5 items-center justify-between gap-1.5 px-1">
              <span className="truncate text-[11px] font-semibold text-muted-foreground">
                {section.label}
              </span>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 rounded-md border-0 bg-transparent p-0 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`${section.label} 섹션 앞으로`}
                  data-admin-sidebar-order-move={`section:${section.label}:-1`}
                  disabled={controlsLocked || sectionIndex === 0}
                  onClick={() => {
                    void persistAndKeepFocus(
                      moveAdminSidebarSection(
                        orderState.order,
                        section.label,
                        -1,
                      ),
                      CONSOLE_FIXED_MESSAGES.orderSaved,
                      `section:${section.label}:-1`,
                      `section:${section.label}:1`,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    const direction = event.key === "ArrowUp" ? -1 : 1;
                    if (controlsLocked) return;
                    if (direction < 0 && sectionIndex === 0) return;
                    if (direction > 0 && sectionIndex === sections.length - 1) return;
                    void persistAndKeepFocus(
                      moveAdminSidebarSection(
                        orderState.order,
                        section.label,
                        direction,
                      ),
                      CONSOLE_FIXED_MESSAGES.orderSaved,
                      `section:${section.label}:${direction}`,
                      `section:${section.label}:${direction < 0 ? 1 : -1}`,
                    );
                  }}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 rounded-md border-0 bg-transparent p-0 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`${section.label} 섹션 뒤로`}
                  data-admin-sidebar-order-move={`section:${section.label}:1`}
                  disabled={controlsLocked || sectionIndex === sections.length - 1}
                  onClick={() => {
                    void persistAndKeepFocus(
                      moveAdminSidebarSection(
                        orderState.order,
                        section.label,
                        1,
                      ),
                      CONSOLE_FIXED_MESSAGES.orderSaved,
                      `section:${section.label}:1`,
                      `section:${section.label}:-1`,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    const direction = event.key === "ArrowUp" ? -1 : 1;
                    if (controlsLocked) return;
                    if (direction < 0 && sectionIndex === 0) return;
                    if (direction > 0 && sectionIndex === sections.length - 1) return;
                    void persistAndKeepFocus(
                      moveAdminSidebarSection(
                        orderState.order,
                        section.label,
                        direction,
                      ),
                      CONSOLE_FIXED_MESSAGES.orderSaved,
                      `section:${section.label}:${direction}`,
                      `section:${section.label}:${direction < 0 ? 1 : -1}`,
                    );
                  }}
                >
                  ↓
                </Button>
              </div>
            </div>

            <div className="space-y-0.5">
              {section.items.map((item, itemIndex) => (
                <div
                  key={item.id}
                  className="grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-muted/55"
                  data-admin-sidebar-order-item="compact"
                >
                  <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                    {item.title}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 rounded-md border-0 bg-transparent p-0 text-[11px] text-muted-foreground hover:bg-background/80 hover:text-foreground"
                      aria-label={`${item.title} 메뉴 앞으로`}
                      data-admin-sidebar-order-move={`item:${item.id}:-1`}
                      disabled={controlsLocked || itemIndex === 0}
                      onClick={() => {
                        void persistAndKeepFocus(
                          moveAdminSidebarItem(
                            orderState.order,
                            section.label,
                            item.id as AdminConsoleMenuId,
                            -1,
                          ),
                          CONSOLE_FIXED_MESSAGES.orderSaved,
                          `item:${item.id}:-1`,
                          `item:${item.id}:1`,
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                        event.preventDefault();
                        const direction = event.key === "ArrowUp" ? -1 : 1;
                        if (controlsLocked) return;
                        if (direction < 0 && itemIndex === 0) return;
                        if (direction > 0 && itemIndex === section.items.length - 1) {
                          return;
                        }
                        void persistAndKeepFocus(
                          moveAdminSidebarItem(
                            orderState.order,
                            section.label,
                            item.id as AdminConsoleMenuId,
                            direction,
                          ),
                          CONSOLE_FIXED_MESSAGES.orderSaved,
                          `item:${item.id}:${direction}`,
                          `item:${item.id}:${direction < 0 ? 1 : -1}`,
                        );
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 rounded-md border-0 bg-transparent p-0 text-[11px] text-muted-foreground hover:bg-background/80 hover:text-foreground"
                      aria-label={`${item.title} 메뉴 뒤로`}
                      data-admin-sidebar-order-move={`item:${item.id}:1`}
                      disabled={
                        controlsLocked || itemIndex === section.items.length - 1
                      }
                      onClick={() => {
                        void persistAndKeepFocus(
                          moveAdminSidebarItem(
                            orderState.order,
                            section.label,
                            item.id as AdminConsoleMenuId,
                            1,
                          ),
                          CONSOLE_FIXED_MESSAGES.orderSaved,
                          `item:${item.id}:1`,
                          `item:${item.id}:-1`,
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                        event.preventDefault();
                        const direction = event.key === "ArrowUp" ? -1 : 1;
                        if (controlsLocked) return;
                        if (direction < 0 && itemIndex === 0) return;
                        if (direction > 0 && itemIndex === section.items.length - 1) {
                          return;
                        }
                        void persistAndKeepFocus(
                          moveAdminSidebarItem(
                            orderState.order,
                            section.label,
                            item.id as AdminConsoleMenuId,
                            direction,
                          ),
                          CONSOLE_FIXED_MESSAGES.orderSaved,
                          `item:${item.id}:${direction}`,
                          `item:${item.id}:${direction < 0 ? 1 : -1}`,
                        );
                      }}
                    >
                      ↓
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p
        className="mt-2 rounded-lg bg-muted/30 px-2 py-1 text-[11px] leading-5 text-muted-foreground"
        aria-live="polite"
      >
        {orderState.message}
      </p>
    </div>
  );
}
