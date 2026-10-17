# OCR·Gemini 스토리보드·롱폼 준비의 전달 상태

이 문서는 격리 후보의 구현·로컬 검증 장부다. 운영 DB 적용·배포·실제 사용자 처리 완료를 뜻하지 않는다. 원문 전체 요구는 `project-request-todos-20261009.md`에 유지한다.

| 대상 | 구현과 선택 근거 | 확인한 증거 | 남은 단계 |
| --- | --- | --- | --- |
| 영수증 OCR | fingerprint별 내구성 claim, dispatch 전후 구분, 불확실한 응답 재조회, 서버 결과 revision을 UI·save RPC·readback에 결합 | v5 source 18개 SHA 일치; 72/72 tests·819 assertions 및 같은 범위 독립 재실행; 실제 catalog 복제 PG17.6에서 stale revision·G014·immutable metadata·create/delete 경합 통과 | 운영 bucket/metadata 및 live Gemini·저장·청구 readback |
| 영수증 업로드 | OCR과 upload에 같은 준비 완료 File 사용, 5MiB 초과·압축 실패는 ReviewModal의 quota/provider 진입 전에 거부 | 5–8MiB 실패 fixture의 quota/provider 각각 0; source-defined bucket 5MiB | 직접 OCR API는 기존 8MiB 한도를 유지; 실제 Storage overwrite 권한과 직접 S3 authority는 별도 검증 |
| 스토리보드 | 새 workflow는 Gemini-only, metadata readiness 전에는 claim하지 않음, 같은 worker의 정확한 text/image 모델 쌍 요구 | 131 tests; exact PG17.6 두 predecessor 체인 각각 30 assertions; 실제 catalog G014·6테이블 archive guard·구 RPC late resume 차단 | hosted migration/deploy/live Gemini·기존 큐 cutover readback |
| 과거 스토리보드 | 문서·자산·편집·역사 읽기·export 유지, 이전 비Gemini 실행과 수동 import는 중지 | archive history digest 보존, active legacy job terminal 전환 | 실제 데이터와 운영 큐의 cutover readback |
| 롱폼 준비 | 완료 videos/streams에서 Shorts·live/upcoming/post_live 제외, 변경 가능한 입력을 1회 캡처하고 resume에 immutable snapshot 사용 | eligible 1,071·Shorts 81·caption 9·missing 1,062; 작성자25/25 및 마지막 독립3/3; 2-target mutable read13회→resume0회 | 전체 claude-video 시각·음성 분석 0/1,071; 공유 OSK materialization·운영 graph 갱신 |
| 운영 hold readback | requireAdmin 선행, 현재 immutable deployment ID·commit·hold를 runtime에서 확인하고 collector와 교차검증 | 78 관련 tests·206 assertions; Next route export 계약 수정 후 관련9 tests·1,193 assertions·production build 통과; 원격/운영 호출0 | 원래15분 창에서 in-flight 부재와7개 writer fence·Gemini 정책을 보존하는 rollback 확인; launch held |

데이터 보호 불변식은 `저장 revision = 현재 결과 revision`, `generation admission ∈ {0,1}`, `준비 완료 verification bytes ≤ 5×1024²`, `legacy workflow의 컷오버 이후 INSERT/UPDATE = 거부`로 표현한다. 읽기 작업량은 caption source 수에 대해 `O(N+C+K)`이며 고정 fixture의 13→0 읽기 횟수는 결정적 동작 검증이다. 처리 시간·RSS·금액 절감의 측정으로 해석하지 않는다.

실제 catalog 복제 통합 검증은 최종 frozen 두 migration을 적용했으나 실패했다. 새 service-role RPC와 trigger EXECUTE 8건이 G014 허용 목록과 불일치했고, predecessor의 authenticated UPDATE 정책이 immutable Storage 전제와 충돌했다. baseline `g014_pg17_workflow_owner_membership_denied`도 fixture actor/역할과 구분해 조사해야 한다. 실패 증빙 `pg17-existing-catalog-replay-final-frozen.json` SHA는 `4851f0dab3cb200b1b613b46b6da5eba58852b07733c5e4750784d0503b14fbf`이며 원본 clone hash 전후는 같고 소유 container cleanup은 확인됐다. 후속 additive SQL로 수정 중이며 기존 applied/frozen SQL과 이 실패 영수증을 덮어쓰지 않는다.

모델 ID는 text `gemini-3.8-flash`, image `gemini-3.1-flash-image`와 `gemini-3-pro-image`다. 공식 이름 지원과 기존 역사 canary는 현재 후보의 프로젝트 접근·청구·live 실행 성공을 대신하지 않는다. 이 후보 검증의 provider·hosted DB·Storage 요청과 배포는 0회다. 서로 겹치는 테스트·여러 predecessor 체인의 assertions를 하나의 독립 표본 수로 합산하지 않는다.

## 2026-10-13 카탈로그 결함 수정과 결합 검증

기존 실패 영수증을 보존한 채 후속 SQL `20261013190100`·`20261013190200`을 추가했다. G014의 effective RPC matrix 불일치는 8→0건이다. 7 public wrapper와 7 private helper를 owner·SECURITY DEFINER·반환형·search_path·EXECUTE·allowlist까지 행별 대조했다. 새 immutable verification 정책은 authenticated upsert를 차단하고 privileged metadata UPDATE/DELETE도 trigger로 거부한다. 이전 DELETE OR 우회 가설은 반증됐다: 실제 permissive owner와 restrictive safe-delete의 조합은 owner AND safe-delete였으며 참조 중 authenticated DELETE는 이미 0행이었다. 새 DELETE trigger는 RLS 우회자와 create/delete 경합의 보호를 추가한다.

최종 `pg17-existing-catalog-replay-delete-races-success-20261013.json` SHA `4de818ec45f4a69c1fe714fc07dbea6180af5930edd42eacf124d6b05093f356`은 status passed·findings 0이다. PostgreSQL 17.6 고정 이미지, 23개 source·590,651bytes의 단일 snapshot, migration ledger 101건, 4 feature SQL exact rollback, 원본 catalog 2,633,559bytes/hash 전후 동일·role catalog 동일·소유 container 제거를 확인했다. create-wins는 DELETE 거부·리뷰/객체 보존, delete-wins는 tombstone 생성·후속 리뷰 연결 거부이며 실제 lock wait도 관측했다. 이는 합성 DB 검증이고 직접 S3 bytes 권한·hosted bucket metadata·계정 삭제와 guarded-admin 전체 흐름의 직접 실행은 포함하지 않는다.

구 실행 UI `LegacyStoryboardReference.tsx`는 10,167줄/399,551bytes에서 10줄/434bytes의 Gemini 진입점 alias로 바뀌었다. 제거량은 10,157줄(99.90%)·399,117bytes(99.89%)이며 전수 source 크기 비교라 표본 CI는 적용하지 않는다. 외부 active runtime caller는 0건이고 역사 문서·자산·export·provenance decode를 보존했다. runtime 속도·번들 크기 개선의 측정은 아니다.

TypeScript parity는 repo 밖의 임의 입력을 허용하는 대신 `backend/utils/provider-budget.mjs` 한 경로만 canonical 논리 이름으로 결속한다. source identity·내용 SHA 전후 비교와 양쪽 compiler 실제 사용을 요구하고 symlink/인접 checkout/.env·임의 backend 입력을 거부한다. 31 regressions·699 assertions, native 7.0.2/compat 6.0.2 진단 0, 논리 입력 3,147개를 확인했다. 논리 이름 SHA `7dd12e20d90bd545032160d953537aa34645a8973ed3aff05bf889fec3ccc2c6`, 내용 SHA `9e023d84ba89e597648c46190f9f4e674c8c20038c68c08392ad41b21a3375eb`이다.

첫 결합 전체 runner는 22개 실패를 확인했고 현재 Gemini/revision 계약과 종료 race를 보존하여 fixtures를 수정했다. 후속 general group은 3,418 pass·3 skip·1 fail이었다. 마지막 실패는 제거된 legacy horizontal owner 3개가 allowlist에 남아 있었으며 exact source/allowlist equality를 유지한 채 stale 항목만 제거했고 관련 10/10이 통과했다. 최종 전체 runner는 3,637 pass·11 skip·0 fail, 90,914 assertions·450파일·20그룹으로 종료했다. 이 전체 실행은 후속 route helper 추출과 운영 workflow 추가 전의 증거이며, 후속 변경은 별도 affected 검증과 구분한다. 겹치는 targeted 재검증을 독립 테스트 수로 더하지 않는다.

## 2026-10-14 소스 재확인과 빌드 복구

전체 목표 원문은 `/Users/twoimo/.codex/attachments/0c6fdf5d-a1c1-45bd-937a-1b6ed6234eb1/goal-objective.md`이며 SHA `130081bfa88b4c721623b50a0ddddd878b3793a483f4e2073ab71bbc297ef4dc`다. 기존 요구를 축소하지 않았다.

Next의 route.ts가 HTTP handler 외 helper를 export해 production type 검사에 실패한 증거를 보존하고 helper를 server-only 별도 파일로 옮겼다. `requireAdmin` 선행과 고정 오류 코드·private/no-store를 유지한다. 관련9 tests·1,193 assertions·targeted ESLint 및 native7.0.2/compat6.0.2 parity(3,148논리 입력·진단0)를 통과했다.

Node24.21.0/npm11.6.2/Next16.3.8의 격리 production build는 exit0, static52페이지, CSS boundary 검증 통과다. `production-build-success-20261013.json` SHA `cbd91c8b6ce762a350d8c84ed7c2bf9d217a9af9cd0f6bc03b142fa59dcedf0b`, 입력 inventory SHA `7fbe352817f033ef119081996c5bfef0504f5ad4bea3abc2ce6968d7d9b76890`를 확인했고 이번 재개에서 1,033개 결속 소스의 내용/hash drift는0건이었다. 한 번의 로컬 `/privacy` 응답200은 인증된 관리자·Supabase·Gemini·배포 검증이 아니다. 최초 실패 영수증은 계속 보존한다.

11개 review-media migration의 운영 실행기와 owner-only manual workflow가 소스로 준비됐고 일반 actionlint1.7.12 검사를 ignore 없이 통과했다. 원래15분 evidence window, 네 개 human custody commitment와 세 개 machine fence, DB에서 네 relation의 quiescence를 별도로 확인한다. 새4개 feature SQL은97→101 별도 보호된 후속 적용 경로가 필요하다. 현재 운영 적용·dispatch·provider 호출·배포는 수행하지 않았으며 launch held를 임의 해제하지 않았다.

운영 실행기 독립 감사 뒤 rehearsal 이후 machine fence/quiescence를 다시 관측하고 apply 전용 exclusive receipt·map·관측 시각·배포/hash를 admission과 controller 양쪽에서 검증하도록 보완했다. 직접71 tests·428 assertions와 당시 workflow5 tests·65 assertions는 겹치는 로컬 검증으로 분리한다. 원래 owner commitment를 machine proof로 바꾸지 않으며11개 SQL bytes와 launch held를 유지한다.

별도4단계 manifest/controller는97→101 전이와 원래15분 창·committed parent custody·7 fences를 결속한다. 작성자 검증은 연결된 controller80 tests와4개 기능계약30 tests·690 assertions였으나 후속11개 admission schema 및 최신UI source와의 통합·workflow 연결은 별도 검증해야 한다. 실제 적용은0회다.

`/api/admin/operating-readback/storyboard-policy`는 requireAdmin 이후 정확한 production/main/deployment/commit에서 공용 선언·요청·worker admission 함수를 실행해 정책을 확인한다. provider와 text/image 허용 집합, legacy 실행 차단을 policy SHA `d4e644ac12e3489a5f8074cbab8ed154bafb846f47db147ca5a4163ec175a804`에 결속하며 실제 provider 접근과DB 컷오버는 미검증으로 표시한다. 관련11 tests·ESLint·native/compat parity3,150 입력·진단0이다. 기존52페이지 build는 이 새route를 포함하지 않는 앞선 build 증거다.

PG17 SQL acceptance의23개 input 중22개는 현재bytes/hash와 일치한다. 운영 evidence schema가 바뀐 manifest1개는 acceptance 당시61b4d002의 정확한Git blob을historical-61b4d002에 보존했다. frozen SQL4개와PG acceptance를 현재 운영controller 검증으로 승격하지 않는다.

## 2026-10-14 Feature successor toolchain 통합

11단계 parent controller의 현재 SHA가 `4f3dacb6f51a669bf64209b380b19e8274d2703101fc50f815153237f4a99d93`인데 feature manifest는 이전 SHA를 가리켜, 단독 feature suite가 시작 전 `FEATURE_SUCCESSOR_SOURCE_DRIFT`로 0 pass·1 fail을 재현했다. manifest를 현재 parent controller에 다시 결속하고, feature controller가 직접 사용하는 `vercel-rollback-readback.mjs`와 parent manifest 자체의 SHA도 추가로 고정했다. parent manifest의 SQL source root만 같고 writer fence·toolchain·terminal contract가 달라지는 경우를 허용하지 않도록 회귀 검사를 추가했다.

최종 manifest SHA는 `87bb27af128b2c4d23c433a442598a1e83536fe1dd32d0ff783e2a554b42968c`, feature controller SHA는 `089ce227a95142deca4ca4d782a51f348ac2278659ebc10bd1d54cbcacd69d4b`다. 6개 toolchain entry의 기대/실제 SHA 불일치0건, parent manifest 기대/실제 SHA 불일치0건이다. 단독 suite는 11 pass·0 fail·67 assertions, parent admission/orchestrator/workflow/harness/feature를 합친8파일은167 pass·0 fail·1,075 assertions, TypeScript parity는3,152입력·진단0, targeted ESLint 오류0이다. 결정적 hash/계약 검증 1회이므로 변화율과95% 신뢰구간은 적용하지 않는다.

launch held, 원래15분 evidence window, 7개 writer fence,97→101 전이와4개 SQL bytes는 변경하지 않았다. `apps/web/supabase/.temp/`도 보존했다. 운영 DB·provider·배포·원격 mutation은 모두0회이며, 이 검증은 hosted 적용이나 실제 production runtime 성공의 증거가 아니다. 별도 영수증은 `apps/web/performance/feature-completion-20261013/feature-successor-toolchain-integration-20261014.json`에 보관한다.

## 2026-10-15 Parent runtime admission 결속 PG17.6 재생

후속 전체 general group은 3,510 pass·3 skip·1 fail·89,552 assertions였고 유일 실패는 retained proof selector의 `LOCAL_REHEARSAL_ARTIFACT_SHA256_MISMATCH`였다. 불일치는 SQL이 아니라 현재 parent manifest·controller·직접 테스트 3개 source binding이었다. 이전 proof와 selector, artifact map을 historical 파일로 보존한 뒤 현재 map을 실제 source bytes에 결속했다. 기존 proof는 재생 전에 `retained-historical-evidence`로 분류됐으며 필드를 현재 SHA로 바꾸지 않았다.

현재 parent manifest SHA `ad1da2db884229ea4b1fbcf6e4caaa04c30c6df7562e94fff01341736ee689d6`와 controller SHA `4f3dacb6f51a669bf64209b380b19e8274d2703101fc50f815153237f4a99d93`에 대해 격리 PostgreSQL 17.6 재생을 새로 수행했다. 11개 migration·112개 statement·12개 rollback stage, 강제 실패 rollback, 응답 유실 1회 복구, advisory-lock 경합 후 만료 거부, 최종 apply guard 만료 전 terminal readback과 전체 rollback이 통과했다. 임시 container 제거를 readback했고 hosted DB·provider·배포·원격 mutation은 0회다.

새 proof SHA는 `6bd946be5b9e0a9a9ef1523112f535456955bc424eaf278c1e23812ce8efc75e`다. SQL source root `61f9d7637c0714a7b0d9108c6f7959ea820175a7870dba681498b570296a1544`와 compiled SQL SHA `285d0c859117006646389dbd2a22de9aef1c0b97bc796a9e4d4448a8a232b093`는 이전 proof와 동일해서 SQL bytes 변경은 0건이다. launch held, 원래 15분 window, 7개 writer fence도 유지했다. selector SHA는 `67d69712d0ded23baf81faac35bc277d3e38e156639b02030efe0f6c9276e89d`, rehearsal map SHA는 `fe2eee6bfa2f5ab20b17b10d4ca48d4e5351d57dd9330ccadab918aa183e5263`, successor map SHA는 `b173616092cee591ecba7aa363dd05d55cfb9f75a6ce880e9e690398b309f87f`이며 두 map의 67개 entry를 전부 재검증했다.

selector 계약은 재생 전 14 pass·55 assertions, parent successor/rehearsal/migration/ownership의 affected 5파일은 재생 후 106 pass·0 fail·693 assertions다. 이는 결정적 1회 replay라 변화율·95% 신뢰구간을 계산하지 않는다. 전체 general group은 남은 root UI 변경을 합친 최종 source에서 다시 실행해야 하므로 여기서는 3,511 pass로 승격하지 않는다. 새 영수증은 `apps/web/performance/feature-completion-20261013/review-media-runtime-admission-retained-proof-20261015.json`에 보관한다.

## 2026-10-15 Storyboard runtime source·alias 결속

스토리보드 정책 선언만 일치하고 실제 worker/provider 경로가 바뀌는 공백을 닫았다. 빌드가 production route·worker·store·Gemini client·provider/model contract를 포함한 실행 경계 20개의 정확한 bytes를 읽어 source binding SHA `9ddbba0c54dae67b70a2301168034b633f2c0cf1e4b2ae5c3a2a3d548c389cd8`을 주입한다. 공용·관리자 readback은 이 값이 없거나 형식이 틀리면 닫히고, canonical policy SHA `3426d02d2cad6c690030b6002d801361224045f7cc60d69e515e1a196cec4a8c`는 이 source binding을 포함한다. 실제 worker entrypoint에 비Gemini fallback 표식을 더한 반증 fixture에서 source binding과 policy SHA가 모두 바뀌며, 누락 source는 빌드 계산 단계에서 거부된다. 모델은 text `gemini-3.8-flash`, image `gemini-3.1-flash-image`·`gemini-3-pro-image` 그대로이고 비용·한도·호출 논리는 변경하지 않았다.

프로덕션 HTTP 관측은 apex `tzudong.app`과 canonical `www.tzudong.app`을 각각 호출한다. apex의 정상 308은 정확한 www compatibility endpoint로 향하는 route 사실로만 기록하고 deployment identity로 합성하지 않는다. www는 direct fixed DTO여야 하며, apex가 direct인 경우에는 두 DTO의 deployment·commit·policy가 같아야 한다. 실제 deployment와 두 alias의 동일성은 Vercel vendor API의 deployment·alias 응답으로만 인정한다. 부모 작업이 제공한 fresh Vercel MCP readback에서는 두 alias가 project `prj_sau35J5uUtShIQ9OKofRtOVVnTSl`·deployment `dpl_EUxJnWmDDozCSMWb2sqNSPgKJLM5`를 가리키고 apex만 www redirect를 가진다. 이 하위 작업이 해당 vendor 호출을 독립 재실행한 것은 아니다.

운영 workflow의 기존 frozen bundle→vendor DTO 합성은 제거했다. apply runner는 Node24/npm11.6.2에서 Vercel CLI `56.5.0`을 정확히 설치하고, 실제 `vercel api` stdout을 deployment와 두 alias의 expected identity에 대조한다. credential 없음·다른 deployment·다른 alias·vendor unavailable은 predecessor SQL mutation 전에 `SUCCESSOR_VERCEL_READBACK_UNCONFIRMED`로 닫힌다. 성공 경로는 base 적용 전에 3개 endpoint를 함께 재검증한 뒤 feature 네 단계마다 같은 3개 endpoint를 다시 읽어 총 15회 live vendor read를 수행한다. 저장소 GitHub secret 이름 metadata를 1회 읽었으나 `VERCEL_TOKEN`은 없었고 값 조회·생성·변경은 0회다. 남은 외부 의존성은 정확히 하나다. exact Tzudong team/project/deployment/alias를 읽을 수 있는 least-privilege repository Actions secret `VERCEL_TOKEN`을 등록해야 한다. 기존 `SUPABASE_DB_URL` 보호 경로는 그대로 사용하며 local DB URL이나 새 DB credential은 필요하지 않다.

검증은 targeted 46 pass·409 assertions, affected 21파일 303 pass·0 fail·1,875 assertions, native7.0.2/compat6.0.2 parity 3,161입력·진단0, targeted ESLint 오류0, actionlint1.7.12 오류0, Node24.21.0/npm11.6.2/Next16.3.8 격리 build 52페이지·exit0이다. targeted 46개 중 workflow 계약6개·166 assertions는 성공, credential 없음, vendor unavailable, deployment 불일치, alias 불일치를 모두 독립 검증했다. 로컬 bundled public route는 200·`private, no-store`를 반환했지만 실제 production alias identity 증거로 승격하지 않는다. parent manifest SHA `ad1da2db884229ea4b1fbcf6e4caaa04c30c6df7562e94fff01341736ee689d6`, controller SHA `4f3dacb6f51a669bf64209b380b19e8274d2703101fc50f815153237f4a99d93`, SQL source root `61f9d7637c0714a7b0d9108c6f7959ea820175a7870dba681498b570296a1544`, compiled SQL SHA `285d0c859117006646389dbd2a22de9aef1c0b97bc796a9e4d4448a8a232b093`는 그대로다. 변경이 SQL source root 밖이라 같은 PG17.6 replay는 반복하지 않았고 기존 proof를 재라벨하지 않았다. launch held·15분 window·7 fences·원본 SQL bytes를 유지했으며 hosted DB·provider·배포·원격 mutation은 0회다. workflow SHA는 `98d77342a8dac80729bf03e2d9fe0b826d1417c106836947558c73045e5f945b`다. 분리 영수증 SHA는 해당 JSON sidecar로 검증한다.

운영 전환은 두 보호 release로 분리한다. 먼저 현재 `held` manifest로 앱을 배포해 새 policy/public compatibility API와 apex·www·vendor deployment identity를 같은 protected-main source에 결속한다. 그 readback 뒤 별도 최소 release에서 base·feature launch state를 함께 `ready`로 바꾸고, 바뀐 base manifest SHA를 feature predecessor에 반영한다. 현재 retained proof는 held base manifest SHA에 결속돼 있으므로 ready bytes로 재라벨하지 않는다. SQL source root가 같더라도 ready commit에서 격리 PG17.6 rehearsal과 selector/artifact map을 다시 만들어 manifest·controller·sourceRoot·compiled SQL을 새로 결속하고, ready commit을 다시 배포한 뒤 fresh 15분 capture → observe → rehearse → apply → 86→97→101 ledger·기능 readback 순서로 실행한다.

## 2026-10-15 Held 앱 feature DB admission delta

운영 DB 86에서 새 리뷰·OCR·스토리보드 mutation이 외부 호출·Storage 업로드·durable claim·storyboard claim보다 먼저 고정 보류 응답을 내도록 owner-scoped read-only feature readiness를 공통화했다. 기존 리뷰 목록·스토리보드 archive/catalog read는 유지한다. UI 보류 문구에는 RPC·SQL·migration 번호를 노출하지 않는다. worker는 readiness가 ready인 경우에만 메모리 admission과 Gemini catalog 조회를 시작한다. 5초 간격 120회 고정 idle trace에서 모델 3개의 catalog GET는 강제 refresh 기준 360회에서 기존 5분 cache 사용 기준 6회로 줄었다. 이는 mock trace이며 시간·실제 provider 성능·비용 증거가 아니다. 리뷰 사진 선택은 generation guard로 오래된 압축 완료를 버리고 이전 OCR을 중단한다. SSE 단절과 durable processing/indeterminate는 일반 OCR endpoint로 재전송하지 않고 사진과 입력을 유지한 보류 상태로 끝낸다.

실행 source 3개를 binding에 추가해 source count는 20→23, source binding SHA는 `9ddbba0c54dae67b70a2301168034b633f2c0cf1e4b2ae5c3a2a3d548c389cd8`→`45a9594b6bf6858802b71b594be1856f9671ebb344b2fab034ac7b05e62fef22`, canonical policy SHA는 `3426d02d2cad6c690030b6002d801361224045f7cc60d69e515e1a196cec4a8c`→`118fff9f3a51a1bb64467b742b0e1f76d6d97055b62f0ce9c70112b470a2bac3`로 바뀌었다. 기존 runtime binding 영수증은 수정·재라벨하지 않았다. 검증은 세 묶음 180·40·62 pass, 합계 282 pass·0 fail·4,192 assertions, TypeScript parity 3,165입력·진단0, targeted ESLint 오류0, Next16.3.8 production build 52 route·exit0이다. build 뒤 source/policy SHA를 다시 계산해 drift 0건을 확인했다.

retained PG17.6 proof와 parent manifest/controller, SQL source root, compiled SQL, workflow SHA는 그대로이며 migration source diff는 0건이다. 이 delta 때문에 기존 proof를 재생하거나 재라벨하지 않았다. ready release에서는 새 ready manifest/controller/selector binding으로 11 migrations·112 statements·12 rollback stages, 강제 rollback·응답 유실 복구·lock 경합·terminal readback·전체 rollback 범위를 다시 실행해야 한다.

두 경계는 남는다. 현재 durable SQL은 owner-scoped read-only OCR status RPC가 없어 SSE 단절 후 자동 readback을 안전하게 추가할 수 없다. 또한 completion은 payload model과 claim model의 일치를 요구해 `GEMINI_OCR_MODEL` CSV fallback을 SQL 변경 없이 복원하면 fallback 호출 결과를 commit할 수 없다. 이번 변경은 중복 provider 재전송을 막았지만 이 두 기능을 완료로 주장하지 않는다. 외부 `ocr-review-receipts.yml`도 저장소에 없어 명시적 admin `forceRefresh=true` 전달은 process endpoint 계약까지만 검증했다. 별도 delta 영수증은 `apps/web/performance/feature-completion-20261013/held-feature-database-admission-delta-20261015.json`에 보관한다.

## 2026-10-15 Feature runtime 계약 후속 delta

앞 절의 세 경계는 아직 적용되지 않은 97→101 feature SQL 안에서 source 계약으로 해결했다. 기존 held 영수증과 retained PostgreSQL proof는 당시 증거로 보존하며 수정하거나 재라벨하지 않는다. OCR fingerprint는 순서가 있는 Gemini model policy와 review generation을 포함하고, completion과 readback은 실제 응답 model이 그 policy의 구성원인지 확인한다. SSE 단절 뒤에는 같은 owner·사진·선택 context로 `read_receipt_ocr_result`만 bounded polling하며 claim이나 provider 호출을 하지 않는다. 1차 polling 뒤에도 processing이면 리뷰 UI는 사진과 입력을 유지하고 `결과 확인` 액션으로 같은 read-only route만 다시 호출한다. status RPC·runtime config·abort 예외는 고정 JSON code로 닫힌다.

관리자 rerun/reset-all은 `public.reviews` reset UPDATE가 private generation을 회전시킨다. process는 현재 generation으로 claim하고 `publish_review_receipt_ocr_result` CAS를 사용하므로 이전 generation의 결과를 게시할 수 없다. trigger helper는 postgres 소유 `SECURITY DEFINER`, 빈 `search_path`, anon/authenticated/service-role 직접 EXECUTE 거부 계약이다. publish는 owner-matched review row를 먼저 잠그고 generation row를 검사해 reset과 같은 `reviews → review_generations` 순서를 사용한다. replay harness는 publish-first/reset-first 두 barrier, deadlock 0, reset-first의 고정 `review_ocr_generation_stale` 거부를 요구한다.

runtime readiness는 base97의 Storage RPC 하나를 전체 ready 증거로 사용하지 않는다. 11개 typed public wrapper의 owner·language·volatility·ACL, private durable tables의 forced RLS, 두 generation trigger, storyboard admin/worker RPC, 최종 immutable Storage trigger, 마지막 migration이 쓰는 capability marker를 함께 확인한다. DB86과 base97, feature stages 98–100은 held이고 stage101의 전체 계약만 ready다. feature manifest SHA는 `a2cfadfbc66db5817b78aa1bb182263e5939a2eaace4f741bbb935f3b58290e7`, source root는 `8f6ac5bd658cdc75c1d0a5f2ea84772c528a5d4f9f551b0533d758c676bc95b5`다. 바뀐 SQL SHA는 `fb80c266cfbede8141da0c8adfc2b099ed835673684aa1f17af0d7e1439526e0`, `0c3f8b4cadc1d4bb0d88b53de49be34ef8e2751a47bfc18ebad89ae543b4c370`, `0a060ca537d3558779fd0cb1b780e7965189eb129f5018987f157c1cb5f2cd3d`다.

실행 source binding SHA는 `806b8c2f95763adbb227eb3169b6a92d0b7ab2f45fac9490f84fdd0db31ecfaa`, canonical policy SHA는 `12c3f99c7841f038ceb605f76e9b23ac71f4754fa7f9d5fd4d5a9331460cbb9a`다. build 후 재계산 결과 drift는 없었다. 관련 14개 테스트 파일은 150 pass·0 fail·1,176 assertions, native TypeScript 진단0, targeted ESLint 오류0, Next16.3.8 production build 53 static pages·route CSS 경계 통과다. 이는 로컬 source와 테스트 증거다. 이 시점의 로컬 계약 영수증이며 후속 검증은 아래에 구분한다. 운영 DB 적용·배포·Gemini 호출·Storage 서비스 동작을 뜻하지 않는다. 실제 호출 경로는 일반 사용자의 mutate_review_with_media RPC와 관리자 service-role reset이다. authenticated 직접 reset UPDATE는 현재 회수된 has_role EXECUTE 경계와 맞지 않아 하니스에서 사용하지 않는다. 새 delta 영수증은 `apps/web/performance/feature-completion-20261013/feature-runtime-contract-delta-20261015.json`이며 sidecar SHA로 검증한다.

## 2026-10-15 실제 권한 경로와 OCR 복구 검증

SQL·manifest·변환기와 새 PG17.6 하니스를 로컬 커밋 `392398a9`에 기록했다. `pg17-existing-catalog-replay-admin-service-reset-20261015.json`은 사용자 RPC 수정 성공·generation 보존, 관리자 reset 회전, private generation 직접 접근 거부, 이전 generation 게시 거부, 현재 게시 멱등성을 검증했다. publish-first/reset-first 두 순서에서 실제 lock wait를 확인했고 deadlock은 0→0건이다. 원본 catalog 2,633,559 bytes와 SHA는 동일하다. root가 source 23개 및 새 map 11개 항목의 bytes/hash·sidecar를 독립 확인했다. 이는 exact PG17.6 로컬 복제 검증이며 운영 쓰기·공급자 호출은 0회다. PG15 전체 run-a/run-b 재구축과 비교는 이 커밋 이후 별도로 진행한다.

영수증 복구는 최초 요청의 사진·맛집 context를 유지하고, 사진 교체·삭제·닫기 뒤 도착한 이전 응답과 buffered SSE patch를 무시한다. 상태 조회는 수동 수정·입력 위치를 초기화하지 않으며, 사진 삭제는 요청을 중단하고 busy 상태도 해제한다. 실제 컴포넌트 함수를 실행하는 관련 51개 검사가 통과했다. 늦은 결과의 result/field/notices 효과는 고정 fixture에서 2/2/1→0/0/0이었으며, 이는 지연·비용 개선 추정이 아니므로 신뢰구간을 적용하지 않는다.

최종 웹 build는 Node24.21.0·Next16.3.8에서 compile·TypeScript·static 53 pages·route CSS boundary를 통과했고 선택한 runtime/build 입력 757개 drift는 0건이다. 최초 font 다운로드 실패와 후속 타입 오류도 별도 rejected 영수증으로 남겼다. 전체 canonical unit의 첫 후속 실행은 3,538 pass·18 fail·3 skip으로 중단됐다. 새 readiness 계약을 공급하지 못한 브라우저 fixture와 이전 source assertion을 수정했고, 이 첫 실패 기록은 보존한다. 당시 영수증은 `apps/web/performance/feature-completion-20261013/ocr-recovery-race-verification-20261015.json`이다. 실제 운영 DB 반영·배포·사용자 OCR 저장 완료는 미확인이다.

## 2026-10-15 재구축 가능한 OCR 스키마와 최종 웹 검사

PG15 전체 재구축은 운영 복제본에만 있던 `reviews.receipt_hash` 컬럼의 소스 부재로 최초 실패했다. 해당 실패와 소유 자원 정리 결과를 별도 보존했다. 아직 적용하지 않은 durable migration에 운영의 기존 4개 컬럼과 3개 인덱스를 멱등적으로 선언하고, 같은 이름의 다른 타입·기본값·NULL 허용·인덱스 정의는 거부하도록 보강했다. 이미 적용한 migration과 기존 RLS·권한은 변경하지 않았다. 이 소스는 `59be0ec683642a3f26c759fc54589229ca16f7d6`에 기록했다.

새 exact PG17.6 복제 검증은 findings 0이고 소스 23개 bytes/hash·sidecar 일치를 root가 확인했다. 새 증빙은 `pg17-existing-catalog-replay-review-ocr-catalog-contract-20261015.json`이며 이전 proof를 현재 SQL에 재라벨하지 않았다. PG15.8의 깨끗한 독립 재구축 두 회도 각각 exit 0으로 끝났고 canonical comparison은 passed다. root가 두 결과를 다시 읽어 58개 파일·각 1,788,551 bytes·1,960 catalog 행의 exact-byte 일치와 comparison receipt SHA `0cb272ffc3458225645ca95151fc5ff72010b7478ddcd096ed0fcdf71c5d5418`를 확인했다. worker의 소유 Docker 자원과 프로세스 잔여물은 0개다. 이는 source reconstruction이며 hosted catalog 동일성 증명은 아니다.

동일 `59be0ec6`의 canonical `npm run test:unit`은 3,775 pass·0 fail·11 skip·92,234 assertions·exit 0, 선택 입력 1,270개 drift 0으로 종료했다. 건너뛴 11개는 통과에 합산하지 않는다. targeted ESLint 51개 파일은 오류·경고 0이고 source binding 51개도 일치한다. 최종 build의 선택 입력 757개는 현재 앱 bytes와 다시 대조해 mismatch 0이었다. 이는 새 빌드 실행이나 새 SQL 전체의 build 증명이 아니며 SQL은 별도 PG 검증을 따른다. 새 영수증은 `ocr-recovery-canonical-final-59be0ec6-20261015.json`, `ocr-recovery-eslint-final-59be0ec6-20261015.json`, `ocr-recovery-build-input-readback-59be0ec6-20261015.json`이다. 이 결과는 로컬 검증이며 운영 적용·provider 응답·실제 사용자 저장 완료나 성능·금액 절감을 주장하지 않는다.
