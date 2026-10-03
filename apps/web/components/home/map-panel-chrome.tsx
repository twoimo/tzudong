import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export const mapPanelIconButtonClass =
  "h-8 w-8 shrink-0 rounded-full border border-border bg-background shadow-none hover:bg-secondary";

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
}) {
  return (
    <header className="min-h-14 shrink-0 border-b border-border bg-background px-3 py-3" data-layout-primitives="stack" data-map-panel-header="true">
      <div className="flex min-h-8 items-center gap-2">
        <div className="min-w-0 flex-1">
          <TitleTag id={titleId} className="flex min-w-0 items-center gap-2 text-sm font-semibold leading-5 text-foreground">
            {titleIcon ? <span className="shrink-0 text-primary [&_svg]:size-4" aria-hidden="true">{titleIcon}</span> : null}
            <span className="min-w-0 truncate" title={title}>{title}</span>
            {typeof count === "number" ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums text-primary" aria-label={`${count.toLocaleString()}${countUnit}`}>
                {count.toLocaleString()}{countUnit}
              </span>
            ) : null}
          </TitleTag>
          {description ? (
            <p className="mt-1 truncate text-xs leading-4 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
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
    </header>
  );
}
