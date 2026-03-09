## 개요
- 모바일 바텀 시트 및 패널 드래그 성능 튜닝 패치 롤백 및 누락된 UI 컴포넌트 복구

## 변경 내용
- `apps/web/components/home/home-map-container.tsx`, `apps/web/components/ui/bottom-sheet.tsx`: 
  - 드래그 터치 반응 속도를 늦추던 `requestAnimationFrame` (RAF) 기반 성능 최적화 로직을 제거하고 즉각적인 상태 렌더링 방식으로 롤백하여 모바일 반응성(직관성) 개선
  - 이전 커밋에서 누락되었던 우측 상단 닫기 엑스(`X`) 버튼 컴포넌트 UI 원상 복구

## 테스트
- 로컬 모바일 개발 환경(iOS/Android 에뮬레이터) 터치 스와이프 및 드래그 반응 즉각 동작 확인

## 관련 이슈
- (없음)
