# 전체 목표 Todos — 2026-10-14 v6

전체 완료 아님. v5와 이전 실패·원자료는 보존했다. 사용자의 현재 제약 “휴대폰 없이 검증해”를 유지한다. 이 목록은 원래 목표와 추가 사용자 요청을 모두 유지하며, 현재 turn의 완료된 읽기/측정과 남은 변경·운영·field를 구분한다.

| 우선순위 | 작업과 완료 조건 | 현재 상태/이번 진행 | 남은 실행·차단 요인 |
|---|---|---|---|
| P0 | 현재 source/운영 SHA 분리 | source main3d7919d6, 새로 확인한 live www1884f87e / READY dpl_EUxJnWmDDozCSMWb2sqNSPgKJLM5 | main의 readiness/operating 수정은 아직 live 아님 |
| P0 | 원래 메모리20% guard | 기존 실패와 ca7674c5 후보 제외 유지. 새 union fb5fc0c4도 종료guard 지지 못함 | 임의 완화·GC 면제 없이 marker DOM 보유/교체 경로 조사→수정→동일 자연조건 재측정 |
| P0 | 재현가능 baseline/통합 A/B | 새 fixture735+735alias/review, real SDK, A/A4+A/B9쌍,22독립프로세스·5632내부동작 완료 | 과거 no-review 데이터와 직접 수치 비교 금지 |
| P0 | union candidate 정확성/요청비용 | 관련19unit+coupled110+lint/parity/build, GET2434→1794/26.294% 감소 | 메모리·입력 지연 개선 미입증. 후보 local only/미승격/미배포 |
| P0 | 독립 집계/노이즈 | Python이 모든 raw hash/5metric/20000bootstrap/3guard 재구성 통과 | 9쌍 CI는 근사; 모집단p95/동시95% 주장 금지 |
| P0 | 실제 DB count/escaping/동등성 | 공개 anonymous6비교/43GET 모두200; ID집합·complete exact count 일치 | 최악 COUNT 서버비용·2000행 actual DB cap/다중 별칭 규모는 미검증 |
| P0 | 실패/응답 잘림 복구 | 503 mobile, count누락 tablet, capped desktop 너비 모두리뷰·선택·map1보존 | 기존Supabase503 3retry 비용 공개. 실패한v1/v2/v3 검사도보존 |
| P0 | DOM/marker 구조 진단 | 별도두 프로세스 각256동작; 각각164markers,9354setIcon,16904setMap. 자연/forcedGC분리, 원문heap RAM처리 | 현재 union은 marker churn 미개선. retained-path와 DOM content/ID 수명 조사 필요 |
| P0 | SDK console/network | primary별Naver-family connect-src CSP1,총22. canonical incident238보존 | 정확한vendor endpoint/필요성·실제 tile/marker 픽셀과 연결. 임의CSP/권한 완화 금지 |
| P0 | 별도 플리커 재검증 | 과거 세션이 운영1ab5b752, 두 physical browser 각12장/검은사각형0 관찰을 보고했음 | 현재 새후보·현재live의 프레임/위치/지속시간은 미완료. 과거 정지캡처를 최신완전제거로 대체하지 않음 |
| P0 | 11단계 리뷰/미디어 SQL | protected main에 executor4review 수정 완료; local exactPG17.6/12stage rollback 통과 | 직접PostgreSQL 연결 설정 위치/로컬SUPABASE_DB_URL 미확인. 기존 질문 pending. fresh source·rollback·7writer fences/실제rehearsal→단일apply/readback |
| P0 | 원래 review UUID 불확실 commit | unsafe 미디어 삭제0/receipt 기반 경로 준비 | 동일원래operationUUID부터 현재운영 reconciliation; 새UUID blind retry 금지 |
| P0 | private verification 이전 | 과거8legacy owner photos/9.81MB plan, 실제copy/delete0 | 최신참조/preimage/정책/각private byte 검증→public삭제→권한·캐시·admin route확인 |
| P0 | 배포/승격/롤백 | 이전PR3202→3204→3203→3201 protected 전달 완료; 새union은제외 | SQL/readiness 일관성 확보 후 exact guard·namedlive rollback·READY alias·assetSHA·실제UI. 배포요청/READY만으로 완료하지 않음 |
| P0 | 배포후 실제핵심흐름 | 운영 metadata 최신readback 완료. 새후보운영0 | signup/privacy/auth redirect/reviewedit/delete/private media/ranking/search/map/back 반복 실제UI |
| P1 | 빈/대량/slow/cache matrix | 관련unit cap2000/invalid count/입력변경 보존 | 실제UI empty/2000/slow/partial, cold/warm·연속입력·갱신·반복방문 별도검사 |
| P1 | viewport/접근성/state | 세CSS breakpoint실패복구검사 완료; 모두touch emulation | keyboard/focus/reduced-motion/rotation/주소창·가상키보드/탭복귀. physical 제외 범위 명시 |
| P1 | 목록/map 상세/back/swipe | primary5632선택/alias review/map1/duplicate0검사 완료 | wheel/drag/zoom/목록scroll/화면back/연속swipe의 프레임/픽셀·상태 검증 |
| P1 | 랭킹 안정성 | 앞선운영public RPCall/monthly200·19rows 검사 보존 | 최신3환경실제UI·실패/빈값/월전환·권한.19행을활성사용자/field로세지않음 |
| P1 | 공통헤더·PNG·필터·count위치 | 구현·이전관련검사 보존 | 새main live전달 및 3환경normal/reduced motion 실제render확인 |
| P1 | 쯔양리뷰1659전수검사 | Gemini3.8FlashHigh 기존전수·21최소수정안staged/운영적용0 | 최신preimage·원문·기존admin47편집보존·held행 제외·Preview/Confirm/Apply/Readback/Audit |
| P1 | transitions/scroll motion | 설치/이전motion코드·검사 보존 | 실제성능에기여하는 boundedtransform/opacity·reduce motion·focus 유지. 지연/debounce로증상숨김금지 |
| P1 | Cloudflare 무료 활용 | 유료설정변경0, 기존asset경로보존 | 현재R2 usage/free limits·캐시·전송/요청확인·실제public asset경로·무효화. 이론비용절감claim금지 |
| P1 | prospective field v2 | 새v2 collector/storage/cohort/성과0; v1분모·browser/tablet·의존성부족 | 사전criteria/cohort/표본/기간→안전계측→전송/저장/집계readback→실사용평가. 합성/내부traffic제외 |
| P1 | 증거 완결/원격바이트 | 이번newpacket의전체raw/실패/통계/liveUI/구조/리포트완료 | parent complete-set artifact-map/detachedpin·원격Git bytes 확인. canonical scorerPASS≠admitted (현재0/releaseBlocked=true) |

신규 수정·unit/build·로컬production 실제SDK·실제DBread-only·source승격·운영배포·physical·field를 분리한다. 최신원자료와 정량표는 apps/web/performance/review-candidate-union-20261014-v1/REPORT-v1.md와 RETENTION-v1.md. 이 목록을 작게 줄여 완료로 만들지 않는다.
