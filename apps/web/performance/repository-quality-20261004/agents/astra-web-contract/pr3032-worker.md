# PR3032 worker — 로컬 의도 통합 결과

작성 시각: 2026-10-04T10:10:11.317789+00:00

지정 작업 폴더 `/Users/twoimo/.codex/worktrees/review-contract-quality-20261004/tzudong`에서만 소스/테스트를 수정했다. 시작과 완료 확인의 HEAD는 `4295fd54411ac8a4c304dce89efbb6f96e90935c`, branch는 `codex/review-contract-quality-20261004`다. 시작 시 tracked/untracked 변경은 없었다. 진행 중 parent의 dashboard/video ID 파일 변경을 관찰했으며 읽기/검증 경계를 유지하고 덮어쓰지 않았다. 이 보고서만 사용자가 지정한 외부 증거 경로에 작성했다.

## 읽은 근거와 범위

- 작업 폴더의 `AGENTS.md`, `docs/agents/verification.md`, `docs/agents/privacy.md`를 소스 수정 전에 읽었다.
- [PR3032](https://github.com/twoimo/tzudong/pull/3032)의 본문, 파일 목록, 리뷰 및 inline review를 GitHub의 읽기 전용 요청으로 확인했다. head는 `76afb0634b6710581aa296a9644929313e24b36f`로 일치했다. 로컬 Git에 이미 있는 두 커밋의 diff와 현행 파일/호출부를 비교했다.
- [P1 리뷰](https://github.com/twoimo/tzudong/pull/3032#discussion_r4081864573)는 고정 오류 코드 구현에 기존 REST tests의 권한 거부/count/config 기대 문자열 3개가 불일치한다고 지적했다. 실제로 아래의 3실패를 재현했다.
- Supabase skill `/Users/twoimo/.codex/plugins/cache/openai-curated-remote/supabase/1.0.0/skills/supabase/SKILL.md`를 읽고 source_lookup를 수행했다. 공식 [changelog](https://supabase.com/changelog.md)와 [type guidance](https://supabase.com/docs/guides/api/rest/generating-types.md)는 read-only HTTP로 읽었다. 새 SDK/API/schema/auth 기능을 도입하지 않았다. 실제 Supabase 서비스/DB 접근 없이 기존 fetch mock과 로컬 fixture만 실행했다.

## 현행에서 보존한 의도와 추가 변경

| 영역 | baseline에 이미 있는 동작 | 이번 최소 변경 |
| --- | --- | --- |
| REST | query escaping, public authorization header 구성, announcements/ad_banners의 401/403만 빈 배열, HEAD exact count, RPC 함수명 인코딩 및 status-only 실패, RPC 성공 JSON 실패 시 null | PR head의 bounded HTTP/config 의도를 통합하고 후속 검토에서 transport/parse/config URL 경계까지 최소 보완했다. 요청마다 config 존재/URL 형식을 확인하며 rows/count/rpc transport 오류와 rows JSON parse 오류도 고정 코드로 정제한다. non-OK body를 읽지 않고 취소한다. 기존 테스트 3개를 정확한 새 message 계약으로 수정하고 추가 실패 경로를 mock으로 검증했다. |
| single-restaurant merge | iterative union-find, 대형 그룹 처리, main selection, group/member 순서, multi-row 최신 media 정렬, compact projection, paginated verified-review count | singleton group에만 직접 projection을 추가했다. 빈 값/default, alias name, categories 중복 제거, 원본 row identity, media, review_count를 기존 결과와 일치시켰다. multi-row 경로와 perf measurement start/end는 유지한다. |
| modal inset | 현행의 overlay, aria-modal, 바깥 클릭 처리, 닫기 버튼, animation 제거, radius와 호출부 class override | DialogContent/AlertDialogContent의 `w-full`만 `w-[calc(100vw-2rem)]`로 변경했다. 기본 `max-w-lg`와 함께 좌우 1rem 여백/기본 최대 32rem 의도를 구현한다. |

PR의 모달 `w-[min(32rem,calc(100vw-2rem))]`를 문자 그대로 복사하지 않았다. 현행 `components/profile/ProfileModal.tsx:371`은 `max-w-2xl`만으로 넓이를 지정하므로, PR 문자열을 쓰면 desktop 폭을 32rem으로 축소한다. 선택한 구성은 현재 max-width 재정의를 유지한다. 기존 `cn`/tailwind-merge를 사용하는 회귀 테스트로 class override 보존을 확인했다. 실제 CSS/layout 렌더 검증은 parent 담당이다. 후속 parent 알림에서 로컬 렌더 20개 조합의 너비/여백/닫기/포커스가 모두 정상이라고 보고했다. 이 결과는 parent의 검증으로 구분하며 worker가 직접 수행한 것으로 기록하지 않는다. parent의 baseline width 비교/최종 판정은 별도 인계 항목이다. AlertDialog의 `aria-modal` 부재는 baseline에도 있는 기존 접근성 경계로 parent가 확인했으며 inset geometry 합격과 구분한다. 요청대로 그 속성을 변경하지 않았다.

해외 지역 filter helper/현재 projection과 관련 문서의 기존 구현은 유지했다. PR의 부수적인 CategoryFilter 로그 수정 및 hook 지역 query 정리는 이번 single-merge/REST/modal 통합에 필수적이지 않아 옮기지 않았다. CategoryFilter는 소유 범위 밖이다. ReviewModal 및 review-save-operation, auth/privacy 구현, marker/map renderer, manifest/lock, admin evaluation/storyboard/Sentry, frozen performance는 수정하지 않았다.

## 수정 전 재현과 수정 후 검증

모든 Bun 명령의 cwd는 작업 폴더의 `apps/web`이다. 출력 전체/response body를 저장하지 않고 결과 개수와 고정된 테스트 이름만 정리했다.

| 단계 | 명령/범위 | 결과 |
| --- | --- | --- |
| baseline | `bun test tests-unit/supabase-rest-client.test.ts` | exit 0, 8 pass / 0 fail, 32 assertions |
| baseline | `bun test tests-unit/use-restaurants-merge.test.ts` | exit 0, 12 pass / 0 fail, 39 assertions |
| PR REST만 통합, legacy tests 유지 | `bun test tests-unit/supabase-rest-client.test.ts` | exit 1, 5 pass / 3 fail, 30 assertions. restaurant permission denial, count failure/missing range, missing config의 이전 문자열 불일치. 리뷰 재현. |
| 새 singleton/modal 회귀 테스트 추가, 해당 구현 전 | `bun test tests-unit/use-restaurants-merge.test.ts tests-unit/dialog-content-inset.test.ts` | exit 1, 14 pass / 6 fail, 50 assertions. singleton sort 2개와 modal width/default/override 4개 실패. |
| HTTP/singleton/modal 1차 통합 | 아래 명령 | exit 0, 46 pass / 0 fail, 259 assertions |
| transport/parser/config URL 추가 회귀, 보완 전 | `bun test tests-unit/supabase-rest-client.test.ts` | exit 1, 10 pass / 4 fail, 151 assertions. rpc failure-code 분기, transport, rows parse, invalid config URL 실패. |
| 추가 경계 보완 후 최종 관련 테스트 | 아래 명령 | exit 0, **50 pass / 0 fail**, 306 assertions |
| 최종 targeted ESLint | 아래 명령 | exit 0, 출력 없음, warnings 0 |
| diff whitespace | `git diff --check` | exit 0 |

최종 테스트:

```text
bun test tests-unit/supabase-rest-client.test.ts tests-unit/use-restaurants-merge.test.ts tests-unit/dialog-content-inset.test.ts tests-unit/overseas-region-filter.test.ts tests-unit/related-review-count-chunking-source.test.ts tests-unit/restaurant-merged-media.test.ts
```

최종 ESLint:

```text
/opt/homebrew/opt/node@24/bin/node node_modules/eslint/bin/eslint.js lib/supabase-rest-client.ts hooks/use-restaurants.tsx components/ui/dialog.tsx components/ui/alert-dialog.tsx tests-unit/supabase-rest-client.test.ts tests-unit/use-restaurants-merge.test.ts tests-unit/dialog-content-inset.test.ts --max-warnings=0
```

구체적으로 검증한 HTTP 오류 코드는 `supabase_rest_rows_failed:<100..599 또는 0>`, `supabase_rest_count_failed:<100..599 또는 0>`, `supabase_rest_config_missing`, `supabase_rest_count_missing`다. 추가 검토 후 rows/count/rpc의 fetch rejection은 각각 `supabase_rest_rows_failed:0`, `supabase_rest_count_failed:0`, `supabase_rest_rpc_failed:0`로 reject한다. rows JSON parse rejection도 `supabase_rest_rows_failed:0`로 reject한다. malformed/non-HTTP(S) config URL은 fetch 전 `supabase_rest_config_invalid`로 reject한다. 요청 준비의 RPC JSON serialization 실패도 같은 RPC 고정 코드가 적용되며 순환 mock args로 확인했다.

RPC non-OK 반환은 기존 `{data:null,error:{status}}`를 유지한다. 성공 rows의 임의 JSON 통과와 RPC unreadable-success `{data:null,error:null}` fallback도 유지한다. public announcements/ad_banners의 401/403만 빈 배열이고 transport 실패는 빈 성공으로 바꾸지 않는다. Error뿐 아니라 문자열/undefined rejection에도 Error.name/message를 고정 코드로 재구성한다.

singleton sort 생략은 호출 수 회귀 검증이며 처리 시간/배수 개선을 측정한 것이 아니다. 새 성능 승인/배수 주장, frozen artifact 변경은 없다.

## 정제된 실행 환경과 metadata

- 직접 확인: `/opt/homebrew/opt/node@24/bin/node` v24.21.0, `/Users/twoimo/.bun/bin/bun` 1.4.0. shell 기본 Node는 v26.10.0이므로 ESLint는 명시적 Node 24로 실행했다.
- parent가 제공한 `apps/web/node_modules` symlink의 실제 target: `/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong/apps/web/node_modules`. worker는 읽기 전용으로 재사용했고 target 파일을 수정하거나 install하지 않았다.
- 연결된 package metadata readback: `@typescript/native` alias의 package `typescript` 7.0.2, `typescript` alias의 package `@typescript/typescript6` 6.0.2, `@typescript/old` 6.0.2, Next 16.3.5, ESLint 9.39.5.
- parent 보고: npm 11.19.0은 release authority 11.6.2와 다름. `verify-typescript-toolchain.mjs`는 symlink 때문에 `TOOLCHAIN_RECEIPT_PATH_INVALID`. package/binary version 확인과 설치 receipt 검증은 별개이며 **설치 검증 통과로 보고하지 않는다**. worker는 이 실패를 우회하거나 receipt를 수정하지 않았다.
- global native7.0.2/compat6.0.2 parity: parent 소유. worker의 최종 REST 추가 변경 때문에 parent가 재실행한다고 알렸다. 최종 소스 준비 및 Bun 50/50/ESLint 통과를 현재 대화에서 알렸으며 worker가 parity 통과를 주장하지 않는다.
- 현재 session metadata 파일: `/Users/twoimo/.codex/sessions/2026/10/04/rollout-2026-10-04T18-56-59-01a10658-684b-78d2-bd2f-fd3505a576a7.jsonl`. 원문 복제 없이 allowlist 필드만 읽었다. line 1의 현재 session `model_provider=openai`; turn_context lines 7/11의 `model=gpt-6-astra`, `effort=xhigh`; collaboration settings도 같은 model/reasoning effort. 따라서 요청한 native Astra xhigh는 **로컬 session metadata 기준 확인됨**. 최종 후속 turn_context line 11도 `gpt-6-astra / xhigh`로 확인했다. upstream 실제 serving/hardware/wire trace는 미확인이고 provider diagnostics는 조회/보존하지 않았다.
- 세션의 cwd metadata는 `/Users/twoimo/.codex/worktrees/179f/tzudong`지만 모든 source/test tool 명령에는 지정 작업 폴더 cwd/절대 경로를 사용했다. 환경의 다른 session ID가 가리키는 이전 chat model을 현재 worker model로 혼동하지 않았다.
- 테스트는 기존 mock fixture의 공개 설정 sentinel을 재사용했고 global fetch를 mock으로 대체했다. 외부 테스트/설치/검증 gate를 통과시키는 가짜 secrets는 넣지 않았다. credentials, provider diagnostics, raw response, PII를 이 문서에 기록하지 않았다.

## 변경 파일과 인계

모든 변경 파일은 다음 source root 기준이다: `/Users/twoimo/.codex/worktrees/review-contract-quality-20261004/tzudong`.

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/lib/supabase-rest-client.ts` | `a53ef5aaa3bb2436032c5cbab50b15e54d86c9be47600b957208bb6479f1ad27` |
| `apps/web/hooks/use-restaurants.tsx` | `c7460bbdf26a347c814e6ce0fe7526fb0df7c334eb2550f9230a8939322b29f9` |
| `apps/web/components/ui/dialog.tsx` | `131a1e1a4bb49b011c08e664516ac60c112f4567b3154c9b95a7959da63ef820` |
| `apps/web/components/ui/alert-dialog.tsx` | `8fbd1080d341f8927947b3a77adb13ca9dd7cddf70a02df0634a57e34549100c` |
| `apps/web/tests-unit/supabase-rest-client.test.ts` | `5c16753b5b267cbb6efb1b5ca0876a3a4e948fdf68880c2247fbb21cb0255fd8` |
| `apps/web/tests-unit/use-restaurants-merge.test.ts` | `4a43c2e80d373835717122f85d5ef877a3833912ff2932d11e3607913ba23178` |
| `apps/web/tests-unit/dialog-content-inset.test.ts` | `9bfa110a852eb81c03d30eaf4afb79390c721d6b641315b291082f54ad0dfbdb` |

`dialog-content-inset.test.ts`는 새 untracked 파일이다. commit/push/merge/PR 댓글/원격 source 쓰기는 실행하지 않았다. parent의 dashboard/video ID 작업, global parity 결과 판단, 실제 modal 렌더 검증 및 source promotion은 parent가 이어간다. 소스/기존 tests 정리와 모달 fixture 준비 가능 상태를 현재 대화에서 알렸다. 현재 worker의 로컬 구현/해당 검증은 완료됐다.
