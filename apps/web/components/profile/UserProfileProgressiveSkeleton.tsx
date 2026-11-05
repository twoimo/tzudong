"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useFilledSkeletonCount } from "@/lib/use-filled-skeleton-count";
import { Button } from "@/components/ui/button";
import { LoadingSurface } from "@/components/ui/loading-surface";

type UserProfileProgressiveSkeletonProps = {
    label?: string;
    header?: ReactNode;
    showCloseButton?: boolean;
    onBack?: () => void;
};

export function UserProfileProgressiveSkeleton({
    label = "사용자 프로필을 불러오는 중",
    showCloseButton = false,
    onBack,
    header,
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

            {header}

            <div className="border-b border-border/70 bg-background p-4">

                <div className="flex items-center justify-between gap-3">

                    <LoadingSurface label={label} className="min-w-0 flex-1">

                        <div className="flex items-center gap-3">

                            <svg
                                viewBox="0 0 48 48"
                                role="img"
                                aria-label="프로필"
                                className="h-12 w-12 shrink-0 rounded-full border"
                            >

                                <circle cx="24" cy="24" r="24" fill="currentColor" opacity="0.1" />

                            </svg>

                            <div className="space-y-2">

                                <p className="text-base font-semibold">사용자 프로필</p>

                                <p className="text-xs">맛집 방문과 활동</p>

                            </div>

                        </div>

                    </LoadingSurface>

                    {
                        !header && showCloseButton && onBack && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onBack}
                                className="h-10 w-10 shrink-0 rounded-full"
                                aria-label="프로필 패널 닫기"
                            >

                                <X className="h-5 w-5" aria-hidden="true" />

                            </Button>
                        )
                    }

                </div>

                <LoadingSurface label={label} className="mt-4">

                    <div className="grid w-full grid-cols-3 gap-2">

                        {
                            ["리뷰", "도장", "좋아요"].map(item => (
                                <div key={item} className="rounded-xl border border-border/60 bg-card/80 px-2.5 py-2.5">

                                    <p className="text-xs">

                                        {item}

                                    </p>

                                    <p className="mt-2 text-lg font-semibold">00</p>

                                </div>
                            ))
                        }

                    </div>

                </LoadingSurface>

            </div>

            <div className="border-b border-border/70 bg-background px-3 py-2">

                <LoadingSurface label={label}>

                    <div className="grid w-full grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1">

                        {
                            ["도장", "리뷰", "좋아요"].map(item => (
                                <p key={item} className="flex h-10 items-center justify-center rounded-lg text-sm">

                                    {item}

                                </p>
                            ))
                        }

                    </div>

                </LoadingSurface>

            </div>

            <UserProfileTabSkeleton label="프로필 활동 로딩 중" live={false} />

        </div>
    );
}

export function UserProfileTabSkeleton({ label, live = true }: { label: string; live?: boolean }) {
    const { ref: filledRef, count: filledCount } = useFilledSkeletonCount(92, 3);
    return (
        <div
            ref={filledRef}
            role={live ? "status" : undefined}
            aria-live={live ? "polite" : undefined}
            aria-label={live ? label : undefined}
            aria-hidden={live ? undefined : true}
            className="space-y-3 p-4"
            data-user-profile-tab-skeleton="true"
        >

            <LoadingSurface label={label}>

                <div className="space-y-3">

                    {
                        Array.from({ length: filledCount }, (_, item) => (
                            <article key={item} className="min-h-20 rounded-xl border border-border bg-card/80 p-3 shadow-sm">

                                <h3 className="text-sm font-medium">맛집 방문 이야기</h3>

                                <p className="mt-2 text-xs">방문과 활동 내역</p>

                                <p className="mt-2 text-xs">최근 기록</p>

                            </article>
                        ))
                    }

                </div>

            </LoadingSurface>

        </div>
    );
}
