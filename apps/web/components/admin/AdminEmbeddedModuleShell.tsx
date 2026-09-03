"use client";

import type { CSSProperties, ReactNode } from "react";

import { ADMIN_CONSOLE_MENU_ICONS } from "@/lib/admin/console-menu-icons";
import {
  getAdminConsoleMenu,
  type AdminConsoleMenuId,
} from "@/lib/admin/console-menu-registry";
import { buildCanonicalAdminModuleHref } from "@/lib/admin/admin-module-routing";
import { CONSOLE_TONE_STEPS } from "@/lib/admin/console-tone-scale";
import { cn } from "@/lib/utils";

const TITLE_TONE = CONSOLE_TONE_STEPS[0];
const ICON_TONE = CONSOLE_TONE_STEPS[1];

type AdminEmbeddedModuleShellProps = {
  menuId: AdminConsoleMenuId;
  actions?: ReactNode;
  onPrimaryAction?: () => void;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  scrollOwner?: string;
};

function AdminConsolePrimaryAction({
  menuId,
  onPrimaryAction,
}: {
  menuId: AdminConsoleMenuId;
  onPrimaryAction?: () => void;
}) {
  const menu = getAdminConsoleMenu(menuId);
  const className =
    "inline-flex shrink-0 items-center rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground";

  if (onPrimaryAction) {
    return (
      <button
        type="button"
        className={className}
        data-admin-module-primary-action={menuId}
        onClick={onPrimaryAction}
      >
        {menu.primaryActionLabel}
      </button>
    );
  }

  return (
    <a
      href={buildCanonicalAdminModuleHref(menuId)}
      className={className}
      data-admin-module-primary-action={menuId}
    >
      {menu.primaryActionLabel}
    </a>
  );
}

export function getAdminEmbeddedModuleTitleId(menuId: AdminConsoleMenuId) {
  return `admin-${menuId}-title`;
}

export function AdminEmbeddedModuleShell({
  menuId,
  actions,
  onPrimaryAction,
  children,
  className,
  headerClassName,
  contentClassName,
  scrollOwner,
}: AdminEmbeddedModuleShellProps) {
  const menu = getAdminConsoleMenu(menuId);
  const Icon = ADMIN_CONSOLE_MENU_ICONS[menuId];
  const titleId = getAdminEmbeddedModuleTitleId(menuId);
  const toneStyle = {
    [TITLE_TONE.cssVariable]: `hsl(var(${TITLE_TONE.token}))`,
    [ICON_TONE.cssVariable]: `hsl(var(${ICON_TONE.token}) / ${ICON_TONE.alpha})`,
  } as CSSProperties;

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground",
        className,
      )}
      data-admin-console-tone-scale="v1"
      data-admin-embedded-module-shell="true"
      data-admin-embedded-module-id={menuId}
      data-admin-module-output-kind={menu.outputKind}
      data-layout-primitives="stack"
      style={toneStyle}
    >
      <div
        className={cn(
          "shrink-0 border-b border-border bg-card px-2 py-1.5",
          headerClassName,
        )}
        data-admin-module-header="compact"
        data-admin-module-header-module={menuId}
      >
        <div className="flex min-w-0 flex-row items-start justify-between gap-1.5 lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Icon
                className="h-5 w-5 shrink-0 text-[var(--admin-tone-2)]"
                aria-hidden="true"
              />
              <h2
                id={titleId}
                className="min-w-0 truncate whitespace-nowrap text-sm font-bold text-[var(--admin-tone-1)]"
              >
                {menu.title}
              </h2>
            </div>
            <div
              className="mt-0.5 min-w-0 truncate text-[11px] text-muted-foreground"
              data-admin-module-summary="true"
            >
              {menu.purpose}
            </div>
          </div>
          <div
            className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5"
            data-admin-module-actions="top-right"
          >
            {actions ?? (
              <AdminConsolePrimaryAction
                menuId={menuId}
                onPrimaryAction={onPrimaryAction}
              />
            )}
          </div>
        </div>
      </div>
      <div
        aria-labelledby={titleId}
        className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", contentClassName)}
        data-admin-module-content="bounded"
        data-admin-module-output-kind={menu.outputKind}
        data-scroll-owner={scrollOwner}
      >
        {children}
      </div>
    </section>
  );
}
