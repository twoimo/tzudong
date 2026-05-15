/**
 * 관리자 라우트 로딩 경계.
 *
 * /admin은 App Router fallback에서 뷰포트 스켈레톤을 그리지 않습니다.
 * 인증/코드분할 단계는 비워두고, 실제 데이터가 들어갈 위치의
 * 모듈별 스켈레톤만 한 번 표시해 중복 로딩 전환을 막습니다.
 */
export default function AdminLoading() {
    return null;
}
