import { Skeleton } from "@/components/ui/skeleton";

export function ResetPasswordProgressiveSkeleton() {
    return (
        <div
            role="status"
            aria-live="polite"
            className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-muted/30 px-4 py-10"
            aria-busy="true"
            aria-label="비밀번호 재설정 화면을 준비하는 중"
            data-reset-password-progressive-skeleton="true"
        >
            <div className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-sm">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-6 w-32 rounded-lg" />
                        <Skeleton className="h-4 w-44 max-w-full rounded-full" />
                    </div>
                </div>
                <div className="mt-6 space-y-4">
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-24 rounded-full" />
                        <Skeleton className="h-11 w-full rounded-md" />
                    </div>
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-28 rounded-full" />
                        <Skeleton className="h-11 w-full rounded-md" />
                    </div>
                    <Skeleton className="h-11 w-full rounded-md" />
                    <Skeleton className="mx-auto h-3 w-2/3 rounded-full" />
                </div>
            </div>
        </div>
    );
}
