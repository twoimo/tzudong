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
                ? "fixed inset-0 z-50 h-[var(--full-height,100vh)] w-screen"
                : "w-full h-full flex-1",
            className
        )}>
            <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 max-w-sm space-y-4 px-4 text-center">
                <div
                    className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary motion-reduce:animate-none"
                    aria-hidden="true"
                />
                <div className="space-y-2 break-keep">
                    <h2 className="text-base font-semibold text-foreground">
                        {message}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        {subMessage}
                    </p>
                </div>
            </div>
        </div>
    );
}

// [최적화] React.memo로 리렌더링 방지
export const GlobalLoader = memo(GlobalLoaderComponent);
GlobalLoader.displayName = "GlobalLoader";
