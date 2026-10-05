# PR3031/3032 계약·품질 후보 — v2

2026-10-04T10:22:56.555489+00:00

사용자의 후속 지시에 따라 **새 dashboard link cache4096과 WeakMap 영상 인덱스를 후보에서 제거했다.** 영상 선택은 매번 단순 `filter`, 날짜 정렬은 baseline의 배열 복사 후 `sort`로 수행한다. v1의 cache/index 후보 채택 결론은 이 v2로 대체한다. **실제 browser flow 성능·메모리 이득은 입증하지 않았으며 새 speedup 또는 메모리 절감 수치를 주장하지 않는다.**

## 기준과 수정 범위

- source root: `/Users/twoimo/.codex/worktrees/review-contract-quality-20261004/tzudong`
- branch: `codex/review-contract-quality-20261004`
- baseline 및 현재 HEAD: `4295fd54411ac8a4c304dce89efbb6f96e90935c`
- 실제 Git 상태와 작업 폴더의 AGENTS/verification 지침을 다시 읽었다. 시작 시 v1의 15개 candidate source hash와 모두 일치했다.
- 이번 후속 변경은 아래 **4개 파일**뿐이다. 다른 작업/다른 worktree의 source에는 쓰지 않았고, 증거만 사용자가 지정한 외부 경로의 새 `v2/`에 저장했다.

| 파일 | v2 변경 |
| --- | --- |
| `apps/web/lib/dashboard/helpers.ts` | videoIdByLink Map, 4096-entry 제한, cache key 길이 제한 및 조회/저장/회전 로직 제거. 고정 regex들을 프로세스 단위로 유지하며 매 호출 직접 추출. |
| `apps/web/lib/dashboard/summary.ts` | VideoRowIndex/WeakMap/bucket/snapshot 및 무효화 로직 제거. selector를 직접 filter로 교체. decorate-sort와 latestUpdatedMs 보조 최적화도 제거하고 baseline의 단순 날짜 비교/sort로 복원. |
| `apps/web/tests-unit/youtube-link-helpers.test.ts` | 존재하지 않는 cache 회전을 전제한 stress 테스트 제거. 반복 호출·6/128/129/4096 경계값 계약은 기존 경계 테스트에서 유지. |
| `apps/web/tests-unit/dashboard-aggregation.test.ts` | 캐시를 전제하던 테스트명을 현재 동작에 맞춤. 배열/링크 편집, 결과 배열 독립 소유, encounter order, ID 상한 검증은 유지. |

`v1-to-v2.diff`는 이번 후속 변경만, `source.diff`는 baseline 대비 후보 전체 패치다. stage/commit/push/merge/PR 댓글/원격 쓰기를 수행하지 않았다. 부모 통합 대기 상태다.

## 보존한 의도와 계약

- 프로세스 단위 regex hoist와 공통 **6..128** 영상 ID 계약을 유지한다. 긴 토큰을 128자로 자르지 않으며, summary/list/detail이 같은 ID 범위를 사용한다.
- normalize 시 영상 ID 추출 1회를 유지한다.
- required 400 / invalid 및 not-found 404 / 실패 500 응답과 고정 dashboard 로그 코드를 유지한다.
- REST의 bounded HTTP/transport/parser/config 오류, 기존 성공·fallback 계약을 유지한다.
- 동등성이 확인된 singleton projection과 caller max-width를 보존한 modal inset 수정을 유지한다.
- REST/hooks/modal/route 등 나머지 **11개 v1 candidate 파일은 byte-for-byte 동일**하다. v1에서 확인한 REST/singleton/모달 결과는 변경 없는 해당 소스에 대한 이전 증거로만 참조한다. 이번에 browser rendering을 새로 실행했다고 보고하지 않는다.
- baseline에 이미 있던 dashboard summary/row TTL cache와 요청별 집계 Map은 이번 제거 대상이 아니다. 새 link cache/영상 인덱스만 제거했으며 기존 운영 동작을 변경하지 않았다.

## 단순 filter/sort의 이론 복잡도

`n`은 입력 행 수, `k`는 선택된 영상의 행 수, `L_i`는 각 행의 링크 길이, `L`은 단일 링크 길이다. 다음은 소스에 대한 통상적 연산 모델이며 실측 시간이 아니다.

| 경로 | 이론 시간 | 추가 메모리/수명 |
| --- | --- | --- |
| 링크 ID 추출 | 고정 5개 패턴과 고정된 128자 토큰 상한에서 O(L) 스캔 모델 | 프로세스 regex 수는 상수. 링크별 결과를 저장하는 새 컨테이너 없음. 추출 결과는 최대 128자. |
| 영상 행 선택 | 매번 O(n + Σ L_i); 링크 길이를 상수로 보면 O(n) | filter 결과 O(k). 영상별 bucket/index/snapshot을 호출 사이에 보유하지 않음. |
| 선택 행 normalize | O(k + 선택 링크 길이 합) 및 필드 투영 | 결과 O(k), 각 행의 ID 추출 1회. |
| 선택 행 날짜 정렬 | 통상적 비교정렬 모델 O(k log k), 배열 복사 O(k) | 명시적 배열 복사 O(k), 런타임 sort 작업 공간은 엔진 구현에 따름. 사전 파싱 timestamp 배열 없음. |
| 목록 행 정렬 | 통상적 비교정렬 모델 O(n log n) | 배열 복사 O(n) 및 엔진 작업 공간. 호출 뒤 보유하는 새 정렬 캐시 없음. |

따라서 영상 상세의 주요 선택/정렬 작업은 통상적 모델에서 **O(n + Σ L_i + k log k)**다. JS 표준은 sort의 특정 알고리즘/복잡도를 보장하지 않는다. 힙/RSS/GC 개선량을 측정하지 않았으며, cache 제거를 browser flow의 성능 승인이나 정량적 메모리 회귀 해소 증거로 취급하지 않는다.

## 새 v2 검사 결과

| 검사 | 결과 |
| --- | --- |
| 변경된 dashboard/helper와 직접 소비자 9개 Bun suites | **54 pass / 0 fail / 668 assertions** |
| 격리된 DB conflict 소비자 suite | **9 pass / 0 fail / 28 assertions** |
| 합계 | **63 pass / 0 fail / 696 assertions** |
| 4개 후속 변경 파일 ESLint | exit 0, warnings 0 |
| exact native7.0.2/compat6.0.2 parity | exit 0, diagnostics **0**, logical inputs **2379**, 양 compiler의 logical input/content hash 일치 |
| baseline 대비 실제 소스 동등성 비교 | **400 cases / 0 mismatches**; summary/paging/selection, null/empty/invalid/tied dates 포함 |
| PR3031 오류/ID 재현 | candidate의 129자 ID는 extractor null / summary 0건 / detail 404 / loader 0회. 세 route의 가변 오류 이름 로그 없음. |
| whitespace | `git diff --check` exit 0 |

정확한 명령, exit code, 정제된 수치 및 소스 해시는 `validation.json`에 있다. 검사 전후 소스 해시가 일치한다. `pr3031-reproduction.json`, `dashboard-equivalence.json` 및 재현 스크립트를 모두 `v2/`에 새로 저장했으며 v1 runner/output을 실행·덮어쓰지 않았다.

## 보존 검증과 환경 제한

- 기존 v1 증거 **32개 파일의 SHA-256 동일**. 원래 REPORT.md, screenshots, source.diff, artifact map, validation 파일을 수정하지 않았다.
- 기존 frozen performance **2,410개 파일 SHA-256 동일**.
- 다른 v1 candidate **11개 파일 SHA-256 동일**, 이번 변경 **4개**. 금지 영역 변경 없음.
- Node24 명시 경로와 공유 node_modules를 읽기 전용으로 재사용했다. install/shared dependency/manifest/lock/env secret 변경 없음.
- v1의 설치 receipt 제한 `TOOLCHAIN_RECEIPT_PATH_INVALID` 및 npm11.19.0/release pin11.6.2 차이는 해결했다고 주장하지 않는다. 같은 실패 gate를 재실행하거나 우회하지 않았다. 이번 compiler parity 통과는 별도 사실이다.
- v1에 저장된 local session metadata의 native Astra Xhigh 확인은 이전 증거이며 이번에 upstream 모델/하드웨어를 새로 확인하지 않았다. 새 서브에이전트를 만들거나 모델을 변경하지 않았다.
- 실제 browser flow의 before/after 시간·메모리 측정, 전체 release CI, hosted/production 검증은 이번 v2에서 수행하지 않았다. 새로운 성능 승인/배수 주장은 없다.

소스는 지정 작업 폴더에 미커밋 상태로 남아 있다. 부모는 이 v2 결과와 `v1-to-v2.diff`를 기준으로 통합하면 된다. 이 작업에서 추가 외부 operation은 소비하지 않았다.
