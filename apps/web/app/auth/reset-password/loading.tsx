/**
 * [PERF] 비밀번호 재설정 페이지 로딩 UI
 */
export default function ResetPasswordLoading() {
    return (
        <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
                <div className="relative mx-auto mb-4 w-10 h-10">
                    <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
                <p className="text-sm text-muted-foreground">로딩 중...</p>
            </div>
        </div>
    );
}
