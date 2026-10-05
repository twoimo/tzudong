독립 검증 최종 결과: **PASS** — 2026-10-05T06:25:14.259807+09:00

issue #2843의 로컬 Nightly 복구를 근거로 **운영자가 수동 종료할 기술적 증거는 충분합니다**. 이번 실행은 `workflow_dispatch`이므로, 기존 `schedule` 전용 자동 종료 경로가 실행됐다는 증거는 아닙니다. 이슈는 현재 `open`이고 이 세션은 종료·댓글·원격 변경을 하지 않았습니다.

[GitHub run 37233565208](https://github.com/twoimo/tzudong/actions/runs/37233565208) · [실제 prerelease](https://github.com/twoimo/tzudong/releases/tag/v1.2.4-nightly.37233565208.gb90154e22e6b) · [issue #2843](https://github.com/twoimo/tzudong/issues/2843)

| 검증 대상 | 확인 결과 |
| --- | --- |
| 현재 protected main / run HEAD / release tag | `b90154e22e6b4ba089275c7ae6d53e7274feae98` 일치 |
| GitHub main source tree | `84d8f211d372fab619f344152dc4405e8c37dc82` |
| 처음 확인한 지정 checkout | `2f9460ab93de8705237e68480793578c096b3619`, clean, 위 main과 전체 tree 동일 |
| 정책 소스 | workflow 2개, publication builder/verifier, allowlist, 요청한 지침 3개의 현재 main 바이트를 API로 읽어 일치 확인 |
| canonical run | `.github/workflows/nightly-local-regression.yml`, attempt 1, Local·Publish 성공 |
| 실제 lane/cleanup 증거 | unit, E2E, outcome aggregation, typegen, publication boundary, cleanup 단계 성공. 소스상 aggregation이 양 lane의 실제 outcome을 검사하고 cleanup 실패는 별도 실패 단계로 전파 |
| 다운로드 범위 | allowlisted publication artifact 하나와 정확히 같은 9개 prerelease 자산. diagnostics artifact·raw log 다운로드 없음 |
| artifact ZIP | ID `11315017178`, 16,589 bytes, GitHub SHA-256과 직접 계산한 값 일치 |
| ZIP 파일 경계 | 정확한 flat allowlist 9개, 중복·경로 이탈·symlink·암호화 없음, 크기/JSON schema/credential boundary 확인 |
| prerelease 자산 | 9/9 파일이 artifact 내부 파일과 바이트 동일; 9/9 개별 GitHub digest 일치; 마지막 API 재확인에서도 불변 |
| 내부 verifier 직접 실행 | 수정 없는 현재 main 소스로 artifact exit 0, prerelease exit 0 |
| 음성 대조 | 잘못된 `GITHUB_SHA` 입력은 exit 1, `local migration publication commit binding mismatch`로 거부 |
| 내용 검증 | migration ledger 100개, closure function 365개, closure 후보 RPC 48/48 통과, 일반 RPC 4개 통과·실패 0 |
| browser 증거 | 요청 telemetry group 27개, bounded record 128개, request 403개. 이를 전체 Playwright 테스트 개수로 해석하지 않음 |

ZIP SHA-256:

```text
70ee298dece546c6dcc493434c4a14ca39d061cd81429d4c77118f07520368b1
```

검증 중 지정 checkout은 다른 작업에 의해 `32f5336…`와 최종 `79922b3b9cd4941d3b85dbb732fdfbbfb11ed810`로 변경됐습니다. 기존 checkout을 수정하거나 복구하지 않았습니다. 최종 실행은 로컬 Git의 정확한 main 객체에서 필요한 소스 121개, 2,940,361 bytes를 허용 디렉터리에 새로 고정하여 수행했습니다. 원본 바이트와 Git blob 해시를 기록했고, 고정 소스는 읽기 전용이며 실행 후에도 동일합니다. 임시 SQL 생성은 이 디렉터리 안에서만 수행됐고 임시 디렉터리는 비어 있습니다. 원래 179f의 HEAD·clean 상태는 전후 동일합니다.

최초 중단 원인도 덮어쓰지 않고 보존했습니다. `readback.json`은 checkout 전제 변경, `attempt-02/readback.json`은 artifact API의 HTTP 415 media-type 오류, `attempt-03/readback.json`은 과도한 모든 쓰기 차단으로 임시 SQL 생성이 막힌 결과입니다. 최종 결과는 **`verification.json`과 `frozen-verification/verifier-results.json`**입니다. 검증 코드나 증거 payload를 완화·수정하지 않고 실행 환경을 허용 범위로 바로잡아 통과했습니다.

자동 종료 정책 근거는 현재 main의 `.github/workflows/nightly-local-regression.yml:1991`과 `:2015`입니다. `schedule` 이벤트에서 job, suite all, unit, E2E, cleanup 성공을 모두 요구합니다. 이번 수동 all run은 기술적 복구를 뒷받침하지만 scheduled 자동 종료 eligibility는 false입니다. 기존 운영 문서의 `nightly-local-<run-id>-<attempt>` 태그 예시는 실제 workflow와 달라 실제 태그를 사용했습니다.

확인 범위는 GitHub publication 경계와 그 소스 결합입니다. private runtime 원문·사용자행·환경·body는 저장하지 않았고 공개된 count/digest만 검증했습니다. 공개 번들에는 unit 총 통과 수가 없으며, 로컬 Python 3.14.8에서 publication verifier를 실행했을 뿐 CI의 전체 application/unit/E2E stack을 다시 실행한 것은 아닙니다. hosted DB나 production 배포 성공은 이 검증으로 주장하지 않습니다. release는 `immutable=false`이므로 결과는 위 readback 시점의 내용에 대한 것입니다.

최소 evidence 경로:

- [최종 판정과 source/policy/ZIP/asset digest](./verification.json)
- [내부 verifier 2회 통과와 잘못된 SHA 거부](./frozen-verification/verifier-results.json)
- [직접 검증한 allowlisted ZIP](./attempt-03/publication-artifact.zip)
- [고정한 main 소스의 파일별 해시](./frozen-verification/source-materialization.json)

이 세션의 파일 쓰기는 요청한 새 디렉터리 아래로 한정했습니다. 원래 179f·지정 source checkout의 수정, commit, push, remote mutation, issue closure는 수행하지 않았습니다.
