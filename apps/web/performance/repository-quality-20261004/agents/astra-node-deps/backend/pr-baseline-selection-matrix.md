# B6 PR baseline 선택 행렬

검토 기준: `4295fd54411ac8a4c304dce89efbb6f96e90935c`. actual PR head/diff를 비교했으며 현재 baseline에 선택한 dependency 의도만 통합했다. 이 행렬은 backend 범위에만 적용한다.

| PR | package | actual head | baseline manifest / resolved | PR target | 최종 manifest / resolved | 선택·근거 |
| --- | --- | --- | --- | --- | --- | --- |
| [3064](https://github.com/twoimo/tzudong/pull/3064) | `puppeteer` | `966e114336620c71bbe5482c5a88e366f5c5caaa` | `^25.8.0` / `25.8.0` | `^25.12.0` | `^25.12.0` / `25.12.0` | 정확한 PR 버전 채택; 실제 caller 호환성 검증 |
| [3062](https://github.com/twoimo/tzudong/pull/3062) | `@google/genai` | `7ce49f47d24842079a88b2954692acc6b0b6d6f4` | `^2.18.0` / `2.18.0` | `^2.24.0` | `^2.24.0` / `2.24.0` | 정확한 PR 버전 채택; 실제 caller 호환성 검증 |
| [3061](https://github.com/twoimo/tzudong/pull/3061) | `dotenv` | `fa568c8ccf04a5e68b153c89033e9b08700f4286` | `^16.6.1` / `16.6.1` | `^18.0.3` | `^18.0.3` / `18.0.3` | 정확한 PR 버전 채택; 실제 caller 호환성 검증 |
| [2924](https://github.com/twoimo/tzudong/pull/2924) | `js-yaml` | `40539ca35df591451ee3be8b8456001d72964fcb` | `^4.2.0` / `4.3.2` | `^5.4.2` | `^5.4.2` / `5.4.2` | 정확한 PR 버전 채택; 실제 caller 호환성 검증 |
| [2902](https://github.com/twoimo/tzudong/pull/2902) | `js-yaml` | `db118759bc403743d1c0f376fd5d3a8e2bad182b` | `^4.2.0` / `4.3.2` | `^4.3.2` | `^5.4.2` / `5.4.2` | backend resolved 4.3.2는 이미 존재; manifest floor ^4.3.2는 미반영이었으나 PR2924의 5.4.2가 대체. 별도 replay 제외. web 3개 manifest 변경은 부모 검증 대상. |

공통 최종 Security gate: `npm audit --json --audit-level=moderate` → **exit 0 / vulnerabilities 0**. 재실행 증거: `final-audit-moderate.json`.

이 추가 확인에서 소스 수정은 없다. manifest·lock·직접 caller·호환성 테스트 12개 파일은 이전 검증 해시와 동일하며 최종 상태는 `backend-source-state.json`에 있다.
