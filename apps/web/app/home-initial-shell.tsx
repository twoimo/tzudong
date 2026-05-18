export function HomeInitialShell() {
    return (
        <main
            id="home-initial-shell"
            aria-label="쯔동여지도 홈 미리보기"
            className="fixed inset-0 z-50 h-[var(--full-height,100vh)] w-screen overflow-hidden bg-background text-foreground"
        >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(239,68,68,0.08),transparent_34%),linear-gradient(0deg,rgba(248,250,252,0.95),rgba(255,255,255,0.95))]" aria-hidden="true" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px)] bg-[size:44px_44px]" aria-hidden="true" />

            <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+10px)] flex h-12 items-center gap-2 rounded-full bg-background/95 px-2 shadow-lg shadow-black/5 backdrop-blur-sm min-[1280px]:left-8 min-[1280px]:right-auto min-[1280px]:w-[360px]">
                <button
                    type="button"
                    data-home-intent="search"
                    className="flex min-h-11 flex-1 items-center rounded-full bg-muted/45 px-3 text-left text-[15px] text-muted-foreground"
                    aria-label="쯔동여지도 검색 열기"
                >
                    쯔동여지도 검색하기
                </button>
                <button type="button" data-home-intent="bookmark" className="min-h-11 min-w-11 rounded-full bg-muted/45 min-[1280px]:hidden" aria-label="북마크 열기" />
                <button type="button" data-home-intent="notification" className="min-h-11 min-w-11 rounded-full bg-muted/45 min-[1280px]:hidden" aria-label="알림 열기" />
                <button type="button" data-home-intent="user" className="min-h-11 min-w-11 rounded-full bg-muted/45 min-[1280px]:hidden" aria-label="사용자 메뉴 열기" />
            </div>

            <p className="sr-only" role="status" aria-live="polite">쯔동여지도 홈 준비 중</p>
        </main>
    );
}
