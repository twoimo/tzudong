'use client';

import { X, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type AnnouncementPanelLoadingFallbackProps = {
    isAdmin?: boolean;
    hideCloseButton?: boolean;
    onClose?: () => void;
};

function InlineCountSkeleton() {
    return <span className="inline-block h-3 w-6 rounded-full bg-muted/70 align-middle animate-pulse motion-reduce:animate-none" aria-hidden="true" />;
}

function AnnouncementListItemSkeleton({ index }: { index: number }) {
    return (
        <div className="w-full rounded-xl border border-border/70 bg-card px-3 py-3" aria-hidden="true">
            <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <Skeleton className={index % 2 === 0 ? 'h-4 w-40 max-w-full rounded-full motion-reduce:animate-none' : 'h-4 w-28 max-w-full rounded-full motion-reduce:animate-none'} />
                    <div className="mt-2 flex items-center gap-1">
                        <Skeleton className="h-3 w-3 rounded-full motion-reduce:animate-none" />
                        <Skeleton className={index % 3 === 0 ? 'h-3 w-16 rounded-full motion-reduce:animate-none' : 'h-3 w-20 rounded-full motion-reduce:animate-none'} />
                    </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <Skeleton className="h-5 w-10 rounded-full motion-reduce:animate-none" />
                    {index % 2 === 0 && <Skeleton className="h-5 w-9 rounded-full motion-reduce:animate-none" />}
                </div>
            </div>
        </div>
    );
}

export default function AnnouncementPanelLoadingFallback({
    isAdmin = false,
    hideCloseButton = false,
    onClose,
}: AnnouncementPanelLoadingFallbackProps) {
    return (
        <div className="relative flex h-full flex-col bg-background">
            <div className="shrink-0 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-[min(11rem,100%)]">
                        <h1 className="flex min-w-0 flex-wrap items-center gap-1.5 text-[1.0625rem] font-bold leading-tight text-primary text-balance xs:text-xl sm:gap-2 sm:text-2xl">
                            <Megaphone className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" aria-hidden="true" />
                            <span className="min-w-0 truncate">쯔동여지도 공지</span>
                            <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground xs:text-sm">
                                (<InlineCountSkeleton />)
                            </span>
                        </h1>
                        <p className="mt-1 max-w-full text-pretty text-xs leading-5 text-muted-foreground xs:text-sm">
                            쯔동여지도 소식과 운영 안내를 확인하세요.
                        </p>
                    </div>
                    {!hideCloseButton && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted"
                            aria-label="공지 패널 닫기"
                        >
                            <X className="h-5 w-5" aria-hidden="true" />
                        </Button>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                <div className="space-y-3 p-4" role="status" aria-busy="true" aria-label="공지사항 목록 로딩 중">
                    <span className="sr-only">공지사항 목록 데이터를 불러오는 중입니다.</span>
                    {isAdmin && (
                        <div className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
                            <span className="rounded-full border border-border bg-muted/45 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                                전체 <InlineCountSkeleton />
                            </span>
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                                게시 <InlineCountSkeleton />
                            </span>
                            <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">
                                배너 <InlineCountSkeleton />
                            </span>
                        </div>
                    )}
                    {Array.from({ length: 5 }).map((_, index) => (
                        <AnnouncementListItemSkeleton key={index} index={index} />
                    ))}
                </div>
            </div>
        </div>
    );
}
