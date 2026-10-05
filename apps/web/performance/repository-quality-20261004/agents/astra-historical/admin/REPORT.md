# Admin historical semantic reconciliation — PR2857 / PR2908

**Verdict: 두 PR 모두 PR 전체 `superseded` 판정 불가.** 현재 구현으로 충족한 의도, 실제 누락, active-owner 선행 작업, 이번 요청에서 의도적으로 실행하지 않은 범위를 분리했다. 분류 25건의 기계 판독본은 [VERDICTS.json](VERDICTS.json), 개별 commit 대응은 [PATCH-MAPPING.md](PATCH-MAPPING.md)이다.

## 기준과 수행 경계

- 유일한 source 통합 기준은 parent PR3114 head 및 지정 checkout HEAD **`7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd`**이다. branch `codex/historical-quality-20261004`, checkout `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong`. 최초 status는 clean이었다. 원격 main 포함·merge·배포를 주장하지 않는다.
- 지정 checkout의 AGENTS.md, verification/privacy/release guide와 실제 caller/tests를 읽었다. 어떤 admin source에도 쓰지 않았다. commit/push/댓글/종결/메시지/설정 변경, full build/full unit/Naver/DB/provider 작업은 하지 않았다.
- 모든 작성은 이 `admin/` 디렉터리의 새 보고서·정제된 근거·제안 diff에만 한정했다. 기존 performance/frozen 파일은 수정하지 않았다. 원격 작업은 gh GET/view 읽기뿐이다.
- local model 설정은 **사용자의 중앙 config/session readback 보고**에 따라 `gpt-6-astra / xhigh / openai`로 기록했다. 이 worker가 config를 재조회한 사실은 없고 actual serving attestation은 제공되지 않았다. 폴더명 astra는 serving 증거가 아니다.
- 이전 memory는 historical dashboard 의도를 찾는 데만 사용했고, 아래 판정은 이번 turn의 Git 객체·현재 source·현행 테스트 대조를 기준으로 한다.

## 정확한 historical 경계

| PR | remote base SHA | old head SHA | 실제 diff merge-base | 확인 범위 |
| --- | --- | --- | --- | --- |
| 2857 | `0a8416d42a37a95e686c4d782e1ec73f6a15e37f` | `8d6b3671325e4a13f85f3e1ed6a297bd8f7a7446` | base와 동일 | 25 commits / 84 files |
| 2908 | `e5bfd74eda0050c93b9370187d5e4be84bed24e6` | `adea93042c0bd27f2015ba3200639be9c4b9fa11` | `0ebb898c708dd2c966fd72dd43172a0cf843cf93` | 34 commits = 32 non-merge + 2 merge / 299 files |

PR2908의 움직인 base tip을 old diff 시작점으로 잘못 쓰지 않았다. metadata는 paginated commit/file GET으로 완전 수집했고 이메일·authors·본문을 저장하지 않았다. 각 parent SHA도 남겼다. 전체 `git diff --binary merge-base head`의 SHA-256은 PR2857 `f5f1d572cf67343e74c6759b18f78cb8d1f872934a7eb3b144ea801173b357c8`, PR2908 `cc09a002953e4152bcf7e2cea0472dbc5ed36c728d6b1a2d3f7a50fa9691d02b`이다. 큰 diff 복사본은 남기지 않고 [historical-hunks.json](historical-hunks.json)에 필요한 source 위치/내용 12건, file-matrix에는 전체 path/blob을 보존했다.

## PR2857: module stack 의도별 판정

| 의도 | 분류 | current 의미와 조건 |
| --- | --- | --- |
| 메뉴별 skeleton 및 loading 연속성 | **fulfilled** | `AdminConsoleOverview.tsx:907,9406,10418,10835`의 preload/loaded/contentReady 상태와 canvas skeleton이 실제 caller에서 작동하도록 배선되어 있다. `dynamic(... loading:null)`만 보고 빈 화면으로 판정하지 않았다. 현재 14-route 구조가 옛 15개 registry와 동일하다는 뜻은 아니다. |
| 공통 error/empty/unauthorized 및 동일 query 재시도 | **active-owner dependency** | 옛 `AdminConsoleModuleCompleteness`/`console-module-state`는 없다. 개별 audit 상태는 있으나 모든 모듈 계약은 입증되지 않았다. 현재 preload는 reject를 catch한 뒤 finally에서 loaded로 표시한다. owner의 16-route, restaurant workspace를 기준으로 오류 재시도와 재로그인 목적지를 함께 보완해야 한다. |
| 검색·섹션 grid, IME commit, 결과 announce, focus 복원 | **active-owner dependency** | 옛 grid/search registry가 현재 없고 sidebar는 순서 편집 중심이다. 옛 15개 고정 목록, 사라진 map-overlays, 옛 refresh URL을 그대로 이식할 수 없다. 기능을 사용자 취소로 간주하지 않았다. |
| 공통 11-form visualization 및 tone scale | **active-owner dependency** | 옛 viz 디렉터리·tone hook 없음. 현재 Recharts/inline charts와 owner admin-ui.css 변경을 먼저 조정해야 한다. 파일 부재 또는 기존 차트 존재만으로 전체 의미 동등을 주장하지 않았다. |
| 실제 감사 피드와 제한된 coverage | **fulfilled** | `AdminConsoleOverview.tsx:1475,9057`에서 `/api/admin/audit-events`와 partial-domain-specific coverage, 오류·비어 있음·재로그인·refetch가 연결된다. 전용 파일 추출이 없어도 핵심 intent가 살아 있다. |
| 읽기 전용 운영 보조 | **active-owner dependency** | authority `LlmSessionWorkspace`는 정적 설명. owner는 `AdminOperationsPanel`에서 pending/pipeline/automation GET과 sanitized view model, domain별 실패 및 refetch를 구현한다. 이것을 parent 통합 완료라고 부르지 않는다. |
| auth 및 risky-work 절차 | **fulfilled (source boundary)** | `guarded-mutation-contract.ts`의 Preview→Confirm→Apply→Readback→Audit와 admin-route-auth focused tests를 확인했다. refresh route는 bounded RPC receipt와 별도 readback을 확인한다. 모든 모듈의 공통 절차 UI 또는 hosted 실행 완료는 아니다. |
| 사용자 목록 마스킹 | **active-owner dependency** | 현재 `app/api/admin/users/route.ts:79,85,139`는 원문 email 및 email local-part username fallback을 반환/사용한다. old emailMaskToken + 서버 검색 의도 미충족. owner `AdminUsersPanel.tsx`와 API DTO·검색·상세 조회 tests를 같이 조정해야 한다. |
| 순서 persistence / dev-user safe fallback | **fulfilled** | 현재 sidebar normalization, UUID 검증, requireAdmin, same-origin, bounded JSON body가 있다. source/helper 이름이 다를 뿐 관련 focused tests 통과. |
| 첫 paint 전 저장 테마 적용 | **active-owner dependency** | 현재 theme은 light 초기값 후 useEffect에서 적용. layout prelude 없음. owner layout의 admin-ui.css를 보존하고 CSP/hydration/첫 paint를 확인해야 한다. 옛 invalid→system 기본값을 현재 light 기본값에 자동 덮어쓰지 않는다. |
| task16 전체 검증과 evidence 변경 | **intentionally excluded under user constraints** | old tasks 16/16.1도 unchecked이며 실패 0/skip 0 미도달을 명시한다. 이번 금지 범위인 full suite/브라우저·Naver 측정이나 old evidence 재작성으로 완료 상태를 만들지 않는다. |

PR2857은 `git cherry`상 25개 모두 unmatched이지만, 그 사실만으로 25개 의도가 모두 필요한 것으로 판정하지 않았다. 반대로 current audit·guard·loading 기능이 있다고 stack 전체가 충족되었다고 하지도 않았다.

## PR2908: 30/32를 직접 검증한 범위

`git cherry AUTHORITY oldHead merge-base`를 재실행한 결과 30 minus / 2 plus. 각 old non-merge commit의 `git patch-id --stable`을 authority의 대응 ancestor patch와 다시 연결해 **30개 각각의 실제 SHA 매핑**을 만들었다. `PATCH-MAPPING.md`와 `pr2908-patch-equivalence.json`을 참조한다.

이 30개는 Semiotic 기능 30개가 아니다. Kiro/증거 정리, bounded admin catalog·replay, refresh RPC, 주소 merge, Naver SDK 독립 query 시작, local-dev admission 등 선행 작업이다. 핵심 의미 대조 결과:

- **refresh atomic boundary:** `8af06fa1 → ba6bf3c5`의 route는 현재 old head와 blob 자체가 같고, requireAdmin → atomic RPC → receipt 검사 → 별도 committed readback이 남아 있다. 이후 `b483ec72`에서 unbound SQL을 candidates로 이동한 의도를 함께 보존한다. source integration 충족; hosted RPC/DB 적용은 판단하지 않는다.
- **주소 merge:** `c7d6eb90`, `300482eb`, `ee175dfa`의 비재귀 union과 이미 연결된 address bucket pair 생략을 현재 `hooks/use-restaurants.tsx:442–502`에서 확인했다. 현행 merge tests 파일 존재 및 호출부를 읽었으나 dependencies 없이 전체 hook 실행이나 새로운 속도 측정은 하지 않았다.
- **local replay source/evidence:** `76595300`, `6cd3ccf9`, `561c7277`, `3553033b`, `628a601e`, `e0342320`, `74d61711`의 exact-source/verification hash 및 ledger admission 계약은 현행 `local_replay_contract.py`, `local-supabase-runtime.mjs`에 남아 있다. read-only proof는 실행 receipt가 아니라는 구분도 유지된다. 새 DB replay·ACL·hosted 상태 검증은 범위 밖이다.
- **나머지 catalog/PG17/진단/문서·evidence 선행 커밋:** commit별 patch identity 및 현행 file/path를 보존했다. 이 admin subtask에서 전체 backend 동작을 독립 실행했다고 주장하지 않는다. 기존 perf 파일은 read-only hash 인덱스만 남겼다. Naver scheduling의 역사적 patch 통합과 실제 현재 Naver 성능은 별개다.

### 남은 첫 commit: `0bb61220b1d408a22f0cf81f1cc1e1d31148ada1`

221개 source/evidence 파일을 함께 변경하는 commit이다. admin title만의 patch가 아니다.

| 의도 | 분류 | 정확한 차이 |
| --- | --- | --- |
| table/tooltip, series toggle, fullscreen, widget 순서 | **fulfilled (source)** | current `AdminConsoleOverview.tsx`와 focused tests가 다른 renderer에서도 해당 기능을 보존한다. 실제 화면은 이번에 띄우지 않았다. |
| Semiotic renderer 전환 | **active-owner dependency** | authority/owner는 Recharts, package.json에 semiotic 없음. `SemioticKpiSparkline.tsx`도 없음. |
| 작은 TOP5 segment의 정직한 비율 | **still needed** | current 5182의 `min-w-[8%]`와 5187의 `Math.max(8, percent)`가 0/1%도 최소 8% 요청 폭으로 만든다. owner에도 같은 코드가 5222/5227에 있다. |
| 50-row bounded table | **active-owner dependency** | old `DashboardDataTable`는 50행 pagination. current 1713의 progressive hook는 결국 rows.length까지 증가하므로 steady bound와 다르다. 초기 페인트 분산은 동등한 성능 증거가 아니다. |
| 월별 cohort 평균·정제된 descriptive evidence | **active-owner dependency** | old helper는 영상 ID 중복 제거/월 평균/음수·missing comparison/median 필터를 다룬다. current는 발행일별 raw trend와 60/25/15 기여 점수, 구독자 기여 후보를 유지해 의미가 다르다. |
| snapshot identity·baseline·scope 보존 | **still needed** | current helper latest/comparison channel에는 channel/source 필터와 15분 하한이 없다. empty snapshot을 null로 만들며 route 345 이후 comparison 부재를 restaurant-history로 대체한다. owner helper/route도 authority와 동일하다. 현행 test는 오히려 `shouldUseHistoryComparisonFallback`을 요구하므로 변경 시 test 의도 갱신과 mocked runtime 검증이 필요하다. |
| 독립 snapshot 읽기 병렬화 | **still needed, no measured gain** | current 297/300은 sequential. old Promise.all/harness는 current에 없다. 기존 합성 latency 결과를 현재의 성능·쿼터 절약으로 재사용하지 않는다. |
| local-edit / evaluation flow | **active-owner dependency** | old helper 경로 일부가 현재 없으며 owner는 RestaurantManagementWorkspace, evaluation-page server/client/query, refresh URL을 재구성 중이다. guarded/local/hosted 경계를 보존해 owner와 합산해야 한다. |
| old performance evidence | **intentionally excluded under user constraints** | `admin-console-20260908` / `youtube-kpi-read-scheduling-20260908`는 authority에 없으나 old Git 객체에 보존됨. 36개 historical performance path의 blob·SHA-256을 별도 인덱스로 보존했다. old 75 pass, parity/layout 및 G003=0는 historical claim이지 이번 결과가 아니다. |

### 남은 둘째 commit: `adea93042c0bd27f2015ba3200639be9c4b9fa11`

11개 파일의 SEO/크롤러 변경이며 첫 commit과 구분했다.

- 현재 `robots.ts` wildcard allow/disallow는 같은 공개/민감 경로 의도를 충족한다. AI bot별 별도 rule 유무만으로 노출 부족을 단정하지 않는다.
- manifest와 llms 문서는 현재 없어서 도입 의도는 남는다. parent의 별도 SEO 범위로 남기며 admin 완료로 흡수하지 않는다.
- old schema의 `4.9 / 1250`, `750+` catalog, 고정 lastModified, 조직 sameAs는 이번 현재 사실 검증이 없다. 근거 없이 복사하거나 최신 사실로 주장하는 행동은 제외한다. historical source 자체는 보존한다.
- `evaluate_new_youtube_videos.py`의 venv 선택, `03-collect-transcript.js`의 Python 환경 fallback, `split_video_chunks.mjs`의 even-dimension ffmpeg 보정은 현재 동일하게 통합되어 있지 않다. 실제 현재 PYTHON_CMD caller와 scale 줄까지 확인했다. runtime/영상 fixture 판단은 backend active owner 의존이며 실행하지 않았다.

## Active owner — 정확한 선행 조건

Read-only checkout `/Users/twoimo/.codex/worktrees/pipeline-performance-20261002/tzudong`, branch `codex/pipeline-performance-restart-20261002`, observed HEAD `a60ef70dba0bd32ea44d32218e2c66ef1b5410e1`. 이것은 PR3114 SHA와 다르다.

1. **운영 보조:** `components/admin/AdminOperationsPanel.tsx`, `lib/admin/operations-view-model.ts`, `tests-unit/admin-operations-view-model.test.ts`, `AdminConsoleOverview.tsx`. 실제 sanitized reads 및 failures/unknown/source counts를 가진 새 구현을 우선 합산해야 한다. 읽은 owner tests는 14 cases이며 이 worker가 실행하지 않았다.
2. **라우팅/검수:** `lib/admin/admin-module-routing.ts`, `components/admin/RestaurantManagementWorkspace.tsx`, `app/admin/evaluations/page.tsx`, `lib/admin/evaluation-page-{client,query,server}.ts`. owner는 sentry/knowledge-graph를 포함한 16 IDs와 refresh→restaurants&restaurantView=refresh를 갖는다. old 15-ID map이나 current 14-ID map을 일괄 덮어쓰면 안 된다.
3. **dashboard/theme/users:** `AdminConsoleOverview.tsx`, `AdminUsersPanel.tsx`, `AdminEmbeddedModuleShell.tsx`, `app/admin/layout.tsx`, `styles/admin-ui.css`. owner가 이미 수정·커밋한 디자인과 shell 배선을 보존해야 한다. 작은 비율 패치는 소스 통합 후 재검토한다.
4. **dirty/untracked readback:** 최초에는 `apps/web/tsconfig.json`과 두 Supabase `.temp/cli-latest` 경로만 dirty/untracked였다. 도중에 `backend/supabase/scripts/materialize_migration_workspace.py` 변경과 `apps/web/performance/rollout-preflight/hosted-migration-ledger-20261004.json` untracked가 나타났다. 동시 작업을 멈추거나 수정하지 않았다. tsconfig의 `.next-ui-knowledge-20261004` generated type include만 읽었고 hosted ledger/임시 파일 내용은 수집하지 않았다. **이 관측 시점에 admin source 자체의 dirty/untracked는 없으며, 중요한 admin 대응 파일들은 이미 owner HEAD에 커밋되어 있다.** 이전 large dirty snapshot을 현재 상태로 재진술하지 않았다.

`state-readback.json`에 실제 status와 관련 owner 파일 hash를 보존했다. 이 파일은 특정 시점의 관측이며 owner의 추가 변경이 가능하다. owner 변경을 이 branch의 작업이라고 주장하지 않는다.

## 최소 proposal과 검증

[proposal-01-truthful-top5-proportions.patch](proposal-01-truthful-top5-proportions.patch)는 **authority SHA 기준 파일 한 곳의 4개 작은 변경**이다: 최소폭 제거, `shrink-0`으로 비율 폭 유지, 8% 미만의 과밀 라벨 숨김, 조회수 tooltip에 exact value 추가. renderer 교체·의존성 업데이트·라우팅/데이터 의미 변경은 포함하지 않는다. old intent 중 분리 가능한 최소 결함만 제안했고 넓은 DTO/상태/UI 변경은 위 owner 조건으로 남겼다.

- **`git apply --check`: exit 0. 실제 적용 안 함.** admin source 변경 파일 0.
- 기존 focused 9 files 실행: **70 pass, 2 dependency-load failures/errors**, 5967 assertions. `@supabase/supabase-js` 부재로 `youtube-kpi-snapshot-contract.test.ts`, `react` 부재로 `admin-restaurant-refresh-history-source.test.ts` 로드 실패. assertion regression으로 분류하거나 성공으로 바꾸지 않았다. [targeted-tests.log](targeted-tests.log), [targeted-tests.json](targeted-tests.json).
- Bun `1.4.0`, pinned Node `/opt/homebrew/opt/node@24/bin/node` `v24.21.0` 확인. apps/web/node_modules 없음. 설치·symlink·owner dependency 변경 없이 실행 가능한 source tests만 사용했다.
- DOM/브라우저·typecheck/parity·전체 suite·현재 performance/hosted readback은 수행하지 않았다. 제안은 typechecked/rendered/delivered 구현으로 주장하지 않는다.
- 예시 `[96,1,1,1,1]`은 현재 CSS 요청 폭 `[96,8,8,8,8]`, 제안은 `[96,1,1,1,1]`. 이는 코드로 계산한 CSS 요청값이며 실제 pixel 크기/성능 측정이 아니다. 현재 flex shrink·overflow가 렌더 결과에 추가 영향을 줄 수 있다.

완료 범위는 historical admin 의미 대조와 검토 가능한 제안/evidence 전달이다. 전체 PR 종결·source 통합·hosted 검증은 실행하지 않았고, remaining intent를 근거 없이 fulfilled 또는 취소로 바꾸지 않았다.
