# 실제 SDK 흐름의 요청 경로 진단

8개 검색을 두 번 방문한 한 프로세스, 총16개 종속 동작에서 검색·선택·상세·marker 동등성 검사를 통과했다. 실제 Naver SDK와 원격 타일, 합성 REST735/Auth401, production build, CPU4, cache off/SW bypass, 390×844/DPR1/touch 에뮬레이션이다. SDK console의 Naver connect-src CSP 오류1회는 남아 있다. 기기·field·운영 성과와 자연 memory guard의 증거가 아니다.

CDP는 GET154회와 OPTIONS154회를 관측했다. 기존 Playwright restaurant counter는154회였으므로 이 실행에서는 GET 수와 같았다. 과거 counter2434회를 OPTIONS가 절반인 수치로 바꾸지 않는다. 그 실행의 method breakdown은 저장되지 않았으며 이번 소규모 진단으로 소급 추정하지 않는다.

첫 방문8개의 각 동작은 GET15회, 두 번째 방문8개의 각 동작은 GET4회였다. 초기 요청2회를 포함해 총154회다. 요청 shapes와 앱 chunk의 initiator 위치는 `raw.json`에 저장돼 있다. 검색어·ID·주소값·headers·body는 저장하지 않았다. 응답 transfer 또는 실제 hosted latency는 이 합성 REST 진단으로 증명하지 않는다.

`RestaurantDetailPanel.tsx`는 관련 리뷰의 맛집 후보를 이름마다4개 필드, 주소마다2개 필드에서 따로 읽는다. 이 진단의 한 이름·한 주소에 해당하는6개 shape가 각각8회 관측됐다. 요청 수 모델은 `4 × 고유 이름 수 + 2 × 고유 주소 수`다. 한 번의 안전한 union 조회가 동등하다면 이 부분의 요청 수는6→1로 줄일 수 있지만, 이는 아직 이론적 후보다. 결과 제한·부분 실패·literal escaping·관리자 변경·별칭/주소 일치·deleted duplicate·순서 의미를 보존해야 하며 UI/heap 이득은 새 전후 비교가 필요하다.

선택 ID·상호명 확인과 검색 refetch는 다른 shape다. 정확성 이유로 존재하는 호출을 중복이라고 단정하거나 staleTime을 늘려 숨기지 않는다. 정적 source hashes는 production build source와 현재 review head에서 네 파일이 같음을 확인한다. 이 자료의 표본은 독립 프로세스1개이므로 p95, 신뢰구간, 개선율 또는 사용자 모집단 성과를 계산하지 않는다.

새 실행 전에 기존 PORT·HTTPS·build/source/SDK admission을 확인한다. 원래 memory 후보의22회 결과, guard 미충족과 모든 실패는 별도 패킷에 보존돼 있다. 이 진단으로 그 후보를 승격하지 않는다.
