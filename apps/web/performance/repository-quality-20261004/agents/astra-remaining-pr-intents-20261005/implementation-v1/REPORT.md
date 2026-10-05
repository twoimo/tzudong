# #3032 두 hook 의도 구현 인계

**요청한 두 의도만 구현했으며 focused unit 9 pass / 0 fail (154 assertions)이다.** source 통합 후 필수 parity/lint는 부모 검증으로 남긴다. commit/push/PR 종료는 수행하지 않았다.

- Managed candidate: `/Users/twoimo/.codex/worktrees/astra-3032-hook-intents-20261005/tzudong`
- 기준 및 현재 HEAD: `93fa1131595508b5b324a88101bbdaf1b0e77b03` (detached, source commit 없음)
- 세션 metadata: `openai / gpt-6-astra / xhigh` 유지.
- 앱 `list_artifacts`에서 기존 운영 worktree들을 확인한 뒤 이 작업의 전용 candidate를 `create_worktree`로 생성했고, 반환 workspace를 사용했다. origin/develop 로컬 참조도 생성 시 지정 SHA와 같았다. mutable nightly HEAD는 기준으로 사용하지 않았다.

| 변경 파일 | 변경 | 내용 |
| --- | --- | --- |
| [use-restaurants.tsx](/Users/twoimo/.codex/worktrees/astra-3032-hook-intents-20261005/tzudong/apps/web/hooks/use-restaurants.tsx:697) | +14 / -10 | 해외 keyword sanitizer·빈 term 제외, 국가 filter 결과 1회 재사용 |
| [use-restaurants-merge.test.ts](/Users/twoimo/.codex/worktrees/astra-3032-hook-intents-20261005/tzudong/apps/web/tests-unit/use-restaurants-merge.test.ts:171) | +169 / -0 | 기존 hook unit에 실제 initializer/callback을 격리 실행하는 5개 테스트 추가 |

전체 diff는 candidate의 `git diff -- apps/web/hooks/use-restaurants.tsx apps/web/tests-unit/use-restaurants-merge.test.ts`로 확인할 수 있다. 파일별 기준/결과 SHA-256 및 semantic matrix는 [implementation.json](./implementation.json)에 있다. source diff 원문·commit 메시지·작성자 정보는 evidence에 저장하지 않았다.

**의미와 경계 검증**

구현 전에 initializer의 normalization/query key, queryFn의 query 배열·분기·merge 흐름, 실제 해외 config 12개 및 기존 sanitizer/country builder를 읽었다. 기존 sanitizer의 `%`/`_` escape와 괄호·comma 제거/trim을 그대로 연결했다. helper나 dataset은 수정하지 않았다.

| 범위 | 확인 결과 |
| --- | --- |
| 현재 해외 지역 12개 | 완전한 query 배열이 기존 keyword 순서와 동일. 중복 keyword도 유지. 현재 dataset의 대상 선택 predicate는 변하지 않는다. |
| query initializer | callback 실행 전 transport와 국가 helper 호출 없음. rounded query key, normalized category, compact/source projection, enabled flag 보존. |
| query 조건·순서 | approved status, approved_name.asc, source_type 포함 projection, 실제 원본 bounds, categories/minReviews 및 OR 삽입 위치 유지. |
| 반환 대상 ID | 격리 transport fixture의 두 ID와 순서 유지. 실제 hosted DB 대상 ID를 읽거나 검증한 것은 아니다. |
| 정제 경계 | 특수문자·공백·괄호/comma keyword를 정제하고 빈 term 제외. 전체 빈 목록에서 빈 OR나 뜻밖의 국가 fallback 없음. |
| 국가 8개 | 실제 callback에서 builder 1회씩 관찰, helper의 결과를 그대로 OR에 사용. 실패한 변경 전 테스트에서는 첫 국가에서 2회가 관찰됨. |
| 국내·미지·빈 지역 | 울릉도/욕지도, 국내 지역·미지 값·공백·구분자 8개 fixture의 기존 fallback 의미 유지. |
| source 보존 | 선택한 region 분기 밖 hook 텍스트가 기준 HEAD와 동일. REST/singleton/dialog, 정렬/미디어/리뷰/KPI 처리 코드는 변경하지 않음. |

**테스트 실행과 한계**

새 회귀 테스트를 기준 hook에 먼저 실행했을 때 2 pass / 3 fail이었다. 세 실패는 keyword 정제 연결, 전체 빈 term 제외, 국가 builder 중복 호출이라는 실제 미충족과 각각 일치했다. 구현 후 신규 hook 5개와 기존 overseas helper 4개가 모두 통과했다. 16개 다른 테스트는 이름 필터로 제외해 큰 merge fixture를 실행하지 않았다. `git diff --check`도 성공했다.

새 worktree에는 node_modules가 없어 초기 runner 준비에서 TypeScript import가 실패했다. 이는 행동 회귀 결과와 분리해 [runner-bootstrap.json](./runner-bootstrap.json)에 기록했다. 설치나 symlink 없이 [focused-unit.tsconfig.json](./focused-unit.tsconfig.json)이 기존 marker workspace의 고정 TypeScript 6.0.2만 참조하도록 했고 자동 설치를 비활성화했다. 실제 소스는 candidate에서 읽었다. Bun은 이 외부 config에 대해 `directory mismatch` 진단을 출력했지만 9개 테스트를 실행하고 exit 0으로 종료했다. 해당 진단을 숨기거나 full parity 성공으로 간주하지 않는다. 부모의 통합 환경에서 아래 표준 focused 명령을 사용할 수 있다.

[변경 전 결과](./focused-unit-before.json) · [변경 후 결과](./focused-unit-after.json)

**성능 해석**

이 작업은 성능 benchmark가 아니다. 해외 branch의 keyword 순회 K와 기존 조건 배열 구조는 유지하며, 각 문자열에 기존 정제가 추가되어 총 문자 수 L에 대한 O(L) 작업이 생긴다. 빈 term은 3개 조건 문자열 생성을 건너뛴다. 성공 국가 branch에서는 builder 내부의 config/term 순회 및 임시 배열 구성 한 벌을 소스상 중복 실행하지 않는다. R개 config와 T개 term에 대한 O(R+T) 점근 복잡도는 같다. 이는 이론적 흐름·할당 경로 설명이며 실제 allocation/CPU/메모리/지연·요청수 절감 주장이 아니다. 테스트의 helper 호출 count는 네트워크 요청 count가 아니다.

**부모의 통합 후 남은 검증**

아래는 준비한 명령이며 이 candidate에서 실행하지 않았다. 통합 workspace의 `apps/web`에서 프로젝트의 고정 Node/npm/dependency를 사용한다.

```text
node scripts/run-web-tool.mjs eslint hooks/use-restaurants.tsx tests-unit/use-restaurants-merge.test.ts --max-warnings=0
npm run typecheck:parity
bun test --no-install tests-unit/use-restaurants-merge.test.ts tests-unit/overseas-region-filter.test.ts -t "useRestaurants region queries|overseas country PostgREST filter" --timeout 10000
```

후속 build/browser/실제 데이터·성능 검증은 이번 범위에서 실행하지 않았다. parent가 source를 통합하기 전 이 candidate는 배포·main 반영된 상태가 아니다. #3031의 WeakMap/로그와 광범위 최적화는 복원하지 않았다.

`original179f`와 부모 `nightly-quality` checkout에는 쓰지 않았다. 기존 상위 `REPORT.md`와 `intent-matrix.json`은 SHA-256 readback으로 그대로임을 확인했고, evidence는 새 `implementation-v1/` 안에만 작성했다.
