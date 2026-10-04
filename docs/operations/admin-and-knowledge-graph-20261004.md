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

사용자의 후속 요청에 따라 메뉴·본문 제목·접근성 이름은 ‘영상 성과 분석’으로 바꿨다. `/admin?module=insights`와 저장된 메뉴 ID는 유지한다. 관련 기존 47개 검사는 통과했다. 크롤러 페이지의 실제 흐름 시각화와 Gemini 추천이 선행하는 자동 검수를 구현·격리 검증했다. 신규 SQL과 운영 배포는 아직 적용하지 않았다. 설명을 더하는 대신 상태·근거·필요한 실행 제어를 밀도 있게 배치한다.

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
