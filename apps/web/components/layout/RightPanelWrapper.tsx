'use client';

import { ReactNode } from 'react';

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
            className={`fixed top-16 right-0 h-[calc(100vh-64px)] z-50 shadow-xl bg-background transition-all duration-300 ease-in-out ${isCollapsed ? 'w-0' : 'w-[400px]'}`}
            style={{ overflow: 'visible' }}
        >
            <div className="h-full w-[400px] bg-background border-l border-border">
                {children}
            </div>
        </div>
    );
}
