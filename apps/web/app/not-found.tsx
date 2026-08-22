export default function NotFound() {
    return (
        <main
            className="fixed inset-0 z-[100] flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background px-4 py-8"
            data-centered-error-state="viewport"
        >
            <section
                className="w-full max-w-[360px] rounded-2xl border border-border/70 bg-card/95 p-6 text-center shadow-[0_18px_60px_hsl(24_10%_10%/0.10)]"
                aria-labelledby="not-found-title"
                aria-describedby="not-found-description"
            >
                <div
                    className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                    data-centered-error-icon="true"
                    aria-hidden="true"
                >
                    <svg viewBox="0 0 24 24" width="20" height="20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                        <path d="M12 9v4" />
                        <path d="M12 17h.01" />
                    </svg>
                </div>
                <h1 id="not-found-title" className="text-lg font-semibold tracking-tight text-foreground">
                    페이지를 찾을 수 없습니다
                </h1>
                <p id="not-found-description" className="mt-2 text-sm leading-6 text-muted-foreground">
                    주소가 바뀌었거나 더 이상 없는 페이지입니다.
                </p>
                <div className="flex justify-center" data-centered-error-actions="true">
                    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keep 404 server-rendered and out of the root client manifest */}
                    <a
                        href="/"
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
                    >
                        홈으로 이동
                    </a>
                </div>
            </section>
        </main>
    );
}
