## 개요
- 모바일 맵 터치 시 연속/중복 동작 방지 및 글로벌 헤더 영역 CLS(Cumulative Layout Shift) 방지 최적화

## 변경 내용
- `apps/web/components/home/home-map-container.tsx`:
  - 모바일 기기 터치 환경에서 마커/오버레이 중단/닫힘 시 단기간 연속 터치로 인한 불필요한 패널 재열림 버그 방지(`MAP_TAP_MARKER_REOPEN_GUARD_MS` 상수 및 suppress ref 추가)
- `apps/web/components/layout/Header.tsx`:
  - 초기 Hydration 중 배너 공지 및 인증 상태(로그인 버튼 등) 공간을 예약하는 Skeleton UI 컴포넌트 적용
  - 이를 통해 첫 로딩 시점 레이아웃 흔들림(CLS 현상) 최소화 및 렌더링 성능 최적화
- `apps/web/app/home-client.tsx`:
  - 불필요한 렌더 트리거 방지를 위한 컴포넌트 상태 최적화 일부 반영

## 테스트
- 모바일 맵 탭 및 연속 패널 닫기 동작 이상 여부 확인 완료
- Header Skeleton 적용을 통한 초기 진입부 레이아웃 떨림 제어 확인

## 관련 이슈
- (없음)
