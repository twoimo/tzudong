## 개요
- 전역 토스트 알림 로직 최적화 및 모바일 검색 UI 텍스트 간소화

## 변경 내용
- **토스트 알림 라이브러리 교체**:
  - `apps/web` 내 여러 컴포넌트(`MobileControlOverlay`, `EditRestaurantModal`, `RestaurantSubmissionModal`, `MyPageSidebar`, `NicknameSetupModal`, `ProfileModal`, `RestaurantDetailPanel`, `sonner.tsx`, `use-announcements.tsx`)에서 기존 `sonner` 패키지 대신 프로젝트 내 커스텀 라이브러리인 `@/lib/no-toast`를 사용하도록 변경했습니다.
  - 이를 통해 특정 상황에서의 알림 노출을 제어하고 불필요한 시각적 방해를 최적화했습니다.
- **모바일 검색바 텍스트 최적화**:
  - `MobileControlOverlay.tsx`의 검색바 플레이스홀더 및 상단 텍스트를 "쯔동여지도 맛집 검색하기"에서 "쯔동여지도 검색하기"로 간소화하여 시인성을 개선했습니다.

## 테스트
- 모바일 환경에서의 검색바 텍스트 노출 상태를 확인했습니다.
- 토스트 알림이 발생하는 시나리오에서 `@/lib/no-toast`가 의도대로 동작하는지 검증했습니다.

## 관련 이슈
- (없음)
