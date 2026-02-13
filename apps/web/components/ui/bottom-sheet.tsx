'use client';

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    defaultHeight?: number; // Percent
    minHeight?: number;    // Percent
    maxHeight?: number;    // Percent
    showHandle?: boolean;
    showCloseButton?: boolean;
    className?: string;
    closeThreshold?: number; // Percent
    disableContentScroll?: boolean;
    headerOffset?: number;   // Pixels (e.g., 80px for header + spacing)
    bottomNavOffset?: number; // Pixels (e.g., 56px for bottom nav)
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

/**
 * 드래그 가능한 바텀시트 컴포넌트
 * [OPTIMIZED] HomeMapContainer의 고성능 로직 이식 (visualViewport, Physics, RAF)
 */
function BottomSheetComponent({
    isOpen,
    onClose,
    children,
    defaultHeight = 75,
    minHeight = 20,
    maxHeight = 100,
    showHandle = true,
    showCloseButton = true,
    className,
    closeThreshold = 15,
    disableContentScroll = false,
    headerOffset = 0,
    bottomNavOffset = 0,
}: BottomSheetProps) {
    // [PERFORMANCE] 렌더링에 필요한 상태만 useState로 관리
    const [sheetHeight, setSheetHeight] = useState(defaultHeight);
    const [isDragging, setIsDragging] = useState(false);

    // [PERFORMANCE] 드래그 중 리렌더링 제거 - Ref로 관리
    const viewportHeightRef = useRef(typeof window !== 'undefined'
        ? (window.visualViewport?.height ?? window.innerHeight)
        : 800
    );

    // Constants matching HomeMapContainer
    const MIN_DRAG_HEIGHT = 5;
    const MIN_SHEET_HEIGHT = minHeight;
    const SWIPE_VELOCITY_THRESHOLD = 0.5;
    const CONTENT_TOP_EPSILON = 2;
    const CONTENT_DRAG_START_THRESHOLD = 16;
    const CONTENT_VERTICAL_INTENT_RATIO = 1.2;

    const isDraggingRef = useRef(false);
    const startYRef = useRef(0);
    const startHeightRef = useRef(defaultHeight);
    const lastYRef = useRef(0);
    const lastTimeRef = useRef(0);
    const velocityRef = useRef(0);
    const sheetRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const rafIdRef = useRef<number>(0);
    const contentTouchStartYRef = useRef(0);
    const contentTouchStartXRef = useRef(0);
    const isContentDraggingSheetRef = useRef(false);
    const contentStartBoundaryRef = useRef<'top' | null>(null);
    const contentScrollTargetRef = useRef<HTMLElement | null>(null);

    const getCurrentMaxHeight = useCallback((vh: number = viewportHeightRef.current) => {
        return headerOffset > 0
            ? ((vh - headerOffset) / vh) * 100
            : maxHeight;
    }, [headerOffset, maxHeight]);

    const getContentSnapPoints = useCallback(() => {
        const minSnap = MIN_SHEET_HEIGHT;
        const maxSnap = Math.max(minSnap, getCurrentMaxHeight());
        const midSnap = minSnap + ((maxSnap - minSnap) / 2);
        return [minSnap, midSnap, maxSnap];
    }, [MIN_SHEET_HEIGHT, getCurrentMaxHeight]);

    const getNearestSnapHeight = useCallback((currentHeight: number) => {
        const snapPoints = getContentSnapPoints();
        return snapPoints.reduce((closest, snap) =>
            Math.abs(snap - currentHeight) < Math.abs(closest - currentHeight) ? snap : closest
        , snapPoints[0]);
    }, [getContentSnapPoints]);

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
                    setSheetHeight(prev => Math.min(prev, getCurrentMaxHeight(viewport.height)));
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
    }, [isOpen, getCurrentMaxHeight]);

    // 패널이 열릴 때 초기화
    useEffect(() => {
        if (isOpen) {
            // 헤더 오프셋이 있는 경우 최대 높이 계산하여 초기화
            if (headerOffset > 0 && typeof window !== 'undefined' && window.visualViewport) {
                const vh = window.visualViewport.height;
                const calculatedMax = ((vh - headerOffset) / vh) * 100;
                setSheetHeight(Math.min(defaultHeight, calculatedMax));
            } else {
                setSheetHeight(defaultHeight);
            }
        }
    }, [isOpen, defaultHeight, headerOffset]);

    // [PERFORMANCE] 드래그 시작 공통 로직
    const handleDragStartCore = useCallback((clientY: number) => {
        isDraggingRef.current = true;
        startYRef.current = clientY;
        startHeightRef.current = sheetHeight;
        lastYRef.current = clientY;
        lastTimeRef.current = Date.now();
        velocityRef.current = 0;
        setIsDragging(true);
    }, [sheetHeight]);

    // 터치 드래그 시작
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        handleDragStartCore(e.touches[0].clientY);
    }, [handleDragStartCore]);

    // 마우스 드래그 시작
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        handleDragStartCore(e.clientY);
    }, [handleDragStartCore]);

    // [PERFORMANCE] 드래그 중 공통 로직 - RAF 기반 최적화
    const handleDragMoveCore = useCallback((currentY: number) => {
        if (!isDraggingRef.current) return;

        const currentTime = Date.now();
        const deltaTime = currentTime - lastTimeRef.current;

        if (deltaTime > 0) {
            velocityRef.current = (currentY - lastYRef.current) / deltaTime;
        }
        lastYRef.current = currentY;
        lastTimeRef.current = currentTime;

        // [PERFORMANCE] 이전 RAF 취소
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
        }

        rafIdRef.current = requestAnimationFrame(() => {
            const deltaY = startYRef.current - currentY;
            const vh = viewportHeightRef.current;
            const deltaPercent = (deltaY / vh) * 100;

            // 최대 높이 동적 계산 (헤더 오프셋 고려)
            const currentMaxHeight = getCurrentMaxHeight(vh);

            let newHeight = startHeightRef.current + deltaPercent;
            newHeight = Math.max(MIN_DRAG_HEIGHT, Math.min(currentMaxHeight, newHeight));

            setSheetHeight(newHeight);
        });
    }, [getCurrentMaxHeight]);

    // 터치 드래그 중
    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        handleDragMoveCore(e.touches[0].clientY);
    }, [handleDragMoveCore]);

    // [PERFORMANCE] 드래그 종료
    const handleDragEnd = useCallback((source: 'handle' | 'content' = 'handle') => {
        isDraggingRef.current = false;
        setIsDragging(false);

        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = 0;
        }

        // 빠른 스와이프로 닫기
        if (source === 'handle' && velocityRef.current > SWIPE_VELOCITY_THRESHOLD) {
            onClose();
            return;
        }

        // 현재 높이 기반 판단
        setSheetHeight(currentHeight => {
            if (source === 'content') {
                return getNearestSnapHeight(currentHeight);
            }
            if (currentHeight <= closeThreshold) {
                queueMicrotask(onClose);
                return currentHeight;
            }
            return currentHeight < MIN_SHEET_HEIGHT ? MIN_SHEET_HEIGHT : currentHeight;
        });
    }, [onClose, closeThreshold, MIN_SHEET_HEIGHT, getNearestSnapHeight]);

    const handleContentTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        contentTouchStartYRef.current = e.touches[0].clientY;
        contentTouchStartXRef.current = e.touches[0].clientX;
        isContentDraggingSheetRef.current = false;
        const scrollTarget = findScrollableTouchTarget(e.target, e.currentTarget);
        contentScrollTargetRef.current = scrollTarget;
        const scrollTop = scrollTarget ? scrollTarget.scrollTop : e.currentTarget.scrollTop;
        const isAtTop = scrollTop <= CONTENT_TOP_EPSILON;
        contentStartBoundaryRef.current = isAtTop ? 'top' : null;
    }, []);

    const handleContentTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        const currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const deltaY = currentY - contentTouchStartYRef.current;
        const deltaX = currentX - contentTouchStartXRef.current;
        const absDeltaY = Math.abs(deltaY);
        const absDeltaX = Math.abs(deltaX);
        const scrollTarget = contentScrollTargetRef.current ?? findScrollableTouchTarget(e.target, e.currentTarget);
        if (!contentScrollTargetRef.current) {
            contentScrollTargetRef.current = scrollTarget;
        }

        if (!isContentDraggingSheetRef.current) {
            const canStartContentDrag = (
                contentStartBoundaryRef.current === 'top' &&
                absDeltaY > CONTENT_DRAG_START_THRESHOLD &&
                absDeltaY > absDeltaX * CONTENT_VERTICAL_INTENT_RATIO
            );
            if (!canStartContentDrag) return;

            handleDragStartCore(contentTouchStartYRef.current);
            isContentDraggingSheetRef.current = true;
        }

        e.stopPropagation();
        handleDragMoveCore(currentY);
    }, [
        CONTENT_DRAG_START_THRESHOLD,
        CONTENT_VERTICAL_INTENT_RATIO,
        handleDragMoveCore,
        handleDragStartCore
    ]);

    const handleContentTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isContentDraggingSheetRef.current) {
            contentScrollTargetRef.current = null;
            contentStartBoundaryRef.current = null;
            return;
        }
        e.stopPropagation();
        isContentDraggingSheetRef.current = false;
        contentScrollTargetRef.current = null;
        contentStartBoundaryRef.current = null;
        handleDragEnd('content');
    }, [handleDragEnd]);

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
            e.preventDefault();
        };

        handle.addEventListener('touchmove', preventPullToRefresh, { passive: false });
        return () => handle.removeEventListener('touchmove', preventPullToRefresh);
    }, [isOpen]);

    if (!isOpen) return null;

    // 동적 높이 스타일
    const heightStyle = {
        // [FIX] Safari/삼성 인터넷 100vh 버그 수정 - HomeMapContainer 방식 적용
        // bottom: 0 고정 + height(px)로 직접 계산하여 가상 키보드 등 대응
        height: `${viewportHeightRef.current * sheetHeight / 100}px`,
        // 헤더 오프셋이 있는 경우 최대 높이 제한 (CSS로도 이중 안전장치)
        maxHeight: headerOffset > 0 ? `calc(100% - ${headerOffset}px)` : `${maxHeight}%`,
        transitionTimingFunction: isDragging ? undefined : 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    };

    return (
        <>
            {/* 배경 오버레이 */}
            <div
                className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm transition-opacity duration-200"
                onClick={onClose}
            />

            {/* 바텀시트 */}
            <div
                ref={sheetRef}
                className={cn(
                    'fixed bottom-0 left-0 right-0 z-50',
                    'bg-background rounded-t-2xl shadow-xl',
                    'flex flex-col',
                    // 드래그 중에는 트랜지션 제거
                    isDragging ? '' : 'transition-[height] duration-300',
                    className
                )}
                style={heightStyle}
                onClick={(e) => e.stopPropagation()}
            >
                {/* 핸들 바 */}
                {showHandle && (
                    <div
                        ref={handleRef}
                        className="flex-shrink-0 flex justify-center py-4 bg-background cursor-grab active:cursor-grabbing select-none rounded-t-2xl"
                        style={{ touchAction: 'none' }}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={() => handleDragEnd('handle')}
                        onTouchCancel={() => handleDragEnd('handle')}
                        onMouseDown={handleMouseDown}
                    >
                        <div className="w-12 h-1.5 bg-muted-foreground/40 rounded-full" />
                    </div>
                )}

                {/* 닫기 버튼 */}
                {showCloseButton && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="absolute right-2 top-2 z-30 h-8 w-8"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                )}

                {/* 콘텐츠 영역 */}
                <div
                    ref={contentRef}
                    className={cn(
                        "flex-1 overscroll-contain min-h-0 border-t border-border/50",
                        disableContentScroll ? "overflow-hidden" : "overflow-y-auto"
                    )}
                    style={{
                        WebkitOverflowScrolling: 'touch',
                        paddingBottom: `calc(env(safe-area-inset-bottom) + ${bottomNavOffset}px)`
                    }}
                    onTouchStart={handleContentTouchStart}
                    onTouchMove={handleContentTouchMove}
                    onTouchEnd={handleContentTouchEnd}
                    onTouchCancel={handleContentTouchEnd}
                >
                    {children}
                </div>
            </div>
        </>
    );
}

export const BottomSheet = memo(BottomSheetComponent);
BottomSheet.displayName = 'BottomSheet';
