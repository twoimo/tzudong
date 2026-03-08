## 개요
- NaverMapView `useEffect` 의존성 배열 누락 문제 및 불필요한 재렌더링 방지 개선
- 빌드/개발 환경 최적화를 위한 `.next-stale-*` 캐시 디렉터리 정리 및 린트 제외 설정 추가

## 변경 내용
- `apps/web/components/map/NaverMapView.tsx`: 여러 `useEffect` 훅에 `mapOptimization`, `isMobileOrTablet` 등의 의존성 배열 추가
- `apps/web/eslint.config.mjs`: `.next-stale-*` 경로 ignore 리스트 추가
- `apps/web/scripts/clean-next.mjs`: `.next-stale-*` 패턴의 불필요한 찌꺼기 파일 제거 로직 추가

## 테스트
- 앱 로컬 환경 무한 렌더링 검사 완료
- 캐시 찌꺼기 폴더 정상 삭제 여부 확인

## 관련 이슈
- (없음)
