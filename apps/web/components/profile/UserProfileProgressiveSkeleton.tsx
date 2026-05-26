import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type UserProfileProgressiveSkeletonProps = {
    label?: string;
    showCloseButton?: boolean;
    onBack?: () => void;
};

export function UserProfileProgressiveSkeleton({
    label = "사용자 프로필을 불러오는 중",
    showCloseButton = false,
    onBack,
}: UserProfileProgressiveSkeletonProps) {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            aria-label={label}
            className="flex h-full min-h-[calc(100vh-4rem)] flex-col bg-background"
            data-user-profile-panel-skeleton="true"
            data-user-profile-route-skeleton="true"
        >
            <div className="border-b border-border/70 bg-gradient-to-br from-background via-background to-muted/35 p-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                        <div className="min-w-0 space-y-2">
                            <Skeleton className="h-5 w-32 rounded-full" />
                            <Skeleton className="h-3 w-44 max-w-full rounded-full" />
                        </div>
                    </div>
                    {showCloseButton && onBack && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onBack}
                            className="h-10 w-10 shrink-0 rounded-full"
                            aria-label="프로필 패널 닫기"
                        >
                            <X className="h-5 w-5" aria-hidden="true" />
                        </Button>
                    )}
                </div>
                <div className="mt-4 grid w-full grid-cols-3 gap-2">
                    {[0, 1, 2].map((item) => (
                        <div key={item} className="rounded-xl border border-border/60 bg-card/80 px-2.5 py-2.5">
                            <Skeleton className="h-3 w-12 rounded-full" />
                            <Skeleton className="mt-2 h-5 w-10 rounded-full" />
                        </div>
                    ))}
                </div>
            </div>
            <div className="border-b border-border/70 bg-background px-3 py-2">
                <div className="grid w-full grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1">
                    {[0, 1, 2].map((item) => (
                        <Skeleton key={item} className="h-10 rounded-lg" />
                    ))}
                </div>
            </div>
            <UserProfileTabSkeleton label="프로필 활동 로딩 중" live={false} />
        </div>
    );
}

export function UserProfileTabSkeleton({ label, live = true }: { label: string; live?: boolean }) {
    return (
        <div
            role={live ? "status" : undefined}
            aria-live={live ? "polite" : undefined}
            aria-label={live ? label : undefined}
            aria-hidden={live ? undefined : true}
            className="space-y-3 p-4"
            data-user-profile-tab-skeleton="true"
        >
            {[0, 1, 2].map((item) => (
                <div key={item} className="rounded-xl border border-border bg-card/80 p-3 shadow-sm">
                    <Skeleton className="h-4 w-2/3 rounded" />
                    <Skeleton className="mt-2 h-3 w-full rounded" />
                    <Skeleton className="mt-2 h-3 w-1/2 rounded" />
                </div>
            ))}
        </div>
    );
}
