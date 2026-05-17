export default function NotFound() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="text-center">
                <h1 className="mb-4 text-4xl font-bold text-foreground">404</h1>
                <p className="mb-4 text-xl text-muted-foreground">페이지를 찾을 수 없습니다</p>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keep 404 server-rendered and out of the root client manifest */}
                <a href="/" className="text-primary underline hover:text-primary/80">
                    홈으로 돌아가기
                </a>
            </div>
        </div>
    );
}
