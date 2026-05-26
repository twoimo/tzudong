/**
 * 글로벌 맵 라우트 로딩 경계.
 *
 * App Router fallback은 비워둡니다. 지도 캔버스와 검색 컨트롤 스켈레톤은
 * `app/global-map/page.tsx`의 dynamic/Suspense 경계가 한 번만 소유합니다.
 * route fallback에서도 MapSkeleton을 그리면 페이지 내부 MapView fallback과
 * 같은 지도 스켈레톤이 순차적으로 2번 보일 수 있습니다.
 */
export default function GlobalMapLoading() {
    return null;
}
