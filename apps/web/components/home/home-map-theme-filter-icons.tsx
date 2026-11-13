"use client";

import {
  Clock3,
  Eye,
  MessageCircle,
  Percent,
  Repeat2,
  type LucideIcon,
} from "lucide-react";
import type { HomeMapThemeFilterId } from "@/lib/home-map-theme-filters";
import { cn } from "@/lib/utils";

const HOME_MAP_THEME_FILTER_ICONS = {
  "hot-view": Eye,
  "comment-hot": MessageCircle,
  "fresh-video": Clock3,
  "repeat-video": Repeat2,
  "fan-signal": Percent,
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
      strokeWidth={2}
      className={cn("h-4 w-4 shrink-0", className)}
    />
  );
}
