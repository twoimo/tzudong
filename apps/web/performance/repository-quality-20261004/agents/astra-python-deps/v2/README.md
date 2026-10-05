# Python dependency quality — subprocess cleanup v2

남아 있던 baseline 실패 3개를 같은 작업 폴더에서 수정했다. 세 기존 검사의 기대값은 그대로이며, 최종 affected-module 실행은 **19개 중 17개 통과, 실패/오류 0, 기존 Windows 전용 skip 2개**다. 추가 회귀 검사 6개도 모두 통과했다. 원격 변경이나 커밋은 하지 않았다.

- 작업 폴더: `/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong`
- branch: `codex/python-dependency-quality-20261004`
- HEAD/baseline: `4295fd54411ac8a4c304dce89efbb6f96e90935c` (유지)
- pinned runtime: task-owned `runtime/pipeline-candidate/bin/python`, CPython **3.12.13**
- v2 소스 변경: `backend/pipeline/nodes.py`, `backend/pipeline/test_nodes_unittest.py`만 추가. v1 requirements 3개는 그대로다.

## 원인 분리와 실제 소유 target 증거

| 분류 | 관찰 및 판정 |
| --- | --- |
| OS | macOS에서 TERM/KILL 뒤 직접 자식인 group leader가 회수되지 않은 `Z` 상태로 남았다. 후손은 사라지고 heartbeat도 멈췄지만 group-empty 확인은 실패했다. Popen을 뒤늦게 wait한 다음에는 그룹이 사라졌다. |
| source | `_ProcessTreeSupervisor.terminate()`가 그룹 종료를 먼저 확인한 뒤 `and _wait_for_process()`로 leader를 회수했다. 따라서 zombie leader가 그룹을 남겨 두면 첫 단계가 실패해 필요한 회수가 늦어졌다. 후속 회수로 실제 정리가 끝나도 이미 설정된 cleanup failure 126은 유지됐다. |
| mock | 정상 TERM 경로에서도 실패했다. 첫 TERM만 실패시키는 mock은 pinned Python full-group helper로, TERM/helper 실패 mock은 SIGKILL로 경로만 바꿨다. mock 자체가 공통 원인은 아니다. |
| fixture | 재현마다 새 session의 parent/child/grandchild 3개 PID를 먼저 등록했다. 모두 `PGID == SID == parent PID`, runner 그룹과 다름을 검증하고 readiness 및 heartbeat 후 종료했다. 준비되지 않은 fixture나 외부 작업을 실패 원인으로 오인하지 않았다. |
| 관측 sandbox | network-denying sandbox에서는 `/bin/ps` 실행이 거부돼 OS 상태를 직접 볼 수 없었다. 별도 socket audit guard 아래 순수 Python fixture를 새로 만들고, 등록한 3개 PID만 지정한 `ps -p ... -o pid=,ppid=,pgid=,stat=`로 확인했다. 같은 원인이 sandbox 밖에서도 재현됐다. 최종 boundary tests는 다시 network-denying sandbox에서 통과했다. |

OS 관측 재현은 아래 target만 사용했다. JSON에는 역할별 PID/PPID/PGID/SID, signal/error enums, 상태와 count만 있다. 프로세스 전체 열람, 명령행·환경 덤프, provider diagnostics, traceback 또는 PII는 v2 자료에 저장하지 않았다. 공유 Docker, 앱, Chrome, ADB의 프로세스를 조회하거나 종료하지 않았다.

| 경로 | baseline PGID / PID 3개 | candidate PGID / PID 3개 | baseline → after |
| --- | --- | --- | --- |
| 정상 TERM | 65152 / 65152, 65154, 65155 | 72407 / 72407, 72430, 72431 | cleanup 126 → timeout 124 |
| 첫 TERM 실패, helper | 65370 / 65370, 65372, 65375 | 72451 / 72451, 72453, 72456 | cleanup 126 → timeout 124 |
| TERM/helper 실패, KILL | 65599 / 65599, 65601, 65604 | 72475 / 72475, 72477, 72478 | cleanup 126 → timeout 124 |

모든 case에서 heartbeat 정지와 최종 group empty를 확인했다. 수정 후에는 group wait 내부에서 leader의 `Z`가 없어지고 cached returncode가 -15 또는 -9로 기록됐다. 측정된 baseline 2.369/2.423/5.346초, candidate 0.312/0.333/0.305초는 case당 단일 진단 실행 시간이며 일반화한 성능 수치가 아니다.

## 최소 수정과 지킨 계약

`_wait_for_posix_process_group()`에 선택적인 소유 `Popen`을 전달해 반복마다 `poll()`로 그 직접 자식만 비차단 회수한다. 정상 supervisor 종료와 supervisor 생성 실패 정리의 두 호출부가 실제 소유한 Popen을 전달한다. 광역 `waitpid(-1/0)`나 별도 helper 파일은 추가하지 않았다.

Popen의 종료가 그룹 전체 종료를 대신하지 않는다. 실제 group-empty 확인, TERM 2초 → KILL 5초, 0.02초 polling, signal/helper 실패 처리, cleanup failure의 fail-closed 의미, timeout/overflow/nonzero 응답 계약은 유지한다. 모델/provider/defaults, stage 환경, reader/output 한도, Windows Job Object 코드는 바뀌지 않았다. 고정 126을 124로 치환한 것이 아니라, 실제 그룹 정리 성공 후 기존 timeout 계약이 반환된다.

정적 AST 비교에서 기존 test 정의 20개(보조 메서드 포함)는 모두 동일하다. production 변경 정의는 group wait/terminate, supervisor terminate, run_command의 호출부 4곳뿐이다. 별도 native Astra Xhigh reviewer도 현재 바이트 diff에 결정적 이슈가 없다고 판정했다. [`structural-scope-check.json`](structural-scope-check.json), [`final-sidecar-review.md`](final-sidecar-review.md) 참조.

## baseline → after 검증

수정 전에 기존 실패를 하나씩 재실행해 각각 1 fail / 0 error를 확인했다. 최종 module 실행에서 정확히 같은 세 ID가 모두 PASS다.

| 기존 실패 | before | after |
| --- | --- | --- |
| `RunCommandBoundaryTests.test_timeout_terminates_descendant_process_tree` | FAIL | PASS |
| `ProcessTreeFallbackTests.test_killpg_failure_uses_full_group_helper_without_descendant_leak` | FAIL | PASS |
| `ProcessTreeFallbackTests.test_tree_helper_term_failure_escalates_to_full_group_kill` | FAIL | PASS |

추가 검사 6개: unreaped leader 제거, leader가 회수돼도 TERM-resistant 후손의 전체 그룹 종료 필요, 그룹 확인 불능이면 계속 실패, 별도 소유 sibling 생존 및 17/23 종료 코드 보존, 모든 signal 실패 시 parent-only fallback 금지, supervisor 생성 실패 시 직접 자식을 회수해도 성공으로 위장하지 않음. 실프로세스 fixture는 직접 생성한 Popen/group에만 finally 정리를 설치했다.

함께 실행한 기존 boundary에는 pinned 실행 파일, stage별 secret/environment 격리(합성 fixture), provider env 재로딩 방지, output overflow 125/캡, 모든 node의 결과 enum 전달과 insert 실패 시 완료 미게시가 포함된다. 최종 실행은 **3.602초, 19 run / 17 pass / 0 fail / 0 error / 2 Windows-only skip**. missing secret로 skip하지 않았고 기존 실패의 기대값·timeout도 완화하지 않았다. native Windows 및 Linux 실행 증거는 없다.

재현 가능한 최종 검사 명령(실제 실행 시 동일 바이트 runner는 task-owned runtime/v2에 있었다):

```sh
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 PYTHON_DOTENV_DISABLED=1 \
  /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  /Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/runtime/pipeline-candidate/bin/python \
  /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-python-deps/v2/run_boundary_tests.py
```

실제 caller는 `nodes.run_command()`이며 실행 payload는 task-owned 합성 Python fixture뿐이다. 유료 API/DB write/진짜 crawler는 실행하지 않았다. JSON runner는 ID·결과 enum·count만 남긴다. [`candidate-final-boundary-tests.json`](candidate-final-boundary-tests.json)이 최종 결과이며, 앞선 18-run 파일은 여섯 번째 회귀 추가 전의 중간 결과다. `reproduce_owned_groups.py`는 현재 source를 진단하며 과거 baseline을 재현했다고 주장하지 않는다. 전달본에는 기존 결과 덮어쓰기 방지 guard만 후첨했다.

## v1 보존, 적용 자료와 부모에게 남기는 항목

- v1의 **25개 파일 SHA-256이 모두 그대로**다. baseline과 dependency candidate가 동일한 3개 실패를 보였다는 v1 README/JSON/patch/index를 수정하지 않았다. v2는 그 이후 별도 소스 수정이다.
- v1 requirements SHA도 그대로다. resolver/pip check/audit, SDK 및 crawler/control 검증은 v1의 시점 증거로 유지하며 v2에서 재실행했다고 하지 않는다. 전체 pipeline suite도 불필요하게 반복하지 않았다.
- [`cleanup-fix.patch`](cleanup-fix.patch)는 **두 추가 파일만** 포함한다. v1 `integration.patch`는 그대로 보존됐다. final source의 총 dirty path는 v1 requirements 3개 + v2 source/test 2개이며, `git diff --check`는 통과했다. 새 helper/lock/CI/web/SQL/layout 변경은 없다.
- owner와 reviewer의 실제 session metadata는 모두 **native openai / gpt-6-astra / xhigh**다. 현재 turn과 일치하는 tool call/result 및 usage record 행도 확인했다. inherited metadata와 독립 provider wire 증거는 구분한다. [`native-execution.json`](native-execution.json) 참조.
- PR3099 head `fd1fbcaaef92786c07f48ee6066aea284dff6041`의 두 대상 파일은 수정 전 baseline과 바이트가 같았고, 그 PR 소스를 가져오거나 바꾸지 않았다. **별도 static integration gap:** PR3099의 nested LAAJ worker가 새 session을 만들므로 outer group empty만으로 nested worker 종료까지 증명할 수 없다. 부모/PR3099 owner가 inherited lock 계약을 보존한 합성 outer-cancellation 검사를 수행해야 한다. 이는 이 작업에서 재현한 leak 또는 완료된 검사라는 뜻이 아니다.
- 커밋/push/PR 종결/merge는 수행하지 않았다. 부모는 두 patch를 최신 통합 head에 직렬 반영하고 변경된 결합 조건에 필요한 검사를 수행해야 한다. 이번 세 cleanup 결함은 로컬 수정·검증 완료이며, native Windows와 PR3099 결합 보장은 별도 남은 검증이다.

[`verification-summary.json`](verification-summary.json), [`final-source-state.json`](final-source-state.json), [`artifact-index.json`](artifact-index.json)에 판정과 경로·hash를 정리했다. 공식 API 근거와 pinned stdlib 관측은 [`sources.md`](sources.md)에 있다.
