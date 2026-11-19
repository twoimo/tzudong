"use client";

import { Fragment, useId } from "react";
import { Button } from "@/components/ui/button";
import {
  HOME_MAP_THEME_FILTERS,
  type HomeMapThemeFilterId,
} from "@/lib/home-map-theme-filters";
import { cn } from "@/lib/utils";
import { HomeMapThemeFilterIcon } from "./home-map-theme-filter-icons";

export type HomeMapThemeFiltersProps = {
  activeThemeId: HomeMapThemeFilterId | null;
  onThemeChange: (id: HomeMapThemeFilterId | null) => void;
  layout?: "wrap" | "reel";
  className?: string;
};

export function HomeMapThemeFilters({
  activeThemeId,
  onThemeChange,
  layout = "wrap",
  className,
}: HomeMapThemeFiltersProps) {
  const descriptionId = useId();

  return (
    <div className={cn("pointer-events-auto w-full min-w-0 max-w-full", className)}>
      <div
        role="group"
        aria-label="쯔양 영상 테마 필터"
        data-scroll-owner={layout === "reel" ? "mobile-theme-filter-reel" : undefined}
        data-allow-horizontal-scroll={layout === "reel" ? "true" : undefined}
        data-horizontal-scroll-owner={layout === "reel" ? "mobile-theme-filter-reel" : undefined}
        className={cn(
          "flex min-w-0 max-w-full items-center gap-2 p-1",
          layout === "reel"
            ? "flex-nowrap overflow-x-auto overscroll-x-contain"
            : "flex-wrap",
        )}
      >
      {HOME_MAP_THEME_FILTERS.map((theme) => {
        const isSelected = activeThemeId === theme.id;
        const themeDescriptionId = `${descriptionId}-${theme.id}`;

        return (
          <Fragment key={theme.id}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onThemeChange(isSelected ? null : theme.id)}
              aria-pressed={isSelected}
              aria-label={`${theme.label}: ${theme.ariaLabel}`}
              aria-describedby={themeDescriptionId}
              title={`${theme.label}: ${theme.description}`}
              className={cn(
                "h-auto min-h-11 shrink-0 gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-left home-map-floating-control-text text-sm font-medium shadow-sm motion-reduce:transition-none",
                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                  : "border-border bg-background/95 text-foreground hover:bg-secondary/80 hover:text-foreground",
              )}
            >
              <HomeMapThemeFilterIcon themeId={theme.id} />
              <span>{theme.label}</span>
            </Button>
            <span id={themeDescriptionId} className="sr-only">
              {theme.description}
            </span>
          </Fragment>
        );
      })}
      </div>

    </div>
  );
}
