import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

export const mapPanelIconButtonClass =
  "h-8 w-8 shrink-0 rounded-full border border-border bg-background shadow-none hover:bg-secondary";

export function MapPanelHeader({
  title,
  count,
  description,
  actions,
  onClose,
  closeLabel,
  titleAs: TitleTag = "h2",
}: {
  title: string;
  count?: number;
  description?: string;
  actions?: ReactNode;
  onClose?: () => void;
  closeLabel: string;
  titleAs?: "h1" | "h2";
}) {
  return (
    <header className="shrink-0 border-b border-border bg-background px-4 py-3" data-layout-primitives="stack">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <TitleTag className="truncate text-base font-semibold leading-6 tracking-tight text-foreground">
            {title}
            {typeof count === "number" ? (
              <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                {count.toLocaleString()}
              </span>
            ) : null}
          </TitleTag>
          {description ? (
            <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className={mapPanelIconButtonClass}
              aria-label={closeLabel}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
