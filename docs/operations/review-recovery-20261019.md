# 관리자 검수·OCR 복구 후속 검증

후속 수정의 기준은 PR #3215의 `b1c505cd4f065fac8a4ebefe235a85a5513acbd7`이다. 소스 검증과 운영 검증을 분리한다. 현재 증빙과 해시는 [인덱스](../../apps/web/performance/cross-audit-20261019/review-fixes-evidence-index.json), 전체 요청의 미완료 항목은 [목표 장부](goal-resume-20261018.md)에 기록한다.

최신 로컬 경계는108 raw `d3258b67…`, compiler `5a9154f5…`, fixture-only manifest `a239a64c…`, main fixture `01766da4…`다. 아래 이행 기록의 이전 후보·실패·통과를 그대로 보존하며, 새 후보의 실제 DB 후속 검증과 원격 CI·운영 적용·배포를 혼동하지 않는다.

## 동작과 정량 모델

| 경계 | 이전 실패 | 수정 후 확인한 결과 | 측정 한계 |
| --- | --- | --- | --- |
| 관리자 OCR 선택 | 가장 오래된 확정 사진 결함을 매번 다시 선택 | 전체 snapshot CAS와 terminal readback을 모두 확인해야 다음 행으로 이동. 권한·전송·provider·저장 불확실성은 중지 유지 | 합성 행 선택·상태 전이 검증. 운영 처리량 미측정 |
| 확정 credential 거절 | generation 불가능이 확인돼도 durable claim이 indeterminate에 남음 | 신뢰한 오류 분류와 정확한 claim token으로만 삭제 또는 기존 유효 결과 복구. stale ACK는 새 claim에 영향 없음 | 실제 유료 API 호출·복구 뒤 청구 결과 미검증 |
| 배너 업로드 | 긴 제목의 서버 거절 뒤 업로드가 누적되거나 `500 + invalid`를 확정 거절로 오인 | 100자 초과는 업로드 전 차단. 정확한400/403/404/409 status/code 조합에서만 현재 제출 파일 정리. 실제 component의 합성400에서 정리1회,500에서0회 | HTTPS 합성 Storage 경계이며 운영 Storage 검증은 별도 |
| 스토리보드 결속 | 실행 의존성 변경이 compatibility digest 밖에 존재 | 최초30개→35개 경계(+5개,+16.7%). 개별 의존성 변형 시 source·policy digest 변경, build route에도 새 digest 포함 | 선언한 first-party 경계 범위이며 운영 alias/private policy readback 미완료 |

정렬된 검수 행에서 확정 결함이 앞에 k개 있다고 하자. 이전 실패 경로는 첫 행을 terminal 처리하지 않아 한 번 실행할 때 완료 행 수 변화가 ΔP=0이고 다음 행까지의 선택 횟수에 유한 상한이 없었다. 수정 후 CAS와 독립 readback이 성공하고 새 행 삽입·동시 편집·외부 장애가 없다는 조건에서는 확정 결함마다 ΔP=1이므로 첫 정상 행에 도달하는 선택은 최대 k+1회다. 이는 조건부 진행성 모델이며 권한·저장 불확실성을 건너뛰는 근거가 아니다.

배너에서 한 제출에 파일 m개, 동일한 잘못된 입력의 재시도가 a회라면 이전 확정 거절 경로는 최대 a×m개의 미참조 업로드를 남길 수 있었다. 긴 제목은 새 경로에서 업로드0회이며, 서버의 확정 사전 거절은 현재 제출의 m개에 대해서만 정리를 시도한다. 정리 실패와 mutation 결과 불확실성은 별도 상태로 보존하므로 운영 미참조 파일이0개라고 주장하지 않는다.

OCR의 새 capability 검사는 실행 경로에 RPC1회를 추가한다. 미설치·malformed·held이면 claim·quota·provider 호출은0회다. 준비된 경로의 추가 비용은 RPC와 catalog 검증 비용이며, 기존 일일 quota 상한과 예약 과금 정책은 바꾸지 않았다. 재시도 때 기존 정책의 새 예약이 생길 수 있다. 지연·토큰·금액 절감은 측정하지 않았다.

## 검증 범위

- 배너18 pass/151 assertions, 관리자 OCR held 분기 포함26 pass/155 assertions, durable OCR32 pass/195 assertions, 스토리보드 관련38 pass/264 assertions, post105 compiler7 pass/59 assertions. 하위·재실행 그룹이 겹치므로 총합을 만들지 않는다.
- 통합 ESLint 통과, 고정 native TypeScript parity3,351 logical inputs/진단0, production build54/54페이지와 CSS 경계 통과. 후속 SQL-only 변경 뒤 compile 관련20/20개 파일의 해시가 같음을 확인했다.
- 실제 component의1280×900px synthetic browser에서101자+새 미디어 저장의 upload/PATCH/cleanup 요청은0/0/0이었다. 최초 HTTP loopback fixture의 URL 차단은 실패 증거로 보존했다. 유효한 HTTPS/no-port synthetic origin을 task-owned context가 전부 로컬 fulfill한 후속 검증에서100자+정확한400/invalid는1/1/1,100자+불확실500/invalid는1/1/0이었고 세 경우 모두 안내·제목·선택 파일·저장 가능한 draft를 보존했다. 외부 HTTP·hosted·provider 호출은0건이었다. 합성 WebSocket2건은 연결 전에 닫았고 context·서버·임시 harness를 정리하고 tsconfig를 복원했다.
- 함수4개의 전체 정규화 ACL·owner와 private table2개의 전체 ACL·owner를 seal에 결속했다. PG17.11 minimal harness에서 추가 table SELECT·추가 wrapper EXECUTE·두 table owner 변경의4개 반례가 모두 held이고 rollback 뒤 ready로 복구됐다. 이는 PG17.6 전체 predecessor 재현이나 hosted 적용의 대체 증거가 아니다.
- PG17.6의 최초 catalog fixture 실패 `RECEIPT_OCR_WRAPPER_ACL_DRIFT_NOT_HELD`는 NOSUPERUSER·owner SET=false 조건의 GRANT가 경고/no-op인 시험 결함이었다. 실제 owner GRANT는 기존 seal이 held로 감지했다. Migration·manifest·compiler를 바꾸지 않고 transaction-local owner lease·실제 mutation readback·membership 복원을 보완했다. 다음 합성 Auth 사용자 정리 실패도 보존하고, 운영 개인정보 ACL 변경 없이 disposable target 전체 폐기로 정리하도록 고쳤다. 표식 자체는 권한·소유권 증거가 아니다.
- 최종 event009에서 fresh PG17.6 constituent·aggregate 두 경로의105→106 적용·seal·44-statement vector·forced rollback·idempotency가 통과했다. 각 catalog의 경고0·mutation 표식10/10·membership 복원, durable assertion·dblink race·disconnect·residual handoff, exact target 제거·잔존0 및 source/retained105 dump 보존을 확인했다. 다만 해당 durable 전체 실행은 임시 `postgres SUPERUSER` lease를 사용했으므로 dblink race는 privileged local concurrency 증거로만 분류한다.
- 별도 fresh target의 event011은 canonical fixture1–444행,15,387bytes·SHA `7c2c382282682bee0437b9f6352e6e26f0d60525fc406837c920b22479a6965b`만 실행했다. 시작부터 끝까지 `postgres.rolsuper=false`이고 membership·dump·synthetic residual이 같았으며 exact teardown도 통과했다. 이에 비-dblink core의 일반 postgres 권한 증거는 성립한다. NOSUPERUSER dblink race와 hosted readiness는 미확인이다. 빈445행을 포함한 event010과 이전 실패 기록은 삭제하지 않았다.

위 수치는 결정적 fixture·소스 결속 범위다. 조건별 독립 운영 표본이 없어 성능 개선율이나 명목95% 신뢰구간을 계산하지 않는다. 단일 build 시간과 테스트 개수는 운영 성능 표본이 아니다.

ACL seal은 봉인 후 변경을 검사한다. 생성 시점의 creator default ACL에 이미 추가 grant가 있었다면 snapshot 일치만으로 이를 canonical 권한이라고 증명할 수 없다. 관측한 PG17.6에는 해당 `privacy_workflow_owner` default ACL이 없었으며 이번 fixture 실패 원인도 아니었다. 임의의 설치 환경까지 initial privilege allowlist를 보장한다는 더 넓은 주장은 이 증빙 범위에 포함하지 않는다.

## 전달 조건

기존 applied migration·89→100→105 manifest와 사용자 작업을 보존한다. 새 successor는 `held_unapplied`인 source-only 계약이며 기존 운영 실행기에 연결하지 않았다. 실제 Gemini 반대 감사와 최신 소스 역검증, 새 head CI, 현재 writer fence·admission에 따른 hosted SQL 적용/readback, 보호된 develop→data→main 승격, 운영 SHA·도메인 readback, 전체 메뉴의 관리자 실검증은 별도 단계다.

## CI 재생·후속 전달

`dfa77ca0b509c508ac29ec5f93fe7eb3f45cc16f`의 앱 복구를 PR #3215에 push하고 리뷰4건을 resolve했다. 해당 head의 Catalog/generate는 실행39150206730의 step12에서 `RECEIPT_OCR_CREDENTIAL_RELEASE_PREREQUISITE_DRIFT`로 실패했다. source-only generator가 Supabase migration ledger 없이 직접 SQL을 재생하기 때문이다.

후속 `14a8f5da4268df890c7adf10bf89e99ce071f6f5`는 정확한 raw migration hash에만 적용되는 PG15 disposable ledger fixture adapter다. 기존 ledger/schema가 있으면 거부하고 raw SQL 자체는 바꾸지 않는다. fixture가 있는 동안 unsealed held를 확인하고, 함수·table body/owner/ACL digest가 같아야 RESTRICT로 자기 자원만 정리한다. ledger 제거 후 getter ready를 주장하지 않는다. workflow의 표본·scorer·필수 검증은 줄이지 않았다.

독립 clean replay2회는 각각1,960행과 source-only candidate validation이 통과했고 산출물 hash58개가 일치했다. 두 candidate의 manifest SHA는 `ec7f3771722786fa0e8bb93e1cf7a00239dbf0477ee184d989eba53ffad3bc42`, SHA256SUMS는 `bb655d2bf637f95eed0f163bafc1a8611597e67203fdc0e33549f02367b48051`다. schema-only 및 synthetic1행 ledger2개 반례도 거절·보존됐다. 상세 범위는 [CI 재생 후속 증거](../../apps/web/performance/cross-audit-20261019/catalog-clean-replay-ci-recovery-followup.json)에 기록한다. Replay A는 exact ID 수집이 누락돼 이름·label 잔존0만 성립하고, Replay B만 exact-ID 폐기가 성립한다. 이 검증은 로컬 source-only 복원이며 운영 SQL·배포 증거가 아니다.

사용자 승인 범위의 GitGuardian 세 탐지 #38364337·#38364338·#38364339만 오탐 처리하고 UI에서 Ignored를 확인했다. [범위별 readback](../../apps/web/performance/cross-audit-20261019/gitguardian-owner-markers-false-positive-readback.json)을 보존했다. 다음 head의 CI는 별도 확인한다.

현재15메뉴×3화면 폭의 헤더45건이 source-bound로 통과했다. 미구현 loopback fixture 오류212건을 보존하며 전체 기능·인증 세션·운영 API 성공으로 해석하지 않는다. [헤더 후속 증거](../../apps/web/performance/cross-audit-20261019/admin-header-current-scope-readback.json)의 범위만 인정한다.

### 혼합 모델 이력 복구와 보충 연구

모델 A가 응답한 뒤 parsing 실패하고 모델 B가 credential 거절을 반환한 경우, 이전 구현은 이력을 잃고 durable claim release를 허용할 수 있었다. 첫 수정에서도 세 번째 모델로 계속 진행하는 반례를 발견했다. 최종 helper는 operation 전체의 non-credential outcome을 단조 누적하고, 혼합 이력 뒤 credential 거절에서는 definitive=false로 중지한다. 이 조건에서 세 번째 모델·다음 credential 호출은0이며 pure credential-only 복구는 유지한다.

수정 전 직접 반례 두 건의 실패와 중간 수정은 보존했다. 최종 helper26/116, 통합79/447, TypeScript parity3,351입력/진단0과 build54페이지가 통과했다. 이후 test-only composition2/12와 durable 전체34/207이 실제 helper→durable 경로의 no-payload·force-refresh에서 release0·markIndeterminate1, 기존 result/payload/revision 보존과 추가 provider0을 확인했다. 이 그룹은 겹치므로 합산하지 않으며 fakeStore application 경계를 SQL 재증명으로 취급하지 않는다. [최종 소스·검증 경계](../../apps/web/performance/cross-audit-20261019/ocr-mixed-model-integrated-verification/final-source-readback.json).

실제 GPT-6 Pro + Deep Research 보충 보고서38,673bytes를 원문 그대로 저장했고 SHA는117b7a0f220af81c5283b385a1b5f46b440c628521fc5ca3522f3a5e7517a215다. [원본 대화](https://chatgpt.com/c/6ad50f71-6e94-83ee-bdf1-851a80101df8)와 frozen14a8f5da/bundle90c4e3f0…를 결속했다. 13개 consequential finding을 [판정표](../../apps/web/performance/cross-audit-20261019/ocr-credential-admission-supplemental-review/decision-matrix.json)와 [후속 판정](../../apps/web/performance/cross-audit-20261019/ocr-credential-admission-supplemental-review/decision-matrix-followup.json)에 매핑했다. 연구 슬롯은 전문 저장 직후 반환했다. 이 보충 연구는 Gemini 반대 감사나 최종 역검증이 아니다.

Initial canonical ACL admission은 미해결이다. 기존106은 운영 applied가 아닌 held_unapplied이며 실제 적용 lineage는89→100→105다. Frozen/published106 pins를 보존하는 별도107과 versioned fail-closed admission을 준비한다. 새 P1 리뷰의 stale-pending admin rerun은 단순 generation 회전으로 해결하지 않는다. 일반 dispatch retry와 명시 recovery operation을 분리하고 ACK 손실·processing·stale generation의 중복 호출을 막는108 계약을 준비한다. 실제 구현·DB 검증·후속 CI·운영 단계는 별도 gate다.


### 65c98679 원격 CI 완료 재조회

2026-10-18T19:07:12Z에 PR #3215의 원격 head `65c9867998d9e0597e3a85c17271c8370fa85649`를 읽기 전용으로 확인했다. 성공30·skipped2·cancelled1이며 실패·대기0이다. 취소된 Promotion Path 실행39155988090/attempt1과 별도로 같은 head의39155999196/attempt1이 성공했다. 둘 다 pull_request_target 이벤트지만 취소 원인은 확정하지 않았다. Swift·Catalog/generate·Admin·GitGuardian도 성공했다. PR은 OPEN/BLOCKED이며, 이 재조회는 로컬107·108 초안이나 운영 DB·배포의 검증이 아니다. [결속된 재조회](../../apps/web/performance/cross-audit-20261019/pr-3215-65c98679-ci-completion-readback.json)에 실행 ID와 취소 기록을 함께 보존했다. 워크플로를 재실행하거나 PR을 병합하지 않았다.


### 107·108 후보의 관측 가능한 판정 기준

권한 admission은 `ready = 독립 허용 정책 F(현재 catalog) ∧ 저장된 seal과 일치 E ∧ 정확한 migration ledger L`로 모델링한다. 기존 반례는 `E=true`여도 `F=false`일 수 있음을 보였다. 새 후보는 실제 객체 생성자의 default privilege에 예상 밖 grantee가 섞인 네 함수·두 테이블을 거절해야 하고, 정상 owner·grantee·grantor·grant option은 PostgreSQL 버전의 owner 기본 권한 표현을 포함해 허용해야 한다. 단순 source 문자열 검사는 이 판정의 실제 DB 증거가 아니다.

명시적 재실행은 operation `o`, 관측 세대 `g`, 입력 snapshot hash `H`에 결속한다. 같은 operation의 추가 세대 변경 수는 `Δgeneration(o) ≤ 1`이어야 한다. 응답 유실 뒤 같은 operation 재전송은 저장된 결과를 읽고, 오래된 `g/H`, 다른 operation, 처리 중 상태는 새 세대로 회전하지 않아야 한다. 일반 GitHub dispatch 응답 유실과 provider 결과 불확실성을 구분한다. 새 유료 시도 가능성을 허용하는 명시 복구도 기존 일일 quota를 늘리지 않는다. 세대 회전의 멱등성이 외부 provider의 실행·취소 확정이나 비용 절감을 증명하지는 않는다.

두 수정은 되돌릴 수 있는 held source 후보다. 개별 source·단위 검사·격리 DB 재생·브라우저·원격 CI·외부 교차 감사·운영 적용을 각각 확인하기 전에는 해당 gate를 통과했다고 기록하지 않는다. 결정적 반례 통과 비율에 표본 성능의95% 구간을 붙이지 않는다.

### 107의 실제 초기 권한 반례와 PG15 재생

최종107은 migration `512f778b…`, 27 statements/vector `37decc48…`, manifest `58adb514…`, compiler `5dd0c667…`에 결속한다. PostgreSQL17.6의 실제 creator-default grant로 네 함수에 추가 EXECUTE4행, 두 테이블에 추가 SELECT2행을 각각 만든 뒤 실행했다. 두 경우 모두 `RECEIPT_OCR_ACL_V2_INITIAL_ADMISSION_FAILED`로 거절하고 ledger106을 유지했다. 105→106→107 결합 실행의 같은 반례는 전체 rollback되어 ledger105·후속 migration0·후속 table/helper 없음이 확인됐다.

정상 경우에는 ledger107/root `cd04aebf…`, 두 seal과 독립 권한 admission이 true이고 capability v2가 ready였다. 추가 grantee·grant option·owner 변경은 seal을 갱신해도 held였다. wrong-grantor 단독 반례까지 실행했다고 주장하지 않는다. PG17의 postgres와 privacy_workflow_owner는 전후 NOSUPERUSER였고, 기존 외부 grantor의 admin=true/inherit=false/set=false membership을 보존했다. transaction-local 자기 grant의 set=true lease만 추가했다가 정확히 복원했다. 네 일회용 대상은 모두 제거했고 label 잔존0, source dump 불변을 확인했다. 역사적 retained105 fixture는 읽거나 재사용하지 않았다. [독립 PG17 증거](../../apps/web/performance/cross-audit-20261019/ocr-credential-admission-supplemental-review/acl107-pg17-independent-followup.json)의 범위이며 운영 권한 증거는 아니다.

PG15.8의107 포함 clean catalog 재생은 새 대상2회에서 각각1,960행, comparator hash58개 일치로 끝났다. 각 실행에서 소유 container4개·volume2개·network1개를 정확히 제거하고 기존 자료를 보존했다. [PG15 후속 증거](../../apps/web/performance/cross-audit-20261019/ocr-credential-admission-supplemental-review/acl107-pg15-dual-clean-followup.json)는108을 포함하지 않는다. 실제 PG17에서 사용한 fixture의 explicit `GRANTED BY postgres` lease 두 쌍을 저장소에 동일 byte로 반영했고 [연속성 증거](../../apps/web/performance/cross-audit-20261019/ocr-credential-admission-supplemental-review/acl107-repository-fixture-continuity.json)에 원본·파생 hash와 변경 범위를 보존했다.

108은 별도 migration `c2c93eb5…`, 77 statements/vector `4653fc0b…`, manifest `ecadbe4e…`, compiler `740d03fd…`의 held 후보로 유지한다. active bound claim 뒤 리뷰 삭제를 막는 실행 lease, 첫 apply의 model/thinking readback 일치 검사, 근거 없는40초 ETA 제거가 추가됐다. 이 문단은 구현 상태이며108의 실제 DB·최종 UI·후속 원격 CI gate를 통과했다는 뜻이 아니다.

최종 앱 통합 재실행은9개 분리 그룹의140 tests/1,047 assertions, scoped ESLint, 고정 native/compat compiler parity3,356 logical inputs/진단0, production build54/54페이지와 CSS 경계가 통과했다. `tsconfig`의 이번 build include만 복원했고 검사 전후 앱 입력 hash가 동일하다. [최종 통합 영수증](../../apps/web/performance/cross-audit-20261019/ocr-admission-recovery-app-integrated-verification-final-v2/verification.json)의 SHA는 `48022cd71a7785e35f78a1f012feabc70bee168dc267556d0ab4bc781af2dafa`다. 최초 통합의 독립 mock 누락·오래된 source assertion 실패는 별도 원본과 분류로 보존했으며 통과 이력으로 덮지 않았다. 과거 겹치는29개 검사와 합산하지 않는다.

별도 동료의 [최종 읽기 전용 소스 감사](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-independent-audit/final-candidate-audit-20261018T195954Z.md)는 위108 hash에서 남은 P1 소스 결함을 찾지 못했고, 초기 finding11개를 구현·검증 경계와 매핑했다. active claim 뒤 프로세스가 종료되면 processing/lease를 시간만으로 풀지 않는다는 제한도 명시했다. 이는 실제 PostgreSQL 동시성이나 필수 외부 Deep Research 교차 감사를 대신하지 않는다.

최종 [Node24 브라우저 영수증](../../apps/web/performance/cross-audit-20261019/ocr-recovery-ui-browser-verification/final-neutral-status-node24-20261019/report.json)은 실제 component와 loopback 합성 endpoint에서36/36 assertions를 통과했다. 취소 시 apply0회, ACK-loss 재시도와 재로드에서 기존 operation 재사용, processing·preview conflict의 apply0회, stale apply1회 뒤 자동 재시도0회를 확인했다. 중립 상태 문구와 고정40초 ETA 부재도 실제 화면에서 확인했다. 하네스·Next 부모/자식·fixture 모두 Node24.22.0이며 소스·tsconfig는 전후 동일하고 소유 프로세스/listener를 정리했다. 외부/provider/hosted 호출0이며 의도된 합성 realtime 콘솔10건·모듈 전환 abort5건·stale409 콘솔1건은 예상 외 오류0과 구분했다. 앞선 Node26 관측과 실패 이력을 보존했고36개 결과와 합산하지 않는다. 이는 인증된 운영 관리자 기능 검증이 아니다.

### 실제 DB에서 발견한108 구문 결함

앞선 앱·소스 검사는 원본 SQL의 파서 실행을 증명하지 않았다. PostgreSQL15와17에서 초기108 `c2c93eb5…`의 statement27이 `IF … OR CASE … END` 구문 오류로 실패했다. [PG15 실패](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/initial-pg15-parser-failure.json)와 [PG17 실패](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/initial-pg17-parser-failure.json)를 그대로 보존한다. PG17은 COMMIT 전 중단·소유 target1/1 제거·잔존0만 확인했으며 사후 DB readback 없는 전체 rollback 성공을 주장하지 않는다.

어댑터의 admission 바깥 보정은 제거했고 원본에 괄호2바이트만 추가했다. 현재 migration은 `abc1cb12…`(62,725bytes), manifest `fec7a54c…`, 77 statements/vector `f15589b3…`, target ledger root `dd1dfb6c…`이다. [정확한2바이트 연속성](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/raw-syntax-two-byte-continuity.json)과 [독립 delta 재감사](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-independent-audit/syntax-delta-followup-20261018T201149Z.md)를 보존했다. 앱·compiler·fixture bytes는 불변이고 compiler3/3·36 assertions를 새 pins로 재실행했다. 따라서 앞선 앱·브라우저 증거는 해당 입력 범위에서 유지되지만, 새 원본의 실제 DB 적용·재생·동시성 검증은 새 결과가 나올 때까지 미완료다.

PG17 후속 실행에서 새 구문은 통과했고, 실제 예상 밖 ACL 함수14행·테이블3행을 만든107→108은 거절·ledger107·dump/role 복원으로 끝났다. 105→108 결합 반례도 전체 ledger105 복원·107/108 객체 없음이 확인됐다. 그러나 정상 설치는 compiler가 ledger108 삽입 뒤107 readiness를 요구하여 `RECEIPT_OCR_RECOVERY108_PREDECESSOR_NOT_READY`로 실패했다. [이 체크포인트](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/pg17-canonical-seal-order-failure.json)는 원본 파서·초기 권한 거절의 부분 성공만 증명한다. 정상 설치·post-install drift·앱 SQL fixture·두 세션 삭제 장벽은 아직 미실행/미통과다. 소유 target3/3 제거·잔존0을 확인했고, compiler 전이 및 설치 후 capability 결속을 수정 중이다.

같은 후보의 추가 소스 반례에서108 계약의 JSON이 실제 catalog snapshot이 아닌 이름·필드 선언이며 equality 검사도 없음을 발견했다. 동일 owner/ACL을 유지한 함수 본문 교체, trigger disable, lease FK 제거/CASCADE 변경은 기존 getter의 ready를 유지할 수 있다. [독립 P1 확인](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-independent-audit/catalog-integrity-counterexample-20261018T202159Z.md)은 이전 최종 감사의 closure를 이 범위에서 제한한다. 수정 목표는 독립 ACL 정책F에 더해 실제 function/table/trigger catalog와 저장 snapshot의 일치E, 정확한 ledgerL을 모두 확인하는 것이다. 이 반례는 아직 실제 DB 통과 증거가 아니며 구현 owner의 새 source freeze 및 별도 DB 회귀가 필요하다. `abc1cb12…` PG15 clean replay2회의1,960행·hash58개 동등은 [역사적 source-only 결과](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/pg15-abc1cb12-interim-dual-clean.json)로 보존하며 운영 compiler의 정상 설치나 새 후보의 integrity를 대신하지 않는다.

### 확인창 문구 간소화

OCR 확인창의 내부 영문 보호 단계 설명을 `계속하시겠습니까?`로 줄였다. 추가 API 사용 경고와 첫 확인·취소·operation 재사용은 유지하고 요청 body·서버의 보호 확인 상수는 변경하지 않았다. [새 Node24 UI 검증](../../apps/web/performance/cross-audit-20261019/ocr-recovery-ui-browser-verification/final-simple-confirmation-node24-20261019/report.json)은39/39 assertions, 영향 테스트26/381, scoped lint/type check를 통과했다. 내부 설명은 확인창3개 모두에서 사라졌고 exact API guard 값은 그대로였다. 새 component SHA는 `1d7b5a06…`다. 앞선36개·140개 검사 시점의 component와 구분하며 겹치는 검사 수를 합산하지 않는다. Provider/hosted 호출0, 소스·tsconfig 전후 일치 및 소유 프로세스 정리를 확인했다.

### 실제 catalog 봉인과 최신 로컬 검증

새 raw `d3258b67…`는83 statements/vector `3d0bfeb1…`, target root `2c7b7fff…`에 결속한다. 실제 함수17개·테이블3개·필수 트리거2개의 정의·보안 속성·ACL·schema/FK/RLS/policy·enabled 상태를 snapshot과 비교하고 독립 ACL 정책도 유지한다. Compiler는 정확한107 봉인 한 행을 CAS로108 ledger에 재결속하고 기존 v2 capability exact readback 뒤108을 봉인한다. [독립 closure 감사](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-independent-audit/catalog-integrity-closure-audit-20261018T203143Z.md)는 기존 operation/lease/정책·잠금·멱등성 경로의 bytes가 보존됐고 이전 integrity P1이 소스상 닫혔음을 확인했다. 실제 DB 반례는 별도다.

최신 [앱 통합 v3](../../apps/web/performance/cross-audit-20261019/ocr-admission-recovery-app-integrated-verification-final-v3/artifact-map.json)는140 tests/1,070 assertions·scoped ESLint·parity3,356입력/진단0·build54/54 및 CSS 경계를 통과했다. 검사 전후 입력은 동일했다. 이후 main fixture의 synthetic content7자 두 개가 실제10자 이상 제약을 위반해 `fixture content`로만 수정됐다. [연속성](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/fixture-content-continuity.json)은 fixture literal2개·manifest의 fixture SHA1개 외 모든 앱·raw·compiler 입력이 같음을 확인한다. 새 fixture SHA는 `27921380…`, manifest는 `a2acfb69…`이고 compiler3/3·59 assertions를 다시 통과했다. [PG17 체크포인트](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/pg17-canonical-pass-fixture-content-failure.json)는 정상105→108 설치·양 capability·role 복원·반복 거부/덤프 불변·초기 ACL 두 경로의 통과와 당시 main fixture 실패를 함께 기록한다. 새 main·post-install drift·두 세션 장벽은 후속 결과가 필요하다.

같은 raw의 [PG15 두 clean replay](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/pg15-d3258b67-dual-clean.json)는 각각1,960행과 hash58개 동등, 각 container4/volume2/network1 exact cleanup·잔존0을 확인했다. source/retained105 dump와 역사적14A 자료는 불변이다. [fixture-only G026 연속성](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/pg15-final-fixture-g026-continuity.json)은 generator 폐쇄32항목·232파일의 canonical hash가 전후 `45b3d770…`로 같고, 변경된 fixture/manifest/compiler는 source-only DB replay 입력이 아님을 확인했다. 따라서 두 DB replay를 불필요하게 다시 실행하지 않고 최종 fixture 결속을 별도 compiler 검사로 확인했다. 이전 snapshot에서 실행한 결과를 새 manifest로 실행했다고 재표시하지 않는다.


### v13 fixture-only 결속과 실제 catalog 오류 보존

v12의 canonical 설치는 통과했지만 main fixture에 임의로 추가했던 `public.restaurants_backup` INSERT는 실제 operating105 catalog에 없는 테이블을 참조해 실패했다. 실제 `reviews.restaurant_id`에도 그 추론의 근거였던 FK가 없었다. 두 줄만 제거하고 리뷰 내용 최소 길이와 transaction `now()` 경계를 만족하는 입력은 유지했다. [실패 영수증](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/pg17-canonical-pass-invalid-backup-fixture-failure.json)의 canonical ready 복원·소유 target1/1 제거·잔존0을 보존한다. Migration이나 운영 제약을 완화하지 않았다.

이 중간 main fixture SHA는 `26895e1c7fe159ad00b22e7c41ce08c9c8d45963aeb437666ae544ed65358b31`, manifest SHA는 `c3537fd0049e127190115cb356f18132ad7847fcd92bc826ccf5678ce6df8627`다. 최신 앱 검증 입력33개 중 변경은 이 두 파일뿐이며, 현재 fixture의 두 `fixture content / now()` 입력을 원래 값으로 역변환하면 원래 byte hash가 재현된다. Manifest도 fixture hash 한 곳만 되돌리면 원본 byte hash와 같다. [최종 연속성 영수증](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/final-v13-fixture-only-continuity.json)의 SHA는 `693d29ab61a3b9dcee694372e6a644fa540dae0852a3928ef8aef5056bd259dc`다. 따라서 앱140/1,070·UI39/39·PG15 generator 입력232파일 증거는 각각 원래 snapshot에 귀속해 유지하고, 최종 fixture는 별도 compiler3/59와 실제 PG17 main 검사로 확인한다. 최종 source 검사 [artifact map](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-source-verification-v6/artifact-map.json)은 `976fdbf0…`다.


### 최종 PostgreSQL17 main·역할 경계 통과

v13에서는 서비스 역할이 비공개 테이블을 직접 읽는 시험 결함이 있었다. [실패 원문 영수증](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/pg17-canonical-pass-private-fixture-role-failure.json)을 유지하고, 제품 public RPC25개는 `service_role`, private seed/readback11개는 명시적 `postgres` 구간으로 분리했다. 역할 전환7쌍·`current_user` assertion15개·transaction-local UUID GUC5개를 독립 확인했으며 기존 main marker12개와 실패 거부 검사는 유지했다. Private schema·제품 권한·raw migration·compiler를 바꾸지 않았다. [역할 delta 감사](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-independent-audit/final-role-boundary-delta-audit-20261018T205829Z.md)의 SHA는 `b47023dd…`다.

최종 manifest `a239a64c…`, fixture `01766da4…`로 실제 PostgreSQL17.6 canonical atomic105→108·terminal root `2c7b7fff…`·반복 거부·덤프 불변·역할 복원을 확인했다. Main fixture는 필수 marker12/12·exit0·stderr0이며 transaction rollback 뒤 canonical ready였다. Raw·compiler·statement vector·target root가 같은 v11의 초기 추가 ACL14+3 거부, 함수 body·트리거2개·FK2개 drift held→ready와 실제 두 세션의 release/terminal 삭제 장벽은 재사용 조건을 명시해 결속했다. 소유 target은 v11의4개와 최종 v14의1개를 합쳐5/5 제거·잔존0이다. 이전 실패 시도의 cleanup은 각 실패 영수증에 별도 기록하며 이5개에 중복 합산하지 않는다.

[최종 PG17 공개 증거](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/final-pg17-proof.json) SHA는 `7d2f94719344d2900ccbb9c6d7113e2b7d355c625d1f7c9dc218c1fd2f89a92b`, [root의 실제 소스·역할·main 재조회](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/final-root-source-readback.json)는 `1ef6c545…`다. Postgres는 전 과정 NOSUPERUSER지만 기존 BYPASSRLS·CREATEROLE 등의 baseline flag를 유지했으므로 비특권 계정 시험이라고 부르지 않는다. Provider 호출0이며 이미 시작한 provider를 취소했다는 주장은 없다.

앱 통합 snapshot의137 tests/1,011 assertions와 최종 fixture/manifest에서 재실행한 compiler3/59는 서로 다른 그룹이다. 합친140/1,070은 소스 연속성이 확인된 구성 검증이며, 모든 그룹을 최종 fixture로 재실행했다는 뜻이 아니다. UI39/39의8개 소스 hash와 PG15 source-only raw/adapter/generator 폐쇄는 그대로다. 최신 fixture/manifest 결속은 [source v7](../../apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-source-verification-v7/artifact-map.json) `111b1da6…`를 따른다. 결정적 fixture의 통과 수에 성능95% 구간을 붙이지 않는다. 실제 외부 반대 감사·역검증,89→108 운영 executor·fresh writer fence·rollback/readback, 보호된 승격·운영 SQL·배포·인증된15메뉴 검증은 미완료다.
