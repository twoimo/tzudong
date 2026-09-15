/**
 * 관리자 라우트 로딩 경계.
 *
 * /admin은 App Router fallback에서 뷰포트 스켈레톤을 그리지 않습니다.
 * 정적 레이아웃은 관리자 페이지가 직접 렌더링하고,
 * 아직 준비되지 않은 데이터 영역에만 상태를 표시합니다.
 */
export default function AdminLoading() {
    return null;
}
