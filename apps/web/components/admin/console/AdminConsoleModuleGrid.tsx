"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildCanonicalAdminModuleHref } from "@/lib/admin/admin-module-routing";
import { ADMIN_CONSOLE_MENU_ICONS } from "@/lib/admin/console-menu-icons";
import {
  ADMIN_CONSOLE_SECTION_LABELS,
  type AdminConsoleMenuId,
  type AdminConsoleSectionLabel,
} from "@/lib/admin/console-menu-registry";
import { filterAdminConsoleMenus } from "@/lib/admin/console-menu-search";
import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";
import { cn } from "@/lib/utils";

const SEARCH_INPUT_ID = "admin-module-grid-search";
const SECTION_FILTER_ID = "admin-module-grid-section";
const TOTAL_MENU_COUNT = 15;

export function AdminConsoleModuleGrid({
  onSelectModule,
}: {
  onSelectModule?: (moduleId: AdminConsoleMenuId) => void;
}) {
  const [rawValue, setRawValue] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [section, setSection] = useState<AdminConsoleSectionLabel | null>(null);
  const isComposingRef = useRef(false);

  const visibleMenus = filterAdminConsoleMenus({ committedQuery, section });
  const liveMessage = `${visibleMenus.length}개 메뉴를 표시합니다. 전체 ${TOTAL_MENU_COUNT}개.`;

  const clearFilters = () => {
    isComposingRef.current = false;
    setRawValue("");
    setCommittedQuery("");
    setSection(null);
  };

  const openMenu = (menuId: AdminConsoleMenuId) => {
    if (onSelectModule) {
      onSelectModule(menuId);
      return;
    }
    window.location.assign(buildCanonicalAdminModuleHref(menuId));
  };

  return (
    <section
      className="mt-3 min-w-0 overflow-x-hidden"
      aria-label="관리자 메뉴 모음"
      data-admin-module-grid="true"
      data-admin-module-grid-placement="after-metric-summary"
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor={SEARCH_INPUT_ID} className="text-xs text-muted-foreground">
            메뉴 검색
          </Label>
          <Input
            id={SEARCH_INPUT_ID}
            value={rawValue}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            placeholder="표시 제목 또는 목적 문장"
            className="mt-1 h-8 min-w-0 text-sm"
            data-admin-module-grid-search="true"
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              isComposingRef.current = false;
              setCommittedQuery(event.currentTarget.value);
            }}
            onChange={(event) => {
              setRawValue(event.target.value);
              if (
                !isComposingRef.current &&
                !event.nativeEvent.isComposing
              ) {
                setCommittedQuery(event.target.value);
              }
            }}
          />
        </div>
        <div className="min-w-0 sm:w-40">
          <Label
            htmlFor={SECTION_FILTER_ID}
            className="text-xs text-muted-foreground"
          >
            섹션 필터
          </Label>
          <select
            id={SECTION_FILTER_ID}
            value={section ?? ""}
            className="mt-1 h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
            data-admin-module-grid-section="true"
            onChange={(event) => {
              const next = event.target.value;
              setSection(
                next === "" ? null : (next as AdminConsoleSectionLabel),
              );
            }}
          >
            <option value="">전체 섹션</option>
            {ADMIN_CONSOLE_SECTION_LABELS.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p
        className="sr-only"
        aria-live="polite"
        data-admin-module-grid-count="true"
      >
        {liveMessage}
      </p>

      {visibleMenus.length === 0 ? (
        <div
          className="mt-3 flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card px-3 py-4"
          data-admin-module-grid-empty="true"
        >
          <p className="text-sm text-foreground">{CONSOLE_FIXED_MESSAGES.gridEmpty}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            data-admin-module-grid-clear="true"
            onClick={clearFilters}
          >
            필터 해제
          </Button>
        </div>
      ) : (
        <div
          className="mt-3 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
          data-admin-module-grid-cards="true"
        >
          {visibleMenus.map((menu) => {
            const Icon = ADMIN_CONSOLE_MENU_ICONS[menu.id];
            return (
              <article
                key={menu.id}
                className={cn(
                  "min-w-0 rounded-xl border border-border bg-card p-3",
                  "transition-[opacity,transform] duration-150 motion-reduce:transition-none",
                )}
                data-admin-module-grid-card={menu.id}
                data-admin-module-grid-card-section={menu.section}
              >
                <p className="truncate text-[11px] text-muted-foreground">
                  {menu.section}
                </p>
                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                  <Icon
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {menu.title}
                  </h3>
                </div>
                <p className="mt-1 break-keep text-xs text-muted-foreground">
                  {menu.purpose}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3 h-7 px-2 text-[11px]"
                  data-admin-module-grid-primary-action={menu.id}
                  aria-label={`${menu.title} ${menu.primaryActionLabel}`}
                  onClick={() => openMenu(menu.id)}
                >
                  {menu.primaryActionLabel}
                </Button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
