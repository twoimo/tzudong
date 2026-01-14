import { memo } from "react";
import { cn } from "@/lib/utils";

interface GlobalLoaderProps {
    message?: string;
    subMessage?: string;
    className?: string;
    fullScreen?: boolean;
}

function GlobalLoaderComponent({
    message = "로딩 중...",
    subMessage = "잠시만 기다려주세요",
    className,
    fullScreen = false
}: GlobalLoaderProps) {
    return (
        <div className={cn(
            "flex items-center justify-center bg-background",
            fullScreen
                ? "fixed inset-0 z-50 h-screen w-screen"
                : "w-full h-full flex-1",
            className
        )}>
            <div className="text-center space-y-6">
                <div className="relative">
                    <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary/20 border-t-primary mx-auto"></div>
                    <div className="absolute inset-0 rounded-full border-4 border-transparent border-r-secondary animate-spin mx-auto h-16 w-16" style={{ animationDuration: '1.5s' }}></div>
                </div>
                <div className="space-y-3">
                    <h2 className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                        {message}
                    </h2>
                    <p className="text-muted-foreground">
                        {subMessage}
                    </p>
                    <div className="flex justify-center space-x-1">
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// [최적화] React.memo로 리렌더링 방지
export const GlobalLoader = memo(GlobalLoaderComponent);
GlobalLoader.displayName = "GlobalLoader";
