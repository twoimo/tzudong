'use client';

import { Megaphone } from 'lucide-react';
import { MapPanelHeader } from '@/components/home/map-panel-chrome';
import { LoadingSurface } from "@/components/ui/loading-surface";

type AnnouncementPanelLoadingFallbackProps = {
    isAdmin?: boolean;
    hideCloseButton?: boolean;
    onClose?: () => void;
};

function AnnouncementListItemPreview({ index }: { index: number }) {
    return (
        <article className="w-full rounded-xl border border-border/70 bg-card px-3 py-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium leading-4">{index % 2 === 0 ? "쯔동여지도 소식" : "새로운 공지"}</h3>
                    <p className="mt-2 text-xs leading-3 text-muted-foreground">서비스 안내</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                    <span className="rounded-full border px-2 leading-5">공지</span>
                    {index % 2 === 0 && <span className="rounded-full border px-2 leading-5">안내</span>}
                </div>
            </div>
        </article>
    );
}

export default function AnnouncementPanelLoadingFallback({
    isAdmin = false,
    hideCloseButton = false,
    onClose,
}: AnnouncementPanelLoadingFallbackProps) {
    return (
        <div className="relative flex h-full flex-col bg-background">
            <MapPanelHeader
                title="쯔동여지도 공지"
                titleAs="h1"
                titleIcon={<Megaphone />}
                description="쯔동여지도 소식과 운영 안내를 확인하세요."
                onClose={!hideCloseButton ? onClose : undefined}
                closeLabel="공지 패널 닫기"
            />
            <div className="flex-1 overflow-hidden">
                <LoadingSurface className="space-y-3 p-4" label="공지사항 목록 로딩 중">
                    <div className="space-y-3">
                        {isAdmin && (
                            <div className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
                                <div className="rounded-full border border-border bg-muted/45 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                                    전체 <span className="inline-block w-6 text-xs leading-3">00</span>
                                </div>
                                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                                    게시 <span className="inline-block w-6 text-xs leading-3">00</span>
                                </div>
                                <div className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">
                                    배너 <span className="inline-block w-6 text-xs leading-3">00</span>
                                </div>
                            </div>
                        )}
                        {Array.from({ length: 5 }).map((_, index) => (
                            <AnnouncementListItemPreview key={index} index={index} />
                        ))}
                    </div>
                </LoadingSurface>
            </div>
        </div>
    );
}
