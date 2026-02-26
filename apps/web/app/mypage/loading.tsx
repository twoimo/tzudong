/**
 * [PERF] 마이페이지 로딩 UI - 즉각적 페이지 전환
 */
export default function MyPageLoading() {
    return (
        <div className="h-[calc(100vh-64px)] bg-background">
            <div className="container mx-auto h-full max-w-6xl flex">
                {/* 사이드바 스켈레톤 */}
                <div className="hidden md:block w-56 shrink-0 border-r border-border p-4">
                    <div className="space-y-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="h-9 bg-muted/60 rounded-md animate-pulse" />
                        ))}
                    </div>
                </div>
                {/* 콘텐츠 스켈레톤 */}
                <div className="flex-1 p-4 md:p-8 md:pt-14">
                    <div className="space-y-4">
                        <div className="h-8 w-48 bg-muted/60 rounded animate-pulse" />
                        <div className="h-4 w-72 bg-muted/40 rounded animate-pulse" />
                        <div className="grid gap-4 mt-8">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
