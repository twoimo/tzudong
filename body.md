## 개요
- React Hooks `eslint-disable-next-line react-hooks/exhaustive-deps` 린트 경고 해결 및 최적화
- `useEffect`, `useCallback` 의존성 배열 누락 문제 및 불필요한 재렌더링 방지 개선

## 변경 내용
- `apps/web/app/page.tsx`: `useCallback`으로 인한 함수 최신화 문제 해결 (`useRef` 활용)
- `apps/web/components/admin/SubmissionDetailView.tsx`: 무한 루프 방지를 위한 의존성 분리 및 `useRef`를 통한 이벤트 중복 실행 핸들링
- `apps/web/components/map/MapView.tsx`: 의존성 배열 누락 해결 및 클로저 상태 참조 안전성 강화 (`useRef` 사용)
- `eslint-disable-next-line` 관련 주석 제거 및 코딩 컨벤션 준수

## 테스트
- 앱 로컬 환경 무한 렌더링 검사 완료
- 린트(`lint` / `type-check`) 에러 발생 여부 확인

## 관련 이슈
- (없음)
