# PR3031 / PR3032 잔여 map·home KPI·CategoryFilter 의미 대조

소스 수정 **0개**. CategoryFilter의 현재 bounded log 결함은 재현되지 않았다. 정상 입력 map 비교 512건과 지역 query 비교 25건은 old head와 결과가 같았다. **null 입력의 과거 확장은 현재에 없으며**, 정상 호출부의 계약과 분리해 아래에 명시했다. 두 PR 전체를 superseded 또는 원격 해결 완료로 분류하지 않는다.

## 고정 기준과 증거

- 작업 checkout: `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong`
- branch: `codex/historical-quality-20261004`
- source 통합 기준: PR3114 head / checkout 시작 HEAD **`7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd`**. remote main 포함 여부를 검사하거나 주장하지 않는다.
- PR3031: base 및 merge-base `d75e3360f393038a64846a3c6b0a4daa56b4d38a`, head `cd86c106b468c40e83a2e2edf39b49c3b9529937`.
- PR3032: base 및 merge-base `d75e3360f393038a64846a3c6b0a4daa56b4d38a`, head `76afb0634b6710581aa296a9644929313e24b36f`.
- GitHub 읽기 전용 metadata와 로컬의 정확한 Git 객체/diff를 대조했다. 각 PR은 관찰 시 OPEN이었다. diff 파일은 author 이메일/commit mail headers가 없는 `git diff --no-ext-diff BASE HEAD` 형식이다.
- `pr3031.patch` SHA-256: `84c2f3cae9cbc3288f573b40e60ed137427cf3444629a64f98266455fbad82cb`.
- `pr3032.patch` SHA-256: `2c7c1859f4c26a808bfbceae199002d13281258b6f0c053411c5b41939a8cd61`.
- 범위별 diff는 `pr3031-scoped.diff`, `pr3032-scoped.diff`; 전체 경로/commit inventory와 blob/hash 근거는 `source-evidence.json`에 있다. 제목이나 패치 수로 의미 대조를 대체하지 않았다.

## B3의 정확한 경계

읽은 근거는 형제 디렉터리 `../../astra-web-contract/REPORT.md`, `pr3032-worker.md`, 최종 `v2/REPORT.md`, `v2/validation.json`이다. `b3-boundary.json`에 이 증거의 해시와 source 대조를 남겼다.

**최종 v2 15개 source/test 파일은 PR3114 작업 checkout과 모두 SHA-256이 같다.** 따라서 v1에만 있는 cache/index 채택 결론을 현행으로 취급하지 않았다. B3의 기존 테스트/브라우저 결과는 그 작업의 과거 증거이며 이번에 재실행한 결과가 아니다.

| 의도 | 분류 | 현행 기준과 경계 |
| --- | --- | --- |
| ID6..128, regex hoist, normalize의 ID 1회 추출, route 응답·고정 log | fulfilled | B3 v2의 helper/summary/세 route와 직접 tests가 현행에 byte-for-byte 통합됨. PR3031의 가변 error.name 기록은 채택하지 않은 의도적 수정이다. |
| 새 link Map4096 / 영상별 WeakMap index | intentionally excluded under user constraints | v2의 명시적 사용자 후속 지시로 제거됨. 현재 selector는 filter이며 기존 운영 TTL cache를 이 제외와 혼동하지 않는다. |
| dashboard 날짜 decorate-sort/latestUpdatedMs 최적화 | intentionally excluded under user constraints | v2에서 baseline의 배열 복사 + 날짜 comparator sort로 복원. 새 성능 승인 없음. |
| REST 고정 실패 코드, singleton projection, 넓은 caller를 보존한 modal inset | fulfilled | B3 최종 소스와 tests가 15개 hash 대조에 포함된다. 이번 worker가 다시 수정하지 않았다. singleton은 PR3031의 단독 정렬 생략 의도도 충족한다. |
| old README 속도 수치와 세 historical benchmark package의 성능 승인 | intentionally excluded under user constraints | old head의 각 디렉터리는 script와 benchmark.json 2개뿐이며 required frozen-tree/scorer/validator/detached artifact-map package를 해당 패키지에서 확인할 수 없다. 세 디렉터리는 현재 source 기준에 없다. 원본 evidence는 변경하지 않았고 새 측정/속도·메모리 주장도 없다. |

## 잔여 의도별 판단

아래 줄 번호는 위 source 통합 SHA 및 이 worker가 확인한 동일 내용에 대한 것이다.

| 의도 / old diff | 분류 | 현재 source·caller·검증 근거 |
| --- | --- | --- |
| PR3031 `NaverMapView`의 unused `findMatchingRestaurantInList` import 제거 | fulfilled | 현행 `NaverMapView.tsx:99`는 lookup builder만 가져오고 `:197`에서 selection helper들을 사용한다. 실제 match 호출은 `lib/naver-map-selection-helpers.ts:76,110`로 이동했다. renderer 변경이 필요하지 않다. |
| PR3031 merged ID 및 이름/좌표 match에서 가장 앞선 candidate 반환 | fulfilled | `lib/map-restaurant-lookup.ts:42`의 기존 `find/includes` 경로도 동일한 앞선 항목을 반환한다. 정상 입력 512건의 old/current 결과 객체 identity 일치, 별도로 일반/merged 각각 이름·좌표 일치가 뒤의 ID 일치보다 우선하는 순서 확인. 기존 lookup 3개 및 selection helper 10개 tests 통과. |
| PR3031 mergedIds 배열 조회를 요청별 Set 조회로 바꾸는 최적화 | intentionally excluded under user constraints | 현재 소스는 base와 같은 배열/includes 구현이다. 이는 미통합 최적화이며, 의미가 동일하다고 해서 코드가 통합됐다고 보고하지 않는다. map runtime 수정과 Naver 측정이 금지된 범위이며 새 성능 이득을 입증하지 않았다. |
| PR3031 map matcher의 nullable target/list 허용 | intentionally excluded under user constraints | old head는 null 반환, 현재는 null/undefined target 및 null/undefined list의 4가지 직접 호출에서 예외 발생을 재현했다. 현행 public 타입은 `Restaurant`/`Restaurant[]`; 실제 caller는 `naver-map-selection-helpers.ts:69,98`에서 nullable 선택을 먼저 거르고 배열을 전달한다. `NaverMapView.tsx:1953`도 query data를 `[]`로 기본화한다. 현재 경로에서 null 유입 결함은 입증되지 않았다. 계약 확장은 미통합 상태 그대로 기록하며 이 worker는 수정하지 않는다. |
| PR3031 home KPI의 빈 배열·빈 링크·변경 링크 재수집 | fulfilled | `lib/home-map-youtube-kpi.ts:22,30`의 현행 반복문/Set은 빈 배열에서 `[]`, 공백 링크 무시, 링크 변경 후 재수집을 이미 만족한다. old/current 동일한 재현 결과. chunk의 빈 목록/NaN size도 동일. 현재 KPI 7개 tests가 100개 chunk·최대 4개 동시 요청·부분 실패 및 응답 오류 보존을 검증한다. |
| PR3031 home KPI helper의 `Restaurant[] \| null \| undefined` 허용 | intentionally excluded under user constraints | old head는 null/undefined에서 `[]`; 현행 collector는 예외를 낸다. **빈 배열 실패는 재현되지 않는다.** 현행 caller `hooks/use-restaurants.tsx:732`는 `data || []`를 merge한 배열을 전달하고 `lib/popular-restaurants.ts:478,553`의 경로도 배열을 merge해 전달한다. 현재 caller 계약 위반은 확인하지 못했다. 공유 helper 변경 금지 범위의 미통합 확장으로 남긴다. |
| PR3032 해외 지역·국가·국내 필터의 현행 조회 의미 | fulfilled | `hooks/use-restaurants.tsx:692` 이하, `lib/overseas-region-matching.ts:45` 및 4개 기존 filter tests 대조. 현재의 상수 지역/국가·국내·도서·synthetic 입력 총 25개 query가 old head와 동일. 현재 35개 지역 keyword는 sanitizer 통과 전후 모두 같다. |
| PR3032 지역 keyword 사전 sanitize 및 국가 helper 중복 호출 제거 | intentionally excluded under user constraints | 현행 지역 상수 branch는 원문 keyword를 사용하고 국가 helper를 조건/본문에서 두 번 호출한다. old head의 cleanup 자체는 미통합이다. 현재 상수로 query 차이는 없으며, 더 넓은/미래의 임의 keyword에 대한 방어를 검증했다고 주장하지 않는다. shared hook 변경 금지이고 현재 결함이 확인되지 않아 옮기지 않았다. |
| PR3032 CategoryFilter의 bounded failure log와 `[]` fallback | fulfilled | `components/filters/CategoryFilter.tsx:84-90`: 현행 log는 고정 문자열 `카테고리 데이터 조회 실패:` 단일 인수, 15자다. actual source AST의 queryFn을 격리 실행해 oversized Error.name, throwing getter object, string, null, undefined rejection 총 5건을 검사했다. 모두 고정 1인수 log와 `[]`, getter 접근 0. old head도 고정 32자 코드로 동일한 경계. 성공 row identity/null-data fallback 보존. 외부 fetch 및 renderer는 사용하지 않았다. |
| PR3032 CategoryFilter 고정 문자열 이름 교체, unused catch binding 및 주석 제거 | intentionally excluded under user constraints | 코드 형태 차이는 있으나 현재 failure의 크기/정보 유출 결함은 없다. 사용자의 “현재 결함이 증명된 경우만 최소 수정” 조건에 따라 문구·catch만 바꾸는 패치를 만들지 않았다. |

**still needed:** 이 worker가 수정 가능한 CategoryFilter 범위에서 현재 결함으로 재현된 항목은 **0개**다. map/home nullable helper 확장과 Set/region cleanup이 통합되지 않았다는 사실은 남아 있다. 이는 위 제약으로 제외한 의도이며 자동으로 fulfilled로 올리지 않는다. 추후 nullable helper 자체를 공용 계약으로 채택하거나 성능 최적화를 재개하려면 그 별도 범위에서 재판단해야 한다. 테스트 부재만으로 현재 결함을 만들거나 두 PR의 전체 종결을 권고하지 않는다.

## G037와 active-owner dependency

PR3031/3032의 정확한 base→head 변경 경로에는 **G037 경로가 0개**다. G037를 이 PR들이 새로 고친 기능으로 분류할 근거가 없다. 아래 6개 파일은 old base, 두 PR head, PR3114 source에서 Git blob이 모두 같다(`source-evidence.json:g037Comparison`).

- `.github/workflows/g037-hosted-closure.yml`
- `backend/supabase/scripts/g037_hosted_closure_executor.py`
- `backend/supabase/scripts/g037_production_controller.py`
- `backend/supabase/scripts/g037_write_freeze.py`
- `backend/supabase/tests/test_g037_write_freeze.py`
- `backend/supabase/tests/test_g037_hosted_closure_workflow.py`

분류는 **fulfilled(기존 source 계약의 보존)**와 **active-owner dependency(운영 증거)**를 분리한다. workflow source는 exact protected main SHA에 묶인 dispatch, `contents: read`, 취소 없는 단일 concurrency, credential 없는 source validation과 별도 readonly job을 선언한다. 기존 workflow test는 이 그래프를 검사하고 freeze test는 fake connection 경계 검사다. 이번에 G037 suite/실제 DB/원격 workflow를 실행하지 않았다. 이 파일의 존재나 hash 동일성은 hosted 결과, freeze exit, ledger 정합성 또는 main 반영의 증거가 아니다.

사용자가 별도 소유로 지정한 `/Users/twoimo/.codex/worktrees/pipeline-performance-20261002/tzudong`은 read-only로 한 번 관찰했다. branch `codex/pipeline-performance-restart-20261002`, HEAD `a60ef70dba0bd32ea44d32218e2c66ef1b5410e1`; dirty `apps/web/tsconfig.json`, `backend/supabase/.temp/cli-latest`, untracked `backend/supabase/supabase/`가 있었다. 이 경로·branch에는 쓰기, 테스트 실행, 커밋, 메시지를 보내지 않았다. 소유자의 실행 상태/남은 작업 완료를 추론하지 않으며 관련 운영 조정은 그 active owner/parent의 영역이다.

## 이번 검증과 한계

- `bun test` 지정 4개 파일: **24 pass, 0 fail, 53 assertions**. 실제 명령은 `COMMANDS.md`, 정제 결과는 `validation.json`에 보존했다. 이미 통과한 검사를 반복하지 않았다.
- `reproduce.ts`: TypeScript **6.0.2**의 실제 source AST를 읽어 CategoryFilter queryFn/region if-block을 실행하고 old/current map/KPI helper를 비교했다. `semantic-probes.json`에 결과가 있다. 외부 fetch는 호출하지 않으며 Category 성공 merge는 dependency stub을 이용하므로 renderer/실제 REST 또는 merge 자체의 새 검증은 아니다.
- shared TypeScript는 `/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong/apps/web/node_modules`에서 읽기 전용으로 로드했다. 작업 checkout에 node_modules를 설치하거나 연결하지 않았다. Bun 1.4.0, Node24 `v24.21.0` 경로를 확인했고 global Node26을 작업 runtime으로 사용하지 않았다.
- 소스 변경이 없으므로 새 full build/full unit/typecheck/parity/Naver 측정을 실행하지 않았다. 기존 B3의 full/parity 결과를 이번 실행 결과로 옮겨 적지 않았다.
- 현재 chat의 로컬 session metadata는 `model_provider=openai`, `model=gpt-6-astra`, `effort=xhigh`. `model-metadata.json`은 local configuration 증거만 보존한다. **actual serving attestation은 미제공/미검증**이며 provider logs는 수집하지 않았다. parent가 별도로 알려준 중앙 metadata를 수정하지 않았다.

## 변경과 인계

작업 checkout source/test 변경: **없음**. 변경한 것은 본 worker의 `map/` 보고서·재현 스크립트·정제 JSON·정확한 historical diff뿐이다. source patch/commit/push/PR 댓글/종결/메시지/설정 변경/배포는 수행하지 않았다. 기존 perf/frozen evidence 및 다른 worker 파일을 수정하지 않았다.

최종 `validation.json`은 19개 관련 source/test의 시작/종료 hash 동일성과 source HEAD 고정을 확인한다. 다른 worker의 공유 checkout 변경은 별도 목록에 기록하되 이 worker의 수정이나 회귀로 주장하지 않는다. 최종 artifact 내용 해시는 `artifact-map.json`에 있다.
