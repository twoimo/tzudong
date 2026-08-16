"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AdminConsoleRouteModuleId } from "@/lib/admin/admin-module-routing";

type AdminEmbeddedModuleShellProps = {
  moduleId: AdminConsoleRouteModuleId;
  titleId: string;
  title: string;
  icon: LucideIcon;
  summary: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  scrollOwner?: string;
};

export function AdminEmbeddedModuleShell({
  moduleId,
  titleId,
  title,
  icon: Icon,
  summary,
  actions,
  children,
  className,
  headerClassName,
  contentClassName,
  scrollOwner,
}: AdminEmbeddedModuleShellProps) {
  const hideHeader = moduleId === "overview";

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground",
        className,
      )}
      data-admin-embedded-module-shell="true"
      data-admin-embedded-module-id={moduleId}
      data-layout-primitives="stack"
    >
      {hideHeader ? (
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
      ) : (
        <div
          className={cn(
            "shrink-0 border-b border-border bg-card px-2 py-1.5",
            headerClassName,
          )}
          data-admin-module-header="compact"
          data-admin-module-header-module={moduleId}
        >
          <div className="flex min-w-0 flex-row items-start justify-between gap-1.5 lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <h2
                  id={titleId}
                  className="min-w-0 truncate whitespace-nowrap bg-gradient-primary bg-clip-text text-sm font-bold text-transparent"
                >
                  {title}
                </h2>
              </div>
              <div
                className="mt-0.5 min-w-0 truncate text-[11px] text-muted-foreground"
                data-admin-module-summary="true"
              >
                {summary}
              </div>
            </div>
            {actions ? (
              <div
                className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5"
                data-admin-module-actions="top-right"
              >
                {actions}
              </div>
            ) : null}
          </div>
        </div>
      )}
      <div
        className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", contentClassName)}
        data-admin-module-content="bounded"
        data-scroll-owner={scrollOwner}
      >
        {children}
      </div>
    </section>
  );
}
