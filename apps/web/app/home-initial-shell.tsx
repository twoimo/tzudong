export function HomeInitialShell() {
    return (
        <main
            id="home-initial-shell"
            role="status"
            aria-label="쯔동여지도 로딩 중"
            aria-live="polite"
            className="fixed inset-0 z-50 h-[var(--full-height,100vh)] w-screen overflow-hidden bg-background text-foreground"
        >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(239,68,68,0.08),transparent_34%),linear-gradient(0deg,rgba(248,250,252,0.95),rgba(255,255,255,0.95))]" aria-hidden="true" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px)] bg-[size:44px_44px]" aria-hidden="true" />

            <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+10px)] flex h-12 items-center gap-2 rounded-full bg-background/95 px-2 shadow-lg shadow-black/5 backdrop-blur-sm min-[1280px]:left-8 min-[1280px]:right-auto min-[1280px]:w-[360px]" aria-hidden="true">
                <div className="flex h-10 flex-1 items-center rounded-full bg-muted/45 px-3 text-left text-[15px] text-muted-foreground">
                    쯔동여지도 검색하기
                </div>
                <div className="h-10 w-10 rounded-full bg-muted/45" />
                <div className="h-10 w-10 rounded-full bg-muted/45" />
            </div>

            <section className="absolute bottom-[calc(env(safe-area-inset-bottom)+92px)] left-1/2 w-[min(calc(100vw_-_32px),360px)] -translate-x-1/2 rounded-2xl bg-background/90 p-4 text-left shadow-xl shadow-black/10 backdrop-blur-sm min-[1280px]:bottom-8 min-[1280px]:left-8 min-[1280px]:translate-x-0">
                <p className="text-xs font-semibold text-primary">쯔동여지도</p>
                <h1 className="mt-1 text-lg font-bold text-foreground">지도를 준비하고 있어요</h1>
                <p className="mt-2 text-sm text-muted-foreground">지도 화면을 먼저 준비하고 맛집 정보를 순서대로 불러옵니다</p>
                <ol className="mt-3 grid gap-2 text-xs text-muted-foreground" aria-label="홈 지도 준비 단계">
                    <li className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden="true" />지도 화면 준비</li>
                    <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-muted" aria-hidden="true" />검색과 필터 준비</li>
                    <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-muted" aria-hidden="true" />맛집 정보 연결</li>
                </ol>
            </section>
        </main>
    );
}
