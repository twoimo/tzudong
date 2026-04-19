export function MapViewErrorState({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
    return (
        <div className="flex items-center justify-center h-full bg-muted">
            <div className="text-center space-y-4">
                <div className="text-6xl">🚨</div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-destructive">
                        지도 로딩 실패
                    </h2>
                    <p className="text-muted-foreground">
                        지도를 불러오는데 문제가 발생했습니다.
                    </p>
                    <div className="text-sm text-muted-foreground space-y-1">
                        <p>🔧 오류: {error.message}</p>
                    </div>
                    <button
                        onClick={resetErrorBoundary}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                    >
                        다시 시도
                    </button>
                </div>
            </div>
        </div>
    );
}

export function MapViewMissingApiKeyState() {
    return (
        <div className="flex items-center justify-center h-full bg-muted">
            <div className="text-center space-y-4">
                <div className="text-6xl">🔑</div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-destructive">
                        Google Maps API 키 필요
                    </h2>
                    <p className="text-muted-foreground">
                        .env 파일에 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY를 설정해주세요.
                    </p>
                </div>
            </div>
        </div>
    );
}

export function MapViewGoogleLoadErrorState() {
    return (
        <div className="flex items-center justify-center h-full bg-muted">
            <div className="text-center space-y-4">
                <div className="text-6xl">❌</div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-destructive">
                        구글 지도 로딩 실패
                    </h2>
                    <p className="text-muted-foreground">
                        Google Maps API를 불러오는데 실패했습니다.
                    </p>
                    <div className="text-sm text-muted-foreground space-y-1">
                        <p>🔧 해결 방법:</p>
                        <p>1. Google Cloud Console에서 API 키 확인</p>
                        <p>2. Application restrictions → HTTP referrers 설정</p>
                        <p>3. 다음 도메인 추가: <code className="bg-muted px-1 rounded">localhost:8080/*</code></p>
                        <p>4. Maps JavaScript API 활성화 확인</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function NaverMapLoadErrorState({ message }: { message: string }) {
    return (
        <div className="flex items-center justify-center h-full bg-muted">
            <div className="text-center space-y-4">
                <div className="text-6xl">❌</div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-destructive">
                        지도 로딩 실패
                    </h2>
                    <p className="text-muted-foreground">
                        네이버 지도 API를 불러오는데 실패했습니다.
                    </p>
                    <p className="text-sm text-muted-foreground">
                        {message}
                    </p>
                </div>
            </div>
        </div>
    );
}
