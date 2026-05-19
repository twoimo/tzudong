'use client';

import { useEffect, useState } from 'react';
import { BREAKPOINTS } from '@/hooks/useDeviceType';

export type HomeViewportMode = 'pending' | 'mobileOrTablet' | 'desktop';

function resolveHomeViewportMode(): Exclude<HomeViewportMode, 'pending'> {
    return window.innerWidth <= BREAKPOINTS.tabletMax ? 'mobileOrTablet' : 'desktop';
}

export function useHomeViewportMode(): HomeViewportMode {
    const [mode, setMode] = useState<HomeViewportMode>('pending');

    useEffect(() => {
        let resizeRafId = 0;

        const updateMode = () => {
            if (resizeRafId) return;

            resizeRafId = window.requestAnimationFrame(() => {
                resizeRafId = 0;
                const nextMode = resolveHomeViewportMode();
                setMode((previousMode) => previousMode === nextMode ? previousMode : nextMode);
            });
        };

        setMode(resolveHomeViewportMode());
        window.addEventListener('resize', updateMode, { passive: true });
        window.addEventListener('orientationchange', updateMode, { passive: true });

        return () => {
            if (resizeRafId) {
                window.cancelAnimationFrame(resizeRafId);
            }
            window.removeEventListener('resize', updateMode);
            window.removeEventListener('orientationchange', updateMode);
        };
    }, []);

    return mode;
}
