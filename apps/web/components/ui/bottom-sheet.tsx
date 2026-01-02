'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    snapPoints?: number[]; // 백분율 [30, 50, 75, 85]
    defaultSnap?: number;
    showHandle?: boolean;
    showCloseButton?: boolean;
    className?: string;
    closeThreshold?: number; // 닫기 임계값 (기본 15%)
}

/**
 * 드래그 가능한 바텀시트 컴포넌트
 * 모바일/태블릿 환경에서 하단에서 올라오는 패널을 구현합니다.
 */
export function BottomSheet({
    isOpen,
    onClose,
    children,
    snapPoints = [30, 50, 75, 85],
    defaultSnap = 75,
    showHandle = true,
    showCloseButton = true,
    className,
    closeThreshold = 15,
}: BottomSheetProps) {
    const [height, setHeight] = useState(defaultSnap);
    const [isDragging, setIsDragging] = useState(false);
    const [startY, setStartY] = useState(0);
    const [startHeight, setStartHeight] = useState(defaultSnap);

    // 드래그 핸들 ref
    const handleRef = useRef<HTMLDivElement>(null);
    // 드래그 속도 측정용 ref
    const lastYRef = useRef(0);
    const lastTimeRef = useRef(0);
    const velocityRef = useRef(0);

    // 드래그 시작
    const handleDragStart = useCallback((e: React.TouchEvent) => {
        setIsDragging(true);
        const touchY = e.touches[0].clientY;
        setStartY(touchY);
        setStartHeight(height);
        lastYRef.current = touchY;
        lastTimeRef.current = Date.now();
        velocityRef.current = 0;
    }, [height]);

    // 드래그 중 - 더 자유로운 드래그 (닫기 임계값까지 허용)
    const handleDragMove = useCallback((e: React.TouchEvent) => {
        if (!isDragging) return;

        const currentY = e.touches[0].clientY;
        const currentTime = Date.now();

        // 속도 계산 (양수면 아래로 드래그)
        const deltaTime = currentTime - lastTimeRef.current;
        if (deltaTime > 0) {
            velocityRef.current = (currentY - lastYRef.current) / deltaTime;
        }
        lastYRef.current = currentY;
        lastTimeRef.current = currentTime;

        requestAnimationFrame(() => {
            const deltaY = startY - currentY;
            const viewportHeight = window.innerHeight;
            const deltaPercent = (deltaY / viewportHeight) * 100;

            let newHeight = startHeight + deltaPercent;
            // 최소 5%까지 드래그 가능 (닫기 영역), 최대는 snapPoints의 최대값
            const maxSnap = Math.max(...snapPoints);
            newHeight = Math.max(5, Math.min(maxSnap + 5, newHeight));

            setHeight(newHeight);
        });
    }, [isDragging, startY, startHeight, snapPoints]);

    // 드래그 종료 - 속도 기반 스와이프 닫기 또는 스냅
    const handleDragEnd = useCallback(() => {
        setIsDragging(false);

        // 빠르게 아래로 스와이프 (velocity > 0.5px/ms) 하면 닫기
        if (velocityRef.current > 0.5) {
            onClose();
            return;
        }

        // 닫기 임계값 이하면 닫기
        if (height <= closeThreshold) {
            onClose();
            return;
        }

        // 가장 가까운 snap point로 이동
        const closest = snapPoints.reduce((prev, curr) =>
            Math.abs(curr - height) < Math.abs(prev - height) ? curr : prev
        );

        setHeight(closest);
    }, [height, snapPoints, closeThreshold, onClose]);

    // isOpen이 변경되면 기본 높이로 리셋
    useEffect(() => {
        if (isOpen) {
            setHeight(defaultSnap);
        }
    }, [isOpen, defaultSnap]);

    // ESC 키로 닫기
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Pull-to-Refresh 방지: 바텀시트가 열려있을 때 body에 overscroll-behavior 적용
    useEffect(() => {
        if (isOpen) {
            document.body.style.overscrollBehavior = 'contain';
            document.documentElement.style.overscrollBehavior = 'contain';
        }
        return () => {
            document.body.style.overscrollBehavior = '';
            document.documentElement.style.overscrollBehavior = '';
        };
    }, [isOpen]);

    // 드래그 핸들에서 Pull-to-Refresh 방지 (passive: false 필요)
    useEffect(() => {
        const handle = handleRef.current;
        if (!handle || !isOpen) return;

        const preventPullToRefresh = (e: TouchEvent) => {
            // 핸들 위에서 터치 중일 때 항상 기본 동작 방지
            e.preventDefault();
        };

        // passive: false로 등록해야 preventDefault 가능
        handle.addEventListener('touchmove', preventPullToRefresh, { passive: false });

        return () => {
            handle.removeEventListener('touchmove', preventPullToRefresh);
        };
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
                className={cn(
                    'fixed bottom-0 left-0 right-0 z-50',
                    'bg-background rounded-t-2xl shadow-xl',
                    'flex flex-col',
                    // 드래그 중에는 트랜지션 완전 제거, 드래그 종료 시 부드러운 스프링 효과
                    isDragging ? '' : 'transition-[height] duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]',
                    className
                )}
                style={{
                    height: `${height}vh`,
                    willChange: isDragging ? 'height' : 'auto',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* 핸들 바 - 드래그 가능, touch-action: none으로 Pull-to-Refresh 방지 */}
                {showHandle && (
                    <div
                        ref={handleRef}
                        className="flex-shrink-0 flex justify-center py-4 bg-background cursor-grab active:cursor-grabbing"
                        style={{ touchAction: 'none' }}
                        onTouchStart={handleDragStart}
                        onTouchMove={handleDragMove}
                        onTouchEnd={handleDragEnd}
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
                        const scrollContainer = e.currentTarget;
                        // 스크롤이 가능한 경우에만 이벤트 전파 방지
                        if (scrollContainer.scrollHeight > scrollContainer.clientHeight) {
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
