# Tzudong 목표 · 2026-10-18 재개

현재 대화의 실제 목표를 등록하고 `active`를 확인했다. 이 목록은 기존 요청 전체의 완료 감사이며, 체크하지 않은 항목은 소스가 있더라도 전달 완료를 뜻하지 않는다. 기존 상세 증빙은 [요청 장부](project-request-todos-20261009.md), [기능 전달 상태](feature-completion-20261013.md), [taste 개선](admin-taste-20261015.md)에 보존한다.

## 현재 실행

- 최신 재개에서는 로컬 `cfba8fbb`와 원격 `65c98679`를 구분했다. 해당 원격 head의 완료 재조회는 성공30·skipped2·cancelled1, 실패·대기0이다. cancelled Promotion Path와 별개로 같은 head의 성공 실행이 있다. 새107 권한 admission은 실제 PG17 초기 권한 반례와 PG15 clean replay2회를 통과했다. 108 명시 복구는 최종 앱140 tests/1,070 assertions·parity3,356입력/진단0·build54/54, Node24 OCR UI39/39와 독립 소스 재감사를 통과했다. PG17 함수·트리거·FK drift 거부와 실제 두 세션의 삭제 장벽 및 최종 main fixture12/12를 통과했다. 실제 public RPC25개는 service_role, private readback11개는 postgres로 분리됐으며 권한을 넓히지 않았다. 최신 fixture/manifest의 compiler3/59와 불변 앱137/1,011의 구성 검증임을 구분한다. 두 PG15 source-only clean replay는 각1,960행·비교 hash58개가 일치했다. 이 변경은 위 원격 CI에 포함되지 않았고 `/목표`는 계속 active다. [상세 경계](review-recovery-20261019.md).
- 실제 `/목표`는 전체 요청·보존 조건·정량 보고 범위를 유지한 `active`다. 완료 상태로 변경하지 않았다.
- 후속 수정의 기준 PR #3215 HEAD는 `b1c505cd4f065fac8a4ebefe235a85a5513acbd7`이다. 앱 복구 수정 `dfa77ca0b509c508ac29ec5f93fe7eb3f45cc16f`를 PR에 push했고 관련 리뷰4건을 resolve한 뒤 재조회했다. 10월19일 재조회한 기존 `b1c505cd`의 33개 check 상태는 success31·skipped2이며 대기·실패0, Swift도 성공했다. 이 결과는 후속 수정의 CI 증거가 아니다. Freshness·hosted ledger의 skipped 2개와 Vercel status는 운영 SQL·배포 증거로 사용하지 않는다.
- 리뷰 음식 사진은 20장으로 경계를 맞췄다. 신규 21장은 압축·업로드·insert 전에 차단하고 기존 입력을 유지한다. 불확실한 저장 뒤 현재 사진이 0장·21장이어도 별도 결과 확인과 임시 저장 정리를 실행할 수 있다. 닫힌 composer에 늦은 실패 알림이 나오는 반례도 실제 실패를 재현한 뒤 보완했다. 최종 영향 검사174개/2,642 assertions·ESLint·parity3,350입력/진단0·build54페이지가 통과했다. 독립 표적13건은 기존 검사와 겹치므로 합산하지 않는다. [최종 source-bound 검증](../../apps/web/performance/cross-audit-20261018/review-food-photo-final-verification/index.json)과 최초 반례·중간 영수증을 구분해 보존했다.
- Gemini 반대 감사는 기존 FIFO/job/hash 그대로 대기 중이다. 저장된 coordinator 관측은 다른 owner의 uncertain 예약과 사용 가능 슬롯0을 기록했으며 현재 실시간 진행·허용량 증거가 아니다. 한 계정의5시간 cap도 공유 장부에 기록돼 있다. 내 작업의 업로드·dispatch는0건이다. 준비된 post-CMS 패키지는 `17eec51a` 범위이고 별도 runtime snapshot은 `b1c505cd` 범위이므로, 아래 추가 수정을 포함한 최종 전체 소스 묶음이 필요하다. 실제 반대 감사·최종 역검증·운영 SQL·승격·배포·모든 메뉴 실검증은 미완료다.

### 10월19일 후속 리뷰

| 항목 | 현재 증거 | 남은 gate |
| --- | --- | --- |
| OCR oldest-row 반복 선택 | 확정된 사진 결함만 terminal 처리, 전체 입력 snapshot CAS와 독립 readback. held 분기 추가 후26개/155 assertions 및 독립 source 결속 검토 통과 | 후속 head CI·hosted 실행 |
| 스토리보드 source binding | 실행·Storage·provider-budget 경계30→35개(+16.7%). 직접9개/82 assertions, compatibility/readback38개/264 assertions 및 독립 freeze 검토 통과. 실제 build route에 새 digest 포함 | 후속 head CI·승인된 배포·alias/private policy readback |
| 배너 업로드 정리 | 제목100자 경계 및 정상 status/code 조합에서만 현재 업로드 정리. 관련18개/151 assertions 통과. 실제 component의 합성 HTTPS 브라우저에서101자 요청0/0/0,100자+400은upload/PATCH/cleanup1/1/1,100자+500은1/1/0. 세 경우 draft 유지 | 후속 head CI·실제 운영 Storage readback |
| OCR 확정 credential 거절 복구 | 앱32개/195 assertions와 compiler7개/59 assertions 통과. PG17.6의 constituent·aggregate 적용/rollback/idempotency·catalog10/10·정확한 target 폐기 통과. 별도 일반 postgres 권한의 canonical 비-dblink core 통과. SUPERUSER lease dblink race는 별도 분류 | 후속 CI·별도 hosted 적용/readback. NOSUPERUSER dblink race는 미확인 |

앱의 통합 ESLint, 고정 TypeScript parity3,351입력/진단0, production build54페이지가 통과했다. 이후 SQL·catalog fixture·held manifest만 바뀌었고 compile 관련20개 파일의 해시는 같음을 별도 확인했다. 테스트 그룹은 서로 겹쳐 합산하지 않는다. 경로 수·테스트 통과·단일 build 시간은 운영 속도나 비용 개선의 표본이 아니며 95% 구간을 만들지 않는다. [통합 검증](../../apps/web/performance/cross-audit-20261019/integrated-review-fixes-verification/verification.json), [앱 source 연속성](../../apps/web/performance/cross-audit-20261019/integrated-review-fixes-verification/app-source-continuity-followup.json).

기존89→100→105 successor와 applied migration은 불변이다. 새 credential-release migration은 기존105 증거에 포함되지 않으며 별도 적용·readiness 증거가 필요하다. 기존 일일 quota 상한·과금 예약 정책은 유지한다. 새 capability 확인은 실행당 RPC1회를 추가하며 지연·비용 효과는 미측정이다. 후속 소스의 PR 반영과 운영 반영은 별도 단계다.

PG17.6의 최초 GRANT no-op과 합성 사용자 정리 실패는 각각 보존했다. 수정 후 event009의 constituent·aggregate 두 경로 및 exact teardown이 통과했고 원본·retained105 fixture의 dump는 같았다. 임시 SUPERUSER lease의 dblink 증거와 별도 event011의 NOSUPERUSER 비-dblink core 증거를 구분하며, 이 결과를 hosted 적용 증거로 사용하지 않는다. 자세한 범위는 [후속 검증](review-recovery-20261019.md)에 기록했다.

### 10월19일 CI·헤더 후속 이행

- 원격 `dfa77ca0`의 Catalog/generate 실행 `39150206730`, job `117742111488`은 source-only 재생에 migration ledger가 없어 새 credential-release prerequisite에서 실패했다. 필수 검사나 migration을 완화하지 않고, 로컬 커밋 `14a8f5da4268df890c7adf10bf89e99ce071f6f5`에 격리된 PG15 source-only adapter를 추가했다. 기존 schema/ledger는 거부하며 raw migration hash는 그대로다.
- 새 adapter의 두 깨끗한 로컬 재생이 각각1,960행을 검증했고 비교 대상 hash58개가 전부 같았다. 기존 schema-only·1행 ledger 반례2개 모두 고정 거절 코드와 전후 보존을 확인했다. 관련 Python 검사9개 통과는 관측됐지만 원본 출력 파일이 없어 별도 봉인된 테스트 영수증으로 취급하지 않는다. 이는 hosted readiness나 운영 적용 증거가 아니다.
- Replay B는 container4·volume2·network1의 실제 소유 label과 exact-ID teardown을 확인했다. Replay A는 generator 성공 후 wrapper의 zsh 예약변수 오류로 exact ID를 수집하지 못했다. A는 이름 기반 부재·label residual0만 확인했으므로 exact-ID 폐기를 주장하지 않는다. source와 retained105 dump는 전후 같았다.
- 승인받은 GitGuardian #38364337·#38364338·#38364339 세 건만 `This is not a secret (false positive)`로 처리하고 `Ignored`를 재조회했다. 스캐너 설정·다른 탐지·자격정보·workflow 재실행은 바꾸지 않았다. 기존 실패 check와 다음 head의 재검사 결과는 구분한다.
- 현재 앱 헤더 입력7개의 source hash를 결속해15메뉴×3폭(1423·768·390px)45/45의 sidebar 진입·제목·헤더 배치 검증을 마쳤다. clipping·가로 넘침·H1 위반·page error는0이다. 미구현 loopback API의404 121건·405 88건과 의도된 KG503 3건을 보존했다. 운영 전체 메뉴 기능 검증은0/15이며 이 헤더 결과로 대신하지 않는다. [현재 헤더 증거](../../apps/web/performance/cross-audit-20261019/admin-header-current-scope-readback.json).
- 기존 Gemini 반대 감사는 원래 FIFO·job·primary bundle hash로 보존한다. ChatGPT 보충 검토는 기존 thesis를 반복하지 않고 확정 credential release의 재시도 안전성과 초기 creator default ACL의 operating admission 조건이라는 미검토 delta만 준비한다. 보충 검토는 Gemini 반대 감사나 최종 역검증의 대체물이 아니다.

## 즉시 진행

- [x] 실제 목표 등록·활성 상태 확인. 심층 메타인지, 수학적·점근적 접근, 정량 결과·불확실성 보고를 포함했다.
- [x] 격리 후보의 소스·dirty/untracked 작업 복구. 복구 당시 HEAD는 `ea08db3ae0c1a8d2525da15e6026ca4556ec0260`였으며 현재 HEAD는 상단 실행 상태를 따른다. 사용자 소유 `apps/web/supabase/.temp/`는 보존한다.
- [x] PR #3215 원격 상태 재확인. OPEN, 기존 head의 Swift 및 주요 CI 성공, develop과 병합 충돌 확인. 이후 head의 성공은 별도 확인한다.
- [x] taste-skill의 기존 dense-tiles 방향을 유지하며 맛집·제보·리뷰 CMS 테이블을 완성한다. 열 정렬·행 밀도·상태 의미·작업 버튼·빈 결과·로딩·키보드 상세 열기/닫기·포커스 복원을 확인한다.
- [x] 최종 1440·834·390px 브라우저에서 실제 viewport를 확인하고 overflow·행 높이·상세·검색·필터를 재검증한다. 과거 viewport 불일치 캡처를 최종 증빙으로 쓰지 않는다.
- [x] provider budget, OCR binding/4000자 경계, KG caption/receipt eligibility, runtime closure 및 SQL readiness 리뷰 수정을 검증한다.
- [x] 신규 forward migration의 102개 ledger·5단계 successor 계약과 PG17 실패·권한·idempotency/readback 검증을 마친다. 운영 적용과 구분한다.
- [x] 관련 단위 검사·ESLint·고정 TypeScript parity·production build를 마친다. 변경이나 구체적 위험이 없으면 통과한 전체 검사를 반복하지 않는다.
- [x] 검증된 작업만 커밋하고 develop 병합 충돌을 의미에 맞게 해결한다. 현재 확인한 충돌 파일은 platform-modernization reconciliation JSON이다.
- [ ] PR #3215 최신 head의 리뷰·Swift·필수 CI를 확인하고 보호된 `develop → data → main` 승격을 마친다.
- [ ] 현재 운영 rollback SHA와 정확한 Vercel 프로젝트를 확인하고 held/ready 계약에 따라 배포한다. 운영 SHA·도메인·hold 상태를 readback한다.
- [ ] 운영 SQL은 새 실행 증빙·현재 권한·writer fence·inflight 상태를 충족할 때 적용하고 readback한다. 과거 중지 확인을 현재 fence로 대체하지 않는다.
- [ ] 배포된 관리자 콘솔의 모든 메뉴·사이드바·목록·상세·주요 작업을 실제 관리자 세션으로 검증한다.

## 전체 요청의 완료 감사

- [ ] 전체 웹의 브랜드·로그인 로고/불꽃 대체·공통 헤더·타이포·여백·모바일·dark mode·접근성·reduced motion을 확인한다.
- [ ] 대시보드 KPI/차트 제목·도구를 가능한 폭에서 한 행으로 정렬하고 작은 화면에서는 겹침 없이 제공한다.
- [ ] 맛집 최신화·이력을 맛집 관리에 통합하고 중복 헤더·불필요한 설명을 제거한다.
- [ ] 맛집 자동 운영의 Gemini 판단·자동 분류·재검수·자동 승인·보호된 적용·readback·감사를 실제 경계까지 확인한다.
- [ ] 제보·리뷰·사용자·배너 관리를 일관된 검색/필터/목록/상세/작업 CMS 구조로 완성한다.
- [ ] 영상 성과 분석 명칭·구조, 크롤러 데이터 흐름 중심 화면, 지식 그래프 중심 화면을 확인한다.
- [ ] 오류 모니터링의 Sentry 연결과 관리자 메뉴, 감사 로그, 운영 보조 및 동선 추천을 확인한다.
- [ ] 영수증 OCR에서 승인된 Gemini 프로젝트·크레딧 경로·중복 방지·quota·저장 binding·실패 복구를 실제 요청으로 확인한다.
- [ ] 썸네일·스토리보드의 실제 지원되는 승인 모델 쌍과 Gemini-only 실행을 확인한다. 과거 비Gemini 기록은 보존하고 신규 비Gemini 실행은 막는다.
- [ ] 쯔양 롱폼 전체 분석의 대상 수·처리 수·미완료 수를 최신 입력으로 확인한다. claude-video 근거·OSK 출처·시각·미검증 상태를 유지하며 전체 완료를 표본으로 대신하지 않는다.
- [ ] 크롤링→영상/자막→추출→평가→저장→검수의 정확도·관리자 수정 보존과 전후 비용/시간/자원 성과를 감사한다.
- [ ] Gmail에서 지정한 메일에 대한 코드 조치, Gemini 리딤 잔액·결제 연결·1만원 충전 및 롯데카드 삭제의 실제 영수증을 확인한다. 불확실한 결제를 재실행하지 않는다.
- [ ] GitHub CI 중복 benchmark/report·I/O 병목을 동일 조건으로 측정하고 필요한 검증·scorer·표본을 유지하며 개선한다. 감시는 별도 읽기 전용 계약을 유지한다.
- [ ] 사용한 스킬의 가변 소프트웨어 정보는 공식 문서·설치된 인터페이스로 확인한다. 프로젝트 pin·로컬 패치는 보존한다.
- [ ] 최종 정량 보고에서 절대차·변화율·가능한 95% 구간·표본·측정 환경·회귀·불확실성을 함께 제시한다. 소스/로컬/운영 증거를 구분한다.

## 실행 원칙

서로 독립적인 CMS 포커스, SQL successor, provider/KG/runtime 감사를 병렬 처리한다. 공유 CSS·통합 검증·커밋·승격·외부 쓰기는 직렬 처리한다. Astra는 필요한 복잡한 판단에만 사용하며 모델·유료 한도·전역 설정을 임의로 바꾸지 않는다. 개인정보·자격증명·raw OCR·원시 관리자 payload는 증빙에 저장하지 않는다.

## 2026-10-18 로컬 증빙

[CMS 측정](../../apps/web/performance/admin-tables-20261018/README.md), [실제 PG17.6 재생](../../apps/web/performance/feature-sql-integration-20261013/pg17-existing-catalog-replay-review-verification-readiness-20261018.json), [외부 감사 준비](../../apps/web/performance/cross-audit-20261018/master-plan.md)를 보존했다. 준비 시점에는 외부 전송이 없었고, 이후 아래 1차 연구의 첨부 2개·전송 1회를 완료했다. 최신 develop을 통합했으며 새 수정 head의 CI·운영 배포·전체 메뉴 실제 검증은 남아 있다.

## 웹 심층 리서치 왕복 검증

- [x] GPT-6 Pro + 심층 리서치의 실제 시작·완료, 전문·원래 URL·SHA를 보존한다.
- [ ] Gemini 4 Argon 최고가 + Deep Research로 앞선 보고서와 소스에 반대 감사를 수행한다.
- [ ] 모든 지적에 안정적인 ID를 부여하고 ACCEPT/CONDITIONAL/REJECT/DEFER를 근거와 함께 판정한다.
- [ ] 수용 지적을 실제 수정·경계/회귀 검사와 연결한다.
- [ ] 최종 수정 소스로 GPT-6 Pro + 심층 리서치 역검증을 수행하고 새 결함도 조치한다.
- [ ] completion-manifest.json의 세 보고서·조치·필수 검증이 충족될 때만 교차 감사 complete로 판정한다. 운영 배포와 전체 목표 완료는 별도다.

공통 coordinator의 기존 job·FIFO·서비스당 한 건·소유자 해제 계약을 보존한다. 현재 manifest는 incomplete_thesis_adjudicated_antithesis_pending이며 빈 파일이나 로컬 리뷰를 웹 연구 완료로 대체하지 않는다.

## SQL 승격 경계

review-media feature successor와 PG17.6 receipt는 정확한 97→102 다섯 migration 증빙이다. 처음 설계한 evidence/popularity 102→105 순서와 달리, 10월18일 운영 SELECT에서는 ledger89·evidence3·feature0이 관측됐다. 기존 admission을 억지로 맞추지 않으며, 선행 ledger의 정확한 행·문장 해시와 현재 토폴로지를 확인한 별도 successor가 필요하다. 기존 102 receipt를 운영105 증빙으로 표시하거나 재사용하지 않는다.

통합 commit `b5d62c34f4a2e854ab10fd9f6741597b6081c43b`에서 관련13개 파일188개 테스트·4,934 assertions, ESLint, compiler parity3,350입력/진단0, production build54페이지와 route CSS 경계가 통과했다. [통합 원시 결과와 영수증](../../apps/web/performance/feature-completion-20261013/integration-20261018/verification.json)을 보존했다. 105 ledger 거부를 추가한 후 관련11개 테스트도 통과했다. backend의 caption20·eligibility1·provider6·evidence-frame9개는 원시 결과 파일로 보존했다. 기존 전체 discovery의 macOS/Windows jq 실행 오류는 범위 밖 환경 실패로 남긴다.

1차 [심층 연구 전문](../../apps/web/performance/cross-audit-20261018/chatgpt-thesis-full-report.md)은 UI9분/출처5/검색99 완료를 확인하고43,130bytes·SHA4c5542b59d9bcb426eac29722b6da36c9c23337fa622bd9e822bd6b3ffe4ad82로 보존했다. ChatGPT 슬롯은 전문 저장 직후 해제했다. TZ-TH-001~009는 ACCEPT8·CONDITIONAL1로 판정했다. provider protocol·debt 복구·abort 경계, OCR 전체 입력 snapshot·공백 제외20~4,000자, 인라인 포커스 및 롱폼 request/response lineage를 수정했다. [현재 소스 검증](../../apps/web/performance/cross-audit-20261018/final-verification/verification.json)에 CMS131·provider JS9/고정Python15·lineage86·layout42, 진단0, production build54페이지를 구분해 기록했다. Gemini 반대 감사 묶음은 원래10개 소스 전문·thesis 전문·기존PG/closure 영수증을 포함하며 FIFO 대기 중이다.

과거 결제 감사:10월2일1만원 충전·한 프로젝트 결제 연결의 UI readback은 있고10월8일 재관측에서 자동충전OFF가 유지됐다.10월15일에는 승인 계정의 유료 Tier/크레딧 표시만 확인했다. 실제 요청의 청구/credit debit 귀속과 정확 잔액은 미확인이다. 카드 삭제는 유효한 대체수단 요구로 취소돼 대상 잔존이며 미완료다. 추가 충전·카드 등록·결제 변경을 하지 않는다. 원본 증거는 pipeline-20261002/billing-readback.json, funded-gemini-followthrough-20261009/billing-before.json 및 longform-resume-readiness-20261009/card-removal-readback.json이다.

후속 상태: `86328a4c52a03e953519ea8d09b2672bef7eda57`의 CI 33개가 완료됐고 실패는 없다. Swift, Catalog generate, orchestration-readiness가 성공했다. skipped hosted-ledger는 운영 SQL 검증이 아니며 Vercel status는 배포 증명이 아니다. 이후 발견한 OCR key fallback 및 사용자·배너 CMS 결함의 수정은 별도 head 검증 대상이다.

롱폼 로컬 상태는 대상 1,071개, 보존된 provider 완료 receipt 3개, 전체 미완료 1,068개다. 현재 소스의 읽기 전용 계획은 new 1,066 / readback_required 5 / reusable 0, provider GET eligible 0이며 독립 검증 완료는 0개다. 새 영상의 남은 segment는 2,004개다. 이는 전체 영상 심층 분석 완료가 아니다. 정확한 입력·상태 해시와 경계는 `longform-local-state-readback-20261018.json`에 보존했다.

10월18일 최신 공개 metadata 재조회에서는 eligible longform 1,071→1,076개(+5, +0.467%)였다. `/videos`1,058·`/shorts`83·완료 streams18이며 live/upcoming0, 중복0, eligible duration 누락0이다. 새 inventory의 offline plan은 new1,071·readback_required5·reusable0·GET eligible0·new segment2,014개다. 공개 metadata만 읽었으며 기존 canonical inventory·queue·receipt·analysis state는 변경하지 않았다. 전체 심층 분석·독립 사실 검증 완료를 뜻하지 않는다. `longform-inventory-refresh-20261018.json`의 SHA와 collection receipt를 보존했다.

교차 감사 상태를 현재 이행과 맞췄다. 실제 thesis 전문1건은 완료·원문 보존했고 TZ-TH-001~005·009의 소스+필수 로컬 검증6건은 완료다. 006의 독립 앱 포커스 캡처, 008의 다음 외부 검토 및 007의 운영 설치 후 ACL/readiness는 별도 gate이며 Gemini·최종 역검증은 미완료다. `completion-manifest.json`의 오래된 미수행 문장을 정리했으며 기존 FIFO/job/hash는 유지했다.

후속 직접 앱 검증에서 TZ-TH-006의 제보·리뷰 인라인 닫기 2건 모두 상세 종료 및 화면에 보이는 행 버튼으로 포커스 복원이 확인됐다. 합성 loopback·1440×960 CUA 증거이며 운영 검증은 아니다. 이에 소스·필수 로컬 검증 완료 집계는7건으로 갱신했다. `inline-focus-application-readback-20261018.json`에 source hash·raw interaction hash·geometry를 보존했다.

Evidence-prefixed successor의 aggregate compile 결과 자체도 별도 PG17.6 컨테이너에서 실행했다. 89→100의11 plans 및100→105의5 plans가 각 단일 외부 transaction으로 완료됐고 compiler terminal output·DB readback·constituent terminal이 일치했다. 새 source와 초기 constituent source의 hash 차이는 `evidence-prefixed-successors-source-binding-followup-20261018.json`으로 구분한다. 신규 정책은 계속 held이며 운영 admission/apply 증거가 아니다.

최종 후속 검증: CMS41개/468 assertions, OCR74개/614 assertions, SQL39개/245 assertions가 통과했다. 독립 CMS 반례4개는 기존 검사와 겹치므로 고유 검사 수에 더하지 않는다. parity3,350입력/진단0, Node24·npm11.6.2 build54페이지 및 CSS 경계가 통과했다. 잘못된 loopback build origin 거부는 첫 실패 영수증으로 보존했으며, 소스 guard를 바꾸지 않고 기존 canonical 공개 origin·자격증명 없음 조건으로 build를 완료했다. 운영 런타임 증거는 아니다.

최종 사용자·배너 390·834·1440px 캡처6개 모두 문서 가로 넘침0이며 title18px, 데스크톱/태블릿 공통 header56px다. 모바일 header는 사용자150→96px(-54px,-36%), 배너142→88px(-54px,-38.03%); 주요 목록·페이지 버튼은32→44px(+12px,+37.5%)다. 조건별1회 관측으로95%구간을 산출하지 않으며 작업 시간·운영 성능 개선으로 해석하지 않는다. 원본 중간 관측과 최종 JPEG byte/hash·source hash는 `admin-cms-followup-20261018/artifact-map.json`에 구분해 보존했다.

CMS-FINAL-001~004는 관측 revision CAS, 실제 삭제된 행의 미디어 정리, 명시적 최신 상태 수용으로 보완됐고 독립 재검토에서도 로컬 소스 결함이 닫혔다. Hosted revision trigger 동작은 아직 미확인이다. 기존 Gemini FIFO/job/hash는 유지하고, 최신 소스 추가 묶음은 준비만 한다. 연구·운영·배포 gate는 미완료다.

### 혼합 모델 이력 복구와 보충 연구

모델 A가 응답한 뒤 parsing 실패하고 모델 B가 credential 거절을 반환한 경우, 이전 구현은 이력을 잃고 durable claim release를 허용할 수 있었다. 첫 수정에서도 세 번째 모델로 계속 진행하는 반례를 발견했다. 최종 helper는 operation 전체의 non-credential outcome을 단조 누적하고, 혼합 이력 뒤 credential 거절에서는 definitive=false로 중지한다. 이 조건에서 세 번째 모델·다음 credential 호출은0이며 pure credential-only 복구는 유지한다.

수정 전 직접 반례 두 건의 실패와 중간 수정은 보존했다. 최종 helper26/116, 통합79/447, TypeScript parity3,351입력/진단0과 build54페이지가 통과했다. 이후 test-only composition2/12와 durable 전체34/207이 실제 helper→durable 경로의 no-payload·force-refresh에서 release0·markIndeterminate1, 기존 result/payload/revision 보존과 추가 provider0을 확인했다. 이 그룹은 겹치므로 합산하지 않으며 fakeStore application 경계를 SQL 재증명으로 취급하지 않는다. [최종 소스·검증 경계](../../apps/web/performance/cross-audit-20261019/ocr-mixed-model-integrated-verification/final-source-readback.json).

실제 GPT-6 Pro + Deep Research 보충 보고서38,673bytes를 원문 그대로 저장했고 SHA는117b7a0f220af81c5283b385a1b5f46b440c628521fc5ca3522f3a5e7517a215다. [원본 대화](https://chatgpt.com/c/6ad50f71-6e94-83ee-bdf1-851a80101df8)와 frozen14a8f5da/bundle90c4e3f0…를 결속했다. 13개 consequential finding을 [판정표](../../apps/web/performance/cross-audit-20261019/ocr-credential-admission-supplemental-review/decision-matrix.json)와 [후속 판정](../../apps/web/performance/cross-audit-20261019/ocr-credential-admission-supplemental-review/decision-matrix-followup.json)에 매핑했다. 연구 슬롯은 전문 저장 직후 반환했다. 이 보충 연구는 Gemini 반대 감사나 최종 역검증이 아니다.

이 보충 연구 당시 initial canonical ACL admission은 미해결이었고, 기존106은 운영 applied가 아닌 held_unapplied이며 실제 적용 lineage는89→100→105였다. 이후 frozen/published106 pins를 보존하는 별도107과 versioned fail-closed admission, 일반 dispatch retry와 명시 recovery operation을 분리하는108을 구현했다. 현재 로컬 구현·DB·UI 검증 범위는 상단 실행 상태와 상세 보고서를 따르며, 후속 CI·외부 감사·운영 단계는 별도 gate다.
