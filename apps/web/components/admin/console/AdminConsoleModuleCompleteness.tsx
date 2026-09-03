"use client";

import type { ReactNode } from "react";

import { AdminEmbeddedModuleShell } from "@/components/admin/AdminEmbeddedModuleShell";
import { AdminConsoleModuleSkeleton } from "@/components/admin/console/AdminConsoleModuleSkeleton";
import { Button } from "@/components/ui/button";
import {
  ADMIN_CONSOLE_MODULE_ERROR_MESSAGE,
  ADMIN_CONSOLE_MODULE_RELOGIN_LABEL,
  ADMIN_CONSOLE_MODULE_RETRY_LABEL,
  ADMIN_CONSOLE_MODULE_UNAUTHORIZED_MESSAGE,
  buildAdminConsoleReloginHref,
  getAdminConsoleModuleEmptyCopy,
  getAdminConsoleModuleOutputKind,
  resolveAdminConsoleModuleState,
  type AdminConsoleModuleState,
  type AdminConsoleModuleStateInput,
} from "@/lib/admin/console-module-state";
import type { AdminConsoleMenuId } from "@/lib/admin/console-menu-registry";

export function AdminConsoleModuleStateMarker({
  menuId,
  state,
  children,
}: {
  menuId: AdminConsoleMenuId;
  state: AdminConsoleModuleState;
  children: ReactNode;
}) {
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-admin-module-state={state}
      data-admin-module-state-menu={menuId}
      data-admin-module-output-kind={getAdminConsoleModuleOutputKind(menuId)}
    >
      {children}
    </div>
  );
}

function CompletenessCopy({
  menuId,
  state,
  onRetry,
}: {
  menuId: AdminConsoleMenuId;
  state: Exclude<AdminConsoleModuleState, "loading" | "ready">;
  onRetry?: () => void;
}) {
  if (state === "empty") {
    const copy = getAdminConsoleModuleEmptyCopy(menuId);
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 px-3 py-4">
        <p className="text-sm text-foreground" data-admin-module-empty-message="true">
          {copy.message}
        </p>
        <p
          className="text-xs text-muted-foreground"
          data-admin-module-empty-next-action="true"
        >
          {copy.nextAction}
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-3 py-4"
        role="alert"
      >
        <p className="text-sm text-foreground">{ADMIN_CONSOLE_MODULE_ERROR_MESSAGE}</p>
        {onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-admin-module-retry="true"
            onClick={onRetry}
          >
            {ADMIN_CONSOLE_MODULE_RETRY_LABEL}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-3 py-4"
      role="alert"
    >
      <p className="text-sm text-foreground">
        {ADMIN_CONSOLE_MODULE_UNAUTHORIZED_MESSAGE}
      </p>
      <Button asChild size="sm" variant="outline">
        <a
          href={buildAdminConsoleReloginHref(menuId)}
          data-admin-module-relogin="true"
        >
          {ADMIN_CONSOLE_MODULE_RELOGIN_LABEL}
        </a>
      </Button>
    </div>
  );
}

export function AdminConsoleModuleCompleteness({
  menuId,
  request,
  onRetry,
  onPrimaryAction,
  children,
}: {
  menuId: AdminConsoleMenuId;
  request: AdminConsoleModuleStateInput;
  onRetry?: () => void;
  onPrimaryAction?: () => void;
  children?: ReactNode;
}) {
  const state = resolveAdminConsoleModuleState(request);

  if (state === "ready") {
    return (
      <AdminConsoleModuleStateMarker menuId={menuId} state="ready">
        {children}
      </AdminConsoleModuleStateMarker>
    );
  }

  if (state === "loading") {
    return (
      <AdminConsoleModuleStateMarker menuId={menuId} state="loading">
        {children ?? <AdminConsoleModuleSkeleton menuId={menuId} />}
      </AdminConsoleModuleStateMarker>
    );
  }

  return (
    <AdminConsoleModuleStateMarker menuId={menuId} state={state}>
      <AdminEmbeddedModuleShell
        menuId={menuId}
        onPrimaryAction={onPrimaryAction}
        contentClassName="overflow-y-auto"
      >
        <CompletenessCopy menuId={menuId} state={state} onRetry={onRetry} />
      </AdminEmbeddedModuleShell>
    </AdminConsoleModuleStateMarker>
  );
}
