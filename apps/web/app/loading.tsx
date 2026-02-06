/**
 * [PERF] 루트 로딩 UI - 페이지 전환 시 즉각적 피드백 제공
 * Next.js App Router가 자동으로 Suspense 바운더리를 생성하여
 * 페이지 간 이동 시 빈 화면 대신 이 컴포넌트를 표시합니다.
 */
export default function RootLoading() {
    return (
        <div className="flex-1 flex items-center justify-center" aria-label="페이지 로딩 중">
            <div className="text-center">
                <div className="relative mx-auto mb-4 w-12 h-12">
                    <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
                <p className="text-sm text-muted-foreground animate-pulse">로딩 중...</p>
            </div>
        </div>
    );
}
