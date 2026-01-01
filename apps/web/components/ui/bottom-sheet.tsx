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
}: BottomSheetProps) {
    const [height, setHeight] = useState(defaultSnap);
    const [isDragging, setIsDragging] = useState(false);
    const [startY, setStartY] = useState(0);
    const [startHeight, setStartHeight] = useState(defaultSnap);

    // 드래그 시작
    const handleDragStart = useCallback((e: React.TouchEvent) => {
        setIsDragging(true);
        setStartY(e.touches[0].clientY);
        setStartHeight(height);
    }, [height]);

    // 드래그 중
    const handleDragMove = useCallback((e: React.TouchEvent) => {
        if (!isDragging) return;

        requestAnimationFrame(() => {
            const deltaY = startY - e.touches[0].clientY;
            const viewportHeight = window.innerHeight;
            const deltaPercent = (deltaY / viewportHeight) * 100;

            let newHeight = startHeight + deltaPercent;
            // 최소값과 최대값 제한
            const minSnap = Math.min(...snapPoints);
            const maxSnap = Math.max(...snapPoints);
            newHeight = Math.max(minSnap, Math.min(maxSnap, newHeight));

            setHeight(newHeight);
        });
    }, [isDragging, startY, startHeight, snapPoints]);

    // 드래그 종료 - 가장 가까운 snap point로 이동
    const handleDragEnd = useCallback(() => {
        setIsDragging(false);

        const closest = snapPoints.reduce((prev, curr) =>
            Math.abs(curr - height) < Math.abs(prev - height) ? curr : prev
        );

        setHeight(closest);
    }, [height, snapPoints]);

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

    if (!isOpen) return null;

    return (
        <>
            {/* 배경 오버레이 */}
            <div
                className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* 바텀시트 */}
            <div
                className={cn(
                    'fixed bottom-0 left-0 right-0 z-50',
                    'bg-background rounded-t-2xl shadow-xl',
                    'transition-all duration-150',
                    isDragging ? '' : 'ease-out',
                    'flex flex-col',
                    className
                )}
                style={{ height: `${height}vh` }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* 핸들 바 - 드래그 가능 */}
                {showHandle && (
                    <div
                        className="flex-shrink-0 flex justify-center py-3 bg-background cursor-grab active:cursor-grabbing border-b border-border/50"
                        onTouchStart={handleDragStart}
                        onTouchMove={handleDragMove}
                        onTouchEnd={handleDragEnd}
                    >
                        <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
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
                    className="flex-1 overflow-y-auto overscroll-contain min-h-0"
                    style={{
                        WebkitOverflowScrolling: 'touch',
                        paddingBottom: 'env(safe-area-inset-bottom)'
                    }}
                    onTouchStart={(e) => {
                        const target = e.target as HTMLElement;
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
