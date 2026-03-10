## 개요
- 바텀 시트 및 패널 스와이프 민감도 튜닝 및 `useCallback` 의존성 최적화

## 변경 내용
- `apps/web/components/ui/bottom-sheet.tsx` 및 `apps/web/components/restaurant/RestaurantDetailPanel.tsx`: 모바일 체감 향상을 위해 좌우 수평(Horizontal) 스와이프 및 상하 수직(Vertical) 스와이프 발생 민감도(Threshold) 및 각도 비율(Intent Ratio) 미세 조정
- `apps/web/components/home/home-map-container.tsx`: 음식점 좌우 스와이프 이동 시 현재 지도 탐색 모드(지역/서울 구 단위 등)에 맞는 대상 필터링 로직 안정화를 위해 `getRestaurantListByMode` 함수 `useCallback` 의존성 반영

## 테스트
- 로컬 모바일 개발 환경(iOS/Android 에뮬레이터) 터치 스와이프 감도 개선 확인
- 린트(`lint` / `type-check`) 에러 발생 여부 확인

## 관련 이슈
- (없음)
