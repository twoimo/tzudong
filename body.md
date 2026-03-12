## 개요
- 모바일 UI 컴포넌트 표준화 및 지도 알림(Floating Toast) 기능 고도화

## 변경 내용
- `apps/web/components/ui/bottom-sheet.tsx`:
  - `showBackdrop`, `closeOnOutsidePointerDown` 옵션 추가로 컴포넌트 유연성 확보 및 모바일 오버레이 최적화
- `apps/web/components/home/MobileControlOverlay.tsx`:
  - 커스텀 시트 로직을 표준 `BottomSheet`으로 리팩토링 및 인터랙션 통일
  - 스냅 포인트(25% / 50% / 100%) 및 드래그 동작 최적화
- `apps/web/components/map/NaverMapView.tsx`:
  - 실시간 공지사항 배너를 지도의 플로팅 배지(`AnnouncementToastBadge`) 형태로 순회 노출하는 로직 추가
- `apps/web/components/layout/Header.tsx` & `AnnouncementPanel.tsx`:
  - 공공 알림 및 시스템 공지사항 가독성 개선 및 레이아웃 조정

## 테스트
- 모바일 환경에서 지역/카테고리 선택 시 바텀시트 스냅 및 닫기 동작 확인
- 지도 위에서 공지사항 배너가 일정 간격으로 순환 노출되는지 확인
- 바텀시트 외부 클릭 시 닫기(선택 사항) 기능 동작 검증

## 관련 이슈
- (없음)
