## 개요
- 지도 뷰 뷰포트 필터 오버헤드 완화 및 검색/머지 경로 튜닝 파이프라인 최적화 (Cycle 1, 2)

## 변경 내용
- `apps/web/components/map/NaverMapView.tsx`:
  - 마커 렌더링 시 매번 발생하는 O(N*M) 선형 검색 핫스팟을 해시 조회(`Map`/`Set`) 방식으로 변경 
  - 뷰포트 범위 내 마커 판독 시 무거운 `naver.maps.LatLngBounds` 인스턴스를 생성하는 대신 단순 수치형 대소 비교 연산 도입하여 GC 압력 완화
- `apps/web/hooks/use-restaurants.tsx`:
  - `mergeRestaurants` 내 Levenshtein 알고리즘 실행 전 문자열 길이 차를 기반으로 유사도 미달 케이스를 사전에 가지치기(Fast-fail)하는 `isLengthDiffWithinSimilarityThreshold` 추가
- `apps/web/components/search/RestaurantSearch.tsx`: 
  - Debounce된 쿼리 문자열에 대한 중복 `.trim()` 연산 memoization, 인기 검색 무효화 키 정합화 수정
  - 검색 히스토리 및 인기 항목 클릭 로직 중복 제거(`handleHistoryOrPopularSelect`)를 통한 가독성 개선
- `OMX_MODERNIZATION_WORKLOG.md` 갱신

## 테스트
- 로컬 `lint`, `type-check`, `unit-test` 모두 통과 확인
- UI 기능 렌더링 및 인터랙션 반응성 테스트 반영 완료

## 관련 이슈
- (없음)
