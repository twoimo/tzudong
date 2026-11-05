'use client';

import { useEffect } from 'react';
import { useNaverMaps } from '@/hooks/use-naver-maps';
import { preloadNaverMap } from '@/lib/naver-map-loader';
import { resolveHomeDetailMapModeParam, type HomeMapMode } from '@/lib/home-detail-route-state';

export function useHomeNaverPreload(isViewportResolved: boolean, mapMode: HomeMapMode) {
    const { isLoaded, loadError, load } = useNaverMaps({
        autoLoad: false,
        strategy: 'afterInteractive',
    });

    useEffect(() => {
        if (!isViewportResolved || mapMode !== 'domestic') return;
        // Initial URL restoration can still be resolving the state in this render.
        if (resolveHomeDetailMapModeParam(new URLSearchParams(window.location.search)) === 'overseas') return;

        preloadNaverMap();
        // Start the existing shared provider alongside the component chunk.
        // The rendered NaverMapView remains the only map-instance owner.
        if (!isLoaded && !loadError) load();
    }, [isViewportResolved, mapMode, isLoaded, loadError, load]);
}
