import { LoadingPreview } from "@/components/ui/loading-surface";

export function ResetPasswordProgressiveSkeleton() {
    return (
        <div
            role="status"
            aria-live="polite"
            className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-muted/30 px-4 py-10"
            aria-busy="true"
            aria-label="비밀번호 재설정 화면을 준비하는 중"
            data-reset-password-progressive-skeleton="true"
        >

            <div className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-sm">

                <LoadingPreview kind="form" rows={2} label="비밀번호 재설정 화면을 준비하는 중" className="min-h-80" />

            </div>

        </div>
    );
}
