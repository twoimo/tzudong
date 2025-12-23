'use client';

import { useRef, useState, useEffect, ReactNode, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScrollableTagContainerProps {
    children: ReactNode;
    className?: string;
    maxWidth?: string;
}

export function ScrollableTagContainer({ children, className, maxWidth = '200px' }: ScrollableTagContainerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [showLeftArrow, setShowLeftArrow] = useState(false);
    const [showRightArrow, setShowRightArrow] = useState(false);

    const checkScrollPosition = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const { scrollLeft, scrollWidth, clientWidth } = container;
        const hasOverflow = scrollWidth > clientWidth;

        setShowLeftArrow(scrollLeft > 1);
        setShowRightArrow(hasOverflow && scrollLeft + clientWidth < scrollWidth - 1);
    }, []);

    useEffect(() => {
        // 약간의 딜레이 후 체크 (렌더링 완료 대기)
        const timer = setTimeout(checkScrollPosition, 100);

        const container = containerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver(() => {
            setTimeout(checkScrollPosition, 50);
        });
        resizeObserver.observe(container);

        return () => {
            clearTimeout(timer);
            resizeObserver.disconnect();
        };
    }, [checkScrollPosition]);

    useEffect(() => {
        // children 변경 시 스크롤 위치 재확인
        const timer = setTimeout(checkScrollPosition, 100);
        return () => clearTimeout(timer);
    }, [children, checkScrollPosition]);

    const scroll = (direction: 'left' | 'right') => {
        const container = containerRef.current;
        if (!container) return;

        const scrollAmount = 100;
        const targetScroll = direction === 'left'
            ? container.scrollLeft - scrollAmount
            : container.scrollLeft + scrollAmount;

        container.scrollTo({
            left: targetScroll,
            behavior: 'smooth'
        });

        // 스크롤 후 상태 업데이트
        setTimeout(checkScrollPosition, 150);
    };

    return (
        <div
            ref={wrapperRef}
            className={cn("relative flex items-center", className)}
            style={{ maxWidth }}
        >
            {/* 왼쪽 화살표 */}
            {showLeftArrow && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        scroll('left');
                    }}
                    className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-5 h-5 flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-full shadow-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                    aria-label="왼쪽으로 스크롤"
                >
                    <ChevronLeft className="h-3 w-3 text-gray-600 dark:text-gray-300" />
                </button>
            )}

            {/* 태그 컨테이너 */}
            <div
                ref={containerRef}
                onScroll={checkScrollPosition}
                className={cn(
                    "flex gap-1 overflow-x-auto scrollbar-hide scroll-smooth",
                    showLeftArrow && "ml-5",
                    showRightArrow && "mr-5"
                )}
                style={{ maxWidth: '100%' }}
            >
                {children}
            </div>

            {/* 오른쪽 화살표 */}
            {showRightArrow && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        scroll('right');
                    }}
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-5 h-5 flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-full shadow-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                    aria-label="오른쪽으로 스크롤"
                >
                    <ChevronRight className="h-3 w-3 text-gray-600 dark:text-gray-300" />
                </button>
            )}
        </div>
    );
}
