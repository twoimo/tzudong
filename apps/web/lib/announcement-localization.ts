// Translate only the exact historical seed copy. Later operator edits remain authoritative.
const LEGACY_RELEASE_CONTENT = `Hello from Tzudong Map.

Version v1.1.1 focuses on making the public restaurant map, the admin moderation console, and the storyboard generation workspace easier to verify and operate.

The public map keeps the map-first browsing flow with clustered restaurant markers, category filters, region filters, mobile controls, and restaurant detail entry points.

The admin workspace includes guarded review and readback flows, and the storyboard module now surfaces starter examples, generated storyboard images, cut-level metadata, local bridge state, and setup traces more clearly.

AI and RAG-related claims are scoped to verified evidence: deterministic fixtures, explicit local/provider smoke runs, and fail-closed worker readiness checks are tracked separately from experimental RAGAS or LangSmith notes.

Thank you for using Tzudong Map.`;
const KOREAN_RELEASE_CONTENT = `안녕하세요, 쯔동여지도입니다.

버전 1.1.1에서는 맛집 지도, 관리자 검수 화면, 스토리보드 제작 작업장을 더 쉽게 확인하고 운영할 수 있도록 개선했습니다.

맛집 지도에서는 가까운 맛집을 묶어 표시하는 마커, 카테고리·지역 필터, 모바일 조작 도구, 맛집 상세 화면으로 이어지는 지도 중심의 탐색 기능을 제공합니다.

관리자 작업장에는 권한 확인을 거치는 검수와 변경 결과 확인 절차가 포함되어 있습니다. 스토리보드 작업장에서는 시작 예제, 생성된 이미지, 장면별 정보, 로컬 연결 상태와 설정 기록을 더 명확하게 확인할 수 있습니다.

인공지능과 검색 증강 생성 기능의 검증 범위도 구분했습니다. 재현 가능한 시험 데이터, 로컬·외부 서비스 연동의 기본 동작 검사, 준비 조건이 충족되지 않으면 실행을 차단하는 작업자 점검 결과를 실험용 평가·추적 기록과 별도로 관리합니다.

쯔동여지도를 이용해 주셔서 감사합니다.`;

export function localizeAnnouncementContent<T extends { id: string; title: string; content: string }>(row: T): T {
    if (row.id === 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
        && row.title === 'Tzudong Map v1.1.1 Release Notes'
        && row.content.replace(/\r\n/g, '\n').trim() === LEGACY_RELEASE_CONTENT.trim()) {
        return { ...row, title: '쯔동여지도 버전 1.1.1 업데이트 안내', content: KOREAN_RELEASE_CONTENT };
    }
    if (row.id === '00000000-0000-4000-8000-000000000201'
        && row.title === 'Local nightly fixture'
        && row.content === 'Deterministic local regression announcement.') {
        return { ...row, title: '로컬 정기 검증 안내', content: '로컬 환경의 동작을 반복 확인하기 위한 검증용 공지입니다.' };
    }
    return row;
}
