# B6 backend Node dependency integration

지정 소스: `/Users/twoimo/.codex/worktrees/node-dependency-quality-20261004/tzudong`
baseline: `4295fd54411ac8a4c304dce89efbb6f96e90935c`
branch: `codex/node-dependency-quality-20261004`

Backend의 정확한 Security gate 명령 `npm audit --json --audit-level=moderate`는 exit 0 / 모든 severity 0건이다(`final-audit-moderate.json`). 소스 변경은 아래 12개 파일로 제한했다. 부모 통합용 소스는 검증 후 고정했고 최종 해시는 `backend-source-state.json`에 기록한다.

| PR | actual head | baseline resolved | 선택 |
| --- | --- | --- | --- |
| [3064](https://github.com/twoimo/tzudong/pull/3064) | `966e114336620c71bbe5482c5a88e366f5c5caaa` | 25.8.0 | 25.12.0 채택 |
| [3062](https://github.com/twoimo/tzudong/pull/3062) | `7ce49f47d24842079a88b2954692acc6b0b6d6f4` | 2.18.0 | 2.24.0 채택 |
| [3061](https://github.com/twoimo/tzudong/pull/3061) | `fa568c8ccf04a5e68b153c89033e9b08700f4286` | 16.6.1 | 18.0.3 채택 |
| [2924](https://github.com/twoimo/tzudong/pull/2924) | `40539ca35df591451ee3be8b8456001d72964fcb` | 4.3.2 | 5.4.2 채택 |
| [2902](https://github.com/twoimo/tzudong/pull/2902) | `db118759bc403743d1c0f376fd5d3a8e2bad182b` | 4.3.2 | 별도 재적용 제외; resolved 의도 이미 존재, 2924로 상위 통합 |

PR2902는 baseline manifest가 `^4.2.0`이므로 PR 전체가 이미 반영됐다고 주장하지 않는다. 해당 PR의 backend resolved 변경(4.3.1 → 4.3.2)만 이미 존재하며, manifest floor는 이번 PR2924의 `^5.4.2`로 대체했다. 각 PR의 head/base manifest, actual manifest patch, changed lock nodes는 `pr-*.json`, 최종 선택은 `pr-decisions.json`에 있다. 오래된 PR 트리를 가져오지 않고 현재 baseline에 npm 11.6.2로 재해석했다.

## 보안 근거

기준 audit exit 1: brace-expansion 1.1.18 및 2.1.4. 수정 후 각각 1.1.21 및 2.1.7, audit exit 0 및 모든 severity 0. Manifest overrides/direct brace dependency를 추가하지 않은 기존 semver 범위의 patch 갱신이다.

| 공식 advisory | 해당 1.x / 2.x 최초 patch | 이번 resolved |
| --- | --- | --- |
| [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | 1.1.19 / 2.1.5 | 1.1.21 / 2.1.7 |
| [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | 1.1.21 / 2.1.7 | 1.1.21 / 2.1.7 |
| [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | 1.1.20 / 2.1.6 | 1.1.21 / 2.1.7 |

1.x는 stealth → user-preferences → user-data-dir → rimraf → glob → minimatch 경로, 2.x는 GenAI → google-auth-library → gaxios(직접/ gcp-metadata 경유) → rimraf → glob → minimatch 경로다. 전체 lock path와 공식 응답에서 고른 advisory 필드는 `advisories-and-resolution.json`에 있다.

## 실제 caller 호환성

js-yaml 5.4.2에서 지도 crawler의 default export 사용은 실제 실행 exit 1 (`MAP_MAIN_FAILED`)로 재현됐다. named `load`로 수정했다. transcript의 namespace `load`는 그대로 호환된다. 두 현재 채널 YAML 모두 baseline 4.3.2와 candidate 5.4.2의 JSON SHA-256이 동일하다. [공식 변경 기록](https://github.com/nodeca/js-yaml/blob/5.4.2/CHANGELOG.md)

dotenv 18.0.3 배너는 실제로 stderr에 발생했다. stdout JSON 자체가 오염됐다고 주장하지 않는다. 기존 조용한 실행을 유지하려고 8개 config caller에 `quiet: true`를 명시했다. `dotenv/config`가 설치본에서 호출하는 동일한 `config()`를 명시적으로 호출해 옵션을 전달했다. .env 경로와 override 의미는 보존했다. [공식 변경 기록](https://github.com/motdotla/dotenv/blob/v18.0.3/CHANGELOG.md)

실제 소스/상대 import를 task temp로 복사하고 installed dependencies를 사용했다. 테스트 .env와 빈 fixture만 읽으며, 네트워크/추가 자식프로세스를 차단했다. DB 연결부만 SELECT-only empty double로 대체했다. 5개 CLI JSON 출력, URL extractor JSON 출력, private apply 환경 로더, crawler YAML 로딩, GenAI API shape, 두 minimatch 경로의 valid glob 및 세 advisory payload가 통과했다. 적용 전 baseline caller와 새 dependency를 조합하면 12개 중 9개가 실패하고, 수정 후 12/12 통과하여 회귀 검출력도 확인했다.

## 변경 파일

- `backend/bin/apply_tzuyang_address_evidence_ledger.mjs`
- `backend/bin/build_google_maps_browser_review_queue.mjs`
- `backend/bin/build_supabase_address_consistency_guarded_plan.mjs`
- `backend/bin/build_tzuyang_address_evidence_ledger.mjs`
- `backend/bin/validate_supabase_review_queue_live.mjs`
- `backend/bin/validate_supabase_same_origin_candidates.mjs`
- `backend/package-lock.json`
- `backend/package.json`
- `backend/restaurant-crawling/scripts/03-collect-transcript.js`
- `backend/restaurant-crawling/scripts/05-map-url-crawling.js`
- `backend/restaurant-crawling/scripts/url-extractor.js`
- `backend/bin/tests/node-dependency-compatibility.test.mjs`

package-lock의 resolved version 변경은 총 10개이며, npm 11.6.2가 pg/puppeteer-extra의 peer metadata도 재계산했다. 두 패키지의 버전은 바뀌지 않았다. 변경 전체 필드는 `advisories-and-resolution.json`에 기록했다.

## 검증과 제한

- Node v24.21.0 / npm 11.6.2. PATH는 task runtime/bin 선행, 최종 설치 userconfig는 task runtime/npmrc, npm cache는 task runtime/backend/npm-cache. 공유 node_modules/config는 수정하지 않았다.
- `npm audit --json --audit-level=moderate`: exit 0, 0 vulnerabilities. 이전 high threshold 결과는 `final-audit.json`에 보존. npm ls --all: 0 problems.
- baseline과 candidate 모두 frozen `npm ci --ignore-scripts --no-audit --no-fund --json` 통과, 각각 lock hash 불변. 브라우저/미디어 바이너리 lifecycle 다운로드는 미검증이다.
- 관련 Node tests 88: pass 80 / fail 0 / skip 8. 새 compatibility cases 12/12. Syntax 10/10, diff --check 통과.
- macOS에서 Windows 전용 8개 제외. 기존 한 Windows test의 skip 이후 본문이 실행되는 문제가 관찰됐으나 제외 처리되었으며 해당 fixture 프로세스 종료도 확인했다. dependency 범위 밖이므로 수정하지 않았다.
- backend lint/build/typecheck script와 ESLint 설정은 없다. backend native parity/build를 통과했다고 주장하지 않는다. web build/parity/rendering/Naver SDK 검증은 부모와 B5 소유다.
- 실제 API·DB·전화·원격 쓰기·commit/push/PR/승격/배포 없음. 적용 SQL, layout/reconciliation, auth/privacy, CI, producer/frozen evidence 변경 없음.
- 본인 rollout 파일의 own id `01a1067a-0722-7371-8ad4-d3eee6cfb861`과 native source, openai provider, 최신 gpt-6-astra/xhigh turn_context 확인. 뒤에 삽입된 부모 session_meta id는 별도 표기했다(`session-metadata.json`).

최종 source stability readback: **true**. 12개 파일 aggregate SHA-256: `4c78d5b583f2196cd5cca216cd57be101863b495e19b651a80ba2907af1d8f88`. backend 소스 추가 변경 없이 부모 통합 대기 상태다.

최종 PR/baseline 선택 행렬: [pr-baseline-selection-matrix.md](pr-baseline-selection-matrix.md). PR2902의 web manifest 3개 변경과 web lock baseline 근거는 부모가 별도로 검증하며 이 backend 결론으로 PR 전체를 제외하지 않는다. 이번 moderate threshold 추가 검증 중 소스 수정은 없다.
