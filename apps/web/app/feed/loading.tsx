/**
 * [PERF] 피드 페이지 로딩 UI - 즉각적 페이지 전환
 */
export default function FeedLoading() {
    return (
        <div className="h-full w-full bg-background flex items-center justify-center">
            <div className="text-center">
                <div className="relative mx-auto mb-4 w-12 h-12">
                    <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
                <p className="text-sm text-muted-foreground">피드를 불러오는 중...</p>
            </div>
        </div>
    );
}
