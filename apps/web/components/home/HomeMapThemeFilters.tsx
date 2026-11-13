"use client";

import { Fragment, useId } from "react";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

const THEME_SUMMARIES: Record<HomeMapThemeFilterId, string> = {
  "hot-view": "맛집별 최고 조회수 기준 상위 20%",
  "comment-hot": "맛집별 최고 댓글 수 기준 상위 20%",
  "fresh-video": "최신 공개 영상일 기준 90일 이내",
  "repeat-video": "연결된 쯔양 영상이 2개 이상",
  "fan-signal": "조회수 조건을 충족한 영상의 댓글 비율 상위 20%",
};

export function HomeMapThemeFilters({
  activeThemeId,
  onThemeChange,
  layout = "wrap",
  className,
}: HomeMapThemeFiltersProps) {
  const descriptionId = useId();
  const activeTheme = HOME_MAP_THEME_FILTERS.find((theme) => theme.id === activeThemeId);

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
                "h-auto min-h-11 shrink-0 gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-left home-map-floating-control-text text-xs font-medium shadow-sm motion-reduce:transition-none",
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
      {activeTheme && (
        <div className="mt-1 flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background/95 pl-3 pr-1 shadow-sm">
          <p className="min-w-0 flex-1 py-2 text-xs leading-5 text-foreground" role="status">
            {THEME_SUMMARIES[activeTheme.id]}
          </p>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0 rounded-full"
                aria-label={`${activeTheme.label} 필터 기준 보기`}
              >
                <Info className="h-4 w-4" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="z-[180] w-[min(22rem,calc(100vw-2rem))] rounded-xl p-4"
            >
              <p className="text-sm font-semibold">{activeTheme.label} 기준</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{activeTheme.description}</p>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onThemeChange(null)}
            className="h-11 w-11 shrink-0 rounded-full"
            aria-label={`${activeTheme.label} 필터 해제`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
