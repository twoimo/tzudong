import { GlobalLoader } from "@/components/ui/global-loader";

/**
 * [최적화] 유저 프로필 페이지 로딩 UI - GlobalLoader 통일
 * UserProfilePanel 내부 로딩 상태와 동일한 메시지/스타일을 사용하여 
 * 페이지 진입 시 이중 로딩(깜빡임) 현상을 방지합니다.
 */
export default function UserProfileLoading() {
    return (
        <GlobalLoader
            message="프로필 불러오는 중..."
            subMessage="사용자 정보를 확인하고 있습니다"
        />
    );
}
