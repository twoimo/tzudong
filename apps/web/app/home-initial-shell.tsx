export function HomeInitialShell() {
    return (
        <main
            id="home-initial-shell"
            role="status"
            aria-label="쯔동여지도 로딩 중"
            aria-live="polite"
            className="relative h-dvh min-h-screen overflow-hidden bg-muted/30 text-foreground"
        >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(248,113,113,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.9))]" />
            <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-[calc(env(safe-area-inset-top)+10px)] min-[1280px]:hidden">
                <div className="pointer-events-auto flex h-12 items-center gap-2 rounded-full border border-border bg-background/95 px-2 shadow-lg backdrop-blur-sm">
                    <div className="flex h-10 flex-1 items-center rounded-full px-2.5 text-left text-[15px] text-muted-foreground">
                        쯔동여지도 검색하기
                    </div>
                    <div className="h-9 w-9 rounded-full border border-border bg-background" aria-hidden="true" />
                    <div className="h-9 w-9 rounded-full border border-border bg-background" aria-hidden="true" />
                    <div className="h-9 w-9 rounded-full border border-border bg-background" aria-hidden="true" />
                </div>
            </div>
            <section className="relative flex h-full items-center justify-center px-6 text-center">
                <div className="space-y-6 rounded-3xl border border-border bg-background/90 px-8 py-7 shadow-xl backdrop-blur-sm">
                    <div className="relative mx-auto h-16 w-16">
                        <div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                        <div
                            className="absolute inset-0 mx-auto h-16 w-16 animate-spin rounded-full border-4 border-transparent border-r-secondary"
                            style={{ animationDuration: '1.5s' }}
                        />
                    </div>
                    <div className="space-y-3">
                        <h1 className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-xl font-bold text-transparent">
                            홈 지도를 불러오는 중...
                        </h1>
                        <p className="text-sm text-muted-foreground">맛집 지도 런타임을 준비하고 있습니다</p>
                        <div className="flex justify-center space-x-1" aria-hidden="true">
                            <div className="h-2 w-2 animate-bounce rounded-full bg-primary" />
                            <div className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:0.1s]" />
                            <div className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:0.2s]" />
                        </div>
                    </div>
                    <span className="sr-only">쯔동여지도 로딩 중...</span>
                </div>
            </section>
        </main>
    );
}
