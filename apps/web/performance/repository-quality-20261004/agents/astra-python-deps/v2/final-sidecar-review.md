# v2 최종 read-only diff review

판정: 요청된 범위에서 결정적 이슈 없음. 현재 candidate의 두 파일 diff와 호출부를 정적으로 검토했다. 프로세스 실행·조회·신호 전송, 테스트 재실행, 소스 수정, Git/원격 변경은 수행하지 않았다. 실패 3개 통과와 Z leader 재현은 owner가 보고한 결과이며 이 리뷰의 독립 실행 결과가 아니다.

- 기대 완화 없음: 기존 테스트 클래스/함수 AST는 HEAD와 동일하다. 변경은 `subprocess` import와 POSIX 회귀 클래스 1개/검사 6개 추가뿐이다. 기존 실패 3개 및 Windows 검사에 새 skip이나 완화가 없다.
- 다른 자식 회수 없음: `nodes.py:459–493`은 전달된 소유 `Popen.poll()`만 호출한다. 두 생산 호출부(`785`, `1018`) 모두 해당 command의 Popen을 전달하며 광역 wait/reap를 도입하지 않는다. poll의 종료값으로 그룹 empty 판정을 대체하지 않는다.
- fail-closed 유지: 그룹 확인 불능과 TERM/KILL 실패는 성공으로 바뀌지 않는다. supervisor 시작 실패는 여전히 `SUBPROCESS_CLEANUP_FAILED`다. 종료 상태를 0으로 덮거나 부모만 kill하는 fallback은 추가하지 않았다.
- fixture 정리 범위: 실프로세스 fixture들은 직접 만든 `start_new_session=True` Popen의 PID/group만 대상으로 하고 finally에서 wait한다. 살아 있는 descendant fixture는 leader 회수 후에도 group 정리를 수행한다. sibling fixture는 기록한 두 Popen만 정리한다. 가짜 PGID 123을 쓰는 두 검사는 실제 probe/signal 함수를 mock하므로 그 값으로 OS 신호를 보내지 않는다. 요청 범위에서 unsafe cleanup 변경은 발견하지 못했다.
- 시간/응답 계약 유지: TERM 2초, KILL 5초, poll 간격 0.02초 및 기존 command timeout이 유지된다. 반환 구조, reason/returncode 매핑, output 한도, reader 정리, 모델/provider 환경과 Windows containment 분기는 변경되지 않았다. deadline의 종료 검사 순서 조정에서 계약을 완화하는 변경은 발견하지 못했다.

이 판정은 아래 바이트 snapshot의 좁은 diff에만 적용한다. PR3099 통합 또는 Windows 실환경 통과를 새로 주장하지 않는다. 기존 v1/v2 자료는 보존했다.

| 파일 | 검토 및 저장 직전 재확인 SHA-256 |
| --- | --- |
| `backend/pipeline/nodes.py` | `9d209c3cdaad646689ca4b34827227ecccf4f3ba7e98b22efaae91d459d7f4db` |
| `backend/pipeline/test_nodes_unittest.py` | `3057a8610bbaffdc4ac68673186e87808929c12a88f3f68652197c6cc3e98248` |

기록 시각 UTC: 2026-10-04T10:46:35.106915+00:00
