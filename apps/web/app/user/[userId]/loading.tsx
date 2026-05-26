/**
 * 유저 프로필 라우트 로딩 경계.
 *
 * route-level Suspense에서는 별도 스켈레톤을 그리지 않습니다.
 * `UserProfilePanel`의 프로필 쿼리 로딩 상태가 `UserProfileProgressiveSkeleton`
 * 한 번만 소유해 route fallback과 패널 내부 로딩 셸이 중복되지 않게 합니다.
 */
export default function UserProfileLoading() {
    return null;
}
