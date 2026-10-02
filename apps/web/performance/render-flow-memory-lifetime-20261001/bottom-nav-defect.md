이 결함은 모바일 홈의 `[data-home-static-skeleton]` 안에 남은 높이56px, 좌우12px inset, 하단12px 여백의 `animate-pulse` 장식 막대다. 스켈레톤 z20 위로 z50의 바텀 네비게이션이 놓였지만, 내비게이션 배경은95% 불투명이고 막대 상단 약7px가 위로 드러났다. 삼성 인터넷의 강제 어두운 렌더링에서 같은 요소가 검게 보였다. 실제 기기의 PNG와 CSSOM을 함께 연결했으며 Naver 타일이나 마커의 오류로 분류하지 않았다.

네비게이션 높이 약60.9px와 막대 높이56px+하단여백12px의 차이로 약7.1px 노출이 예상된다(이론). 실측 최대 노출은 Chrome7.121px, 삼성 인터넷7.026px였고, 샘플 opacity는0.50~1.00을 오갔다. 모바일에는 desktop-only `homePanelReady`가 없어 기존 두 ready flag 조건이 충족되지 않았기 때문이다. 두 브라우저 각각2회 독립 탭 방문에서2/2회 남았고, 방문당30프레임 모두에서 존재했다. 탭은 같은 기존 browser process와 한 기기에 속한다.

장식용 하단 막대를 DOM에서 제거했다. 상단 준비 표시는 실제 lazy MobileControlOverlay의 기존 mounted-ready effect에서 새 CSS용 flag를 설정하고 unmount에서 지울 때까지 유지한다. parent-only readiness로 너무 일찍 숨겼던 첫 후보는 검토 후 거부·보존했다. 실제 production chunk를 보류한 뒤 해제한 검사와 실패시킨 검사 모두, 기다리는 동안 상단 스켈레톤과5개 내비게이션 버튼을 유지함을 확인했다. compiled CSS의40개 폭/상태 조합도 통과했다. 지도 status/loading 안내는 이 장식 스켈레톤과 별개이며 삭제하지 않았다.

네이티브 After 비교와 정확한 운영 release/배포 정보는 최종 집계 및 보고서에 연결한다. DOM 요소 제거의 검증을 전체 픽셀/컴포지터 플리커의 완전 제거 또는 CPU/field 성능율로 바꾸지 않는다.
