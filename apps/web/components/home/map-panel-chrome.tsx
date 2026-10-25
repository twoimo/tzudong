import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pageHeadingTitleClass, pageHeadingDescriptionClass } from "@/components/layout/page-heading-styles";

export const mapPanelIconButtonClass =
  "h-9 w-9 shrink-0 rounded-lg border border-border bg-card shadow-none hover:bg-secondary";

export const pageHeaderIconButtonClass =
  "h-10 w-10 shrink-0 rounded-full bg-muted/45 shadow-none hover:bg-muted";
export const pageHeaderTitleClass =
  `flex items-center gap-2 ${pageHeadingTitleClass}`;
export const pageHeaderDescriptionClass =
  `mt-1 text-pretty ${pageHeadingDescriptionClass}`;

export function MapPanelHeader({
  title,
  count,
  countUnit = "개",
  description,
  titleIcon,
  titleId,
  actions,
  onClose,
  closeLabel,
  closeAction = "close",
  titleAs: TitleTag = "h2",
  variant = "panel",
  titleAddon,
  eyebrow,
  wrapTitle = false,
  children,
}: {
  title: string;
  count?: number;
  countUnit?: string;
  description?: string;
  titleIcon?: ReactNode;
  titleId?: string;
  actions?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  closeAction?: "close" | "back";
  titleAs?: "h1" | "h2";
  variant?: "panel" | "page";
  titleAddon?: ReactNode;
  eyebrow?: string;
  wrapTitle?: boolean;
  children?: ReactNode;
}) {
  const isPage = variant === "page";
  return (
    <header className={cn("min-h-14 shrink-0 border-b border-border bg-background px-3 py-3", isPage && "sm:px-5 sm:py-4")} data-layout-primitives="stack" data-map-panel-header="true" data-header-variant={variant}>
      <div className={isPage ? "flex flex-wrap items-start justify-between gap-3" : "flex min-h-8 items-center gap-2"}>
        <div className={cn("min-w-0 flex-1", isPage && "basis-[min(11rem,100%)]")}>
          {eyebrow ? <p className="mb-0.5 text-2xs font-bold tracking-wide text-brand-garden-text xs:text-xs">{eyebrow}</p> : null}
          <div className={cn("flex min-w-0 items-center gap-x-2", isPage ? "flex-wrap gap-y-1" : "flex-nowrap")}>
            <TitleTag id={titleId} className={isPage ? pageHeaderTitleClass : "flex min-w-0 items-center gap-2 text-sm font-semibold leading-5 text-foreground"}>
              {titleIcon ? <span className={cn("shrink-0", isPage ? "text-brand-tangerine-ink" : "text-primary", isPage ? "[&_svg]:size-5 sm:[&_svg]:size-6" : "[&_svg]:size-4")} aria-hidden="true">{titleIcon}</span> : null}
              <span className={cn("min-w-0", wrapTitle ? "whitespace-normal break-words [overflow-wrap:anywhere]" : "truncate")} title={title}>{title}</span>
              {!isPage && typeof count === "number" ? (
                <span className="shrink-0 rounded-full bg-brand-cream px-2 py-0.5 text-[11px] font-bold leading-4 tabular-nums text-foreground" aria-label={`${count.toLocaleString()}${countUnit}`}>
                  {count.toLocaleString()}{countUnit}
                </span>
              ) : null}
            </TitleTag>
            {isPage && typeof count === "number" ? (
              <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground xs:text-sm">({count.toLocaleString()}{countUnit})</span>
            ) : null}
            {isPage ? titleAddon : null}
          </div>
          {description ? (
            <p className={isPage ? pageHeaderDescriptionClass : "mt-1 text-pretty text-xs leading-4 text-muted-foreground"}>{description}</p>
          ) : null}
        </div>
        <div className={cn("flex shrink-0 items-center gap-1.5", isPage && "ml-auto sm:gap-2")}>
          {isPage ? actions : null}
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className={mapPanelIconButtonClass}
              aria-label={closeLabel ?? `${title} 닫기`}
            >
              {closeAction === "back" ? <ArrowLeft className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
            </Button>
          ) : null}
        </div>
      </div>
      {!isPage && (titleAddon || actions) ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2" data-map-panel-toolbar="true">
          {titleAddon ? <div className="flex min-w-0 flex-wrap items-center gap-1">{titleAddon}</div> : null}
          {actions ? <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </header>
  );
}
