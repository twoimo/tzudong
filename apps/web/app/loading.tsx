/**
 * 루트 로딩 경계.
 *
 * 전역 App Router fallback은 별도 스켈레톤을 그리지 않습니다.
 * 각 route/page/module 경계가 자신의 실제 레이아웃에 맞는 스켈레톤을
 * 한 번만 소유합니다. 루트에서 MapSkeleton을 먼저 그리면 비지도 라우트와
 * 지도 내부 loader 모두에서 2단계 스켈레톤 전환처럼 보일 수 있습니다.
 */
export default function RootLoading() {
    return null;
}
