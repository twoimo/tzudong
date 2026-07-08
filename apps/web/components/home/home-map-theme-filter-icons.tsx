"use client";

import {
  Clock3,
  MessageCircle,
  Repeat2,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { HomeMapThemeFilterId } from "@/lib/home-map-theme-filters";
import { cn } from "@/lib/utils";

const HOME_MAP_THEME_FILTER_ICONS = {
  "hot-view": TrendingUp,
  "comment-hot": MessageCircle,
  "fresh-video": Clock3,
  "repeat-video": Repeat2,
  "fan-signal": Sparkles,
} satisfies Record<HomeMapThemeFilterId, LucideIcon>;

type HomeMapThemeFilterIconProps = {
  themeId: HomeMapThemeFilterId;
  className?: string;
};

export function HomeMapThemeFilterIcon({
  themeId,
  className,
}: HomeMapThemeFilterIconProps) {
  const Icon = HOME_MAP_THEME_FILTER_ICONS[themeId];

  return (
    <Icon
      aria-hidden="true"
      focusable="false"
      strokeWidth={2.25}
      className={cn("h-3.5 w-3.5 shrink-0", className)}
    />
  );
}
