## 개요
- NaverMapView 컴포넌트의 마커 선택 및 식당 탐색 로직 리팩토링
- `.next-stale-*` 캐시 무시 규칙을 ESLint 설정에 보강

## 변경 내용
- `apps/web/components/map/NaverMapView.tsx`: 중복되던 레스토랑 매칭 로직을 `findMatchingRestaurantInList` 함수로 분리하여 코드 가독성 제고
- `apps/web/eslint.config.mjs`: `.next-stale-*` 디렉터리에 대한 글로벌 무시 (`**/.next-stale-*/**`) 패턴 추가 

## 테스트
- 앱 로컬 환경 무한 렌더링 검사 완료
- 린트(`lint` / `type-check`) 에러 발생 여부 확인

## 관련 이슈
- (없음)
