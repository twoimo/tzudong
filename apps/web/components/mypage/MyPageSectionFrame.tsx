"use client";

import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const myPageListCardClass =
  "overflow-hidden border-border/80 bg-card/95 shadow-sm transition-colors hover:bg-secondary/20";
export const myPageResponsiveListClass =
  "grid gap-3 md:grid-cols-2 xl:grid-cols-3";
export const myPageListContentClass = "p-4";
export const myPageCardTitleClass =
  "truncate text-base font-semibold tracking-tight sm:text-lg";
export const myPageInfoPanelClass =
  "space-y-2 rounded-2xl bg-muted/45 p-3 text-sm";
export const myPageNestedCardClass =
  "rounded-xl border border-border/70 bg-background/70 p-3";
export const myPageFooterMetaClass =
  "flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground";
export const myPageInlineLinkClass =
  "inline-flex min-w-0 items-center gap-1 truncate text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

interface MyPageSectionFrameProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  countLabel?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  "data-section"?: string;
}

export function MyPageSectionFrame({
  icon: Icon,
  eyebrow,
  title,
  description,
  countLabel,
  children,
  action,
  className,
  contentClassName,
  "data-section": dataSection,
}: MyPageSectionFrameProps) {
  return (
    <section
      className={cn("space-y-4", className)}
      data-mypage-section-frame={dataSection ?? title}
    >
      <div
        className="hidden rounded-3xl border border-border/80 bg-card/95 p-5 shadow-sm md:block"
        data-mypage-section-hero="quiet"
        data-mypage-section-hero-surface="desktop"
      >
        <div className="flex items-start justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex"
              aria-hidden="true"
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-primary sm:text-xs">
                {eyebrow}
              </p>
              <h1 className="mt-0.5 truncate text-lg font-bold tracking-tight sm:mt-1 sm:text-2xl">
                {title}
              </h1>
              <p className="mt-1 hidden max-w-2xl text-sm leading-6 text-muted-foreground sm:block">
                {description}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 sm:pt-1">
            {countLabel && (
              <Badge
                variant="secondary"
                className="border-transparent bg-transparent px-0 py-0 text-xs text-muted-foreground hover:bg-transparent sm:rounded-full sm:bg-secondary sm:px-3 sm:py-1 sm:text-secondary-foreground sm:hover:bg-secondary/80"
              >
                {countLabel}
              </Badge>
            )}
            {action}
          </div>
        </div>
      </div>
      {(countLabel || action) && (
        <div
          className="flex items-center justify-end gap-2 border-b border-border pb-2 md:hidden"
          data-mypage-section-mobile-controls="integrated-header"
        >
          {countLabel && (
            <Badge
              variant="secondary"
              className="border-transparent bg-transparent px-0 py-0 text-xs text-muted-foreground hover:bg-transparent"
            >
              {countLabel}
            </Badge>
          )}
          {action}
        </div>
      )}
      <div className={cn("space-y-3 sm:space-y-4", contentClassName)}>
        {children}
      </div>
    </section>
  );
}

interface MyPageEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function MyPageEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: MyPageEmptyStateProps) {
  return (
    <Card className="border-dashed border-border/80 bg-card/80">
      <CardContent className="grid min-h-64 place-items-center px-5 py-12 text-center text-muted-foreground">
        <div className="mx-auto max-w-sm space-y-3">
          <span
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Icon className="h-7 w-7" />
          </span>
          <div>
            <p className="text-base font-semibold text-foreground">{title}</p>
            <p className="mt-1 text-sm leading-6">{description}</p>
          </div>
          {action && <div className="pt-1">{action}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

interface MyPageErrorStateProps {
  title?: string;
  description?: string;
}

export function MyPageErrorState({
  title = "내용을 불러오지 못했습니다",
  description = "잠시 후 다시 시도해주세요. 문제가 계속되면 홈으로 돌아가 다시 열어주세요.",
}: MyPageErrorStateProps) {
  return (
    <Card className="border-destructive/25 bg-destructive/5">
      <CardContent className="px-5 py-8 text-sm text-destructive">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 leading-6 text-destructive/80">{description}</p>
      </CardContent>
    </Card>
  );
}
