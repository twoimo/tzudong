'use client';

import { useCallback, useEffect, useRef, type RefObject, type TouchEvent } from 'react';
import { resetMobileSheetLayoutState, setMobileSheetLayoutState } from '@/lib/mobile-sheet-layout';
import { getMobileScrollNavVisibilityAction } from '@/lib/mobile-scroll-nav-visibility';

type UseMobileBottomNavAutoHideOptions<T extends HTMLElement> = {
    scrollRef: RefObject<T | null>;
    source: string;
    disabled?: boolean;
    touchThresholdPx?: number;
    revealOnScrollUp?: boolean;
    topRevealOffsetPx?: number;
    getScrollTop?: () => number;
};

export function useMobileBottomNavAutoHide<T extends HTMLElement>({
    scrollRef,
    source,
    disabled = false,
    touchThresholdPx = 32,
    revealOnScrollUp = true,
    topRevealOffsetPx,
    getScrollTop,
}: UseMobileBottomNavAutoHideOptions<T>) {
    const isBottomNavHiddenRef = useRef(false);
    const previousScrollTopRef = useRef(0);
    const touchStartYRef = useRef<number | null>(null);

    const setBottomNavHidden = useCallback((hidden: boolean) => {
        if (disabled) return;
        if (isBottomNavHiddenRef.current === hidden) return;
        isBottomNavHiddenRef.current = hidden;

        if (hidden) {
            setMobileSheetLayoutState({
                hideBottomNav: true,
                headerHideProgress: 1,
                source,
            });
            return;
        }

        resetMobileSheetLayoutState(source);
    }, [disabled, source]);

    const handleTouchStart = useCallback((event: TouchEvent<T>) => {
        if (disabled) return;
        touchStartYRef.current = event.touches[0]?.clientY ?? null;
    }, [disabled]);

    const handleTouchMove = useCallback((event: TouchEvent<T>) => {
        if (disabled) return;

        const startY = touchStartYRef.current;
        const currentY = event.touches[0]?.clientY;
        if (startY === null || currentY === undefined) return;

        const deltaY = currentY - startY;
        if (deltaY <= -touchThresholdPx) {
            setBottomNavHidden(true);
            touchStartYRef.current = currentY;
        } else if (
            revealOnScrollUp &&
            deltaY >= touchThresholdPx
        ) {
            setBottomNavHidden(false);
            touchStartYRef.current = currentY;
        }
    }, [disabled, revealOnScrollUp, setBottomNavHidden, touchThresholdPx]);

    const handleScroll = useCallback(() => {
        if (disabled) return;

        const scrollElement = scrollRef.current;
        if (!scrollElement && !getScrollTop) return;

        const currentScrollTop = getScrollTop?.() ?? scrollElement?.scrollTop ?? 0;
        const action = getMobileScrollNavVisibilityAction({
            previousScrollTop: previousScrollTopRef.current,
            currentScrollTop,
            isHidden: isBottomNavHiddenRef.current,
            revealOnScrollUp,
            topRevealOffsetPx,
        });

        previousScrollTopRef.current = currentScrollTop;

        if (action === 'hide') {
            setBottomNavHidden(true);
        } else if (action === 'show') {
            setBottomNavHidden(false);
        }
    }, [disabled, getScrollTop, revealOnScrollUp, scrollRef, setBottomNavHidden, topRevealOffsetPx]);

    useEffect(() => {
        if (disabled) return;

        const scrollElement = scrollRef.current;
        if (!scrollElement && !getScrollTop) return;

        previousScrollTopRef.current = getScrollTop?.() ?? scrollElement?.scrollTop ?? 0;

        scrollElement?.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            scrollElement?.removeEventListener('scroll', handleScroll);
            isBottomNavHiddenRef.current = false;
            resetMobileSheetLayoutState(source);
        };
    }, [disabled, getScrollTop, handleScroll, scrollRef, source]);

    return {
        onScroll: handleScroll,
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        setBottomNavHidden,
    };
}
