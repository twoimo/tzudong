# 관리자 UI와 OSK 지식 그래프: 2026-10-04 작업 증빙

## 범위와 상태

후보 `codex/pipeline-performance-restart-20261002`에서 관리자 UI와 지식 그래프를 구현했다. 원본 작업트리·원본 크롤링 입력·운영 맛집 행은 변경하지 않았다. 이번 변경은 아직 운영 배포 증빙이 아니다. 전체 장기 목표는 완료되지 않았다.

관리자 제목을 16px/600/24px로 맞추고, 맛집 관리의 제목·건수·탭·뷰·자동 운영을 통합했다. KPI 5개와 콘텐츠 성과/성과 진단 헤더는 한 행이다. 일반 테이블·고정열은 같은 배경을 쓰고 선택·호버·실패 상태에 의미 있는 색을 사용한다. 사용자/배너는 검색·필터·선택 해제·미저장 보호·명시 확인·readback을 유지한다. 운영 보조는 설명 카드 대신 검수/자동 운영/파이프라인의 실제 GET 3개를 읽으며, 미확인 값을 0이나 정상으로 표시하지 않는다.

동선 추천 오류는 지도 좌표 메서드를 분리 호출하며 `this`가 사라지는 것이 원인이었다. `coordinate.call(value)`로 수신자를 보존했고 실제 private-field 메서드 회귀 검사를 통과했다. 인사이트의 모바일 컨트롤은 폭을 제한하고 지정된 가로 스크롤 영역에서 접근한다. 배너 hook은 원시 오류 메시지를 표시하지 않는다.

## 실측 UI

| 항목 | 변경 전 → 후 | 절대 차이 | 변화율 | 표본·환경·95% 구간 |
| --- | --- | --- | --- | --- |
| 콘텐츠 성과/성과 진단 헤더 높이 | 60 → 28px | −32px | −53.33% | 카드별 3개 폭(1423/834/390), 각 조건 1회, Node24/Chrome 합성 fixture. 통계적 구간 미산출 |
| 데스크톱 KPI 헤더 높이 | 47 → 24px | −23px | −48.94% | 5개 카드, 각 조건 1회, 1423px. 통계적 구간 미산출 |
| 맛집 관리 헤더 | 제목/조회/자동 운영 3개 영역 → 통합 상단 | 영역 통합 | 속도 수치 없음 | 1423px 한 행, 834/390px는 접근성을 위해 줄바꿈. 가로 넘침 0 |

높이 차이는 동일 합성 내용의 기하 관측이다. 사용자 작업시간·속도·운영 성능 향상으로 확대하지 않는다. 기준선/후보 원시 JSON, 화면 PNG와 당시 CSS 해시는 `apps/web/performance/ui-renewal-20261003/`에 있다. 후속 스타일 변경을 과거 측정의 소스 해시와 혼동하지 않는다.

15개 메뉴 × 3개 폭 × 2개 테마 = 90개 최신 조합을 확인했다. 84개는 렌더링 검사 통과, Sentry 6개는 정확한 `not_configured`다. 메뉴 진입 90/90, pageerror·문서 가로 넘침·잘린 컨트롤 0이다. 초기 전체 검사에서 발견한 오류와 HMR/검증기 실패도 보존했고, 변경되거나 실패한 조합만 재검사했다. 통합 summary는 각 조합의 보고서·SHA·시각을 연결한다. 이것은 하나의 배포 빌드에서 동시에 동결한 90회 실험이 아니다.

사용자·배너와 자동 운영의 위험 동작은 별도 브라우저 메모리에서 합성 응답으로 확인했다. 실제 인증·DB·도로 제공자·Sentry 수집·실제 승인/삭제·운영 배포·완전한 접근성 준수는 이 화면 검사에서 입증하지 않았다. 경량 접근성 검사의 이름 후보와 검색 의미 검증 한계는 summary에 남겼다.

## 실제 롱폼 목록과 claude-video

2026-10-04 공개 채널에서 `/videos` 1,051개, `/shorts` 80개, 완료된 `/streams` 18개를 수집했다. 중복·탭 겹침 0이며 합계 1,149개는 YouTube 공식 channels API의 공개 videoCount와 일치한다. 롱폼 대상은 일반 영상+완료된 라이브 다시보기 1,069개, 총 1,214,353초(337.3203시간)다. 길이 180초만으로 Shorts를 분류하지 않는다. 원본 1,127개 메타데이터는 과거 자료이며 현재 전체 수로 쓰지 않았다.

필수 도구 `bradautomates/claude-video`는 공식 commit `03ceb42f7fa2c4439aca01752118044baabffb8f`/0.3.2/MIT를 고정했다. 표준 CLI를 실제 호출하고, 명시 Gemini 3.8 Flash와 `--start 0 --end duration`의 전체 static 범위를 사용했다. 키·기존 watch 설정·유료 용량은 변경하지 않았다. 공식 Models GET은 입력 최대 1,048,576, 출력 최대 65,536을 반환했다.

실제 pilot 영상 1개(1,008초)의 watch subprocess 관측은 19.473894초, 총 93,409토큰이다. 입출력별 토큰·청구액·크레딧 차감은 제공되지 않아 비용 미확인으로 보관한다. n=1이므로 전체 시간/비용/정확도나 95% 구간을 주장하지 않는다. 식당 1개·메뉴 7개·관찰 2개는 모델의 관찰이며 독립 검증되지 않았다. 같은 유효 입력/배치의 재시작 7회는 모두 결과를 재사용했고 추가 제공자 호출은 0이다. 다른 입력의 재사용이나 불확실 결과 재전송으로 확대하지 않는다.

작업 하한은 `T ≥ max(총 처리 작업량/C, 60×요청수/RPM, 60×입력토큰/TPM)`다. 실제 프로젝트 한도와 여러 길이의 표본이 없으므로 전체 실행 ETA는 확정하지 않는다. 입력 최대치를 호출마다 예약하는 값은 안전 admission 상한이며 예상 사용량이나 금액이 아니다. 명시 상한 없는 실행은 차단하며 timeout/부분/손상은 자동 재요청하지 않는다. contentSha가 없으면 ID·길이를 유지한 원격 영상 편집을 탐지하지 못할 수 있다.

## OSK 저장과 관리자 조회

공식 OSK 엔진의 현재 API 파일 SHA를 설치본과 대조했고, 사용자 요청에 따라 `00_Scope/tzudong` 허브를 만들고 `session=tzudong`으로 결속했다. `graph.Index`와 `Node.references`를 실제 사용해 양 끝이 Tzudong인 연결만 내보낸다. 다른 Scope 내용·이름·ID는 관리자 응답에 들어가지 않는다. JSON 전체 대신 관리자 인증 뒤 기본 100개/최대 200개, revision에 묶인 커서·검색·종류·선택 근거를 반환한다. 상세 근거 URL은 정확한 영상 ID/타임코드의 YouTube URL로 제한한다.

현재 실제 OSK는 허브 포함 13노드·43간선이다. 영상 1개·식당 1개·메뉴 7개·관찰 3개를 저장했고, 근거 12개는 모두 미확인 상태다. 모델 관찰을 독립 검증된 사실로 승격하지 않는다. 분석 완료 표시 0/1,069, 전체 처리가 남아 있다. source revision과 validator 결과를 보관한다. 관리자 메뉴는 `/admin?module=knowledge-graph`다.

## 후속 복구·소스 검증

최신 배너 목록의 `<ul>/<li>` 구조를 390/1423px에서 재확인했으며 두 조건이 모두 통과했다. 최초 데스크톱 실패는 검증기가 숨겨진 모바일 버튼의 bounds를 기다린 문제였고, 해당 조회를 모바일 조건으로 제한했다. 실패 원시 기록을 유지했다. 브라우저 보고서에는 실제 소유 session 이름을 기록한다.

지식 그래프는 초기 조회 실패 시 분석·실패 수를 `—`로 표시한다. 오래된 커서 오류의 재조회는 커서를 제거한 첫 페이지 요청만 수행한다. 별도 1423×1000 합성 브라우저의 28개 assertion이 통과했고, 409 복구 요청 1회·오래된 cursor 재전송 0회·브라우저 예외 0건이었다. 초기 503 요청은 2회 관측되어 초기 중복 요청까지 제거했다는 주장은 하지 않는다. 선택 상세·타임코드·검색·빈 결과·검색 해제·목록/그래프 클릭도 확인했다. `performance/knowledge-graph-20261004/recovery-browser-20261004.json`이 해당 소스 SHA와 관측을 보관한다.

전체 웹 suite의 보존된 결과는 2,729 pass·9 skip·0 fail이다. 마지막 그래프 복구 및 snapshot 변경 후 관련 graph API/query/sidebar 12개도 통과했다. 최종 빌드 전 결과와 이후 수정을 혼동하지 않는다. 이 기록은 로컬 검사이며 실제 Supabase·Sentry 수집·배포 증빙이 아니다.

허브의 누락 링크 10개를 보완하고 실제 OSK를 다시 내보냈다. 현재 revision은 `6ba74b6b1a486cee4a99a0f2bdb361d6a012e3505fc2d1d1326c948f206e6ba9`, 12노드·39간선·10,185bytes다. 독립 검증 완료는 여전히 0/1,069이다. OSK 조직 검토는 2개 구간을 검토한 뒤 deferred로 기록했고, 남은 10개 구간과 분석 근거를 완료로 간주하지 않았다.

현재 변환 소스 checkpoint를 조건별 7쌍(총 42개 subprocess)으로 다시 비교했다. 1,257개 결정적 출력은 각 조건의 전후 해시가 일치하며 원본 입력의 전후 해시도 일치했다. 표는 p75, 변화율은 `(후−전)/전×100`, 95% 구간은 10,000회 짝지은 percentile bootstrap이다.

| 변환 조건 | 전 → 후 | 절대 차이 | 변화율·95% 구간 | 표본·환경 |
| --- | --- | --- | --- | --- |
| 변경 없음 | 441.237 → 217.832ms | −223.405ms | −50.63% [−54.79, −50.63] | 7쌍, macOS/고정 Python subprocess, 실제 원본 읽기 전용, 네트워크·DB 0 |
| 입력 5개 변경 | 563.711 → 447.751ms | −115.960ms | −20.57% [−30.97, −2.56] | 동일 |
| 최초 실행 | 401.637 → 634.970ms | +233.333ms | +58.10% [+49.50, +58.10] | 동일, 악화 |

최초 cache 검증 비용은 이 부분 실험 p75 기준 변경 없는 재실행 2회로 회수한다. CPU·최대 RSS·p50/p75/p95와 source/dataset SHA는 `performance/pipeline-20261002/transform-final-followup-20261004-summary.json`에 있다. 이는 변환 함수 부분 실험이며 전체 파이프라인, 운영 지연, 실제 비용, G003 공식 성능 주장이 아니다. 과거 실험·회귀와 새 실험은 각각의 원시 시점에 묶어 보존한다.

## 자동 publication과 추가 UI 요청

완료된 분석 영수증을 pinned OSK 공개 API로 반영하는 publisher를 구현했다. 실제 engine의 격리 fixture 테스트 9개, projection/longform 포함 53개가 통과했다. 내용 SHA·원래 모델 증빙·공통 잠금·CAS·ACK 유실 readback·부분 생성 재개·허브 연결을 검증한다. 계획에서 node/edge/JSON/scope/hub bytes의 보수적 상한을 계산하고 한도를 넘으면 첫 쓰기 전에 중단한다. 분석 전 결과 크기는 추정하지 않으며, 노드를 잘라 한도에 맞추지 않는다.

사용자가 요청한 실제 Tzudong scope에도 pilot를 반영했다. 이전 11개 노드의 본문을 보존하고 publication 출처를 연결했으며, 원래 유료 분석에 있던 식당 내부 관찰 1개를 추가했다. 저장 후 12개 노드 hash의 readback 차이는 0개였고, 같은 publisher 재시작은 12개 재사용·새 생성/갱신 0개·추가 provider call 0이었다. 현재 export는 13노드·43간선·11,201bytes, revision `3f598e25271f223a0415c1560c151b79c3cdbc781fc64e2270c0196aa1d60767`다. 근거 상태는 모두 미확인이며 독립 검증 완료는 여전히 0/1,069다. 실제 로컬 OSK 저장과 운영 맛집 DB·배포는 구분한다.

사용자의 후속 요청에 따라 메뉴·본문 제목·접근성 이름은 ‘영상 성과 분석’으로 바꿨다. `/admin?module=insights`와 저장된 메뉴 ID는 유지한다. 관련 기존 47개 검사는 통과했다. 크롤러 페이지의 실제 흐름 시각화와 Gemini 추천이 선행하는 자동 검수를 구현·격리 검증했다. 당시 신규 SQL과 운영 배포는 적용 전이었다. 아래 후속 검증에서 운영 SQL 상태를 갱신한다. 설명을 더하는 대신 상태·근거·필요한 실행 제어를 밀도 있게 배치한다.

## 파이프라인 다이어그램·Gemini 자동 판단 최종 검증

크롤러 콘솔에 8개 단계·8개 간선의 responsive SVG DAG를 적용했다. 마지막 manifest와 현재 실행 목록의 run ID 연결은 기존 API로 입증할 수 없어 분리했다. 선택 단계의 시간·입출력·소스 근거, 키보드·클릭, 실패/선택 생략/미확인 상태와 dry/live를 구분한다. 실행 제어는 preview → confirmation → apply → readback을 유지한다. 관련 26개 검사, 3개 폭×2테마의 6개 렌더, 합성 적용/실패 검증을 통과했다. 잘린 라벨·가로 넘침·페이지 오류는 0개다. 합성 Realtime websocket 오류는 별도 관측으로 보관했다. 정적 archify artifact는 9/9 검사·경고 0이며 앱 렌더·정적 HTML·운영 실행은 서로 다른 증빙이다.

Gemini 3.8 Flash의 자동 검수 추천과 재검수를 기존 한 호출에 결합했다. 자동 승인 집합은 `모델 승인 추천 ∩ 서버 필수 평가/위치/중복/identity 조건 ∩ 보호/CAS/정책 유효성 ∩ 승인 한도`다. 선행 추천이 없는 새 승인은 거부된다. 6개 승인 근거 코드가 모두 필요하고 모델 confidence는 정확도로 취급하지 않는다. 신규 SQL은 미적용이다. 기존 평가와 실제 eval_basis를 보존하며 별도 판단 이력에는 정형 코드·모델·입력/prompt SHA·실제 결론·시각만 남긴다. 54개 worker/helper/SDK/PG 검증에서 합성 보호 위반 0개를 확인했다.

UI는 실제 judgmentEngine metadata가 있을 때만 Gemini 검수 상태를 표시하며, legacy enabled는 ‘판단 연결 미확인’이다. 이력에서 권장 승인과 실제 blocked/deferred/hold를 구분한다. 390/1423px의 70개 assertion, 12개 가로 넘침 관측 0, 브라우저 예외 0을 확인했다. 정확한 run UUID·version·hash·confirmation과 불확실한 응답의 같은 UUID 재확인을 유지했다. 이는 브라우저 메모리의 합성 응답이며 실제 적용이 아니다.

실제 공급자 합성 검증은 사용자 데이터와 DB를 사용하지 않은 1회다. 정확한 `gemini-3.8-flash` 응답에서 `hold / insufficient_evidence`, 4,763.95ms를 관측했다. 토큰은 입력 360·출력 422·thinking 971·합계 1,753이다. 입력이 불충분한 한 사례의 API/형식 관측이며 모델 정확도·모집단 CI·금액 절감·크레딧 차감액을 주장하지 않는다. 원시 증빙은 `review-gemini-real-smoke-20261004.json`이다. 사전 임시 문자열 실행의 파싱 실패 이후 파일 기반 probe를 사용했으며, probe는 실행 전 receipt를 기록하고 재전송을 차단한다.

최종 통합 웹 suite는 **2,756 pass·9 skip·0 fail**, native/compat parity는 diagnostics 0, Next production build 및 CSS 경계 검사도 통과했다. 관리 CSS는 381,344bytes/gzip 70,655bytes로 정해진 상한 안이다. 이 값은 전후 속도·비용 개선율이 아니다. 불필요한 개인 build tsconfig 추가분만 제거했다. 관련 source/artifact SHA와 이후 변경의 차이는 별도 checkpoint map으로 보존한다.

## 다중 모델과 남은 요구

네이티브 GPT-6 Astra Xhigh 독립 검토가 SQL 동등성/계산량, 승인·개인정보, 성과 증빙, 전체 화면에 참여했고 실재 결함과 소스-증빙 불일치를 보고했다. AGY Claude Opus 5.5 High 경로와 실행 모델 ID를 확인했지만 CLI 최종 결과 회수 지연 및 HTTP429로 완료된 독립 검토라고 표시하지 않는다. 기존 기록을 보존했고 다른 모델/낮은 추론 강도로 조용히 대체하거나 용량을 구매하지 않았다.

아직 전체 롱폼 분석·독립 근거 검증·운영 스케줄의 OSK publication·최종 파이프라인 5조건×7쌍·실제 HTTP/화면 전후100쌍·G003 운영 관측·source 보호 승격/배포/readback이 남는다. 경고 집계 SQL의 허용 Unicode 동등성과 계산량 admission, G014 소스 계약을 보완했다. 기본은 기존 전체 경고 stream이며 새 RPC는 명시 opt-in이다. 전체 canonical 로컬 replay를 통과했으며 운영 적용은 미완료다. Sentry 저장 region/연결 정보와 카드 삭제의 유효 대체 결제 수단도 미확인이다. 기존 측정의 cold/media/DB write 회귀를 숨기지 않는다.

## 전체 DB 재생 후속 증빙

깨끗한 관련 source commit에서 G014 전체 canonical 로컬 replay를 완료했다. 격리 Docker 설정은 사용자 자격 증명/플러그인 경로를 복사하지 않고 설치된 Compose v2 호환 CLI를 사용한다. Docker plugin2.39.4와 standalone5.6.0의 차이를 확인했고 현재 전체 실행은 standalone5.6.0이다. 관련50개 검사, source/schema/권한 재생과 산출물 checksum 검증이 통과했다. 기존 컨테이너·설정·데이터를 정리하거나 운영 DB를 호출하지 않았다. `apps/web/performance/catalog-replay-20261004/local-replay-summary.json`이 source commit, 실제 server version, catalog row 수와 원시 산출물을 연결한다. 이는 격리 source 재생이며 운영 현재 catalog·마이그레이션 이력·배포/readback을 대체하지 않는다.

## 운영 버전 혼합 경로 보완

운영 migration ledger는62개, 최신20261003113923이고 새 Gemini 판단 SQL은 미적용이다. 실제 정책은 enabled=false·version1·회당50/하루50·마지막 실행 null로 읽었다. 새 API의 start/run과 새 worker는 mutation 이전에 실제 status.judgmentEngine의 provider/model/promptVersion/requiredForApproval/maxCallsPerClaim을 확인한다. 부재·불일치에서는 tick·claim·provider 호출0으로 중단한다. 읽기와 중지는 유지하며 legacy UI의 실행/설정은 비활성화한다. 관련 API/DTO15개·worker28개 검사가 통과했다. 신·구 버전 조합에서 기존 SQL의 추천 없는 승인을 호출하지 않는다.

운영 Vercel의 정확한 프로젝트·GitHub twoimo/tzudong·root apps/web·Node24.x를 공식 connector와CLI56.5.0으로 확인했다. 현재 production alias의 READY deployment에서 rollback SHA `ca235e250957c4360ad713ffd29e118c11cc5b7c`를 새로 읽었다. 이 상태와 소스 재생은 운영 배포/readback과 구분한다.

원시 DB 재생 SQL 두 파일의 원본 trailing whitespace는 byte/hash 보존을 위해 유지했다. 해당 원시 산출물의 whitespace 진단을 소스 오류와 혼동하지 않았으며 실제 신규 코드의 diff 검사와50개 원시 checksum 검증은 통과했다.

후속 admission UI는 390/1423px67개 assertion·가로 넘침10개 관측0·예상 밖 오류0을 확인했다. 이전70개 보고서는 원시 SHA 그대로 유지한다. 새 API/DTO15개·worker28개·native/compat 진단0·최종 Next build·CSS 경계가 통과했다. 마지막 전체 suite2,756/skip9 이후 변경은 해당 경로만 재검사했으며 전체 숫자를 추정해 늘리지 않았다.

CI의 layout/naming 검사는 새 backend/knowledge_graph 패키지의 소유 경계 등록 누락으로 실패했다. 실제 소유·허용/금지 내용과 source classification을 layout manifest에 추가하고 트리 개수를38로 갱신했다. 관련76개 검사와 재생 원장을 다시 확인한다. 기능 변경이나 사용자 파일 이동은 없다.


## 헤더·파이프라인 밀도 후속 검증

15개 메뉴가 공통 `AdminPageHeader`를 사용한다. 390/834/1423px의 45조건에서 제목은 16px/600/24px, 좌우 padding12px, 가로 넘침0이었다. 데스크톱 헤더 높이의 범위는28–59px에서57px으로 통일했다. 최소 높이는29px(+103.6%) 늘고 최대 높이는2px(−3.4%) 줄었다. 범위 폭(max−min)은31→0px이다. 모바일 버튼은 최소44×44px이며, 필요한 행동을 숨기지 않고 좁은 화면에서 줄을 바꾼다. 본문 결과는42개 렌더 검사 통과/3개 Sentry 미설정이다. 이를 전체 운영 페이지 정상 동작이나 Sentry 연결 완료로 표시하지 않는다.

| 파이프라인 기본 화면 | 전→후 | 절대 차이 | 변화율 | 표본·환경·95% CI |
|---|---|---:|---:|---|
| 높이/390px | 1314→727px | −587px | −44.7% | n=1/조건, 합성 로컬 Chromium; CI 미추정 |
| 높이/834px | 1248→723px | −525px | −42.1% | 동일 |
| 높이/1423px | 1017→637px | −380px | −37.4% | 동일 |
| 기본 노출 문자 | 757→271 | −486 | −64.2% | 동일; DOM innerText, 공백 정규화 |
| 설명 블록 | 3→0 | −3 | −100% | 동일 |

이 값은 결정적인 화면 기하·문자 수의 관측이며 처리 속도·통계적 우월성 주장이 아니다. 기하 noise budget은±1px, 문자수0이다. 상태·건수·실행은 기본 화면에 두고 실행 ID/환경/근거는 상세로 옮겼다. DAG8노드/8간선·선택·키보드·실행 확인/적용 경로를 보존했다. 헤더77개/파이프라인26개 관련 검사 및3개 파이프라인 렌더가 통과했다. 최종 web build는 소스·lock·설치가 일치하는Next16.3.8/Node24에서 통과했고 route CSS 경계도 통과했다. 전체 unit 실행은2717pass/1skip/새 replay 등록 기대값1fail이었다. 이를 수정한 해당17개 검사를 재검증했고, 다른 통과한 검사를 다시 실행한 전체 green 결과로 바꾸어 쓰지 않는다.

증빙은 `ui-renewal-20261003/admin-page-header-comparison-20261004-astra.json`, `pipeline-density-comparison-20261004.json` 및 각각의 detached SHA에 있다. source/로컬 render/운영/배포는 별개다.

## 운영 SQL 적용·가입 확인 정합 수정

운영 PostgreSQL17.6의 정확한 이력62건을 읽기 전용으로 대조했다. CLI2.119.0/TLS verify-full/저장소 CA를 사용해 선택형13개만 dry-run 대조 후 적용했다. Vault 동기화·seed·일괄 role 파일·history repair는 사용하지 않았다. 이후 원본 PG17 owner 복구, 가입 확인 identity 정합 수정, 최종 verifier를 각각 fresh ledger/단일 pending 팩으로 적용했다. 이력은62→75→76→77→78이고 각 단계의 기존 version/name/statement 배열 SHA는 보존됐다.

최초 최종 verifier는 오래된5인자 가입 확인 항목 때문에 실패했다. 실제6인자 nonce-bound 함수는 canonical 본문 SHA `b6a478e40bbb98fbd0d2e4a7993295000d33792093dcf0688b05b33f6363bf4e`와 일치했다. 폐기된5인자/service_role 항목1건과 catalog assertion의 같은 서명1곳만 정합하게 바꿨다. 6인자 함수·ACL·기본 인자0개·nonce 검증·다른 catalog 조건은 보존했다. 실패·롤백 preview는 별도 증빙으로 남겼으며, 처음 실패한 verifier source `a2a50b99…`도 보관했다. 신규 수정은 운영 적용 전 nativePG17 성공/각 assertion 실패/권한·함수 metadata·rollback 검사15개를 통과했다.

최종 실제 운영에서 workflow-owner/public-RPC/definer/catalog assertions4개가 통과했다. 임시 helper0, postgres의 workflow-owner USAGE/SET 모두false다. 맛집1659건 전체 to_jsonb 행 SHA는 모든 단계 전후 `32a58ac590418a889708c0fc97539fe7ca5b20a97f0ba43c7b5226340acc8458`로 같다. 검수 정책은 적용 전후 OFF/version1/회당50/하루50/last_run=null을 보존했다. 임의 승인·provider 추론·추가 충전은 수행하지 않았다.

service_role의 운영 read RPC는 요청50건/반환50건/전체1659건/hasMore=true를 반환했다. JSON text188983bytes, n=1이다. 실제 전후 지연·전송량 비교 실험이 아니므로 개선율·95% CI·금액 절감을 추정하지 않는다. anon/authenticated EXECUTE는 모두false다. 운영 status의 판단 엔진은Gemini3.8Flash/restaurant-review-v1/승인 전 판단 필수/claim당 최대1회로 확인했다.

`rollout-preflight/hosted-*-readback*.json`과 SHA가 실제 receipt다. PG15 replay adapter의 verified-existing/legacy-contract-preserved는 현재 소스의 로컬 읽기 검증이며 운영 DDL 또는 최종 assertions 실행 receipt로 재사용하지 않는다. 운영 배포는 아직 수행하지 않았고, 병행PR3114와의 소스 결합 후 보호된 develop→data→main 승격·live SHA/readback이 남는다.


## 2026-10-05 다이어그램 중심 화면·결합 소스 검증

후속 요청에 따라 기본 화면은 공통 헤더와 다이어그램만 남겼다. 통계/실행 목록/환경/설명 accordion은 기본에서0개이며, 실행 관리는 상단 버튼, 단계 근거는 노드 선택의 패널로 옮겼다. 실행 확인/적용/readback 함수는 유지했다. SVG의 percent-height/ResizeObserver 순환 때문에 처음 높이가 작게 측정되는 문제는 캔버스에 절대 배치한 host로 수정했다.

1423px에서 다이어그램 높이는205→865px(+660px/+322.0%), 작업 패널 내 높이 비율은32.2→92.8%(+60.6%p)다. 390px에서는291→578px(+287px/+98.6%), 비율40.0→82.5%(+42.5%p)다. 기본 노출 문자271→129(−142/−52.4%). viewport별 n=1의 합성 DOM 관측이며95% CI는 추정하지 않는다. 처리시간·금액 개선으로 해석하지 않는다.

390/834/1423 렌더3건과 상태4건이 통과했다. 노드8/간선8, 잘림0, pageError0, 실제 server-bound POST0, 합성 확인/적용2건이다. consoleError14건은 합성 Realtime handshake10건과 의도된 HTTP/차단4건으로 분리해 기록했다. Enter/Space/방향키와 Escape 후 포커스 복귀를 검증했다. 관련26개 검사245assertions가 통과했다.

PR3114의 develop 변경을 결합한 source9e5a6b6의 분리된 설치 환경에서 전체 web2965pass/9skip/0fail(16 Bun batches), Next16.3.8/React19.3 build 및 CSS 경계, native/compat parity(진단0), layout/supply-chain49개, clean source의 orchestration22모듈213개 검증이 통과했다. 이후 다이어그램 변경의 관련26개 및 새 Gemini SDK2.24에서 Node25개가 통과했다. 기존18792/18793/18794 미리보기와 사용자 작업은 보존했으며 설치/화면 검증은 별도 체크아웃과18810/18811/18812 합성 환경에서 수행했다.

CI generate 실패는 타입 생성 단계 이전의 catalog artifact 비교였다. 새 PG15 검증 SQL/receipt4개가 artifact-manifest에서 빠졌음을 확인해 생성 목록에 등록했다. 비교기의 파일 집합/순서/SHA/양쪽 증빙 검사는 그대로다. 회귀21개가 누락/변조/체크섬 재작성 후 불일치 거부를 검증했다. 전체 CI replay의 최종 통과는 새 PR head에서 확인해야 하며, 운영 배포 완료로 표시하지 않는다.


## 2026-10-05 CMS 목록·상세 및 그래프 후속

Payload 공식 List/Pagination 문서의 검색·필터·선택 상세 패턴을 기존 앱에 적용했다. CMS 패키지를 새로 설치하지 않았다. 사용자·배너·제보·리뷰는 공통 toolbar, 목록 선택, 데스크톱 360px inspector와 좁은 화면 Sheet로 구성했다. 감사 로그는 최근 조회 항목 검색·상태 필터·선택한 항목의 펼침 상세로 바꾸고 범위 설명은 접었다. 사용자 expected-state readback, 배너 pending-readback 잠금, 미저장 편집 보호와 기존 제보·리뷰 mutation 함수는 보존한다. 리뷰·제보 및 감사의 필터와 수는 실제 조회된 범위에 한정하며 전체 운영 archive 검색이라고 표시하지 않는다.

지식 그래프의 기본 목록/근거 패널은 버튼과 노드 선택 Sheet로 옮겼다. 데스크톱·태블릿은 종류별 열, 모바일은 두 열 묶음이며 연결과 전체 건수·페이지·미확인 근거 상태를 유지한다. 390/834/1423px의 최종 합성 graph/audit 6조건에서 가로 넘침·pageError·검증 문제0, graph keyboard 선택·Escape 포커스 복귀와 audit 상세 선택을 확인했다. 감사 검색/상태를 추가 검증한3조건도 통과했다. 기존 첫 화면 실험은 감사 fixture가 DTO 필드를 빠뜨려 조회 실패를 표시했고 검증기의 오류 문자열 누락으로 pass로 분류됐다. 그 원시 결과를 보존하고 현재 오류 감지·정확한 synthetic DTO와 추가 검증으로 구분한다. 이전 pass를 정상 감사 목록 근거로 사용하지 않는다.

모바일 graph의 내부 sizing 수정 전후는 캔버스480→603px(+123px/+25.63%), 작업 면적 내 높이 비율60.91→76.52%(+15.61%p)다. 최종834/1423px 캔버스는773px/패널960px(80.52%)다. 내부 수정의 n=1/조건 합성 Chromium DOM 관측이며95% CI를 추정하지 않았다. 이는 원래 운영 화면과의 속도·비용 비교가 아니다. viewport 높이는960px, noise budget은 기하±1px이다. source/unit/render/운영 배포는 분리한다.

공통 UI 및 KG/audit 관련55테스트/4734assertions가 통과했다. 앞선 CMS 관련74테스트와 겹치므로 합산하지 않는다. 새 보고서는 ui-renewal-20261003의 cms-audit-graph-v2, cms-audit-filters 및 source-bound manifest다. 운영 쓰기와 provider 호출은0이며 새 UI의 보호 승격·배포 검증은 남아 있다.

## Transform ownership 수정 후 신규·재시작 측정

receipt가 없는 최초 증분 실행에서 기존 파이프라인 소유 행이 남는 결함을 고쳤다. 현재 입력의 channel/source family/video와 미검수·미수정 조건으로 소유권을 입증한 행만 갱신한다. 소유권 근거 없는 legacy 행과 관리자 수정은 보존한다. 해당24개 restart/보호/원자적 출력 검사가 통과했다.

수정 source SHA ae9ad574fd38e02caefdaed8c7004ec296d9a7ea088e1353dfcda41b540a1bf4로 신규 입력·실패 후 재시작을 각각7쌍 AB/BA 재측정했다. 신규 입력 p75는531.021→212.044ms(−318.977ms/−60.07%, paired bootstrap95% CI[−64.93,−53.61]), 실패+재시작 p75는936.374→386.303ms(−550.071ms/−58.74%, CI[−72.70,−54.60])다. 원본3307파일/23636539bytes SHA가 전후 같고 최종28/28 출력1257레코드 의미 digest가 일치했다. peakRSS/CPU/각 p50·p75·p95·절대CI·잡음은 transform-ownership-new-restart-20261005 raw/summary/report에 있다.

Mac M5 Max/18CPU/128GiB/macOS26.6.2/Python3.14.8의 component 실험이다. baseline append-open 실패와 candidate atomic replace 실패를 통제했으므로 내부 실패 지점이 동일하다고 주장하지 않는다. 신규/재시작 조건의 결과를 기존 다른 source의 cold·warm·delta 측정에 섞지 않는다. cold 회귀의 기존 기록, G003·전체 pipeline·실제 HTTP100쌍·운영 관측 미완료 상태는 그대로다. 확인된 금액 절감·세계 순위·전체 모델 정확도 주장은 없다.


운영 보조도 상태·정렬·목록 선택·상세 및 모바일 Sheet로 통일했다. 소스 조회 함수는 유지한다. 합성390/834/1423의 read-model 목록·상세 선택3조건이 통과했다. 오류 모니터링의 소스는 같은 CMS 구조지만 실제 region/DSN/읽기 연결은 미설정이다. 최종3조건은 모두 not-configured로 분류했다. 이전 중간 보고서가 바뀐 문구를 인식하지 못한 상태는 보존하며 Sentry 연결/오류 목록 성공 근거로 사용하지 않는다. typed data-admin-sentry-state와 audit unavailable marker로 검증기를 보완했다.

CMS 관련 통합 native/compat parity는3254 logical inputs/진단0이다. Sentry route와 실제 feed 검사를 임의의 한 Bun 프로세스에 합치면 module mock 때문에6개가 실패했다. 저장소 run-unit-tests.mjs가 두 파일을 원래 분리하도록 지정함을 확인했고 실제 feed의 지정된 독립 실행8개는 통과했다. 서비스 로직을 바꾸어 mock 오염을 숨기지 않았으며 이 임의 합친 실행은 whole-suite green 증빙이 아니다.


## 운영 receipt archive와 fresh chain 경계

이미 적용된115554 final verifier와123034 identity correction의 원래 SQL bytes/version/name을 그대로 운영 receipt archive에 보관하고 자동 fresh migration 목록에서 분리했다. 실제78행 readback의 statement/array SHA에 바인딩했으며, historical ledger나 다른 applied source는 변경하지 않았다. PG15 source catalog 검증은 fresh chain 이후 별도의 read-only dispatcher로 실행한다. hosted 실행 표시·가짜 applied alias·gate 완화는 없다. 신규 deferred 판단 재분류는 추가 migration이며 현재 source/test만 준비했고 운영에는 적용하지 않았다.

전체 canonical source replay1회는 exit0/122.977초/PG15.8/Node24.21.0/Python3.14.8이었다. artifact55개 manifest·checksum 검증이 통과하고 catalog1917행 및 tuple SQL은 기존 결과와 byte 동일하다. 시작HEAD3d91e75f, metadata와 종료HEAD7c7e1eed로 다른 웹 커밋이 진행됐으며 관련194입력은 시작·종료 byte 동일하다(집합SHA5b4326bd74a843731136c9c7cf7edc2d52bed73276331c6a3976aa3e3c61913e). 해당 동작을 전체 commit3d91 또는 독립2회 재생으로 바꾸어 표시하지 않는다. 운영·provider 호출0, task 자원 잔존0, 다른 컨테이너·볼륨·네트워크 보존이다. canonical retained proof는 catalog-replay-20261005/observation.json·related-source-binding.json·validation.json·artifact-map이다. 운영78행 증빙은 그대로 별도로 유지한다.


7c7e1eed의 production source와 같은 분리된 설치 환경에서 Next16.3.8/React19.3/Node24.21 production build와48개 static page 생성이 통과했다. TS/TSX/CSS/MJS/JSON 대조에서 production source 차이는0이며, performance 증빙·테스트1개·task tsconfig preview include의 차이는 별도였다. route CSS raw는home193609/general372392/admin383123/deferred193609bytes이며 ceiling 안이다. 추가된 task build include2개만 제거했다. refresh-history의 후속 응답 불확실 보호 변경은 이 build 범위에 없으며 별도로 검증한다.

PR7c7e1eed의 Admin CI 실패를 같은103개 cohort에서 재현했다(102pass/1fail). 이전 배너 grid/aria-current 문자열 기대값이 새360px inspector/aria-pressed와 맞지 않았고 실제 browser CMS/keyboard는 이미 확인했다. 선택 의미·읽기 잠금·키보드 upload 기대를 유지하며 해당 기존 assertion2곳을 정합했다. 실패한13개 parity cohort의 재실행은13pass/0fail이다. 새 PR head의 전체 CI 완료는 별도로 읽어야 한다.


최신화·이력은 공통 CMS 목록/360px inspector/모바일 Sheet를 적용하고 완료·반려·승인·대체 항목의 읽기 상세를 열었다. 미저장 메모·결정·적용 선택은 후보 전환/닫기/Escape에서 보호한다. 루트 검토에서 응답 유실 후 이전 GET 상태로 POST를 다시 보낼 수 있음을 찾아, 동일 후보·맛집·기대 상태·새 결정/적용 시각을 fresh GET에서 확인할 때까지 전송·선택·닫기를 잠그도록 보완했다. cached GET/ID 존재/불완전한 applied 정보/다른 결정은 해제 근거가 아니다. recrawl 대기·실패 의미와 폐업 자동 적용 차단은 유지한다.

이 변경은 agent 관련28tests/284assertions 및 root refresh+responsive30tests/823assertions가 통과했다(겹침은 합산하지 않는다). 390/834/1423 가로 넘침0, keyboard/Sheet와 세 합성 POST 실패/readback을 검증했다. 실제 browser mutation/provider/운영 호출0이다. GET은 메모·결정 주체를 반환하지 않으므로 동일 상태의 작성자까지 입증하지 않으며, 잠금은 컴포넌트 수명 동안이다. 전체 새로고침/부모 unmount를 넘는 복구라고 표시하지 않는다. 로그인 fixture의 기존 MyPage hydration 오류1건은 별도 기록했고 관리자 후속 화면에서 새 오류는 없었다.

스토리보드 프로젝트 전환/신규/사이드바/링크/뒤로가기·편집 닫기는 미저장·불확실 저장을 확인하고 저장 중 전환을 막는다. 보낸 장면 내용과 증가한 revision을 확인하여 저장을 확정하고 늦은 readback 뒤 새 편집을 버리지 않는다. 신규 browser 회귀8개/기존 단위5개/기존 Playwright3개가 통과했다. Gemini 모델·worker·API·billing은 바꾸지 않았다. 취소한 popstate의 URL 복구는 앞으로가기 stack을 축약할 수 있으며 실제 제공자 성능 증거는 아니다.


## 2026-10-05 현 transform 5조건과 운영79 증빙

동일 ae9ad574 source의 cold/unchanged/delta-five도 각각7쌍 재측정했다. p75 cold275.570→468.802ms(+193.233/+70.12%,95%CI[53.79,75.60]), unchanged255.129→122.946ms(−132.183/−51.81%,CI[−56.55,−49.85]), delta-five282.824→226.437ms(−56.387/−19.94%,CI[−24.03,−17.10])다. cold 시간·CPU·RSS는 모두7/7악화다. 나머지는0/7악화이며 unchanged의 시간/CPU2회, delta-five4회로 cold 추가 비용을 회수한다. RSS는 누적 상각하지 않는다. 원본3307파일/23636539bytes·입력 SHA를 보존하고42개 출력1257행이 동일하다. 이로써 같은 source의 transform component5조건 표본은 채웠지만 전체 pipeline/media/provider/운영/100쌍HTTP/G003 관측을 대체하지 않는다. raw/summary/report는 transform-ownership-three-20261005에 있다.

새 deferred migration은 actual fresh ledger78·old tick SHA/metadata·policyOFF·running/queued0·맛집1659행 동일 hash 확인 후 single-pending 팩/CLI2.119/skip-vault/TLSverify-full로1회 적용했다. actual ledger79, prior78동일, 새 tick body658473cae9137b04ddd810cb6ccf688b9ae998446880fa164e912eb8a1fbef6d 및 metadata 동일을 새readback에서 확인했다. 맛집 전체 행 SHA32a58ac590418a889708c0fc97539fe7ca5b20a97f0ba43c7b5226340acc8458·정책OFF/version1·자동운영 미실행을 보존했다. Vault/seed/roles/history repair/provider/추가billing은0이다.

최초 root readback은 파일 전체가1statement일 것이라는 잘못된 기대값과 property-order 비교를 사용하여 proven=false였다. 이 실패를 보존했고 SQL을 재적용하지 않았다. 실제 ledger는3statements였으며 source-pinned parser의3개 vector가 actualCLI2.119 배열 SHA7f1452c48d099b8b11aab5172e4d627eb2e18e95e46a68076fa090fec9699ce5와 일치했다. 원래 parser port 표기는v2.109.1이며 이 해당source의actualvector 일치를 확인한 것이다. canonical object 비교의 readback-only 검증에서proven=true였다. rollout-preflight/deferred-20261005의 initial/canonicalreadback·intent·transport·source-vector-proof와 detachedmap이 실제증빙이다.

Gemini3 청크 temperature는 공식 권고에 따라 생략하여 기본1.0을 사용한다. 비Gemini3은 기존0.2다. prompt/model/thinking/output4096/한도는 유지하며 helper SHA가 기존stagecache dependency에 포함되므로 이전조건을 잘못 재사용하지 않는다. SDK2.24와2.26의 request serialization24개씩, stageexecution6개를 검증했고 actualprovider 결과 품질은 아직 측정하지 않았다.
