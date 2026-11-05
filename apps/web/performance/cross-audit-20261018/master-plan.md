# Tzudong 변경 교차 감사 계획서

## 범위와 현재 단계

대상은 PR #3215의 dirty snapshot이며 기준 HEAD는 `ea08db3ae0c1a8d2525da15e6026ca4556ec0260`이다. 공개 저장소는 `https://github.com/twoimo/tzudong`이다. 이 문서와 `source_bundle.txt`만 외부 감사 입력의 canonical 자료로 사용한다. 전체 저장소·운영 데이터·로그·환경 파일·인증 상태는 업로드하지 않는다.

외부 단계는 `prepared`다. 소스 업로드 0회, 프롬프트 전송 0회이며 공통 예약 도구의 경로·사용법을 받기 전에는 전송하지 않는다. 다른 채팅의 로그인·모델·사용량을 이 채팅의 증거로 쓰지 않는다. 외부 보고서는 아직 없으며, 아래 판단은 로컬 감사 결과다.

완료 순서는 소스·해시 고정 → 예약 및 계정/모델/리서치 모드 확인 → ChatGPT 6 Pro + Deep Research 검토 → Gemini 4 Argon 최고 사고 + Deep Research 반대 검토 → ChatGPT 역검증 → 실제 수정·native 검증 → 보호된 승격·운영 readback이다. 호스트 모델·권한·큐·유료 용량을 변경하지 않는다. 정확한 조합이 없으면 해당 단계만 UNVERIFIED다.

## 작업 흐름과 수학적 불변식

### ADR-001 · 프로젝트 단위 공급자 예산과 불확실한 획득

키 수가 아닌 프로젝트가 quota의 단위다. 동시에 활성인 lease 수를 `L(t)`, 허용 동시성을 `C`, 구간 길이 `W`의 요청 상한을 `R`이라 하면 `L(t) ≤ C`, `starts(t-W,t] ≤ R`를 보존해야 한다. 프로세스 종료 비용을 줄여도 quota 제약은 완화하지 않는다.

획득 subprocess의 영속 commit과 부모 응답 수신은 원자적이지 않다. `commit → stdout 실패 → nonzero exit`가 가능하므로 nonzero만으로 거절을 확정할 수 없다. 현재 수정은 canonical 고정 거절 표식·종료 코드·빈 stdout의 결합만 확정 거절로 분류한다. 그 외 모호한 종료는 부모가 미리 정한 lease ID로 정리한다. stderr는 제한된 내부 비교에만 쓰고 기록하지 않는다.

질문 R01: 정상 작업, commit 전 거절, commit 후 partial/malformed stdout, signal/abort 각각에서 release 및 debt가 정확히 한 번 적용되는가? Python helper의 commit/표식 순서가 이 구분을 보장하는가? 프로세스/SQLite 경계 검증과 provider 실제 과금 증거를 구분하라.

### ADR-002 · OCR 결과와 저장 입력의 동일성

OCR 저장의 기준은 화면에 보이는 성공 문구가 아니라 결과 ID·revision·입력 사진과 대상의 결속이다. 제출 직전 snapshot을 `B0`, 비동기 readiness 확인 후 현재 입력을 `B1`이라 할 때 `B0 = B1`이어야 한다. AI 분석 중이거나 결속 ID 중 하나가 없으면 업로드·저장을 시작하지 않는다. 리뷰 내용의 허용 길이는 20–4,000자다.

질문 R02: 분석 중 입력 교체, 모드 전환, 닫기/다시 열기, 중복 클릭, 오래된 결과의 늦은 도착 및 readiness 대기에서 입력이 바뀌는 경로가 모두 같은 경계로 닫히는가? synthetic 통과를 실제 Storage/provider 성공으로 올리지 말라.

### ADR-003 · CMS 목록과 상세의 포커스 소유권

목록의 identity 버튼만 키보드 진입점이며 장식 화살표는 추가 tab stop을 만들지 않는다. 상세 종료 시 active element가 상세 내부·문서 본문에 남았을 때만 마지막 행 버튼으로 복원한다. 사용자가 검색창 등 외부로 이동했으면 그 포커스를 보존한다. 제거되거나 비활성화된 행에는 복원하지 않는다.

질문 R03: Radix Sheet의 비동기 exit와 검색 입력 이동 사이에 늦은 focus 복원이 끼어들 수 있는가? Enter/Space 열기 → Escape 닫기 → 즉시 검색 입력, 행 제거 및 inline 상세 경로를 반례로 검사하라. 1440·834·390px는 실제 `innerWidth`로 확인하며 요청한 폭과 다른 캡처는 제외한다.

### ADR-004 · runtime readiness는 실제 catalog에 결속

capability 이름이나 부분 문자열은 충분하지 않다. 함수 owner/security/config/language/volatility/return type/ACL 및 정확한 본문 hash, enabled trigger와 정의가 승인된 계약과 일치해야 한다. 과거 migration은 변경하지 않고 forward migration으로 보완한다. ledger는 102개, feature successor는 5단계다. drift를 발견하면 runtime/controller는 `held`여야 한다.

질문 R04: update/delete trigger 비활성화, 정의 교체, 함수 본문 변조, capability 위조, 중간 rollback, 재적용에서 stale readiness로 write가 통과하는 반례가 있는가? 실제 PG17.6 clone 결과의 보존 파일·cleanup·before/after source hash를 요구하라. clone은 운영 DB의 권한·Storage bytes·provider authority 증거가 아니다.

### ADR-005 · 롱폼·지식 그래프의 근거 경계

membership schema·정확한 key set·영상 ID/channel/duration/tab별 live-status를 검증한 같은 byte snapshot만 사용한다. provider readback은 hash-bound observation과 올바른 response ID 및 generate/readback operation에 한정한다. Shorts·진행/예정 live를 롱폼 완료 분모에 넣지 않는다. `완료/eligible`와 식당/영상/시각의 관찰 근거를 따로 보고하며 모델 관찰을 독립 검증 사실로 바꾸지 않는다.

질문 R05: membership 변조, 잘못된 duration/live-status, 다른 request의 response ID, rejected observation이 유료 재요청·허위 완료·잘못된 OSK 연결로 이어질 수 있는가? 전체 영상의 분석 완료는 일부 source/fixture 테스트로 대체할 수 없다.

### ADR-006 · 성능·배포·외부 감사의 증거 분리

성능은 동일 조건의 전후 표본과 hash-bound source tree로 비교한다. 반복 샘플의 독립 단위와 cluster를 명시하고, 절대차·변화율·95% 구간·noise budget을 함께 기록한다. 표본 부족이나 coverage 누락이면 미확정이다. 행 높이·overflow의 기하 측정은 사용성·운영 latency 개선의 증거가 아니다.

질문 R06: 실패·취소·진행 중 및 timing-invalid attempt가 성공 성능 표본에 섞이는가? CI의 queue, runner 점유 합, 생성→마지막 완료 임계 경로가 구분되는가? 검증량/scorer/표본 축소로 성능이 좋아 보이게 만들지 말라.

## 작업 지시와 실제 검증

| 작업 | 판정 기준 | 현재 증거와 잔여 단계 |
| --- | --- | --- |
| W001 예산 획득 복구 | ADR-001, R01 반례 | provider-budget native Node 테스트 6/6 로컬 보고. 실제 provider 과금/쿼터 증거는 별도 |
| W002 OCR 제출 결속 | ADR-002, R02 반례 | runtime binding/OCR/save 관련 Bun 72/72, 643 assertions 로컬 보고. 실제 API·Storage·저장 readback 별도 |
| W003 CMS 상세 포커스 | ADR-003, R03 반례 | 관련 소스 검사·ESLint·TypeScript parity 통과. 최종 세 폭 브라우저 재확인 진행 |
| W004 readiness forward | ADR-004, R04 반례 | Bun 14/14 로컬 보고. 실제 PG17.6 clone replay passed·findings=[]·cleanup 확인. JSON SHA `9ce142b2de2a9e3980afbe85981a2a6cc29d9705a63fb1cb8d1ced46141af29d`를 같은 bytes로 검증. runtime launch policy는 held |
| W005 KG 증거 | ADR-005, R05 반례 | caption adapter 20/20 및 longform eligibility 회귀 1/1 로컬 보고. 전체 분석/운영 graph는 별도 |
| W006 통합 릴리스 | ADR-006, R06 | 기존 원격 HEAD의 Swift/주요 CI 성공. dirty 수정·develop 충돌·최신 head CI·운영 배포·모든 메뉴 readback 미완료 |

## 로컬 판단표 · 외부 합의가 아님

| ID | 판정 | 근거 등급 | 실제 조치·검증 |
| --- | --- | --- | --- |
| LOCAL-001 nonzero 획득의 무조건 거절 분류 | ACCEPT | SOURCE_OBSERVED, SYNTHETIC_MOCK_TESTED | 고정 sentinel과 모호한 commit 후 종료를 분리, 회귀 테스트 추가. W001 |
| LOCAL-002 Sheet가 외부 검색 포커스를 덮어씀 | ACCEPT | SOURCE_OBSERVED | 조건부 포커스 복원으로 수정. 실제 종료 애니메이션/검색 경계는 W003에서 확인 |
| LOCAL-003 capability 부분 문자열 판별 | ACCEPT | SOURCE_OBSERVED | exact catalog identity와 prosrc hash 및 trigger drift fence. W004 |
| LOCAL-004 실제 provider/Storage·운영 readiness 주장 | DEFER | UNVERIFIED | 실제 readback 전 주장을 보류하고 launch policy held·저장 binding/readiness guard 유지. W002/W004/W006 |
| EXTERNAL-001 3단계 외부 교차 감사 | DEFER | UNVERIFIED | 공통 예약·정확한 모델/모드 확인 전 전송하지 않음. 외부 감사 미완료를 릴리스 승인으로 해석하지 않음 |

## 외부 감사 질문·출력 계약

세 단계 모두 칭찬·구조 반복 설명·통과 모듈 요약을 생략한다. 각 결함은 수학/동시성/상태 전이의 도출, 정확한 소스 근거와 위 7단계 근거 등급, R/ADR/W ID, 재현 테스트 또는 unified diff를 제시한다. 독립 검증하지 않은 현상·수치·backend identity는 UNVERIFIED로 적는다. 범위를 넘는 모델/계정/유료 용량/운영 설정 변경은 제안과 실행을 구분한다.

ChatGPT 1차: 이 계획과 hash-indexed source의 취약한 가정을 찾고, W001–W006의 DAG와 반례를 검토하라. Gemini 반대 검토: 1차 결과를 신뢰하지 말고 소스와 형식적 반례로 공격하라. ChatGPT 역검증: Gemini 주장마다 ACCEPT/CONDITIONAL/REJECT/DEFER를 판정하되 REJECT는 공식 근거·수학적 반증·실행 가능한 counter-proof가 있어야 한다. ACCEPT/CONDITIONAL은 실제 변경·native 검사와 연결한다.

## 보존과 provenance

각 외부 보고서는 완료 후에만 전문을 수정 없이 별도 Markdown으로 저장한다. 대화 URL, 관측된 모델 label·추론·Deep Research mode, timestamp, source revision·bundle hash, 전송/수락/계획/리서치 시작/전문 완료/저장/판정 단계를 별도 기록한다. 표시 label만으로 backend 모델 ID·조회 수·실제 테스트 수행을 추정하지 않는다. 아직 없는 보고서의 빈 placeholder를 완료 증거로 만들지 않는다.

원문 보고서와 판단표는 서로 구분하며 개인정보·계정 주소·세션 정보는 포함하지 않는다. 새 커밋/소스 변경 뒤에는 bundle hash와 범위를 다시 고정한 후 전송한다. Cursor 키트·PDF·HTML 복제본은 요청되지 않아 만들지 않는다.
