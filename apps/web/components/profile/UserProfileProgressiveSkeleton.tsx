import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataPending } from "@/components/ui/data-pending";

type UserProfileProgressiveSkeletonProps = {
    label?: string;
    showCloseButton?: boolean;
    onBack?: () => void;
};

/** Route compatibility frame. Only unresolved identity, counts and activity load. */
export function UserProfileProgressiveSkeleton({
    label = "사용자 프로필을 불러오는 중",
    showCloseButton = false,
    onBack,
}: UserProfileProgressiveSkeletonProps) {
    return (
        <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col bg-background">
            <header className="border-b border-border/70 p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold">사용자 프로필</h1>
                        <p className="mt-1 text-xs text-muted-foreground">방문 도장과 리뷰 활동</p>
                    </div>
                    {showCloseButton && onBack && <Button variant="ghost" size="icon" onClick={onBack} aria-label="프로필 패널 닫기"><X className="h-5 w-5" aria-hidden="true" /></Button>}
                </div>
                <DataPending label={label} className="max-w-48" />
                <div className="grid grid-cols-3 gap-2">
                    {["도장", "좋아요", "랭킹"].map((title) => <div key={title} className="rounded-xl border p-2.5"><span className="text-xs">{title}</span><DataPending label={`${title} 확인 중`} className="min-h-5 p-0" /></div>)}
                </div>
            </header>
            <div role="tablist" aria-label="사용자 프로필 콘텐츠" className="grid grid-cols-3 gap-1 border-b p-3">
                {["도장", "리뷰", "좋아요"].map((title, index) => <button key={title} type="button" role="tab" aria-selected={index === 0} disabled className="rounded-lg border px-2 py-2.5 text-sm">{title}</button>)}
            </div>
            <div className="px-4 pt-4"><h2 className="text-sm font-semibold">방문 도장</h2><p className="text-xs text-muted-foreground">리뷰로 인증한 맛집을 모았어요.</p></div>
            <UserProfileTabSkeleton label="도장 목록 로딩 중" />
        </div>
    );
}

export function UserProfileTabSkeleton({ label, live = true }: { label: string; live?: boolean }) {
    return live ? <DataPending label={label} variant="list" className="p-4" /> : <div aria-hidden="true"><DataPending label={label} variant="list" className="p-4" /></div>;
}
