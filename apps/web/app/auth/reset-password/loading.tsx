import { GlobalLoader } from "@/components/ui/global-loader";

/**
 * [PERF] 비밀번호 재설정 페이지 로딩 UI
 */
export default function ResetPasswordLoading() {
    return (
        <GlobalLoader
            message="비밀번호 재설정 페이지를 불러오는 중..."
            subMessage="계정 정보를 확인하고 있습니다"
            fullScreen
        />
    );
}
