'use client';

import { ReactNode } from 'react';
import { APP_HEADER_HEIGHT_VAR } from '@/lib/mobile-sheet-layout';

interface RightPanelWrapperProps {
    isOpen: boolean;
    isCollapsed: boolean;
    children: ReactNode;
}

/**
 * 우측 패널 공통 래퍼 컴포넌트
 * - 마이페이지, 제보관리, 리뷰관리 패널에서 공통으로 사용
 * - 일관된 스타일과 애니메이션 제공
 */
export default function RightPanelWrapper({ isOpen, isCollapsed, children }: RightPanelWrapperProps) {
    if (!isOpen) return null;

    return (
        <div
            className={`fixed right-0 z-50 shadow-xl bg-background transition-all duration-300 ease-in-out ${isCollapsed ? 'w-0' : 'w-[min(400px,calc(100vw-1rem))]'}`}
            style={{
                top: `var(${APP_HEADER_HEIGHT_VAR}, 56px)`,
                height: `calc(100vh - var(${APP_HEADER_HEIGHT_VAR}, 56px))`,
                overflow: 'visible',
            }}
        >
            <div className="h-full w-[min(400px,calc(100vw-1rem))] bg-background border-l border-border">
                {children}
            </div>
        </div>
    );
}
