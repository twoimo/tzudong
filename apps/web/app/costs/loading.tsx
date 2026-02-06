/**
 * [PERF] 비용 페이지 로딩 UI - 즉각적 페이지 전환
 */
export default function CostsLoading() {
    return (
        <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
                <div className="relative mx-auto mb-4 w-12 h-12">
                    <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
                <p className="text-sm text-muted-foreground">서버 비용 데이터를 불러오는 중...</p>
            </div>
        </div>
    );
}
