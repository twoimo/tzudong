# 별도 heap 객체 형태 진단

primary v7 비교가 끝난 뒤 같은 archived production build/SDK/합성 REST735/Auth401에서 baseline·candidate 각각 fresh process1회, 검색128개+재방문128개를 실행했다. 두 실행 모두256동작 동등성을 통과했다. snapshot은 GC를 유발할 수 있어 자연 heap guard 표본에 포함하지 않는다. 원시 snapshot·문자열·값은 RAM에서만 처리했고 저장하지 않았다.

| 객체 형태 | Before 수 / 자체 bytes | After 수 / 자체 bytes | 직접 참조 배열 backing bytes Before→After |
|---|---|---|---|
| id/name/lat/lng/mergedIds |132 /4224|867 /27744|1572→10392|
| references/keys/unique |0 /0|133 /3192|0→182240|
| searched/restaurants |132 /2640|132 /2640|53640→53640|
| searched/visible/restaurant |0 /0|0 /0|0→0|

후보의 snapshot 검증은 살아 있는 row R개와 list별 참조·key 배열을 유지하므로 공간 비용은 O(R+Σ list길이)다. 이 실행에서는 baseline에 없던 list snapshot 형태133개와 selection key 형태735개가 추가로 관찰됐다. WeakMap 소유자가 살아 있는 동안 이 값도 유지된다. query history에 여러 list가 보유되는 경우 64-entry selection cache 한도만으로 전체 snapshot 메모리가 제한되지 않는다.

이 표는 property 집합으로 분류한 형태와 자체 크기이며 dominator/독점 retained-size 분석이 아니다. 참조 배열은 여러 형태와 다른 앱 상태가 공유할 수 있어 합산해 전체 메모리 비용으로 보고하지 않는다. single sample·post-snapshot 조건이므로 primary의 종료 +5.1501MB 원인을 전부 설명하거나 leak을 입증하지 못한다. 추가 캐시 비용의 보유 경로를 확인할 다음 진단 근거이며 후보21a86dca를 채택하지 않는다.

실행: pinned Node24.21.0으로 diagnose-ui-v1.mjs baseline heap-baseline-v1 128 2, candidate heap-candidate-v1 128 2를 새 evidence copy에서 직렬 실행한다. localhost3000이 점유되면 다른 작업을 종료하지 않는다. 원격 SDK 해시와 build/lock/helper 실제 bytes가 계획과 다르면 중단한다. 이 도구는 snapshot64MiB를 넘으면 고정 코드로 중단하며 raw contents를 저장하지 않는다. 개인정보가 포함된 실제 사용자 데이터나 로그인 세션에 이 진단을 확장하지 않는다.

고정 형태만 출력하는 분석기의 합성 fixture는 secret-like 값 미출력, 배열 bytes, 알 수 없는 schema 거부를 확인했다. 최초 stdin fixture의 문법 오류는 readiness-operating-20261012에 남겨 두었다. source/scorer admission·field·운영·물리 기기·픽셀 플리커 증거는 아니다.
