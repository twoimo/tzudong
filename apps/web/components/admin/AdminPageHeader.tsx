"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AdminPageHeaderProps = Omit<ComponentPropsWithoutRef<"header">, "title"> & {
  title: string;
  titleId?: string;
  titleAs?: "h1" | "h2";
  icon?: LucideIcon;
  summary?: ReactNode;
  actions?: ReactNode;
};

/** Shared page heading geometry. Secondary filters and editable content stay outside it. */
export function AdminPageHeader({
  title,
  titleId,
  titleAs: Title = "h1",
  icon: Icon,
  summary,
  actions,
  children,
  className,
  ...props
}: AdminPageHeaderProps) {
  return <header {...props} className={cn("admin-page-header", className)} data-admin-page-header="true">
    <div className="admin-page-header-identity">
      <div className="admin-page-header-title-group">
        {Icon && <Icon className="admin-page-header-icon" aria-hidden="true" />}
        <Title id={titleId} className="admin-page-header-title">{title}</Title>
      </div>
      {summary != null && <div className="admin-page-header-summary" data-admin-module-summary="true">{summary}</div>}
    </div>
    {children}
    {actions != null && <div className="admin-page-header-actions" data-admin-module-actions="top-right">{actions}</div>}
  </header>;
}
