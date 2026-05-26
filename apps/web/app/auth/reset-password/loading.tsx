/**
 * 비밀번호 재설정 라우트 로딩 경계.
 *
 * route-level Suspense에서는 별도 스켈레톤을 그리지 않습니다.
 * 클라이언트 페이지의 세션 확인 단계가 같은 `ResetPasswordProgressiveSkeleton`
 * 한 번만 소유해 route fallback -> page state 전환 중 같은 셸이 2번 보이는
 * 현상을 막습니다.
 */
export default function ResetPasswordLoading() {
    return null;
}
