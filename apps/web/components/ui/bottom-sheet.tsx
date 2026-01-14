'use client';

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    defaultHeight?: number;
    minHeight?: number;
    maxHeight?: number;
    showHandle?: boolean;
    showCloseButton?: boolean;
    className?: string;
    closeThreshold?: number;
}

/**
 * 드래그 가능한 바텀시트 컴포넌트
 * [OPTIMIZED] Ref 기반 드래그로 리렌더링 최소화
 */
function BottomSheetComponent({
    isOpen,
    onClose,
    children,
    defaultHeight = 75,
    minHeight = 15,
    maxHeight = 90,
    showHandle = true,
    showCloseButton = true,
    className,
    closeThreshold = 15,
}: BottomSheetProps) {
    // [OPTIMIZATION] 렌더링에 필요한 상태만 useState
    const [height, setHeight] = useState(defaultHeight);
    const [isDragging, setIsDragging] = useState(false);

    // [OPTIMIZATION] 드래그 로직용 Ref (리렌더링 없음)
    const handleRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<HTMLDivElement>(null);
    const startYRef = useRef(0);
    const startHeightRef = useRef(defaultHeight);
    const lastYRef = useRef(0);
    const lastTimeRef = useRef(0);
    const velocityRef = useRef(0);
    const isDraggingRef = useRef(false);
    const rafIdRef = useRef<number>(0);

    // [OPTIMIZATION] 드래그 시작 공통 로직
    const handleDragStartCore = useCallback((clientY: number) => {
        isDraggingRef.current = true;
        startYRef.current = clientY;
        startHeightRef.current = height;
        lastYRef.current = clientY;
        lastTimeRef.current = Date.now();
        velocityRef.current = 0;
        setIsDragging(true);
    }, [height]);

    // 터치 드래그 시작
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        handleDragStartCore(e.touches[0].clientY);
    }, [handleDragStartCore]);

    // 마우스 드래그 시작
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        handleDragStartCore(e.clientY);
    }, [handleDragStartCore]);

    // [OPTIMIZATION] 드래그 이동 공통 로직 - RAF 기반
    const handleMoveCore = useCallback((currentY: number) => {
        if (!isDraggingRef.current) return;

        const currentTime = Date.now();
        const deltaTime = currentTime - lastTimeRef.current;

        if (deltaTime > 0) {
            velocityRef.current = (currentY - lastYRef.current) / deltaTime;
        }
        lastYRef.current = currentY;
        lastTimeRef.current = currentTime;

        // [OPTIMIZATION] 이전 RAF 취소
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
        }

        rafIdRef.current = requestAnimationFrame(() => {
            const deltaY = startYRef.current - currentY;
            const viewportHeight = window.innerHeight;
            const deltaPercent = (deltaY / viewportHeight) * 100;

            let newHeight = startHeightRef.current + deltaPercent;
            newHeight = Math.max(5, Math.min(maxHeight, newHeight));

            setHeight(newHeight);
        });
    }, [maxHeight]);

    // 터치 드래그 중
    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        handleMoveCore(e.touches[0].clientY);
    }, [handleMoveCore]);

    // [OPTIMIZATION] 드래그 종료 - 클로저 문제 회피
    const handleDragEnd = useCallback(() => {
        isDraggingRef.current = false;
        setIsDragging(false);

        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = 0;
        }

        // 빠른 스와이프로 닫기
        if (velocityRef.current > 0.5) {
            onClose();
            return;
        }

        // 현재 높이 기반 판단
        setHeight(currentHeight => {
            if (currentHeight <= closeThreshold) {
                queueMicrotask(onClose);
                return currentHeight;
            }
            return currentHeight < minHeight ? minHeight : currentHeight;
        });
    }, [closeThreshold, minHeight, onClose]);

    // [OPTIMIZATION] 마우스 이벤트 - window에 등록
    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            handleMoveCore(e.clientY);
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
    }, [isDragging, handleMoveCore, handleDragEnd]);

    // isOpen 변경 시 높이 리셋
    useEffect(() => {
        if (isOpen) {
            setHeight(defaultHeight);
        }
    }, [isOpen, defaultHeight]);

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

    // 드래그 핸들 Pull-to-Refresh 방지
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
                    isDragging ? '' : 'transition-[height] duration-150 ease-out',
                    className
                )}
                style={{
                    height: `${height}vh`,
                    willChange: isDragging ? 'height' : 'auto',
                }}
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
                        onTouchEnd={handleDragEnd}
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
                    className="flex-1 overflow-y-auto overscroll-contain min-h-0 border-t border-border/50"
                    style={{
                        WebkitOverflowScrolling: 'touch',
                        paddingBottom: 'env(safe-area-inset-bottom)'
                    }}
                    onTouchStart={(e) => {
                        if (e.currentTarget.scrollHeight > e.currentTarget.clientHeight) {
                            e.stopPropagation();
                        }
                    }}
                    onTouchMove={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                >
                    {children}
                </div>
            </div>
        </>
    );
}

// [OPTIMIZATION] memo로 불필요한 리렌더링 방지
export const BottomSheet = memo(BottomSheetComponent);
BottomSheet.displayName = 'BottomSheet';
