# Historical PR/CI 의미 대조 및 최소 수정 인계

지정 checkout에서 승인된 최소 수정과 PR별 의미 대조를 완료했다. **소스 변경은 3개 파일(+48/-6)**, HEAD/branch는 시작 상태 그대로이며 commit/push/원격 쓰기는 없다. 전체 PR를 patch count나 제목만으로 superseded로 분류하지 않았다. active owner 영역의 실제 누락과 필요한 선행 조건은 아래 보고서에 남겼다.

## 기준 및 소스 상태

- checkout: `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong`
- branch: `codex/historical-quality-20261004`
- 시작/종료 HEAD 및 관찰한 parent PR3114 head: `7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd`
- parent PR3114 source head가 비교 권위다. remote main 포함, PR 병합, hosted 실행 또는 배포 완료를 확인하거나 주장하지 않는다.
- 초기 clean 상태를 확인했고, 최종 허용 파일 목록·해시·patch는 [SOURCE-HANDOFF.json](SOURCE-HANDOFF.json), [source-changes.patch](source-changes.patch)에 있다. 모든 source writer가 종료했다.

| 실제 변경 파일 | 내용 | 검증 |
| --- | --- | --- |
| `.github/workflows/security-audit.yml` | PR2892의 Helm action SHA와 PR2887의 OpenTofu action SHA, 정확히 두 줄 | upstream tag→commit 및 입력 schema, YAML 전체 구조 비교, 3 Bun + 2 Python 검사 |
| `README.md` | latest release 링크, 내부 탐색, 현재 stack·실행 안내, current release guide 정합성 | 문서 정적 검사·로컬 링크·앵커·preserved text 비교 |
| `README.ko.md` | 같은 문서 의도의 한글 대응 | 위와 동일 |

CategoryFilter에 현재 bounded log 결함이 없어 수정하지 않았다. nightly workflow/test, packages/locks, shared hooks/map runtime, ReviewModal/auth/privacy, applied SQL, layout/reconciliation 및 기존 performance/frozen evidence의 source 변경은 0이다. 작업 checkout의 untracked 파일도 0이다. 별도 지정 evidence root 안에만 새 산출물을 기록했다.

## PR별 판정

`fulfilled`는 해당 의도의 현재 source 또는 이번 미커밋 patch 충족을 뜻한다. rendering/hosted 결과까지 뜻하지 않는다. `still needed`와 `active-owner dependency`는 원격 종결 사유로 사용할 수 없다.

| PR | exact old head | 결과와 남은 의도 | 상세 근거 |
| --- | --- | --- | --- |
| 2857 | `8d6b3671325e4a13f85f3e1ed6a297bd8f7a7446` | loading/audit/guard/sidebar persistence는 source에서 fulfilled. 공통 상태·검색/IME·viz·운영보조·사용자 마스킹·첫 paint theme은 active-owner dependency. 전체 완료 불가 | [admin 보고서](admin/REPORT.md), [25개 의도 판정](admin/VERDICTS.json) |
| 2908 | `adea93042c0bd27f2015ba3200639be9c4b9fa11` | 30/32는 개별 ancestry patch 증거만 확보. 미일치 admin·SEO commit을 별도 대조. TOP5 비율·snapshot 정체성/기준·독립 읽기 scheduling·manifest/llms 의도 still needed; renderer/table/cohort/local-edit/crawler는 owner 의존. 미검증 수치·성능 주장은 제외 | [admin 보고서](admin/REPORT.md), [실제 대응 SHA](admin/PATCH-MAPPING.md) |
| 2903 | `da096e04baf979ac35531172c7a1de95090aa649` | 12개 문서 의도 중 최종 fulfilled 8, 제약상 제외 4. 5개 미충족 문서 의도를 이번 한·영 README patch로 해결. main 직접 base였다는 사실과 local 통합 기준을 구분 | [README 보고서](readme/REPORT.md) |
| 2892 | `b5fca0502d99809e4f300c054c7ec8b30c46cf2d` | still needed → local patch fulfilled. `Azure/setup-helm@9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310` | [CI 보고서](ci/report.md) |
| 2887 | `3a10ae6e8004c1f1488861b3f7c118653e62f0da` | still needed → local patch fulfilled. `opentofu/setup-opentofu@a1320f892987e89d278cc92dc5adc984fb93aca4` | [CI 보고서](ci/report.md) |
| 3031 | `cd86c106b468c40e83a2e2edf39b49c3b9529937` | B3의 정확한 최종 15파일 통합 보존. map first-match·실제 caller의 KPI 빈 배열/링크 계약 충족. nullable 확장·Set 최적화 및 B3가 철회한 cache/index/sort는 제약상 제외; 구현 통합으로 오인하지 않음 | [map 보고서](map/REPORT.md) |
| 3032 | `76afb0634b6710581aa296a9644929313e24b36f` | B3 REST/singleton/modal 계약 보존. CategoryFilter는 고정 단일 인수 log와 배열 fallback으로 fulfilled. 문자열/catch 정리 및 지역 helper cleanup은 현재 결함 미입증으로 제외 | [map 보고서](map/REPORT.md) |

모든 old base/head/merge-base와 exact diff 또는 필요한 hunk/blob/hash는 각 하위 보고서에 있다. 특히 PR2908은 변경된 remote base tip 대신 **실제 merge-base `0ebb898c708dd2c966fd72dd43172a0cf843cf93`**부터 대조했다. 미일치 두 commit은 `0bb61220b1d408a22f0cf81f1cc1e1d31148ada1` 및 최종 old head다.

G037는 PR3031/3032 exact diff에 변경 경로가 없다. 확인한 6개 source/test blob은 old base/heads/current에서 동일하다. source 계약 보존과 실제 hosted/freeze/ledger 실행 증거를 분리했으며 운영 증거는 parent/active owner 의존이다.

## Active-owner와 최소 admin proposal

`/Users/twoimo/.codex/worktrees/pipeline-performance-20261002/tzudong`은 읽기 전용으로만 관찰했다. 당시 HEAD는 `a60ef70dba0bd32ea44d32218e2c66ef1b5410e1`, branch는 `codex/pipeline-performance-restart-20261002`였다. admin 대응 파일들이 이미 owner HEAD에 커밋된 상태와 이후 dirty/untracked SQL 관련 변화가 함께 관찰됐다. 사용자의 과거 dirty snapshot을 현행으로 재진술하지 않았고, 어떠한 수정·커밋·테스트 실행·메시지 전송도 그 owner에게 하지 않았다.

parent가 합산해야 하는 정확한 영역:

- `components/admin/AdminOperationsPanel.tsx`, `lib/admin/operations-view-model.ts`, 관련 tests: 실제 운영 GET·실패/unknown 상태·domain별 retry 보존.
- `lib/admin/admin-module-routing.ts`, `RestaurantManagementWorkspace.tsx`, evaluation page/helper: owner의 16-route 및 `restaurantView=refresh`와 옛 15-route/현재 14-route를 reconcile.
- `AdminConsoleOverview.tsx`, `AdminUsersPanel.tsx`, `AdminEmbeddedModuleShell.tsx`, `app/admin/layout.tsx`, `styles/admin-ui.css`: owner UI 보존 후 공통 상태·마스킹·theme·dashboard 의도 재검토.
- `lib/admin/youtube-kpi-snapshots.ts`, `app/api/admin/youtube-kpis/route.ts`, `tests-unit/youtube-kpi-snapshot-contract.test.ts`: 채널/출처, 최소 비교 간격, 빈 snapshot 및 fallback 의미를 확정하고 mock runtime 검증. 병렬화는 정확성 확정 후 검토하며 현재 성능 향상은 입증되지 않음.

[TOP5 비율 최소 제안](admin/proposal-01-truthful-top5-proportions.patch)은 `AdminConsoleOverview.tsx` 한 파일의 최소폭 왜곡을 제거하고 작은 라벨을 숨기며 exact-value tooltip을 유지한다. **git apply --check만 통과, 실제 적용 없음.** owner source 합산 후 DOM/반응형/접근성 및 관련 테스트 검증이 필요하다. 넓은 renderer/DTO/SQL/라우팅 수정은 제안 patch에 섞지 않았다.

## 검증 결과 및 한계

| 검증 | 관찰 결과 |
| --- | --- |
| CI Bun source contract | 3 pass, 128 assertions |
| CI Python source contract | 2 pass |
| map/KPI/region focused unit | 24 pass, 53 assertions |
| admin focused 9 files | 70 pass, 5967 assertions; 의존성 로드 오류 2건 |
| README 정적 검증 | 14/14, 로컬 참조 62개와 앵커 8개 누락 0 |
| map 의미 probe | 유효 입력 512건, region query 25건 불일치 0 |
| CategoryFilter probe | 각 old/current 실패 형태 5건; current 고정 1인수/15자 log, getter read 0, fallback 및 성공 row identity 보존 |
| patch/source 범위 | 전체 diff --check 및 source patch reverse apply --check 통과; 변경3·금지파일0·untracked0 |

실행한 좁은 테스트는 합계 **99 pass**이며, admin 두 파일은 `@supabase/supabase-js`와 `react`가 없어 실행되지 못했다. 이 2건을 코드 assertion 실패 또는 통과로 바꾸지 않았다. 전체 suite 성공을 주장하지 않는다. `actionlint`는 미설치로 실행하지 않았고 PyYAML 6.0.3 및 실제 workflow 필드 동등성 검증을 사용했다.

full build/full unit/parity/Naver 측정/브라우저 rendering/DB replay/hosted CI/배포는 실행하지 않았다. 문서의 개발 절차도 실제 onboarding 실행 증거는 아니다. 과거 evidence는 변경하거나 현재 측정으로 재사용하지 않았다. 성능·쿼터 절약 수치나 새 cache/index 승인도 없다.

별도 현행 source 관찰: `backend/utils/tests/test_supply_chain_contract.py`의 기존 Next-family 테스트는 16.3.5를 요구하지만 package manifest는 16.3.6이다. packages/tests를 소유한 parent의 합산 항목이며 이번 두 CI pin 변경과 무관하여 수정하지 않았고, 이 관찰을 실행 실패 결과로 표현하지 않았다.

## 재현 및 모델 증거

- [CI 재현](ci/report.md) 및 [읽기 전용 SHA/YAML validator](ci/validate-ci-pins.py)
- [README 재현](readme/REPRODUCE.md)
- [map 재현](map/COMMANDS.md)
- [admin 재현](admin/REPRODUCE.md)
- [소스 인계 manifest](SOURCE-HANDOFF.json), [미커밋 source patch](source-changes.patch)

native `multi_agent_v1`로 독립 담당 3개를 **gpt-6-astra / xhigh** 명시 요청했다. coordinator와 세 child의 local session/turn_context에서 provider `openai`, model `gpt-6-astra`, effort `xhigh`를 직접 선별 읽어 [model-metadata.json](model-metadata.json)에 보존했다. 이는 local configured metadata다. **actual serving model attestation은 제공되지 않았으므로 미검증**이다. 모델/provider/default/permissions/설정 변경은 없다.

parent의 다음 단계는 source patch 검토·serial 통합·commit/push 및 필요한 hosted CI readback이다. admin proposal과 남은 의도는 active owner 합산 후 처리해야 한다. 이 보고서는 원격 PR 종결이나 publish/merge를 실행하거나 승인받았다는 뜻이 아니다.


## Parent 추가 작업과 소유권 경계

최종 인계 중 사용자가 PR3114 review thread `PRRT_kwDOQGRyNc6oxx7W`와 parent의 후속 계획을 전달했다. 해당 review는 이 worker가 별도로 조회하지 않았으며 사용자 제공 근거로 구분한다. parent는 `.github/workflows/web-admin-ci.yml` Admin lane에 기존 backend dependencies로 `node-dependency-compatibility.test.mjs`를 실행하는 command 및 trigger paths를 추가할 예정이다. backend supply-chain의 Next 16.3.6 expectation, LocalFunction ledger100, nightly runbook도 parent 소유다.

이 worker의 CI 쓰기 범위는 `.github/workflows/security-audit.yml`의 **action SHA 두 줄뿐**이다. `source-changes.patch`는 그 파일과 한·영 README만 담으며 parent 소유 파일은 포함하지 않는다. 원본 파일 전체를 덮어쓰거나 baseline으로 복원하지 말고 세 파일의 diff만 검토/합산해야 한다. parent의 command/paths 및 다른 추가 변경은 보존한다. 앞의 Next 16.3.5 관찰은 이 후속 조치 이전 snapshot이며, parent가 수정 완료했다는 주장도 계속 실패한다는 주장도 아니다. [소유권 기록](parent-coordination.json)을 보존했다. 이 추가 지시 후 소스는 변경하지 않았다.
