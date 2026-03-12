## 개요
- 모바일 바텀시트 사용자 경험 개선 및 UI 여백 미세 조정

## 변경 내용
- `apps/web/components/ui/bottom-sheet.tsx`:
  - `hideHandleWhenFull` 옵션을 추가하여 바텀시트가 전체 높이(Full Height)일 때 상단 핸들을 숨길 수 있는 기능을 구현했습니다.
- `apps/web/components/home/MobileControlOverlay.tsx`:
  - 지역/카테고리 필터 바텀시트에 `hideHandleWhenFull={true}`를 적용하여 시각적 복잡도를 줄였습니다.
  - 가로 스크롤 카테고리 바의 상하 패딩을 미세 조정(`pt-[2px] pb-[2px]`)하여 전체적인 수직 균형을 최적화했습니다.

## 테스트
- 모바일 환경에서 바텀시트를 최대 높이로 확장 시 핸들이 사라지는지 확인했습니다.
- 카테고리 바의 시각적 요소가 상단 검색바 및 하단 지도와 적절한 간격을 유지하는지 확인했습니다.

## 관련 이슈
- (없음)
