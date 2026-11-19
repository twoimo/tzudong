"use client";

import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HOME_MAP_THEME_FILTERS, type HomeMapThemeFilterId } from '@/lib/home-map-theme-filters';
import { MapOverlayNoticeButton } from './map-overlay-notice';

const summaries: Record<HomeMapThemeFilterId, string> = {
  'hot-view': '맛집별 최고 조회수 상위 20%',
  'comment-hot': '맛집별 최고 댓글 수 상위 20%',
  'fresh-video': '최신 영상 기준 90일 이내',
  'repeat-video': '영상에 두 번 이상 나온 맛집',
  'fan-signal': '조회수 조건을 충족한 댓글 비율 상위 20%',
};

/** Uses the map's single status slot; loading/errors take priority over criteria. */
export function MapThemeNotice({ themeId, className }: { themeId: HomeMapThemeFilterId; className?: string }) {
  const theme = HOME_MAP_THEME_FILTERS.find(item => item.id === themeId);
  if (!theme) return null;
  return <Popover>
    <PopoverTrigger asChild>
      <MapOverlayNoticeButton
        className={`pointer-events-auto !min-h-11 ${className ?? ''}`}
        contentClassName="!whitespace-normal !text-left !font-normal !leading-5"
        icon={<Info className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
        ariaLabel={`${theme.label} 필터 기준 보기`}
      >{summaries[theme.id]}</MapOverlayNoticeButton>
    </PopoverTrigger>
    <PopoverContent align="center" sideOffset={8} className="z-[180] w-[min(22rem,calc(100vw-2rem))] rounded-xl p-4">
      <h2 className="text-sm font-medium">{theme.label} 기준</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{theme.description}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">선택한 필터를 다시 누르면 해제됩니다</p>
    </PopoverContent>
  </Popover>;
}
