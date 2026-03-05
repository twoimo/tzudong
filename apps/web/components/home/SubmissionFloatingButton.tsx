'use client';

import { memo } from 'react';
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDeviceType } from "@/hooks/useDeviceType";
import { useHydration } from "@/hooks/useHydration";

interface SubmissionFloatingButtonProps {
    onClick: () => void;
    isSidebarOpen: boolean;
    className?: string;
}

// [OPTIMIZATION] React.memo로 불필요한 리렌더링 방지
const SubmissionFloatingButton = memo(function SubmissionFloatingButton({
    onClick,
    isSidebarOpen,
    className
}: SubmissionFloatingButtonProps) {
    const { isMobileOrTablet } = useDeviceType();
    const isHydrated = useHydration();
    void isSidebarOpen;

    return (
        <Button
            type="button"
            onClick={onClick}
            aria-label="맛집 제보하기"
            className={cn(
                "fixed z-50",
                // 모바일/태블릿: 우측 하단 (검색 버튼 위)
                // 검색 버튼: bottom-20(80px) + h-12(48px) = top at 128px
                // 제보 버튼: bottom-36(144px) -> 16px 간격
                // 데스크탑: 우측 하단 고정
                isMobileOrTablet ? "right-4 bottom-36" : "right-6 bottom-6",
                // [Mobile] 돋보기 아이콘과 동일한 크기 (h-12 w-12)
                isMobileOrTablet ? "h-12 w-12" : "h-14 w-14",
                "rounded-full shadow-xl",
                "bg-red-800 hover:bg-red-900 text-white",
                "transition-all duration-300 ease-in-out",
                "hover:scale-110 active:scale-95",
                "flex items-center justify-center",
                "border-2 border-border/20",
                // Hydration 깜빡임 방지
                isHydrated ? "opacity-100" : "opacity-0",
                className
            )}
            title="맛집 제보하기"
        >
            <Send className="h-6 w-6" />
        </Button>
    );
});

export default SubmissionFloatingButton;
