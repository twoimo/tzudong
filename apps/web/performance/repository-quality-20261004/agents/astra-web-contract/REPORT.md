# PR3031 / PR3032 현행 develop 계약·품질 수정

완료 기준: 지정 작업 폴더에서 두 PR의 소유 범위 내 의도를 현행 baseline에 통합하고 관련 단위·실행·렌더·타입 검증을 통과시켰다. **로컬 소스 수정 완료, 15개 파일 변경, 커밋/원격 쓰기/배포 없음.** 설치 receipt와 release 환경의 제한은 아래에 따로 기록한다.

작성 시각: 2026-10-04T10:14:14.582672+00:00

## 기준과 경계

- source root: `/Users/twoimo/.codex/worktrees/review-contract-quality-20261004/tzudong`
- branch: `codex/review-contract-quality-20261004`
- baseline/현재 HEAD: `4295fd54411ac8a4c304dce89efbb6f96e90935c`
- 시작 Git status: clean. 읽기 전용 `git ls-remote origin refs/heads/develop`도 같은 SHA를 반환했다. fetch/reset/stash/clean/cherry-pick/commit/push/merge/PR 댓글을 실행하지 않았다.
- 작업 폴더의 `AGENTS.md`, `docs/agents/verification.md`, `docs/agents/privacy.md`를 읽었다. Vercel 조회·DB 쓰기·보호 브랜치 승격 등 release 동작은 수행하지 않았다.
- [PR3031](https://github.com/twoimo/tzudong/pull/3031) head `cd86c106b468c40e83a2e2edf39b49c3b9529937`과 [PR3032](https://github.com/twoimo/tzudong/pull/3032) head `76afb0634b6710581aa296a9644929313e24b36f`의 본문·파일 diff·리뷰·inline comments를 읽기 전용으로 확인했다.
- 변경은 승인한 15개 파일에만 있다. `scope-and-frozen-readback.json`의 outOfScopeChanges는 빈 배열이다. 증거만 사용자가 지정한 외부 폴더에 썼다.

## 각 PR의 의도와 선택

| 영역 | 현행 baseline | 수정본 / 의도 보존 |
| --- | --- | --- |
| PR3031 영상 ID | extractor에 길이 상한이 없고 route classifier가 없음 | 같은 6..128 허용 문자 토큰을 extractor/classifier에 공유. 긴 토큰의 128자 prefix를 다른 ID로 노출하지 않고 전체 거부. required 400, invalid/not found 404, 실패 500의 기존 고정 응답은 보존. |
| PR3031 반복 계산 | 함수마다 regex 생성, 행 normalize 시 중복 추출, 상세마다 filter | 프로세스 단위 regex, 최대 4,096개/키 최대 2,048자 link cache, 한 번의 normalize 추출, WeakMap 영상 그룹 인덱스와 날짜 decorate-sort를 통합. 행/배열의 in-place 변경 시 인덱스 재생성, 반환 배열 소유권 보존. **매 호출 membership 검사는 남으며 무스캔/속도 배수 주장을 하지 않는다.** |
| PR3031 로그 | 현행 develop의 세 route는 이미 고정 문자열 | PR의 가변 error.name 로그를 옮기지 않고 명시적 `DASHBOARD_SUMMARY_FAILED`, `DASHBOARD_RESTAURANTS_FAILED`, `DASHBOARD_VIDEO_FAILED`만 기록. HTTP 응답의 기존 고정 문자열은 그대로 유지. |
| PR3031 성능 증거 | PR의 두 dashboard benchmark 디렉터리는 현행에 없음 | PR head의 두 디렉터리는 script/benchmark.json만 있고 요구된 frozen-tree/scorer/validator/detached artifact-map package가 없다. 이를 승인 근거로 옮기지 않았고 README·historical benchmark를 추가하거나 수정하지 않았다. 새 성능 승인/배수/시간 절감 주장 없음. |
| PR3032 REST | escaping, public fallback, HEAD count, RPC status/null 성공 fallback은 존재. rows/count/config 메시지는 예전 계약 | 고정 bounded rows/count/rpc failure code, config missing/invalid, count missing으로 정제. non-OK body는 읽지 않고 취소. 네트워크·rows JSON 실패도 고정 코드로 처리. 기존 성공 결과와 announcements/ad_banners 401/403 fallback, RPC의 unreadable-success null 반환은 보존. 기존 실패 테스트 3개를 새 계약으로 갱신. |
| PR3032 singleton | 기존 merge 의미와 iterative union-find, main selection, multi-row 최신 media 정렬은 존재 | 단일 그룹만 직접 projection; name/default/category dedup/media/review_count/row identity/그룹 순서 유지. multi-row 경로와 성능 계측 경계 유지. 정렬 호출 생략을 검증했으며 wall-clock 성능 주장은 없음. |
| PR3032 modal inset | w-full 및 caller max-width override | 기본 너비를 `w-[calc(100vw-2rem)]`로 바꾸고 max-w-lg 유지. PR의 `min(32rem, ...)`를 그대로 쓰면 max-w-2xl caller가 32rem으로 줄어드는 문제를 피함. 넓은 호출부, overlay/닫기/기존 Dialog aria-modal 유지. |

`canonicalizeYoutubeLink`의 비추출 링크 fallback은 그대로다. 이번 shared extractor 상한은 관련 admin identity/conflict와 home-map KPI 소비자 테스트로 함께 확인했다.

## 재현과 검증

| 검증 | 결과 / 증거 |
| --- | --- |
| baseline dashboard 3 suites | 17 pass / 0 fail / 121 assertions. 기존 tests는 overlong ID를 검출하지 못했다. |
| 실제 PR3031 head의 129자 ID | extractor 129자, 요약에 영상 1건, classifier invalid, 상세 404 / loader 호출 0. 요약-상세 불일치 재현. |
| PR3031 head 로그 | 세 route 모두 임의 오류 이름 8,704자를 로그에 포함. candidate는 모두 고정 코드 1개만 남기고 untrustedNameLogged=false. 원문은 보존하지 않음. |
| candidate 129자 ID | extractor null, 요약 영상 0건, classifier invalid, 상세 404 / loader 호출 0. `pr3031-reproduction.json`. |
| PR3032 old-string 재현 | baseline 8 pass. PR REST 구현 + 이전 tests: 5 pass / **3 fail**. 테스트 갱신과 transport 보강 후 worker 관련 50/50. `pr3032-worker.md`. |
| 최종 affected Bun suites | **105 pass / 0 fail / 5,078 assertions**, 15개 suites. |
| 격리된 DB conflict 소비자 suite | **9 pass / 0 fail / 28 assertions**. 모듈 mock 오염을 피하려 별도 실행. |
| 대시보드 baseline 대비 동등성 | **400 cases / 0 mismatches**. 실제 Git baseline을 메모리에서 로드하여 summary/paging/selection 비교. null/empty/invalid/tied dates 포함. timings 아님. `dashboard-equivalence.json`. |
| 모달 실제 렌더 | 설치된 Chrome의 독립 headless context, 실제 React/Radix 컴포넌트+Bun bundle+Tailwind CSS. 폭 320/390/768/1024/1440 × dialog/alert × default/max-w-2xl = candidate **20/20**, baseline 비교 **20/20**. candidate 모두 좌우 최소 16px·기본 최대512px·override 최대672px, overflow 없음. baseline edge-touch 8건 → candidate 0건. 각 case focus/close 확인. pageErrors=0, external requests=0. `modal-render.json` 및 PNG. |
| 변경 15개 파일 ESLint | exit 0, warnings 0. |
| exact native7.0.2/compat6.0.2 parity | exit 0, diagnostics **0**, logical inputs **2379**, logical names/content hashes 일치. 최종 소스에서 재검증. |
| Git whitespace | `git diff --check` exit 0. |
| frozen / 범위 | 기존 performance **2,410개 파일 SHA-256 동일**, 범위 밖 변경 0. |

전체 실행 명령과 exit code, 정제된 수치, 수정 전후 source hash는 `validation.json`에 있다. 최종 검증 중 source hash 변화는 없었다. `source.diff`는 신규 tests 2개를 포함한 검토용 패치이며 index는 stage하지 않았다.

모달 최초 fixture는 inset 범위 외 `aria-modal`까지 일괄 조건으로 검사해 10/20이라고 보고했다. 기록은 `modal-render-initial.json`에 보존했다. 실제 baseline/candidate 비교에서 AlertDialog의 속성 부재가 양쪽 10건씩 동일함을 확인한 뒤 geometry/focus/close 판정과 분리했다. **AlertDialog aria-modal 개선이나 포괄적 접근성 승인으로 보고하지 않는다.** source scope인 inset과 무관한 기존 접근성 상태는 후속 소유자 경계다.

## 환경과 미확인 경계

- Node `/opt/homebrew/opt/node@24/bin/node` **v24.21.0**, Bun **1.4.0**. 기본 PATH Node 26 대신 명시적 Node 24 사용.
- npm 설치 **11.19.0**, repository release authority **11.6.2**와 차이. install/lock/manifest 변경 없음. 정확한 compiler script를 Node로 직접 실행했으며 release-package 검증이라고 주장하지 않는다.
- 작업 폴더의 node_modules는 `/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong/apps/web/node_modules`를 가리키는 새 로컬 링크다. 공유 대상에 쓰기/install을 하지 않았다. Next16.3.5, native7.0.2, compat/API6.0.2 metadata를 확인했다.
- `verify-typescript-toolchain.mjs`는 외부 realpath를 receipt로 허용하지 않아 **TOOLCHAIN_RECEIPT_PATH_INVALID**. 설치 receipt 검증은 실패/미해결이다. 이를 약화하거나 shared node_modules를 바꾸지 않았다. compiler parity 성공과 별개다. release 환경에서 repo pin을 충족하는 자체 dependency tree로 설치 검증을 수행하는 것은 부모 소유다.
- `model-route-metadata.json`: 현재 작업과 PR3032 worker의 고유 session_meta를 ID로 구분하고 각 최신 turn_context 확인. 둘 다 **provider=openai / model=gpt-6-astra / effort=xhigh**. 이는 로컬 세션 메타데이터 근거이며 upstream 실제 serving/hardware는 미확인. provider diagnostics/credential/raw response/PII 원문은 보존하지 않았다.
- 세션 cwd metadata는 179f이지만 source/test 작업은 모든 명령의 cwd/절대 경로를 지정 작업 폴더로 고정했다.
- 기존 REST 단위 테스트의 mock sentinel만 사용했다. env 파일·실서비스 credential·가짜 secrets를 추가해 gate를 통과시키지 않았다. 실제 Supabase/외부 네트워크 호출 및 로그인은 수행하지 않았다.
- hosted/preview/production 동작과 전체 저장소 release CI는 이번 로컬 검증으로 증명하지 않는다.

## 소유 범위 밖 의도

PR3031의 map lookup/marker renderer 부수 변경과 home-map KPI null-input 확장은 직접 소유 범위에 속하지 않아 옮기지 않았다. PR3032의 CategoryFilter 로그 정리 역시 필수 의존성이 아니며 제외했다. ReviewModal, review-save-operation, auth/privacy 구현, marker/map renderer, manifests/locks, admin evaluation/storyboard/Sentry는 변경하지 않았다. dashboard 오류·ID 계약, REST, singleton, inset의 통합에는 이 파일 변경이 필요하지 않다. 따라서 부모가 다른 작업을 통합할 때 해당 PR 나머지 변경을 별도로 판단해야 하며 두 PR 전체 원격 해결/merge 완료를 주장하지 않는다.

## 변경 파일

- `apps/web/app/api/dashboard/restaurants/route.ts`
- `apps/web/app/api/dashboard/summary/route.ts`
- `apps/web/app/api/dashboard/video/[videoId]/route.ts`
- `apps/web/components/ui/alert-dialog.tsx`
- `apps/web/components/ui/dialog.tsx`
- `apps/web/hooks/use-restaurants.tsx`
- `apps/web/lib/dashboard/helpers.ts`
- `apps/web/lib/dashboard/summary.ts`
- `apps/web/lib/supabase-rest-client.ts`
- `apps/web/tests-unit/dashboard-aggregation.test.ts`
- `apps/web/tests-unit/dashboard-route-contract.test.ts` (신규)
- `apps/web/tests-unit/dialog-content-inset.test.ts` (신규)
- `apps/web/tests-unit/supabase-rest-client.test.ts`
- `apps/web/tests-unit/use-restaurants-merge.test.ts`
- `apps/web/tests-unit/youtube-link-helpers.test.ts`

## 인계

구현과 검증은 위 작업 폴더에 미커밋 상태로 남겼다. 부모는 `source.diff`, `scope-and-frozen-readback.json`, `validation.json`과 이 보고서를 검토하고 자신의 commit/push/PR 처리 및 develop→data→main 승격 정책을 적용하면 된다. 외부 operation은 소비하지 않았다.

재현 명령은 `apps/web` cwd에서 `python3 .omx/artifacts/astra-web-contract-modal/validate.py`, Node24로 `.../reproduce.mjs`, `.../verify.mjs`다. 이 디렉터리는 소유 작업 폴더의 ignored local fixture이며 실제 bundle은 그 안에 있다. 증거 폴더의 동명 스크립트는 정제된 소스 snapshot이다. render 재생성은 `bun .../build-baseline.mjs`, `bun build .../entry.jsx --target browser --outdir .../bundle`, Node24 Tailwind CLI로 input.css를 bundle/styles.css로 생성한 후 verify.mjs를 실행한다.
