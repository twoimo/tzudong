# Tzudong 읽기 전용 이슈·PR 감사 — 2026-10-04

최종 GitHub 재조회: **2026-10-04T08:39:06.035134+00:00**. 열린 이슈 **1개**, PR **26개**(사용자 소유 7, 자동 의존성 19)를 전부 조사했다. 이 감사는 해결·병합·배포를 수행하지 않았다. 부모의 #3111 수정과 보안 에이전트의 알림 처리 영역을 보존했다.

세션 필드는 `openai / gpt-6-astra / xhigh`로 확인했다. 초기·최종 목록 사이 PR SHA나 열린 항목의 변동은 없었다.

## 우선 조치

- **#2843 야간 검증:** 최신 실패에서 39 tests / 1 failure / 33 errors. `100 != 99`와 `receipt_ledger_state`로 unit/e2e가 시작되지 않았다. 관련 검증 소스는 감사 시점 main에서도 동일하다. 정확한 fixture/ledger 계약 수정 후 실제 canonical nightly 성공 증거가 필요하다.
- **#3099:** 미해결 리뷰 2건(중복 경고의 최대 251회 순차 조회, 잘못된 category 원소 승인), 후보 reconciliation 증거 불일치가 남아 있다. 보안 검사 2종 실패는 보안 에이전트에 분리한다.
- **#3066:** Bun 잠금 누락 외에 `Supercluster` namespace 사용으로 TS2702 **16건**이 실제 Admin CI에 나타난다. #3065도 frozen Bun lock 설치 실패가 확인됐다.
- **#3032:** 기존 REST 오류 문자열 계약 테스트 **3개 실패** 및 충돌. #3031은 ID 길이 불일치·가변 error.name 로그·검증되지 않은 성능 근거 3건이 남아 있다.
- **#2902/#2903:** main 직접 진입의 필수 Promotion Path 실패. #2908은 필수 Release가 없고 충돌한다. #2857은 별도 refactor 기반 작업으로, 이 기반에 없는 보호 규칙을 만들어 적용하지 않았다.

## 보호 규칙과 증거 경계

develop/data/main의 현재 보호 규칙은 `Release`, `Promotion Path`, strict up-to-date, conversation resolution이며 요구 승인 수는 **0**이다. 규칙셋은 0개다. 미해결 리뷰 **11건 / 8 PR**, 전체 리뷰 스레드 64건, 하나 이상의 실패 검사가 있는 PR은 **20개**다. 실제 코드 충돌은 #3032/#2908/#2903/#2902이며, 19개 PR은 충돌 없이 behind 상태다. 현재 대상 브랜치와의 ancestry상 뒤처진 PR은 총 23개다. #2850의 Promotion Path는 SKIPPED로, 정책 실행 성공과 구분한다.

- `develop`: `d0e38f333a8d9dbd9ed4e14d3e113732ad58ef9a`

- `data`: `4bda4aaebee8bffac723e09b35b0712e8b4adf6e`

- `main`: `ca235e250957c4360ad713ffd29e118c11cc5b7c`


현재 develop는 data의 조상이고 data는 main의 조상이다(각 1개 커밋 차이). 열린 승격 PR은 0개이며 신규 소스는 `develop -> data -> main` 순서로만 통합해야 한다. 후속 배포와 rollback/live SHA readback은 부모 소유다. pending/queued/in_progress/waiting/requested 워크플로우는 조회 시점 0개였고 실행·취소하지 않았다.

## 이슈

[#2843 — Local regression incident](https://github.com/twoimo/tzudong/issues/2843): 본문과 댓글 37개를 페이지네이션으로 읽었고, 구조화된 incident 기록 38개만 보존했다. 최근 5회 nightly가 모두 실패했다. 최신 [실패 실행](https://github.com/twoimo/tzudong/actions/runs/37155813334)은 `3aebb1c6f446250fd49fceac5f1a4ccac2f5d8f0`이다. fixture/ledger 계약 수정 및 새 all-suite 실행의 검증된 성공·publication 증거가 생기기 전 닫지 않는다.

## 모든 열린 PR

| PR / 분류 | 현재 head SHA | 관찰된 핵심 문제와 최소 조치 |
|---|---|---|

| [#3111 — fix(web): restore onboarding and make review retries consistent](https://github.com/twoimo/tzudong/pull/3111)<br>active-parent-owned-source | `99f91157190058ac4691ec10046d3f520466ebd8` | Required checks succeeded at 99f9115, but one unresolved upload ambiguity race blocks conversation-resolution protection. Parent is already editing ReviewModal, review-save-operation and paired tests. **Next:** Parent completes ambiguous-upload handling, verifies focused review lifecycle tests and current-head release checks, then resolves the addressed review. Audit agent must not duplicate these edits. |

| [#3099 — Optimize pipeline and review, renew UI, and integrate Gemini and Sentry](https://github.com/twoimo/tzudong/pull/3099)<br>active-user-owned-source-and-evidence | `a29e464e3ff94f42e23bccb76388da0bd51a2566` | 630 changed files, including 309 performance evidence paths; this is not an evidence-only PR. Two unresolved current-head P2 defects: warning enrichment makes up to 251 sequential 200-row requests; category classifier checks only nonempty array and can accept malformed elements. Exact source reviewed. orchestration-readiness fails test_manifest_is_reproducible_from_current_candidate_blobs with platform_modernization_reconciliation_stale (365 tests, 1 failure in the selected step). CodeQL and GitGuardian checks also fail; alert diagnosis/remediation belongs to the separate security agent. **Next:** Existing source owner should add bounded database warning aggregation and strict category element validation with focused tests. Preserve applied migrations; use a new correction migration when applicable. Refresh current-candidate reconciliation after source settles, preserving historical evidence, and rerun affected gates. Security agent resolves security findings separately. |

| [#3066 — build(deps): bump the web-runtime group across 1 directory with 17 updates](https://github.com/twoimo/tzudong/pull/3066)<br>automated-web-runtime-dependencies | `8ed5035144255c110d5d66f5672c8bfe6bcc15c1` | Only package.json and package-lock.json changed; Bun lock remains stale. Review says 19 changes; direct-manifest audit found 18 changed dependency/devDependency entries, so title/review counts are not authoritative. Selected Admin CI log shows 16 TS2702 diagnostics because Supercluster is used as a namespace in NaverMapView and clustering helpers. This is an additional blocker beyond the lockfile review. 75 commits behind current develop. **Next:** Use one web-dependency owner with #3065/#2855 after #3099 manifest changes; reconcile npm authority and Bun lock, adapt Supercluster type imports/callers, then parity/build/map runtime checks on the final candidate. |

| [#3065 — build(deps-dev): bump the web-development group across 1 directory with 8 updates](https://github.com/twoimo/tzudong/pull/3065)<br>automated-web-development-dependencies | `a64f9dae53145c5eaf3e63104c841f1d3a2338f6` | Eight development dependency updates omit Bun lock and fixed Supabase version-contract updates. Selected Install log confirms frozen-lockfile failure. 75 commits behind current develop. **Next:** Reconcile Bun lock and targeted nightly/toolchain version contracts against npm authority; keep native TS 7.0.2 and compatibility TS 6.0.2 pins. Integrate with the single web dependency batch and verify parity/unit/build gates. |

| [#3064 — build(deps): bump puppeteer from 25.8.0 to 25.12.0 in /backend](https://github.com/twoimo/tzudong/pull/3064)<br>automated-backend-node-dependencies | `966e114336620c71bbe5482c5a88e366f5c5caaa` | Puppeteer 25.8.0 -> 25.12.0; orchestration-readiness fails at an older base; no PR-specific browser defect established in bounded audit. **Next:** Reconcile fresh backend lockfile under one owner and verify affected crawler/browser paths plus readiness after baseline evidence repair. |

| [#3063 — build(deps): bump langchain-core from 1.6.0 to 1.6.5 in /backend/pipeline](https://github.com/twoimo/tzudong/pull/3063)<br>automated-pipeline-python-dependencies | `ac44f4c3a6be3ee73e9a4f40ec49a95ff1c2381d` | langchain-core 1.6.0 -> 1.6.5; orchestration-readiness fails. **Next:** Resolve together with langgraph/pydantic in a pinned compatible pipeline environment; run affected orchestration/data-contract tests and security-agent-selected audit. |

| [#3062 — build(deps): bump @google/genai from 2.18.0 to 2.24.0 in /backend](https://github.com/twoimo/tzudong/pull/3062)<br>automated-backend-node-dependencies | `7ce49f47d24842079a88b2954692acc6b0b6d6f4` | @google/genai 2.18.0 -> 2.24.0; orchestration-readiness fails. **Next:** Coordinate with #3099 Gemini caller changes; update package and lock once, then validate affected response/cache/usage-boundary contracts. |

| [#3061 — build(deps): bump dotenv from 16.6.1 to 18.0.3 in /backend](https://github.com/twoimo/tzudong/pull/3061)<br>automated-backend-node-major-compatibility | `fa568c8ccf04a5e68b153c89033e9b08700f4286` | dotenv 16.6.1 -> 18.0.3; unresolved review identifies stdout banner contamination of JSON CLI output. Current PR source uses config without quiet and dotenv/config side-effect import in two CLI consumers. orchestration-readiness fails; 75 commits behind. **Next:** Preserve machine-readable stdout with explicit quiet configuration; add focused stdout JSON parsing checks for both CLI paths before accepting the major update. |

| [#3060 — build(deps): bump langgraph from 1.2.1 to 1.2.12 in /backend/pipeline](https://github.com/twoimo/tzudong/pull/3060)<br>automated-pipeline-python-dependencies | `561bed977f436d64f5a3bfcd5dec1c5050a4e2c2` | langgraph 1.2.1 -> 1.2.12; orchestration-readiness fails. **Next:** Integrate with #3063/#2889 under one requirements-file owner; validate state/checkpoint compatibility and affected pipeline contracts. |

| [#3032 — fix: 단일 맛집 병합과 모달 너비를 정리한다](https://github.com/twoimo/tzudong/pull/3032)<br>user-owned-source-needs-reconciliation | `76afb0634b6710581aa296a9644929313e24b36f` | GitHub mergeability readback is dirty; head is 120 commits behind current develop. Source and CI confirm three existing REST-client tests still require old error strings while implementation emits bounded codes; Ubuntu npm unit step fails. **Next:** After #3111, reconcile this branch with fresh develop without resetting user work; update existing REST-client contract tests to fixed bounded codes, retain fail-closed behavior, and verify modal insets plus single-restaurant merge behavior. |

| [#3031 — perf(web): 같은 영상 링크의 ID 추출과 재조회를 한 번만 한다](https://github.com/twoimo/tzudong/pull/3031)<br>user-owned-performance-source-and-evidence | `cd86c106b468c40e83a2e2edf39b49c3b9529937` | Three unresolved threads: retained benchmark uses inline baseline without frozen-tree/scorer/validator/detached artifact-map proof; extracted ID length is unbounded while route classifier limits it to 128; mutable error.name is logged in three dashboard routes. Current-head source confirms ID/logging issues. Six performance files are scripts/benchmark JSON across three directories; no accepted speedup established by this audit. 120 commits behind current develop; checks green on its old SHA do not prove integration. **Next:** Use one ID length contract, fixed failure codes and related runtime tests; retain canonical frozen baseline/scored/validated evidence before accepting the README speed claim, or remove unsupported acceptance/claim while preserving historical artifacts. Reconcile hook changes after #3111/#3032. |

| [#2971 — chore(deps): bump openai from 3.3.1 to 3.16.1 in /backend/restaurant-crawling/scripts](https://github.com/twoimo/tzudong/pull/2971)<br>automated-crawler-python-dependencies | `0063bc00e85b1d9f0c24631203c057c53a3eef75` | Python openai 3.3.1 -> 3.16.1; orchestration-readiness fails. **Next:** Batch crawler requirements under one owner with #2896/#2894/#2888/#2850; verify surviving SDK callers and affected crawler tests without changing models/providers. |

| [#2924 — build(deps): bump js-yaml from 4.3.2 to 5.4.2 in /backend](https://github.com/twoimo/tzudong/pull/2924)<br>automated-backend-node-major-compatibility | `40539ca35df591451ee3be8b8456001d72964fcb` | js-yaml manifest changes ^4.2.0 -> ^5.4.2 (PR title describes another prior release). Unresolved review identifies removed default export; current PR map crawler still uses const { default: yaml } = await import and yaml.load. orchestration-readiness fails; 307 commits behind. **Next:** Use named load export or namespace consistently, verify channel config parsing and Step 05 callers, and coordinate the surviving YAML update with #2902/backend dependency owner. |

| [#2908 — feat(admin): adopt semiotic KPI dashboard, trend momentum, and evaluation review](https://github.com/twoimo/tzudong/pull/2908)<br>historical-user-owned-partially-duplicated-source-and-evidence | `adea93042c0bd27f2015ba3200639be9c4b9fa11` | Conflicts with current develop and is 492 commits behind. Required Release context is absent on head; GitGuardian fails. git cherry finds 30 equivalent patches and 2 unmatched patches among 32 non-merge commits. Unmatched commits are 0bb61220b1d408a22f0cf81f1cc1e1d31148ada1 and adea93042c0bd27f2015ba3200639be9c4b9fa11; these include broad UI/data/evidence and SEO/crawler work. This does not prove semantic supersession. PR body historical catalog counts and test claims were not treated as current hosted proof. **Next:** Reconcile the two unmatched commits by behavior/file against fresh develop and active #3099; retain evidence. Ask the source owner to choose surviving changes only after a concrete reconciliation; obtain fresh required CI and security readback. Keep open until substantive remaining scope is resolved. |

| [#2906 — chore(deps): bump psycopg2-binary from 2.9.11 to 2.9.13 in /backend/pipeline-control](https://github.com/twoimo/tzudong/pull/2906)<br>automated-control-python-dependencies | `600a75d5cf57c51941f67abbdcaeebc099676cb6` | psycopg2-binary 2.9.11 -> 2.9.13; Freshness, both npm audit jobs and orchestration-readiness fail on historical head. **Next:** Reconcile current control requirements and verify connection/transaction contracts; security agent checks current advisories rather than inheriting old npm audit conclusions. |

| [#2903 — docs: clean up README with concise features and visual product tour](https://github.com/twoimo/tzudong/pull/2903)<br>user-owned-documentation-with-wrong-promotion-target | `da096e04baf979ac35531172c7a1de95090aa649` | README-only PR targets main directly, fails mandatory Promotion Path, and conflicts; 461 commits behind main. **Next:** Prepare surviving README changes against fresh develop and route through develop -> data -> main under protection; retain original PR until successor scope and evidence are explicit. |

| [#2902 — chore(deps): bump the npm_and_yarn group across 2 directories with 4 updates](https://github.com/twoimo/tzudong/pull/2902)<br>automated-partially-superseded-multi-manifest-wrong-target | `db118759bc403743d1c0f376fd5d3a8e2bad182b` | Targets main directly: mandatory Promotion Path fails and merge conflicts exist. Three proposed web entries are already met/exceeded: current maplibre-gl ^6.10.0 vs proposed ^6.4.1; next 16.3.5 vs 16.3.4; sharp ^0.35.4 already matches. Backend js-yaml ^4.3.2 is not represented by current ^4.2.0; therefore entire PR is not proven obsolete. **Next:** Extract only still-needed compatible YAML intent into fresh develop with the backend batch; do not downgrade web packages or close the original before successor coverage is proven. |

| [#2896 — Bump google-api-python-client from 2.196.0 to 2.200.0 in /backend/restaurant-crawling/scripts](https://github.com/twoimo/tzudong/pull/2896)<br>automated-crawler-python-dependencies | `833ddd699e73f95bf84b2b80975fea1783998333` | google-api-python-client 2.196.0 -> 2.200.0; no failed head checks but 494 commits behind current develop. **Next:** Integrate under crawler requirements owner and run current YouTube API adapter contracts. |

| [#2894 — Bump curl-cffi from 0.15.0 to 0.16.3 in /backend/restaurant-crawling/scripts](https://github.com/twoimo/tzudong/pull/2894)<br>automated-crawler-python-dependencies | `f286446ff1000d67fdf780c57cc2714b2fb820e7` | curl_cffi 0.15.0 -> 0.16.3; no failed head checks; 494 commits behind. **Next:** Integrate crawler requirements once and test affected HTTP/crawler error behavior in isolated local checks. |

| [#2892 — chore(deps): bump Azure/setup-helm from 4.3.1 to 5.0.1](https://github.com/twoimo/tzudong/pull/2892)<br>automated-ci-action-dependencies | `b5fca0502d99809e4f300c054c7ec8b30c46cf2d` | Pinned Azure/setup-helm action changes to 5.0.1; Freshness and orchestration-readiness fail. **Next:** Coordinate with #3099 security workflow edits and #2887; verify the action revision and existing workflow contract without changing permissions or dispatching workflows in this audit. |

| [#2889 — Bump pydantic from 2.13.4 to 2.13.5 in /backend/pipeline](https://github.com/twoimo/tzudong/pull/2889)<br>automated-pipeline-python-dependencies | `e817c475ee9c38478deab156a36848eba4e8dffc` | pydantic 2.13.4 -> 2.13.5; no failed head checks; 494 commits behind. **Next:** Resolve and verify with #3063/#3060 against existing model/serialization contracts. |

| [#2888 — Bump scrapling from 0.4.8 to 0.4.15 in /backend/restaurant-crawling/scripts](https://github.com/twoimo/tzudong/pull/2888)<br>automated-crawler-python-dependencies | `7333b4877dc077ed936a93f5fdd82694b1f304a8` | scrapling[fetchers] 0.4.8 -> 0.4.15; crawler pip-audit fails on this head; 494 commits behind. **Next:** Let security agent identify current required remediation versions; verify the combined crawler environment and smoke contracts before promotion. |

| [#2887 — chore(deps): bump opentofu/setup-opentofu from 1.0.8 to 2.0.2](https://github.com/twoimo/tzudong/pull/2887)<br>automated-ci-action-dependencies | `3a10ae6e8004c1f1488861b3f7c118653e62f0da` | Pinned opentofu/setup-opentofu action changes to 2.0.2; Freshness fails; 154 commits behind. **Next:** Reconcile alongside #2892 and active #3099 workflow changes, preserving pins and privileges; validate current workflow source. |

| [#2857 — Admin console sidebar refactor: module panel through task 16 verification](https://github.com/twoimo/tzudong/pull/2857)<br>user-owned-stacked-admin-work | `8d6b3671325e4a13f85f3e1ed6a297bd8f7a7446` | Targets refactor/admin-console-sidebar, not protected develop. This base has no matching branch-protection rule in the observed repository. 25 commits ahead of its explicit base; six web CI jobs fail at install/lint/typecheck steps. Historical task 16/16.1 completion is not proven; description explicitly retains failed local verification. Release success on this stack does not prove production readiness. Missing Promotion Path is not classified as a missing mandatory check on this unprotected base. **Next:** Preserve the stack and owner work; reconcile unique admin behavior with #3099/current develop, fix inherited toolchain/fixture failures in a dedicated candidate, verify sidebar keyboard/hydration/responsive behavior, and use a protected develop integration before promotion. |

| [#2855 — chore(deps): bump framer-motion from 12.42.2 to 13.4.0 in /apps/web](https://github.com/twoimo/tzudong/pull/2855)<br>automated-web-runtime-major-dependencies | `338de43e80ffaa5cd703dacd7886017b5c219e31` | framer-motion ^12.42.2 -> ^13.4.0; only npm manifest/lock changed. Install/freshness/platform CI and readiness failures remain. **Next:** Integrate in the single web dependency batch; reconcile Bun lock and verify animations, reduced motion and responsive map/panel behavior on current source. |

| [#2850 — chore(deps): bump yt-dlp from 2026.7.4 to 2026.8.19 in /backend/restaurant-crawling/scripts](https://github.com/twoimo/tzudong/pull/2850)<br>automated-crawler-python-dependencies | `ae2d394a470ec2a0ac582200235b30e695eeaaee` | yt-dlp[default] 2026.7.4 -> 2026.8.19; 592 commits behind. Release succeeded but Promotion Path was SKIPPED. **Next:** Integrate crawler requirements on fresh develop and obtain an actually executed promotion-policy check plus affected media metadata contracts. |


각 항목의 전체 변경 경로, 검사 실패명, 필수 검사 상태, 리뷰 URL, ancestry, 의존성 버전 차이, 최소 조치, 증거 한계는 [findings.json](findings.json)에 있다.

## 중복·의존 관계

- #3111과 #3099는 게시된 변경 파일 기준 겹침 0개다. #3111과 #3032는 `use-restaurants.tsx`를 공유한다. #3031/#3032도 이 hook과 merge 테스트를 공유하므로 부모 수정 뒤에 통합한다.
- #2908은 32개 비병합 패치 중 30개가 develop와 동등하지만, 남은 2개는 큰 UI/데이터/SEO/크롤러 변경이다. 전체가 대체되었다고 판단할 수 없다. #3099와 35개, #2857과 13개 파일을 공유한다. #2857/#3099는 15개를 공유한다.
- #2902의 web 3개 버전 의도는 현재 develop에 반영되었거나 초과되지만, backend YAML 의도는 남아 있다. web을 내리지 말고 살아 있는 의도를 분리 검증한다.
- 19개 자동 PR 중 package/lock 또는 requirements 파일을 공유하는 그룹은 하나의 담당자가 조정한다. #3099가 수정 중인 Gemini/Sentry manifest와 security workflow도 통합 순서를 보장한다.
- 별도의 evidence-only PR은 없다. #3099/#3031/#2908은 실행 소스와 과거 증거가 혼합되어 있다. 과거 증거·서명·applied migration은 보존한다.

## 제안하는 분리 작업 배치

- **B0 — Parent #3111 upload race and authorized delivery**: #3111. Parent only. All other batches preserve parent review files; hook integration waits for B0.

- **B1 — Nightly publication fixture and ledger contract**: #2843. Dedicated regression owner. Disjoint from parent upload files. Coordinate canonical migration changes from B2 before final evidence; never rewrite applied migrations/old receipts.

- **B2 — Active admin evaluation correctness/performance and candidate evidence**: #3099. Existing #3099 source owner, security agent owns alerts. Fix two unresolved defects; current-candidate reconciliation is generated after content settles. Serialize admin/UI integration with B4 and manifests with B5/B6.

- **B3 — Dashboard ID/log/evidence contracts and REST contract reconciliation**: #3031, #3032. One owner for shared hook and merge test. Wait for B0 before touching use-restaurants.tsx; keep supported logging and benchmark proof requirements. Source fixes may be prepared in disjoint dashboard/REST files meanwhile.

- **B4 — Historical admin stack and documentation reconciliation**: #2857, #2908, #2903. Source owner reconciliation; no automatic closure. Compare surviving behavior after B2. #2903 README can be prepared independently against develop. Preserve unmatched commits and evidence; wrong-base original PRs are not directly merged.

- **B5 — Web dependency manifest, locks and types**: #3066, #3065, #2855. One web dependency owner. Serialize web manifest/lock edits with #3099; reconcile Bun against npm authority and fix Supercluster namespace types. Preserve pinned toolchain.

- **B6 — Backend Node dependency compatibility**: #3064, #3062, #3061, #2924, #2902. One backend manifest owner. Serialize backend manifest/lock edits with #3099; fix dotenv JSON stdout and YAML namespace callers; retain only unapplied #2902 intent.

- **B7 — Pipeline Python requirements**: #3063, #3060, #2889. One pipeline requirements owner. Single resolver-compatible update for shared file; coordinate #3099 pipeline contracts and security-agent conclusions.

- **B8 — Crawler Python requirements**: #2971, #2896, #2894, #2888, #2850. One crawler requirements owner. Disjoint requirements file from B7; preserve models/providers. Use security-agent findings for current dependency remediation; no ad hoc safe-version claims.

- **B9 — Control Python dependency**: #2906. Control requirements owner. Can prepare independently of B7/B8; protected integration remains serialized.

- **B10 — Pinned CI action updates**: #2892, #2887. One security workflow owner. Shares security-audit.yml with #3099; integrate after active workflow edits, preserve pins and privileges.


B1/B3의 비중복 파일, B7/B8/B9의 서로 다른 requirements 파일은 병렬 준비가 가능하다. 공유 manifest, admin 화면, security workflow 수정과 보호 브랜치 승격은 직렬화한다. 이 배치 제안은 새 작업 위임·외부 쓰기 권한을 생성하지 않는다.

## 수행 범위와 재현 가능한 근거

기존 gh 2.102.0과 읽기 전용 Git 객체를 사용했다. issue/PR/파일/댓글 목록은 페이지네이션을 끝까지 읽었다. PR #3099의 파일 목록은 7페이지였고, GraphQL checks/reviewThreads/comments 연결은 추가 페이지가 없음을 확인했다. 일부 초기 대규모 GraphQL 요청은 구문/노드 제한 오류 후 범위를 줄여 정상 조회했으며, 감사 coverage 누락은 없다. CI 로그는 메모리에서만 정리했고 저장하지 않았다. 계정·자격증명·설정 변경, 소스 수정, push/merge/close/comment/review resolution/workflow 실행·취소/배포는 0건이다. 로컬 테스트나 실사용·호스팅 검증을 실행하지 않았다.

정확한 snapshot과 per-item 결과는 JSON 파일들에 있다. 초록 필수 검사나 옛 PR 본문은 최신 통합·실서비스 증거가 아니며, 전체 해결 또는 안전한 종결이 확인된 PR은 0개다.
