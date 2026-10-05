9개 Python dependency PR의 변경을 지정 fresh develop에서 단일 owner가 requirements 3개에 한 번씩 통합했다. 추가로 실제 resolver 충돌을 없애기 위한 Playwright pin과 실제 caller import 실패를 없애기 위한 tqdm pin을 보완했다. 의존성·SDK 검증은 통과했지만, pipeline의 기존 subprocess 정리 테스트 3건은 baseline과 후보에서 동일하게 실패한다. 따라서 전체 품질 gate 통과, 원격 PR 완료·폐기·병합으로 판정하지 않는다.

- 작업 폴더: `/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong`
- Branch: `codex/python-dependency-quality-20261004`
- 시작·종료 HEAD 및 마지막 원격 develop: `4295fd54411ac8a4c304dce89efbb6f96e90935c`
- 변경 파일: `backend/pipeline/requirements.txt`, `backend/restaurant-crawling/scripts/requirements.txt`, `backend/pipeline-control/requirements.txt`
- 실제 control manifest는 하이픈 경로이고 Python 모듈 경로는 `backend/pipeline_control`이다. layout 변경은 하지 않았다.
- 최초 clean, 최종 tracked 변경은 위 3개뿐, untracked source 0개, `git diff --check` 통과. caller·모델·provider·defaults·응답 계약 변경 0개.
- 소스 owner와 검토 child의 실제 native `openai / gpt-6-astra / xhigh` metadata 및 현재 턴 tool 실행을 [native-execution.json](native-execution.json)에 기록했다. 독립적인 서버 측 모델 attestation은 수집하지 않았다.
- 커밋·push·원격 종결·호스팅 배포·공유 환경 변경은 하지 않았다. 최종 readback에서 PR 9개 모두 open, 최초와 같은 head였다.

| PR | 실제 manifest 변경 | 최초 baseline에 적용됨 | 정확한 판정 |
| --- | --- | --- | --- |
| [3063](https://github.com/twoimo/tzudong/pull/3063) | langchain-core 1.6.0 → 1.6.5 | 아니오 | 로컬 통합·의존성 검증. 부모 promotion 및 기존 pipeline 실패 검토 대기 |
| [3060](https://github.com/twoimo/tzudong/pull/3060) | langgraph 1.2.1 → 1.2.12 | 아니오 | 로컬 통합. crawler와의 실제 동시 설치 충돌도 해결. 부모 promotion 및 기존 pipeline 실패 검토 대기 |
| [2889](https://github.com/twoimo/tzudong/pull/2889) | pydantic 2.13.4 → 2.13.5 | 아니오 | 로컬 통합·의존성 검증. 부모 promotion 및 기존 pipeline 실패 검토 대기 |
| [2971](https://github.com/twoimo/tzudong/pull/2971) | openai 3.3.1 → 3.16.1 | 아니오 | 로컬 통합. 실제 SDK 성공·401·429 및 LangChain caller 검증. 부모 promotion 대기 |
| [2896](https://github.com/twoimo/tzudong/pull/2896) | google-api-python-client 2.196.0 → 2.200.0 | 아니오 | 로컬 통합. 실제 discovery/request 객체로 metadata·2-page 목록 계약 검증. 부모 promotion 대기 |
| [2894](https://github.com/twoimo/tzudong/pull/2894) | curl_cffi 0.15.0 → 0.16.3 | 아니오 | 로컬 통합. 실제 curl request 준비·Scrapling 응답 변환 검증. 부모 promotion 대기 |
| [2888](https://github.com/twoimo/tzudong/pull/2888) | scrapling[fetchers] 0.4.8 → 0.4.15 | 아니오 | Playwright 1.62.0 보완과 함께 로컬 통합. 원 PR 단독은 설치 불가. 부모 promotion 대기 |
| [2850](https://github.com/twoimo/tzudong/pull/2850) | yt-dlp[default] 2026.7.4 → 2026.8.19 | 아니오 | 로컬 통합. 실제 CLI parser 및 Chrome impersonation 표 계약 검증. 부모 promotion 대기 |
| [2906](https://github.com/twoimo/tzudong/pull/2906) | psycopg2-binary 2.9.11 → 2.9.13 | 아니오 | control의 1줄 의도만 로컬 통합. 실제 native driver·Json·pool 검증. 부모 promotion 대기 |

이미 적용되어 제외한 PR 0개, surviving 업데이트 9개, 폐기·종결한 PR 0개다. PR 제목을 판정 근거로 삼지 않았다. 모든 exact head SHA, 해당 head의 manifest blob/content, 실제 diff, baseline content는 [pr-inputs.json](pr-inputs.json), 구조화된 판정은 [pr-decisions.json](pr-decisions.json)에 있다.

# 확인된 충돌과 보완

1. PR 변경만 합친 crawler는 `scrapling[fetchers]==0.4.15`의 `playwright>=1.62.0` 요구와 기존 `playwright==1.59.0` 때문에 resolver exit 1이었다. 공식 PyPI metadata의 최소 버전 `playwright==1.62.0`으로 맞춘 뒤 설치·pip check를 통과했다. Playwright의 기존 CDP/Chrome launch/upload 호출 signature를 검증했고 실제 브라우저는 시작하지 않았다.
2. pristine baseline의 `03-1-generate-transcript-context.py:27`은 선언되지 않은 tqdm import 때문에 테스트 수집 전에 실패했다. `tqdm==4.70.1`을 직접 requirement에 추가했다. baseline 비교를 위해 baseline 전용 환경에만 같은 prerequisite을 설치했으며, 이 보완 전 실패와 보완 후 7개 통과를 구분해 보존했다.
3. 세 baseline manifest의 동시 resolver는 `langchain==1.3.9`가 요구하는 `langgraph>=1.2.4`와 pipeline의 `1.2.1` 충돌로 exit 1이었다. 요청된 `1.2.12` 적용 후 동시 resolver·설치·pip check가 통과했다.
4. crawler 단독 현재 해석은 `langchain-core==1.6.6`, 통합 환경은 pipeline의 `1.6.5`다. 두 환경에서 실제 caller를 검증했다. 소스에 1.6.6 pin을 추가하지 않았다.
5. #2906의 오래된 전체 tree는 가져오지 않았다. 해당 head의 web에는 Next 16.2.12 등이 있었고 baseline은 16.3.5였다. control pin만 이식했음을 최종 diff와 [제외한 tree 차이](pr2906-excluded-tree-differences.json)로 확인할 수 있다. 이 비교 자체를 별도의 web 취약점 audit 결과로 해석하지 않는다.

변경 이유·공식 version metadata는 [compatibility-findings.json](compatibility-findings.json), [pypi-metadata.json](pypi-metadata.json), [sources.md](sources.md)에 있다. caller 실패에 따른 소스 수정은 필요하지 않았다.

# 검증 결과와 한계

Runtime은 현재 control Dockerfile·daily crawler의 Python 3.12 계열에 맞춘 **3.12.13/macOS arm64**, 보안 CI 방식은 `.github/workflows/security-audit.yml`의 **Python 3.11.17/pip-audit 2.10.1**을 사용했다. 모든 설치·캐시·임시 파일은 `/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/runtime/` 안의 task 전용 경로에 있다. backend/test-requirements.txt의 기존 test pin을 사용했다. CI 또는 공유 환경을 수정하지 않았다.

| 검사 | baseline | 최종 후보 |
| --- | --- | --- |
| 개별 component resolver/install/pip check | 3개 통과 | 3개 통과 |
| 3개 manifest 동시 resolver | LangGraph pin 충돌 | 통과, 동시 설치·pip check 통과 |
| CI 방식 strict audit, 실제 manifest에서 pip resolve | 별도 runtime snapshot audit 모두 0건 | pipeline 37, crawler 122, control 16 packages: 취약점 0, collection 실패·skip 0 |
| 통합 runtime 해석 결과 audit | 동시 설치 불가 | 130 packages: 취약점 0, skip 0 |
| 기존 pipeline 선택 검사 | 54 실행: 48 통과, 3 실패, 3 skip | 동일 |
| 기존 crawler 선택 검사 | 24 통과 + tqdm 누락으로 transcript import 실패; prerequisite 보완 후 7 추가 통과 | 31 통과 |
| 기존 control 선택 검사 | 21 통과 | 21 통과 |
| 실제 SDK 보완 계약 검사 | 18 통과, crawler는 위 prerequisite 보완 상태 | 18 통과 |
| 통합 환경의 crawler SDK·transcript 검사 | baseline 동시 설치 불가 | 21 통과 |

기존 검사 최종 합계는 106 실행/100 통과/3 실패/3 skip이다. component SDK 검사는 별도 18개다. 통합 환경의 21회 실행은 다른 의존성 조합 확인이며 새로운 unique test 21개라는 의미가 아니다. audit의 Python/해석 방식에 따른 package count 차이를 PR 개수나 취약점 감소로 환산하지 않았다. baseline audit도 0건이므로 보안 취약점 감소를 주장하지 않는다.

실제 SDK 검사는 OpenAI의 HTTP 전송만 fixture로 바꾸고 성공·401 latch·429 non-latch를 검증했다. LangChain 실제 model 생성·chain·prompt YAML·Document JSONL, Google 실제 discovery와 pagination, Scrapling 실제 Fetcher/response 변환, curl native dispatch 직전 준비, Playwright 실제 signature, yt-dlp 실제 parser/impersonation, psycopg2 실제 Json/ThreadedConnectionPool을 사용했다. DB 연결만 가짜 connection으로 대체했다. pipeline에는 현재 production LangGraph 호출이 없어 StateGraph 검사는 실제 PipelineState reducer를 이용한 **보충 검사**이지 production graph 실행 증거가 아니다.

테스트 실행 전체에 macOS `sandbox-exec -p '(version 1)(allow default)(deny network*)'`를 적용했다. dotenv 비활성화와 정제한 자식 환경을 사용했고 paid API·DB write·실제 crawler·브라우저를 실행하지 않았다. package 설치 및 공개 advisory 조회만 네트워크를 사용했다. 원문 출력은 저장하지 않고 test ID·개수·bounded error 위치만 [test-results.json](test-results.json)에 보존했다. 최초 보충 harness의 모듈 격리 오류는 수정 후 해당 crawler 검사만 재실행했고 production 실패로 집계하지 않았다.

남은 3개 실패는 `backend.pipeline.test_nodes_unittest`의 다음 케이스다.

- `RunCommandBoundaryTests.test_timeout_terminates_descendant_process_tree`
- `ProcessTreeFallbackTests.test_killpg_failure_uses_full_group_helper_without_descendant_leak`
- `ProcessTreeFallbackTests.test_tree_helper_term_failure_escalates_to_full_group_kill`

직접 재현한 첫 케이스는 기대 `SUBPROCESS_TIMEOUT` 대신 `SUBPROCESS_CLEANUP_FAILED`를 반환했다. baseline·후보 failure ID가 동일하고 process source는 변경하지 않았다. 관찰 경로는 `nodes.py`의 process-group empty 확인/정리 결과 처리이며, underlying OS/process 원인은 분리 확정하지 않았다. 부모가 이 기존 실패를 별도 조사해야 하며, 이를 의존성 회귀로 숨기거나 통과로 바꾸지 않았다. skip 3건은 Windows 전용 2건과 이 clean checkout에 없는 reconciliation evidence 1건이다. reconciliation 파일을 만들거나 바꾸지 않았다.

macOS 오프라인 결과는 Linux 실제 runtime, live browser, 서비스 인증, 네트워크 extractor, PostgreSQL transaction/CAS, 배포 성공을 증명하지 않는다. 운영 shell의 home-local yt-dlp 우선 선택도 변경하지 않았으므로 준비된 venv 결과를 배포된 실행파일 증거로 취급하지 않는다.

# 재현 및 부모 인계

선택한 기존 test target과 개별 결과는 `test-results.json`에 모두 있다. 동일 dependency 환경을 사용한 예시는 다음과 같다. 반복 실행은 변경·실패 조사에 필요한 선택 검사만 한다.

```sh
cd /Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong
TASK_RUN=/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/runtime
TASK_EVIDENCE=/Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-python-deps
# Same pinned runtime and actual installed-SDK harness. No network permitted.
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 PYTHON_DOTENV_DISABLED=1 \
  sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  "$TASK_RUN/combined-final/bin/python" "$TASK_EVIDENCE/offline_unittest.py" \
  "$TASK_EVIDENCE/offline_sdk_contracts.py::CrawlerContracts"
# Exact CI audit approach against a final manifest; public advisory network required.
"$TASK_RUN/audit-tools/bin/python" -m pip_audit \
  -r backend/restaurant-crawling/scripts/requirements.txt --strict
```

[verification.json](verification.json)에는 resolver/install/pip check/audit 명령·exit code·관찰 원인이, [installed-versions.json](installed-versions.json)에는 실제 설치 버전이 있다. `*-resolved.txt`는 task date의 재현용 dependency snapshots이며 project lockfile 변경이 아니다. [integration.patch](integration.patch)는 위 requirements 3개만 포함하며 SHA-256은 `51b571918187fe318f6244cd503079fb3de46195b4b53eb690c7d9c3b98eb0af`다. 파일별 baseline→after 내용·SHA 및 최종 변경 경계는 [final-source-state.json](final-source-state.json), 최종 원격 확인은 [remote-readback.json](remote-readback.json)에 있다.

부모의 남은 작업: 3개 파일 diff 검토, 기존 process cleanup 실패 별도 처리/정확한 gate 판정, 승인된 source promotion 절차에 따른 commit·push·PR 통합, 그 이후 9개 원격 PR의 처리 판정이다. 이 작업 결과만으로 PR을 완료·폐기하지 않는다.
