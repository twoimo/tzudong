import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const mapPanelIconButtonClass =
  "h-8 w-8 shrink-0 rounded-full border border-border bg-background shadow-none hover:bg-secondary";

export const pageHeaderIconButtonClass =
  "h-10 w-10 shrink-0 rounded-full bg-muted/45 shadow-none hover:bg-muted";
export const pageHeaderTitleClass =
  "flex min-w-0 items-center gap-1.5 text-[1.0625rem] font-bold leading-tight text-primary text-balance xs:text-xl sm:gap-2 sm:text-2xl";
export const pageHeaderDescriptionClass =
  "mt-1 max-w-full text-pretty text-xs leading-5 text-muted-foreground xs:text-sm";

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
  children?: ReactNode;
}) {
  const isPage = variant === "page";
  return (
    <header className={cn("min-h-14 shrink-0 border-b border-border bg-background px-3 py-3", isPage && "sm:px-5 sm:py-4")} data-layout-primitives="stack" data-map-panel-header="true" data-header-variant={variant}>
      <div className={isPage ? "flex flex-wrap items-start justify-between gap-3" : "flex min-h-8 items-center gap-2"}>
        <div className={cn("min-w-0 flex-1", isPage && "basis-[min(11rem,100%)]")}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <TitleTag id={titleId} className={isPage ? pageHeaderTitleClass : "flex min-w-0 items-center gap-2 text-sm font-semibold leading-5 text-foreground"}>
              {titleIcon ? <span className={cn("shrink-0 text-primary", isPage ? "[&_svg]:size-5 sm:[&_svg]:size-6" : "[&_svg]:size-4")} aria-hidden="true">{titleIcon}</span> : null}
              <span className="min-w-0 truncate" title={title}>{title}</span>
              {!isPage && typeof count === "number" ? (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums text-primary" aria-label={`${count.toLocaleString()}${countUnit}`}>
                  {count.toLocaleString()}{countUnit}
                </span>
              ) : null}
            </TitleTag>
            {isPage && typeof count === "number" ? (
              <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground xs:text-sm">({count.toLocaleString()}{countUnit})</span>
            ) : null}
            {titleAddon}
          </div>
          {description ? (
            <p className={isPage ? pageHeaderDescriptionClass : "mt-1 truncate text-xs leading-4 text-muted-foreground"}>{description}</p>
          ) : null}
        </div>
        <div className={cn("flex shrink-0 items-center gap-1.5", isPage && "ml-auto sm:gap-2")}>
          {actions}
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
      {children}
    </header>
  );
}
