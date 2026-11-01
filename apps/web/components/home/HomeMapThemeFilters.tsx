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
  className?: string;
};

export function HomeMapThemeFilters({
  activeThemeId,
  onThemeChange,
  className,
}: HomeMapThemeFiltersProps) {
  const descriptionId = useId();

  return (
    <div
      role="group"
      aria-label="쯔양 영상 테마 필터"
      className={cn(
        "pointer-events-auto flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 p-0.5",
        className,
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
                "h-auto min-h-[44px] min-w-0 max-w-full gap-1.5 whitespace-normal rounded-full border px-2.5 py-2 text-left home-map-floating-control-text text-xs font-semibold shadow-sm motion-reduce:transition-none",
                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                  : "border-border bg-background/95 text-foreground hover:bg-secondary/80 hover:text-foreground",
              )}
            >
              <HomeMapThemeFilterIcon themeId={theme.id} />
              <span className="min-w-0 [overflow-wrap:anywhere]">{theme.label}</span>
            </Button>
            <span id={themeDescriptionId} className="sr-only">
              {theme.description}
            </span>
          </Fragment>
        );
      })}
      <p data-map-marker-legend="true" className="basis-full rounded-lg bg-background/95 px-2 py-1 text-xs leading-relaxed text-foreground shadow-sm">
        묶음 숫자: 맛집 수 · 빨간 배지: 쯔양 방문 횟수
        <span className="sr-only">지도 핀은 Tab으로 이동하고 Enter 또는 Space로 열 수 있습니다.</span>
        {activeThemeId && <span className="block text-muted-foreground">
          {HOME_MAP_THEME_FILTERS.find((theme) => theme.id === activeThemeId)?.description}
        </span>}
      </p>
    </div>
  );
}
