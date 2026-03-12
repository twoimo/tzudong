'use client';

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useDeviceType';
import { resetMobileSheetLayoutState, setMobileSheetLayoutState } from '@/lib/mobile-sheet-layout';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    defaultHeight?: number; // Percent
    minHeight?: number;    // Percent
    maxHeight?: number;    // Percent
    showHandle?: boolean;
    className?: string;
    closeThreshold?: number; // Percent
    disableContentScroll?: boolean;
    headerOffset?: number;   // Pixels (e.g., 80px for header + spacing)
    bottomNavOffset?: number; // Pixels (e.g., 56px for bottom nav)
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    enablePeek?: boolean;
    hideBottomNavWhenOpen?: boolean;
    progressiveHeaderHide?: boolean;
    layoutSource?: string;
    showBackdrop?: boolean;
    closeOnOutsidePointerDown?: boolean;
    hideHandleWhenFull?: boolean;
}

const isVerticallyScrollable = (element: HTMLElement) => {
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    const allowsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    return allowsScroll && element.scrollHeight > element.clientHeight;
};

const findScrollableTouchTarget = (
    target: EventTarget | null,
    boundary: HTMLElement | null
): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return boundary;

    let node: HTMLElement | null = target;
    while (node && node !== boundary) {
        if (isVerticallyScrollable(node)) return node;
        node = node.parentElement;
    }

    if (boundary && isVerticallyScrollable(boundary)) return boundary;
    return null;
};

const SWIPE_VELOCITY_THRESHOLD = 0.22;
const SWIPE_VELOCITY_CLOSE_THRESHOLD = 0.26;
const SWIPE_VELOCITY_OPEN_THRESHOLD = 0.24;
const CONTENT_TOP_EPSILON = 2;
const SHEET_HALF_OPEN_TOLERANCE = 1;
const HALF_TO_FULL_DISTANCE_PX = 14;
const FULL_TO_HALF_DISTANCE_PX = 18;
const FULL_TO_HALF_FAST_DISTANCE_PX = 18;
const HALF_TO_PEEK_DISTANCE_PX = 28;
const HALF_TO_FULL_FAST_DISTANCE_PX = 12;
const HALF_TO_FULL_VELOCITY_FLOOR_PX_PER_MS = 0.16;
const HALF_TO_FULL_QUICK_VELOCITY_FLOOR_PX_PER_MS = 0.19;
const QUICK_GESTURE_DURATION_MS = 85;
const QUICK_GESTURE_EXTRA_DISTANCE_PX = 2;
const QUICK_GESTURE_SHORT_DISTANCE_PX = 25;
const LONG_PRESS_TRANSITION_THRESHOLD_MS = 175;
const DRAG_RENDER_EPSILON_PERCENT = 0.08;
const SNAP_TRANSITION_BASE_MS = 235;
const SNAP_TRANSITION_FAST_MS = 175;
const SNAP_TRANSITION_SMOOTH_MS = 295;
const SNAP_EASING_BASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SNAP_EASING_FAST = 'cubic-bezier(0.16, 1, 0.3, 1)';
const SNAP_EASING_SMOOTH = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const HORIZONTAL_SWIPE_THRESHOLD = 10;
const HORIZONTAL_SWIPE_INTENT_RATIO = 0.85;
const VERTICAL_DRAG_INTENT_RATIO = 1.25;
const HANDLE_VERTICAL_DRAG_THRESHOLD = 6;
const CONTENT_VERTICAL_DRAG_THRESHOLD = 10;
const FULL_HEIGHT_VERTICAL_DRAG_THRESHOLD = 22;
const FULL_HEIGHT_VERTICAL_INTENT_RATIO = 1.8;

/**
 * 드래그 가능한 바텀시트 컴포넌트
 * [OPTIMIZED] HomeMapContainer의 고성능 로직 이식 (visualViewport, Physics, RAF)
 */
function BottomSheetComponent({
    isOpen,
    onClose,
    children,
    defaultHeight = 50,
    minHeight = 50,
    maxHeight = 100,
    showHandle = true,
    className,
    closeThreshold = 15,
    disableContentScroll = false,
    headerOffset = 0,
    bottomNavOffset = 0,
    onSwipeLeft,
    onSwipeRight,
    enablePeek = false,
    hideBottomNavWhenOpen = false,
    progressiveHeaderHide = false,
    layoutSource = 'bottom-sheet',
    showBackdrop = true,
    closeOnOutsidePointerDown = false,
    hideHandleWhenFull = false,
}: BottomSheetProps) {
    const isMobileOrTablet = useIsMobile();
    // [PERFORMANCE] 렌더링에 필요한 상태만 useState로 관리
    const [sheetHeight, setSheetHeight] = useState(defaultHeight);
    const [isDragging, setIsDragging] = useState(false);
    const [sheetSnapTransition, setSheetSnapTransition] = useState({
        duration: SNAP_TRANSITION_BASE_MS,
        easing: SNAP_EASING_BASE,
    });

    // [PERFORMANCE] 드래그 중 리렌더링 제거 - Ref로 관리
    const viewportHeightRef = useRef(
        typeof window !== 'undefined'
            ? (window.visualViewport?.height ?? window.innerHeight)
            : 800
    );

    const isDraggingRef = useRef(false);
    const startYRef = useRef(0);
    const startHeightRef = useRef(defaultHeight);
    const dragStartTimeRef = useRef(0);
    const lastYRef = useRef(0);
    const lastTimeRef = useRef(0);
    const dragEndYRef = useRef(0);
    const dragEndTimeRef = useRef(0);
    const velocityRef = useRef(0);
    const sheetRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const contentTouchStartYRef = useRef(0);
    const contentTouchStartXRef = useRef(0);
    const isContentDraggingSheetRef = useRef(false);
    const lockedContentScrollTargetRef = useRef<HTMLElement | null>(null);
    const lockedContentScrollTargetOverflowRef = useRef<string | null>(null);
    const lockedContentRootOverflowRef = useRef<string | null>(null);
    const contentStartBoundaryRef = useRef<'top' | null>(null);
    const contentScrollTargetRef = useRef<HTMLElement | null>(null);
    const handleTouchStartXRef = useRef(0);
    const handleSwipeDirectionRef = useRef<'horizontal' | 'vertical' | null>(null);
    const contentSwipeDirectionRef = useRef<'horizontal' | 'vertical' | null>(null);
    const sheetTouchSourceRef = useRef<'handle' | 'content' | null>(null);
    const sheetHeightRef = useRef(defaultHeight);

    const getCurrentMaxHeight = useCallback((vh: number = viewportHeightRef.current) => {
        return headerOffset > 0
            ? ((vh - headerOffset) / vh) * 100
            : maxHeight;
    }, [headerOffset, maxHeight]);

    const pxToPercent = useCallback((px: number) => {
        return (px / viewportHeightRef.current) * 100;
    }, []);

    const percentToPx = useCallback((percent: number) => {
        return (percent / 100) * viewportHeightRef.current;
    }, []);

    const getContentSnapPoints = useCallback(() => {
        const minSnap = minHeight;
        const maxSnap = Math.max(minSnap, getCurrentMaxHeight());
        if (!enablePeek || defaultHeight <= minSnap || defaultHeight >= maxSnap) {
            return [minSnap, maxSnap];
        }
        return [minSnap, defaultHeight, maxSnap];
    }, [defaultHeight, enablePeek, getCurrentMaxHeight, minHeight]);

    const getNearestSnapHeight = useCallback((currentHeight: number) => {
        const snapPoints = getContentSnapPoints();
        return snapPoints.reduce((closest, snap) =>
            Math.abs(snap - currentHeight) < Math.abs(closest - currentHeight) ? snap : closest
        , snapPoints[0]);
    }, [getContentSnapPoints]);

    const applySnapTransition = useCallback((isFlick: boolean, distancePx: number, isLongPress: boolean) => {
        if (isFlick) {
            setSheetSnapTransition({
                duration: SNAP_TRANSITION_FAST_MS,
                easing: SNAP_EASING_FAST,
            });
            return;
        }

        if (isLongPress || distancePx >= 80) {
            setSheetSnapTransition({
                duration: SNAP_TRANSITION_SMOOTH_MS,
                easing: SNAP_EASING_SMOOTH,
            });
            return;
        }

        setSheetSnapTransition({
            duration: SNAP_TRANSITION_BASE_MS,
            easing: SNAP_EASING_BASE,
        });
    }, []);

    const syncMobileLayout = useCallback((heightPercent: number) => {
        if (!isOpen || !hideBottomNavWhenOpen || !isMobileOrTablet) {
            resetMobileSheetLayoutState(layoutSource);
            return;
        }

        const maxSnap = Math.max(minHeight, getCurrentMaxHeight());
        const clamped = Math.max(minHeight, Math.min(maxSnap, heightPercent));
        const headerHideProgress = progressiveHeaderHide && maxSnap > defaultHeight
            ? Math.max(0, Math.min(1, (clamped - defaultHeight) / (maxSnap - defaultHeight)))
            : 0;

        setMobileSheetLayoutState({
            source: layoutSource,
            hideBottomNav: true,
            headerHideProgress,
        });
    }, [
        defaultHeight,
        getCurrentMaxHeight,
        hideBottomNavWhenOpen,
        isMobileOrTablet,
        isOpen,
        layoutSource,
        minHeight,
        progressiveHeaderHide,
    ]);

    const setSheetHeightSafe = useCallback((nextHeight: number, forceRender = false) => {
        const currentMaxHeight = getCurrentMaxHeight();
        const nextHeightSafe = Math.max(minHeight, Math.min(currentMaxHeight, nextHeight));

        if (Math.abs(sheetHeightRef.current - nextHeightSafe) < DRAG_RENDER_EPSILON_PERCENT) {
            syncMobileLayout(nextHeightSafe);
            return;
        }

        sheetHeightRef.current = nextHeightSafe;
        syncMobileLayout(nextHeightSafe);

        if (!forceRender && isDraggingRef.current) {
            return;
        }

        setSheetHeight(nextHeightSafe);
    }, [getCurrentMaxHeight, minHeight, syncMobileLayout]);

    const unlockContentScrollDuringDrag = useCallback(() => {
        const lockedTarget = lockedContentScrollTargetRef.current;
        if (lockedTarget) {
            lockedTarget.style.overflowY = lockedContentScrollTargetOverflowRef.current ?? '';
        }

        const content = contentRef.current;
        if (content) {
            content.style.overflowY = lockedContentRootOverflowRef.current ?? '';
        }

        lockedContentScrollTargetRef.current = null;
        lockedContentScrollTargetOverflowRef.current = null;
        lockedContentRootOverflowRef.current = null;
    }, []);

    const lockContentScrollDuringDrag = useCallback((preferredTarget?: HTMLElement | null) => {
        const content = contentRef.current;
        if (!content) return;

        if (lockedContentRootOverflowRef.current === null) {
            lockedContentRootOverflowRef.current = content.style.overflowY;
        }
        content.style.overflowY = 'hidden';

        const target = preferredTarget ?? contentScrollTargetRef.current;
        if (!target) return;

        if (lockedContentScrollTargetRef.current && lockedContentScrollTargetRef.current !== target) {
            lockedContentScrollTargetRef.current.style.overflowY = lockedContentScrollTargetOverflowRef.current ?? '';
            lockedContentScrollTargetRef.current = null;
            lockedContentScrollTargetOverflowRef.current = null;
        }

        if (!lockedContentScrollTargetRef.current) {
            lockedContentScrollTargetRef.current = target;
            lockedContentScrollTargetOverflowRef.current = target.style.overflowY;
        }

        target.style.overflowY = 'hidden';
    }, []);

    const resetSheetInteractionState = useCallback(() => {
        isDraggingRef.current = false;
        setIsDragging(false);
        isContentDraggingSheetRef.current = false;
        velocityRef.current = 0;
        unlockContentScrollDuringDrag();
    }, [unlockContentScrollDuringDrag]);

    const canContentDragFromTouch = useCallback((deltaY: number) => {
        const scrollArea = contentScrollTargetRef.current;
        const top = scrollArea ? scrollArea.scrollTop : contentRef.current?.scrollTop ?? 0;

        const currentMaxHeight = getCurrentMaxHeight();
        const isAtHalf = enablePeek
            ? sheetHeightRef.current <= defaultHeight + SHEET_HALF_OPEN_TOLERANCE
            : sheetHeightRef.current <= minHeight + SHEET_HALF_OPEN_TOLERANCE;
        const isAtFull = sheetHeightRef.current >= currentMaxHeight - SHEET_HALF_OPEN_TOLERANCE;

        if (isAtHalf) return top <= CONTENT_TOP_EPSILON;
        if (deltaY > 0 && isAtFull) return top <= CONTENT_TOP_EPSILON;

        return false;
    }, [defaultHeight, enablePeek, getCurrentMaxHeight, minHeight]);

    // [PERFORMANCE] visualViewport resize 스로틀링 (16ms ≈ 60fps)
    useEffect(() => {
        if (!isOpen) return;

        const viewport = window.visualViewport;
        if (!viewport) return;

        let throttleTimer: number | null = null;

        const handleResize = () => {
            if (throttleTimer !== null) return;

            throttleTimer = requestAnimationFrame(() => {
                viewportHeightRef.current = viewport.height;
                // 드래그 중이 아닐 때만 상태 업데이트 (리렌더링 최소화)
                if (!isDraggingRef.current) {
                    // 최대 높이를 넘지 않도록 조정
                    setSheetHeight(prev => {
                        const nextHeight = Math.max(minHeight, Math.min(prev, getCurrentMaxHeight(viewport.height)));
                        syncMobileLayout(nextHeight);
                        return nextHeight;
                    });
                }
                throttleTimer = null;
            });
        };

        viewport.addEventListener('resize', handleResize, { passive: true });
        // 초기값 설정
        viewportHeightRef.current = viewport.height;

        return () => {
            viewport.removeEventListener('resize', handleResize);
            if (throttleTimer !== null) cancelAnimationFrame(throttleTimer);
        };
    }, [isOpen, getCurrentMaxHeight, minHeight, syncMobileLayout]);

    // 패널이 열릴 때 초기화
    useEffect(() => {
        if (isOpen) {
            // 헤더 오프셋이 있는 경우 최대 높이 계산하여 초기화
            if (headerOffset > 0 && typeof window !== 'undefined' && window.visualViewport) {
                const vh = window.visualViewport.height;
                const calculatedMax = ((vh - headerOffset) / vh) * 100;
                const nextHeight = Math.min(defaultHeight, calculatedMax);
                setSheetHeight(nextHeight);
                sheetHeightRef.current = nextHeight;
                syncMobileLayout(nextHeight);
            } else {
                setSheetHeight(defaultHeight);
                sheetHeightRef.current = defaultHeight;
                syncMobileLayout(defaultHeight);
            }
            return;
        }
        resetMobileSheetLayoutState(layoutSource);
    }, [defaultHeight, headerOffset, isOpen, layoutSource, syncMobileLayout]);

    useEffect(() => {
        sheetHeightRef.current = sheetHeight;
        syncMobileLayout(sheetHeight);
    }, [sheetHeight, syncMobileLayout]);

    useEffect(() => {
        return () => {
            resetMobileSheetLayoutState(layoutSource);
        };
    }, [layoutSource]);

    // [PERFORMANCE] 드래그 시작 공통 로직
    const handleDragStartCore = useCallback((clientY: number) => {
        isDraggingRef.current = true;
        startYRef.current = clientY;
        startHeightRef.current = sheetHeightRef.current;
        dragStartTimeRef.current = performance.now();
        lastYRef.current = clientY;
        lastTimeRef.current = performance.now();
        dragEndYRef.current = clientY;
        dragEndTimeRef.current = performance.now();
        velocityRef.current = 0;
        setSheetSnapTransition({
            duration: SNAP_TRANSITION_BASE_MS,
            easing: SNAP_EASING_BASE,
        });

        if (sheetRef.current) {
            sheetRef.current.style.transitionDuration = '0ms';
        }
        lockContentScrollDuringDrag();
        setIsDragging(true);
    }, [lockContentScrollDuringDrag]);

    // [PERFORMANCE] 드래그 중 공통 로직 - 즉시 반응 우선
    const handleDragMoveCore = useCallback((currentY: number) => {
        if (!isDraggingRef.current) return;

        const currentTime = performance.now();
        const deltaTime = currentTime - lastTimeRef.current;
        if (deltaTime > 0) {
            velocityRef.current = (currentY - lastYRef.current) / deltaTime;
        }
        lastYRef.current = currentY;
        lastTimeRef.current = currentTime;
        dragEndYRef.current = currentY;
        dragEndTimeRef.current = currentTime;

        const deltaY = startYRef.current - currentY;
        const vh = viewportHeightRef.current;
        const deltaPercent = (deltaY / vh) * 100;
        const currentMaxHeight = getCurrentMaxHeight(vh);

        let newHeight = startHeightRef.current + deltaPercent;
        newHeight = Math.max(minHeight, Math.min(currentMaxHeight, newHeight));
        setSheetHeightSafe(newHeight, true);
    }, [getCurrentMaxHeight, minHeight, setSheetHeightSafe]);

    // 터치 드래그 시작
    // [PERFORMANCE] 드래그 종료
    const handleDragEnd = useCallback((source: 'handle' | 'content' = 'handle') => {
        isDraggingRef.current = false;
        setIsDragging(false);
        unlockContentScrollDuringDrag();

        const currentHeight = sheetHeightRef.current;
        const currentMaxHeight = getCurrentMaxHeight();
        const elapsedMs = Math.max(16, dragEndTimeRef.current - dragStartTimeRef.current);
        const dragDistancePx = dragEndYRef.current - startYRef.current;
        const upwardDistancePx = startYRef.current - dragEndYRef.current;
        const gestureVelocity = elapsedMs > 0
            ? dragDistancePx / elapsedMs
            : velocityRef.current;

        const isSwipeDown = gestureVelocity >= SWIPE_VELOCITY_THRESHOLD;
        const isSwipeDownStrong = gestureVelocity >= SWIPE_VELOCITY_CLOSE_THRESHOLD;
        const isSwipeUpStrong = gestureVelocity <= -SWIPE_VELOCITY_OPEN_THRESHOLD;
        const movementFromStart = currentHeight - startHeightRef.current;
        const movementPxFromStart = percentToPx(movementFromStart);
        const startedAtPeek = enablePeek && startHeightRef.current <= minHeight + 0.5;
        const startedAtHalf = !startedAtPeek && startHeightRef.current <= defaultHeight + 0.5;
        const startedAtFull = startHeightRef.current >= currentMaxHeight - 0.5;
        const isQuickGesture = elapsedMs <= QUICK_GESTURE_DURATION_MS;
        const movementPx = Math.abs(movementPxFromStart);
        const isLongPress = !isQuickGesture && elapsedMs >= LONG_PRESS_TRANSITION_THRESHOLD_MS;
        const peekToHalfDistancePercent = pxToPercent(
            HALF_TO_FULL_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0)
        );
        const halfToFullDistancePercent = pxToPercent(
            HALF_TO_FULL_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0)
        );
        const fullToHalfDistancePercent = pxToPercent(
            FULL_TO_HALF_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0)
        );
        const halfToPeekDistancePercent = pxToPercent(
            HALF_TO_PEEK_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0)
        );
        const shouldUseFastTransition = isSwipeUpStrong || isSwipeDownStrong;
        const isQuickAndSmall = isQuickGesture && movementPx <= QUICK_GESTURE_SHORT_DISTANCE_PX;
        const shouldUseSmoothTransition = isLongPress || (!isQuickAndSmall && movementPx > QUICK_GESTURE_SHORT_DISTANCE_PX) || dragDistancePx > HALF_TO_PEEK_DISTANCE_PX;

        applySnapTransition(shouldUseFastTransition, movementPx, shouldUseSmoothTransition);
        velocityRef.current = 0;

        const fullToHalfDistancePx =
            FULL_TO_HALF_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0);
        const fullToHalfFastDistancePx = FULL_TO_HALF_FAST_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0);
        const hasFullToHalfHint = isSwipeDownStrong && dragDistancePx >= fullToHalfFastDistancePx;
        const halfToFullFastDistancePx = HALF_TO_FULL_FAST_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0);
        const hasFastUpDistance = isSwipeUpStrong && upwardDistancePx >= halfToFullFastDistancePx;
        const hasFastUpVelocity = isSwipeUpStrong && upwardDistancePx >= HALF_TO_FULL_QUICK_VELOCITY_FLOOR_PX_PER_MS * elapsedMs;
        const hasFastUpDistanceByVelocity = isSwipeUpStrong && upwardDistancePx >= HALF_TO_FULL_VELOCITY_FLOOR_PX_PER_MS * elapsedMs;
        const shouldSnapToPeekFromHalf =
            enablePeek &&
            startedAtHalf &&
            dragDistancePx > 0 &&
            dragDistancePx >= HALF_TO_PEEK_DISTANCE_PX;

        if (isSwipeDown) {
            if (startedAtPeek) {
                setSheetHeightSafe(minHeight, true);
                return;
            }

            if (startedAtHalf) {
                if (!enablePeek) {
                    onClose();
                    return;
                }

                setSheetHeightSafe(minHeight, true);
                return;
            }

            setSheetHeightSafe(minHeight, true);
            return;
        }

        if (enablePeek && startedAtPeek && (movementPxFromStart > peekToHalfDistancePercent || (hasFastUpDistance && hasFastUpVelocity) || hasFastUpDistanceByVelocity)) {
            setSheetHeightSafe(defaultHeight, true);
            return;
        }

        if (enablePeek && startedAtHalf && (movementPxFromStart < -halfToPeekDistancePercent || shouldSnapToPeekFromHalf)) {
            setSheetHeightSafe(minHeight, true);
            return;
        }

        if (startedAtHalf && (movementPxFromStart > halfToFullDistancePercent || (hasFastUpDistance && hasFastUpVelocity) || hasFastUpDistanceByVelocity)) {
            setSheetHeightSafe(currentMaxHeight, true);
            return;
        }

        if (startedAtFull && (movementPxFromStart < -fullToHalfDistancePercent || (hasFullToHalfHint && dragDistancePx >= fullToHalfDistancePx))) {
            setSheetHeightSafe(minHeight, true);
            return;
        }

        if (Math.abs(currentHeight - startHeightRef.current) < 2) {
            setSheetHeightSafe(getNearestSnapHeight(currentHeight), true);
            return;
        }

        setSheetHeightSafe(getNearestSnapHeight(currentHeight), true);

        if (!enablePeek && source === 'handle' && currentHeight <= closeThreshold) {
            queueMicrotask(onClose);
        }
    }, [
        applySnapTransition,
        defaultHeight,
        enablePeek,
        closeThreshold,
        getCurrentMaxHeight,
        getNearestSnapHeight,
        minHeight,
        onClose,
        percentToPx,
        pxToPercent,
        setSheetHeightSafe,
        unlockContentScrollDuringDrag,
    ]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (!isMobileOrTablet) return;
        handleTouchStartXRef.current = e.touches[0].clientX;
        startYRef.current = e.touches[0].clientY;
        handleSwipeDirectionRef.current = null;
    }, [isMobileOrTablet]);

    // 마우스 드래그 시작
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!isMobileOrTablet) return;
        e.preventDefault();
        handleDragStartCore(e.clientY);
    }, [handleDragStartCore, isMobileOrTablet]);

    const handleSwipeTouchMove = useCallback((e: React.TouchEvent, isFromHandle = false) => {
        const currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const currentStartY = isFromHandle ? startYRef.current : contentTouchStartYRef.current;
        const currentStartX = isFromHandle ? handleTouchStartXRef.current : contentTouchStartXRef.current;
        const currentDirectionRef = isFromHandle ? handleSwipeDirectionRef : contentSwipeDirectionRef;
        const deltaY = currentY - currentStartY;
        const deltaX = currentX - currentStartX;
        const absDeltaY = Math.abs(deltaY);
        const absDeltaX = Math.abs(deltaX);

        if (!currentDirectionRef.current) {
            const isHorizontalSwipe =
                absDeltaX >= HORIZONTAL_SWIPE_THRESHOLD &&
                absDeltaX >= absDeltaY * HORIZONTAL_SWIPE_INTENT_RATIO;
            if (isHorizontalSwipe && (onSwipeLeft || onSwipeRight)) {
                currentDirectionRef.current = 'horizontal';
                return;
            }

            const verticalThreshold = isFromHandle
                ? HANDLE_VERTICAL_DRAG_THRESHOLD
                : CONTENT_VERTICAL_DRAG_THRESHOLD;
            const currentMaxHeight = getCurrentMaxHeight();
            const isAtFull = sheetHeightRef.current >= currentMaxHeight - SHEET_HALF_OPEN_TOLERANCE;
            const resolvedVerticalThreshold = !isFromHandle && isAtFull
                ? Math.max(verticalThreshold, FULL_HEIGHT_VERTICAL_DRAG_THRESHOLD)
                : verticalThreshold;
            const resolvedVerticalIntentRatio = !isFromHandle && isAtFull
                ? FULL_HEIGHT_VERTICAL_INTENT_RATIO
                : VERTICAL_DRAG_INTENT_RATIO;
            const hasVerticalIntent =
                absDeltaY >= resolvedVerticalThreshold &&
                absDeltaY >= absDeltaX * resolvedVerticalIntentRatio;
            if (!hasVerticalIntent) {
                return;
            }

            if (!isFromHandle && !canContentDragFromTouch(deltaY)) {
                return;
            }

            handleDragStartCore(currentStartY);
            if (!isFromHandle) {
                lockContentScrollDuringDrag(contentScrollTargetRef.current);
            }
            currentDirectionRef.current = 'vertical';
            if (!isFromHandle) {
                isContentDraggingSheetRef.current = true;
            }
        }

        if (currentDirectionRef.current !== 'vertical') return;
        if (!isFromHandle) {
            e.stopPropagation();
        }
        handleDragMoveCore(currentY);
    }, [
        canContentDragFromTouch,
        getCurrentMaxHeight,
        handleDragMoveCore,
        handleDragStartCore,
        lockContentScrollDuringDrag,
        onSwipeLeft,
        onSwipeRight,
    ]);

    const handleSwipeTouchEnd = useCallback((e: React.TouchEvent, isFromHandle = false) => {
        const currentTouch = e.changedTouches?.[0] ?? e.touches?.[0];
        if (!currentTouch) return;
        const currentDirectionRef = isFromHandle ? handleSwipeDirectionRef : contentSwipeDirectionRef;
        const currentStartY = isFromHandle ? startYRef.current : contentTouchStartYRef.current;
        const currentStartX = isFromHandle ? handleTouchStartXRef.current : contentTouchStartXRef.current;
        const direction = currentDirectionRef.current;

        if (direction === 'horizontal') {
            const deltaX = currentTouch.clientX - currentStartX;
            const deltaY = currentTouch.clientY - currentStartY;
            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);
            const isValidSwipe =
                absDeltaX >= HORIZONTAL_SWIPE_THRESHOLD &&
                absDeltaX >= absDeltaY * HORIZONTAL_SWIPE_INTENT_RATIO;

            if (isValidSwipe) {
                if (deltaX < 0) {
                    onSwipeLeft?.();
                } else {
                    onSwipeRight?.();
                }
            }
        } else if (direction === null) {
            const deltaX = currentTouch.clientX - currentStartX;
            const deltaY = currentTouch.clientY - currentStartY;
            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);
            const isPossibleSwipe =
                absDeltaX >= HORIZONTAL_SWIPE_THRESHOLD &&
                absDeltaX >= absDeltaY * 0.8;

            if (isPossibleSwipe) {
                if (deltaX < 0) {
                    onSwipeLeft?.();
                } else {
                    onSwipeRight?.();
                }
            }
        }

        if (direction === 'vertical') {
            if (isFromHandle) {
                handleDragEnd('handle');
            } else {
                handleDragEnd('content');
            }
        }

        currentDirectionRef.current = null;
        if (!isFromHandle) {
            isContentDraggingSheetRef.current = false;
            contentScrollTargetRef.current = null;
            contentStartBoundaryRef.current = null;
        }
        unlockContentScrollDuringDrag();
    }, [
        handleDragEnd,
        onSwipeLeft,
        onSwipeRight,
        unlockContentScrollDuringDrag,
    ]);

    const handleSheetTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        const touch = e.touches[0];
        if (!touch) return;
        const target = e.target;

        handleSwipeDirectionRef.current = null;
        contentSwipeDirectionRef.current = null;
        isContentDraggingSheetRef.current = false;
        contentScrollTargetRef.current = null;
        contentStartBoundaryRef.current = null;
        sheetTouchSourceRef.current = null;

        const isFromHandle = target instanceof Node && handleRef.current?.contains(target);

        if (isFromHandle) {
            handleTouchStart(e);
            sheetTouchSourceRef.current = 'handle';
            lockContentScrollDuringDrag();
            return;
        }

        contentTouchStartYRef.current = touch.clientY;
        contentTouchStartXRef.current = touch.clientX;
        const scrollTarget = findScrollableTouchTarget(target, contentRef.current);
        contentScrollTargetRef.current = scrollTarget;
        const scrollTop = scrollTarget
            ? scrollTarget.scrollTop
            : contentRef.current?.scrollTop ?? 0;
        const isAtTop = scrollTop <= CONTENT_TOP_EPSILON;
        const currentMaxHeight = getCurrentMaxHeight();
        const isAtFull = sheetHeightRef.current >= currentMaxHeight - SHEET_HALF_OPEN_TOLERANCE;
        contentStartBoundaryRef.current = isAtTop ? 'top' : null;
        sheetTouchSourceRef.current = 'content';
        if (isAtTop && !isAtFull) {
            lockContentScrollDuringDrag(scrollTarget);
            return;
        }
        unlockContentScrollDuringDrag();
    }, [
        getCurrentMaxHeight,
        handleTouchStart,
        lockContentScrollDuringDrag,
        unlockContentScrollDuringDrag,
    ]);

    const handleSheetTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        handleSwipeTouchMove(e, sheetTouchSourceRef.current === 'handle');
    }, [handleSwipeTouchMove]);

    const handleSheetTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        handleSwipeTouchEnd(e, sheetTouchSourceRef.current === 'handle');
        sheetTouchSourceRef.current = null;
    }, [handleSwipeTouchEnd]);

    // [PERFORMANCE] 마우스 이벤트 - window에 등록 (드래그 중일 때만)
    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            handleDragMoveCore(e.clientY);
        };
        const handleMouseUp = () => {
            handleDragEnd();
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, handleDragMoveCore, handleDragEnd]);

    // ESC 키로 닫기
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Pull-to-Refresh 방지
    useEffect(() => {
        if (!isOpen) return;
        document.body.style.overscrollBehavior = 'contain';
        document.documentElement.style.overscrollBehavior = 'contain';
        return () => {
            document.body.style.overscrollBehavior = '';
            document.documentElement.style.overscrollBehavior = '';
        };
    }, [isOpen]);

    // 드래그 핸들 Pull-to-Refresh 방지 (Passive: false)
    useEffect(() => {
        const handle = handleRef.current;
        if (!handle || !isOpen) return;

        const preventPullToRefresh = (e: TouchEvent) => {
            if (e.cancelable) {
                e.preventDefault();
            }
        };

        handle.addEventListener('touchmove', preventPullToRefresh, { passive: false });
        return () => handle.removeEventListener('touchmove', preventPullToRefresh);
    }, [isOpen]);

    // 콘텐츠 영역: 드래그 중 터치 스크롤 방지 (non-passive 리스너)
    useEffect(() => {
        const content = contentRef.current;
        if (!content || !isOpen) return;

        const preventContentScrollWhileDragging = (e: TouchEvent) => {
            if (isDraggingRef.current || isContentDraggingSheetRef.current) {
                if (e.cancelable) {
                    e.preventDefault();
                }
            }
        };

        content.addEventListener('touchmove', preventContentScrollWhileDragging, { passive: false });
        return () => content.removeEventListener('touchmove', preventContentScrollWhileDragging);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        return () => {
            resetSheetInteractionState();
        };
    }, [isOpen, resetSheetInteractionState]);

    useEffect(() => {
        if (!isOpen || showBackdrop || !closeOnOutsidePointerDown) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (sheetRef.current?.contains(target)) return;
            onClose();
        };

        document.addEventListener('pointerdown', handleOutsidePointerDown, true);
        return () => {
            document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
        };
    }, [closeOnOutsidePointerDown, isOpen, onClose, showBackdrop]);

    if (!isOpen) return null;

    const currentMaxHeight = Math.max(minHeight, getCurrentMaxHeight());
    const isAtFullHeight = sheetHeight >= currentMaxHeight - SHEET_HALF_OPEN_TOLERANCE;

    // 동적 높이 스타일
    const heightStyle = {
        // [FIX] Safari/삼성 인터넷 100vh 버그 수정 - HomeMapContainer 방식 적용
        // bottom: 0 고정 + height(px)로 직접 계산하여 가상 키보드 등 대응
        height: `${viewportHeightRef.current * sheetHeight / 100}px`,
        // 헤더 오프셋이 있는 경우 최대 높이 제한 (CSS로도 이중 안전장치)
        maxHeight: headerOffset > 0 ? `calc(100% - ${headerOffset}px)` : `${maxHeight}%`,
        transitionDuration: isDragging ? '0ms' : `${sheetSnapTransition.duration}ms`,
        transitionTimingFunction: isDragging ? undefined : sheetSnapTransition.easing,
    };

    return (
        <>
            {/* 배경 오버레이 */}
            {showBackdrop && (
                <div
                    className="fixed inset-0 z-[94] bg-black/30 transition-opacity duration-200"
                    role="button"
                    tabIndex={0}
                    aria-label="바텀시트 닫기"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) {
                            onClose();
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
                            event.preventDefault();
                            onClose();
                        }
                    }}
                />
            )}

            {/* 바텀시트 */}
            <div
                ref={sheetRef}
                className={cn(
                    'fixed bottom-0 left-0 right-0 z-[95]',
                    'bg-background shadow-xl',
                    isAtFullHeight ? 'rounded-none' : 'rounded-t-2xl',
                    'flex flex-col',
                    // 드래그 중에는 트랜지션 제거
                    isDragging ? '' : 'transition-[height,border-radius]',
                    className
                )}
                data-sheet-state={isAtFullHeight ? 'full' : 'partial'}
                style={{ ...heightStyle, touchAction: 'auto' }}
                onTouchStartCapture={handleSheetTouchStart}
                onTouchMoveCapture={handleSheetTouchMove}
                onTouchEndCapture={handleSheetTouchEnd}
                onTouchCancelCapture={handleSheetTouchEnd}
            >
                {/* 핸들 바 */}
                {showHandle && (!hideHandleWhenFull || !isAtFullHeight) && (
                    <div
                        ref={handleRef}
                        role="button"
                        tabIndex={0}
                        className={cn(
                            "flex-shrink-0 flex w-full justify-center py-1 bg-transparent cursor-grab active:cursor-grabbing select-none",
                            isAtFullHeight ? 'rounded-none' : 'rounded-t-2xl'
                        )}
                        style={{
                            touchAction: 'none',
                            WebkitTapHighlightColor: 'transparent',
                            backgroundColor: 'transparent',
                        }}
                        onMouseDown={handleMouseDown}
                        aria-label="바텀시트 높이 조절"
                    >
                        <div className="w-8 h-1 bg-muted-foreground/40 rounded-full" />
                    </div>
                )}

                {/* 콘텐츠 영역 */}
                <div
                    ref={contentRef}
                    className={cn(
                        "flex-1 overscroll-contain min-h-0 border-t border-border/50",
                        disableContentScroll ? "overflow-hidden" : "overflow-y-auto"
                    )}
                    style={{
                        touchAction: isDragging
                            ? 'none'
                            : (
                                enablePeek
                                    ? (sheetHeight <= defaultHeight + SHEET_HALF_OPEN_TOLERANCE ? 'none' : 'pan-y')
                                    : (sheetHeight <= minHeight + SHEET_HALF_OPEN_TOLERANCE ? 'none' : 'pan-y')
                            ),
                        overflowY: isDragging ? 'hidden' : undefined,
                        WebkitOverflowScrolling: 'touch',
                        paddingBottom: `calc(env(safe-area-inset-bottom) + ${bottomNavOffset}px)`
                    }}
                >
                    {children}
                </div>
            </div>
        </>
    );
}

export const BottomSheet = memo(BottomSheetComponent);
BottomSheet.displayName = 'BottomSheet';
