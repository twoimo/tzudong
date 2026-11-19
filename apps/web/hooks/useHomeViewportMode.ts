'use client';

import { useLayoutEffect, useState } from 'react';
import { DESKTOP_MIN_WIDTH_QUERY } from '@/lib/viewport-breakpoints';

export type HomeViewportMode = 'pending' | 'mobileOrTablet' | 'desktop';

export function useHomeViewportMode(): HomeViewportMode {
    const [mode, setMode] = useState<HomeViewportMode>('pending');

    useLayoutEffect(() => {
        const mediaQuery = window.matchMedia(DESKTOP_MIN_WIDTH_QUERY);
        const updateMode = () => {
            const nextMode = mediaQuery.matches ? 'desktop' : 'mobileOrTablet';
            setMode((previousMode) => previousMode === nextMode ? previousMode : nextMode);
        };

        mediaQuery.addEventListener('change', updateMode);
        updateMode();

        return () => {
            mediaQuery.removeEventListener('change', updateMode);
        };
    }, []);

    return mode;
}
