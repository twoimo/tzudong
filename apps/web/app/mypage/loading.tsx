/**
 * 마이페이지 라우트 로딩 경계.
 *
 * App Router fallback에서는 별도 뷰포트 스켈레톤을 그리지 않습니다.
 * 정적 레이아웃은 `MyPageLayoutContent`가 즉시 유지하고, 인증/데이터처럼
 * 실제 동적 영역만 해당 위치에서 한 번 스켈레톤을 표시합니다.
 */
export default function MyPageLoading() {
    return null;
}
