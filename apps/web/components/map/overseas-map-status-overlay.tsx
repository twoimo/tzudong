import type { HomeViewportMode } from '@/hooks/useHomeViewportMode';
import type { HomeMapResultSummary } from '@/lib/home-map-result-summary';
import type { HomeMapThemeFilterId } from '@/lib/home-map-theme-filters';
import { MapThemeNotice } from './MapThemeNotice';
import { MapOverlayNotice } from './map-overlay-notice';

type OverseasMapStatusOverlayProps = {
    activeThemeId?: HomeMapThemeFilterId | null;
    isMapLoaded: boolean;
    viewportMode: HomeViewportMode;
    resultStatus: HomeMapResultSummary['status'];
    restaurantCount: number;
};

/** Provider loading/errors own the full map; result state and criteria share one slot. */
export function OverseasMapStatusOverlay({
    activeThemeId,
    isMapLoaded,
    viewportMode,
    resultStatus,
    restaurantCount,
}: OverseasMapStatusOverlayProps) {
    if (!isMapLoaded || viewportMode === 'pending') return null;

    const kind = resultStatus === 'error' ? 'error'
        : resultStatus === 'pending' ? 'loading'
            : resultStatus === 'select-country' ? 'select-country'
                : restaurantCount === 0 ? 'empty'
                    : activeThemeId ? 'theme' : null;
    if (!kind) return null;

    const positionClass = viewportMode === 'mobileOrTablet'
        ? 'mobile-map-status-badge pointer-events-none fixed top-[var(--mobile-map-controls-bottom,calc(env(safe-area-inset-top)_+_136px))] left-1/2 -translate-x-1/2 z-[70]'
        : 'pointer-events-none absolute inset-x-3 top-28 z-10 flex justify-center';

    return (
        <div className={positionClass} data-map-overlay-kind={kind} data-overseas-map-status-slot="true">
            {kind === 'theme' && activeThemeId ? <MapThemeNotice themeId={activeThemeId} /> : (
                <MapOverlayNotice
                    role={kind === 'error' ? 'alert' : 'status'}
                    ariaLive={kind === 'error' ? 'assertive' : 'polite'}
                    ariaBusy={kind === 'loading' || undefined}
                    contentClassName="!whitespace-normal !leading-5"
                >
                    {kind === 'loading' ? '맛집 핀을 불러오고 있어요'
                        : kind === 'error' ? '맛집 결과를 불러오지 못했습니다'
                            : kind === 'select-country' ? '국가를 선택해 주세요'
                                : '선택한 조건에 맞는 맛집이 없습니다'}
                </MapOverlayNotice>
            )}
        </div>
    );
}
