## 개요
- 모바일 바텀 시트 및 상세 패널 터치 인터랙션 대대적 개편 및 iOS 버스 스크롤 현상 대응

## 변경 내용
- `apps/web/components/home/home-map-container.tsx` 및 `apps/web/components/ui/bottom-sheet.tsx`: 
  - 불필요한 `button` 태그 대신 일반 `div` 핸들러로 스와이프 이벤트를 교체하여 iOS Safari에서 발생하는 브라우저 고유 Webkit 터치 하이라이트/더블 탭 클릭 방지
  - 드래그 동작 중 스크롤 영역에 `overflowY: 'hidden'` 스타일을 동적 부여하여, 컴포넌트 내부 스크롤 이벤트가 부모(바텀 시트)의 드래그를 간섭하는 버그 수정
- `apps/web/app/stamp/page.tsx`: 스탬프 투어 페이지 맵 컨테이너 마진 및 `BottomSheetComponent` 파라미터 미세 조정 
- `apps/web/components/map/NaverMapView.tsx`: 클러스터링 모드 해제 시 마커 애니메이션 성능 오버헤드 개선
- `OMX_MODERNIZATION_WORKLOG.md` 갱신

## 테스트
- iOS/Android 환경 터치 스와이프 브라우저 간섭 여부 크로스 브라우징 확인
- 로컬 환경 컴파일 에러 없음 점검 완료

## 관련 이슈
- (없음)
