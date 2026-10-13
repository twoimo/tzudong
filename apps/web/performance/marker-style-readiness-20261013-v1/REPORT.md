# Marker CSS 준비 후보: 효과 입증 안 됨

bdb90215289864c19d91f06e836de2480414c7c2는 기존624B marker CSS를 root layout에서도 가져와 deferred map보다 먼저 준비하는 단일 후보였다. 원래 ID 매칭 후보는 포함하지 않았다. 관련9tests/57assertions, 변경 파일lint, Next16.3.8 production builddcfhHb7NjNKAeBukxGbFu와 실제 dist CSS gate는 통과했다.

사전 고정8실행 ABBAABBA에서 baseline4회 중2회 실제 SDK+1동작 성공, candidate4회 중0회 성공이었다. 다섯 실행에서 actual SDK 대신 자동 local stub이 관찰됐고 하나는 initial cluster timeout이다. 이 실패들은 제외하지 않았다. candidate의 메모리·반응 시간은 측정하지 못했으며0으로 채우지 않았다. 효과·95% CI·메모리 guard 통과를 주장하지 않고 배포/성능admission0으로 보존한다.

이 연구는 다른 결함을 확인했다: useNaverMaps의 live script.onerror/onload(API없음)가 loadLocalNaverStubFallback을 호출한다. 이 source 경로는 현재 운영 SHA1884에도 존재하지만 배포 asset의 실패 경로 실행은 별도 확인이 필요하다. fail-visible+명시적 retry 수정은 sibling naver-live-failure-state-20261013-v1와 PR3198에서 진행하며 CSS 후보는 포함하지 않는다.

모든 실행은 Chrome155/Node24.21.0/Next16.3.8 production,390×844,dpr1,CPU4,cacheoff,합성REST735/Auth401이다. actual SDK성공2회의 scriptSHA는 기존 pinned802f...와 같았다. SDK실패 실행에는 receipt가 없다. compare-plan과raw·스크립트를 함께 보존한다. Source/root/receipt를 새 격리 checkout에 준비한 뒤 comparison-plan-v1.json의8개 순서와각1동작을 재현하되 새output이름을 사용한다. 네트워크 오류/모의 지도는 실패로 남긴다.
