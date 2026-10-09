# 승인된 웹 리뷰 결함 후속 수정 · 2026-10-09

제품7파일과 관련테스트5파일을 안정화했다. 소유 source SHA는 `approved-source-manifest.json`이다. 기존17-thread 감사는 당시 snapshot으로 보존하고, 이번 소유5개 thread의 local addressed 결과는 `approved-web-thread-results.json`에 분리했다. GitHub 게시/resolve/commit/push는 하지 않았다.

| 지적 | 변경 | 실제 검증 |
| --- | --- | --- |
| PRRT_kwDOQGRyNc6pyg6w · graph typing |250ms 입력 debounce. raw input 변화로 page를 즉시 재조회하지 않고 committed query 변경 때 node/edge cursor를 함께 초기화 | current30/88 graph desktop/tablet/mobile 각각 typing burst→HTTP GET1회 |
| PRRT_kwDOQGRyNc6qme8W · graph selection | queryKey에서 selected를 분리하고 loaded nodes에서 즉시 상세 선택. 페이지/refresh 조회에 selected를 동반하여 off-page 데이터 유지 | 세 폭 Enter→상세→Escape/focus return, loaded selection 추가 GET0회.101-node fixture page transition1회, later-page 검색1회/cursor와선택초기화 |
| PRRT_kwDOQGRyNc6pzgm5 · pipeline reliability | `pipelineDisplayIsReliable`가 실제 displayed Unknown downgrade를 반영. statusLabel/안내/제어/실패 숫자가 이 경계를 사용하며 snapshot undefined narrowing도 수정 | manifest없음/다른run→일부미확인, 같은validrun→GitHub Actions. fallback control은 모두잠김. job_api 동작의 기존test도 유지 |
| PRRT_kwDOQGRyNc6qm-hm · users exact readback | requireAdmin 후 bounded user_id UUID GET, AuthAdmin getUserById1개 + bounded metadata RPC. UI가 exact target를 먼저 확인하고 기존 filtered list를 별도로 유지. generation/AbortSignal로 이전응답의state갱신을막음 | renamed target가 old search에서 없어도 exact expected fields로확인. missing/wrong/newer nonmatching/aborted old response는lock유지. actualGET worker는401/403/invalidUUID/missing404/ID-only조회검증 |
| PRRT_kwDOQGRyNc6qm-ht · refresh exact readback | requireAdmin/no-store/UUID bounds를유지한 candidate_id exact `.eq(id).limit(1)`. UI는원래필터목록+exact read를분리하고임의필터reset을제거 | newest100 밖target를 정확조회·확인. 목록검색/상태필터유지. missing/wrong/conflict/oldtimestamp/read failure는확인으로승격하지않음 |

User 캡처에서 확인된 stale ‘재조회 필요’ toast도 exact 확인 성공 시 ‘상태 재확인 완료’로 교체했다. 기존 v1 title adapter, 실제 CAS, canonical data/원문, shared vault, model/queue/operating 경계는 수정하지 않았다.

## 증거와 범위

- focused45 tests/4files 통과. 확대 affected67 tests/8files, 관련 density/skeleton source contracts2개 통과. 새 runtime AbortSignal test가 canceled earlier exact read의 pending/loading 덮어쓰기를 막는 실제 loader body를 검증한다. 기존 literal assertion은 삭제하지 않고 current-generation+non-aborted 의미 및 generation 체크까지 강화했다.
- actual GET handlers를 disposable Bun worker에서 import해17조건을 확인했다. SDK/DB/Auth는 synthetic mock이며 requireAdmin의401/403에서 privileged factory 호출0, invalid ID400, missing404/no-store, user target1개 및 candidate limit1을 검증했다. 운영 Supabase query는 하지 않았다.
- 브라우저9 flows: currentgraph3폭 + synthetic101-nodepagination1 + pipeline3상태 + userreadback1 + refreshreadback1. Graph는 실제 `readLocalKnowledgeGraph`를 HTTP fixture gateway로 읽는다. 나머지 Auth/DB/상태/사용자 데이터는합성이다. PATCH/POST2회는 Playwright route.fulfill이 local memory에서만처리했으며 operating/API server로forward하지않았다. pageerror0, external forwarded0. GET request count는 실제 browser requests를 센 값이다.
- 기존 원시 실패/중간 결과와 캡처는 보존했다. 첫 heading locator는 SheetTitle과detail h2가겹쳐정확한detail영역으로좁혔다. pipeline버튼은현재UI‘실행 관리’로수정했다. 이를 product success로바꾸거나 assertion을제거하지않았다. graph/pagination 통과 뒤 필요한pipeline/readback만 이어갔고 toast 수정 후 user만재검증했다. `resumedFrom`으로 원시 결과의연결을기록했다.
- ESLint exit0, Node24 compiler parity diagnostics0/logical inputs3314, git diff --check 통과. 전체web suite/build는 root의후속 batch 범위다. 배포/실운영/authenticated physical device/대형graph latency·quota savings는증명하지않는다.

## 공식 API 확인

설치된 @supabase/supabase-js2.117.2를 유지했다. [현재 JS getUserById 문서](https://supabase.com/docs/reference/javascript/auth-admin-getuserbyid)의 UID/server-only 경계와 installed types를 대조했다. [changelog](https://supabase.com/changelog)도 관련 breaking 항목을 확인했으며 SDK/pins를업데이트하지않았다. search_docs의 첫 결과는C# reference여서JS근거로사용하지않고공식JS페이지로확인했다. changelog.md는웹도구의markdown content-type 제한으로열리지않아공식HTML index를사용했다. 문서확인은운영프로젝트접속/권한/DB검증증거가아니다.

## 종료/보존

소유 fixture55410/dev11566/browser92261 및 이전owned browser runs는종료됐다.20512/20513/20514 listener0. 기존PID57309/19872 유지. compiler가추가한 소유dist include2개만제거했고expected/head JSON equality 및원래 SHA776471d5c093f02d7d3d24c3c1b61736c8d685a9ed1ef3d13c48f1f804396b17 복원을확인했다. CLAUDE.md/shared source는보존했다. generated dist와 private synthetic fixture는재현용으로남기되artifact map/commit 입력에서제외했다.

공식댓글resolution이나다른소유5개결함의상태를이번보고서로판정하지않는다. Root는최종source hash에대한전체suite/build 및별도운영단계를진행할수있다.
