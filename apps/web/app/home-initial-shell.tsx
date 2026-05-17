export function HomeInitialShell() {
    return (
        <main
            id="home-initial-shell"
            role="status"
            aria-label="쯔동여지도 로딩 중..."
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
                    <h2 className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-xl font-bold text-transparent">
                        쯔동여지도 로딩 중...
                    </h2>
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
