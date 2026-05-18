export function HomeInitialShell() {
    return (
        <main
            id="home-initial-shell"
            role="status"
            aria-label="쯔동여지도 로딩 중"
            aria-live="polite"
            className="fixed inset-0 z-50 flex h-[var(--full-height,100vh)] w-screen items-center justify-center bg-background text-foreground"
        >
            <div className="space-y-6 text-center">
                <div className="relative">
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
                        <div className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0.1s' }} />
                        <div className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0.2s' }} />
                    </div>
                </div>
            </div>
        </main>
    );
}
