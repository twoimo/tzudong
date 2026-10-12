# 조회 콜백 메모리 보유 경로와 production 인라인 진단

원격에 고정한 이전 증거1046f7bd를 새 managed worktree로 복구하고, 메모리 원인의 추가 참조 경로를 실제 Chrome production 흐름에서 확인했다. Original179f와 이전 frozen188파일 패킷은 변경하지 않았다. 복구 verifier가188파일/고정map SHA를 통과했다.

원래 캐시 후보21a는 계속 미채택이다. 실제128검색·128재방문 후 conditionalWeakMap 경로의 추가735개 selection snapshot 형태가 확인됐으나 전체5.15MB의 독점 retained-size나 leak 원인은 아니다. 같은 흐름에649개Query가 남고 Query.options 콜백이 컴포넌트의 bound dispatch/Fiber에 연결되는 별도 경로가 관찰됐다.

Main056a를 기준으로 동일 조회 로직을 모듈 팩토리로 옮겼다. 단계1(0718)만으로 Fiber1202→1202였다. 옵션 이름과 내부contextedge역할을 좁힌 진단에서16검색·16재방문 기준 own-context QueryFn capture51→19, getNextPageParam16이 계속16Fiber를 참조했다. 단계2(e362)에서 페이지커서도 공유 모듈 함수로 옮겨 해당 직접참조0을 확인했지만 전체Fiber1202는 유지됐다. 단계3(3e64)에서 검색·인기 조회도 분리해128검색 기준 직접상태참조 queryFn131→1로 줄었지만 Fiber1214였다. 직접참조 감소를 전체 보유 경로 제거로 해석하지 않았다.

실제 minified production JS AST에서 네 팩토리가 component 안의 FunctionExpression IIFE로 다시 인라인된 것을 확인했다. 반환 함수의 context.previous 경로로 render context가 남을 수 있어 소스 분리만으로 충분하지 않았다. 단계4(81d5)는 두 불변 함수 목록의 member lookup을 사용한다. 기록하는 것은 고정된 함수5개 참조이며 query history/global mutable cache를 추가하지 않는다. JS AST의 inlinefactory4→0/opaquemember4, 같은 실제 SDK 흐름256동작 통과를 확인했다.

공간 모델은 캐시된 함수Q개가 컴포넌트의 공유 lexical environment와 연결되는 O(Q×보유 컴포넌트 그래프) 경로를 데이터 입력과 고정 함수목록 O(1)로 분리하려는 것이다. 그래프 공유가 있어 단순 합산하거나 이 모델을 독점 retained bytes로 계산하지 않는다. Query/data의 기존 보존 시간과 범위, 키, 네트워크·페이징·사용자별 좋아요·승인된 리뷰 조건, 입력/스타일/훅 순서는 유지했다. 효과는 실제 production AST와 browser 소유 경로에서 검증하며 이론상 이득을 UI 성능으로 보고하지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 검색128개·재방문128개 | Chrome154/Next16.3.8/CPU4/390×844, 조건당1프로세스 | React Fiber 객체 수 | 1202 | 946 | 256 | 21.30% | n=1/GC 후 진단, CI 없음 | 구조 관찰; 자연 heap 개선 판정 아님 | query-owner-v1/ui-query-owner-before-v1/raw.json · query-owner-stage4-v1/ui-query-owner-stage4-after-v1/raw.json |
| 검색128개·재방문128개 | Chrome154/Next16.3.8/CPU4/390×844, 조건당1프로세스 | detached DOM 분류 객체 수 | 938 | 938 | 0 | 0.00% | n=1/GC 후 진단, CI 없음 | 구조 관찰; 자연 heap 개선 판정 아님 | query-owner-v1/ui-query-owner-before-v1/raw.json · query-owner-stage4-v1/ui-query-owner-stage4-after-v1/raw.json |
| 검색128개·재방문128개 | Chrome154/Next16.3.8/CPU4/390×844, 조건당1프로세스 | Query 객체 수 | 649 | 649 | 0 | 0.00% | n=1/GC 후 진단, CI 없음 | 구조 관찰; 자연 heap 개선 판정 아님 | query-owner-v1/ui-query-owner-before-v1/raw.json · query-owner-stage4-v1/ui-query-owner-stage4-after-v1/raw.json |

Before source056a86600f412eb42df4304e3206841679012f3e, 최종 로컬 source81d5aca4951e7cef5d67c1e910f31b3436597466. 최종 변경9파일은 source-manifest-final-v1.json/source-final-v1.patch에 결속했다. 정확한 named production build와 CSS gate 모두 통과했고, 최종buildID ZtFOfbea7z7ELcNeBC7wL이다. Unit3463pass/11skip/0fail, 관련64pass, lint0, native7.0.2/compat6.0.2 parity0(logical3149). Stage3의 누락된 history.select 상수 import를 TypeScript가 잡았고 공유상수 import/export로 복구했다. 처음 Source-contract 검사 실패는 옮긴 실제 read module을 따라 수정했으며 경계 검사와 동작 검증을 유지했다. 실패 로그는 남겨 두었다.

Node24.21.0/npm11.6.2/Bun1.4.0/Playwright1.63/Chrome154.0.8037.98. Node/npm 글로벌 설정은 변경하지 않았다. 기존 operator.env는 RAM에서 전체 parse하고 공개4설정만 build에 전달했다. 값이나 server key를 저장·출력·forward하지 않았다. 모델/프로바이더/새 유료용량/기기/호스트 SQL·Storage·배포 설정 변경0이다.

브라우저는 실제 remote Naver SDK/타일, SHA802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1을 사용하며 REST735/Auth401은 합성이다. DOM선택/센터/중복marker/mapCreates1을256동작마다 확인했다. Physical Galaxy·Samsung Internet/실제auth·비공개review/Field성과는 이 검사 범위 밖이다. Page0/console2(CSP1+other1)와2434restaurant requests를 최종 실행에서 관측했다. 오류를 숨기거나 CSP를 넓히지 않았다. 정지 캡처로 flicker율/지속시간을 주장하지 않는다.

Heap snapshot64MiB cap과 raw문자열/id RAM-only 계약을 지켰다. v3는 context class exactname 가정 때문에 실제 shortestpath와0counter가 모순되어 zeroownership proof로 무효다. 원자료와 INSTRUMENTATION-LIMIT-v3.json을 유지했다. v4는 실제closure.internal.context edge역할로 고쳤고 classunknown/비Fibernegative/privacy의2회귀테스트 통과했다. 이전4/5parser/cap정리 검사도 보존했다. 모든 객체 counts는 post-snapshot이며 GC를 유발할 수 있다; exclusive retained size, 전체 누수 없음, 자연heap guard를 대신하지 않는다.

새 primary root ../query-callback-memory-primary-20261012-v2에서 AA4+AB9쌍/18프로세스, 각각256종속동작을 사전 계획으로 고정했다. ForcedGC/profiler/ownbuild·test 없이 실행하고 heap20%/input15% guard, seed20261009/20kbootstrap을 유지한다. 이 보고 시점에는 실제 process가 진행 중이므로 최종성과/CI/admission을 선언하지 않는다. 준비만 하고 실행하지 않은 v1plan은 PREPARATION-ONLY로 보존했다. 낮을수록좋은 감소량=before-after, 상대=(before-after)/before×100이다.

소스는 로컬후보이며 push/PR/보호된 승격·운영 배포가 끝나지 않았다. 기존 main056a 소스 승격과 운영1884의 차이도 유지한다. G037active 쓰기동결의 좁은11SQL 예외 승인은 아직 답변이 없고 apply경로를 우회하지 않았다. 원래 warm60/cold2000/lifecycle/pixel/서비스 재검증·prospectivefield/denominator/browsercohort·운영SQL/media 작업이 남는다. 사용자 지시대로 휴대폰은 사용하지 않는다. 전체goal은 완료가 아니다.
