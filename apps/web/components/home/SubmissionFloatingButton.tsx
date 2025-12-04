'use client';

import { memo } from 'react';
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    // 사이드바 너비에 따라 left 위치 조정
    // 열려있을 때: 256px(w-64) + 16px(여백) = 272px
    // 닫혀있을 때: 64px(w-16) + 16px(여백) = 80px
    const leftPosition = isSidebarOpen ? 'left-[272px]' : 'left-[80px]';

    return (
        <Button
            onClick={onClick}
            className={cn(
                "fixed bottom-6 z-50",
                leftPosition,
                "h-14 w-14 rounded-full shadow-xl",
                "bg-red-800 hover:bg-red-900 text-white",
                "transition-all duration-300 ease-in-out",
                "hover:scale-110 active:scale-95",
                "flex items-center justify-center",
                "border-2 border-stone-200/20",
                className
            )}
            title="맛집 제보하기"
        >
            <Send className="h-6 w-6" />
        </Button>
    );
});

export default SubmissionFloatingButton;
