"use client";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

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
        <AdminPageHeader
          title={title}
          titleId={titleId}
          titleAs="h2"
          icon={Icon}
          summary={summary}
          actions={actions}
          className={headerClassName}
          data-admin-module-header="compact"
          data-admin-module-header-module={moduleId}
        />
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
