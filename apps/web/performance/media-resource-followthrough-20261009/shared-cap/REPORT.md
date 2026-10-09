# Project/context FFmpeg cap 후속 — 2026-10-09

같은 pipeline context의 참여 프로세스가 기존 cap4를 공유하도록 구현했다. process-local Semaphore/CPU limit은 유지했고, 별도의 4개 POSIX flock slot을 실제 native FFmpeg exec에 상속한다. FD lifetime이 lease이며 TTL/PID 소멸로 slot을 돌려주지 않는다. Node parent가 죽어도 native child의 descriptor는 남고, 종료/기존 group cancellation 시 OS가 반환한다. 기대 parent PID는 아직 admission되지 않은 요청의 취소에만 사용하며 lease 회수에는 사용하지 않는다.

소유 변경: resource-budget.mjs, 새 media_lease_exec.py, frame 추출/버전 probe 호출자, chunk ChildSupervisor, 관련 Node/Python 테스트와 MEDIA_RESOURCE_BUDGET.md. 기본 namespace는 Git commondir로 worktree 사이에 공통이다. Git 없는 source distribution은 backend runtime 경로, 명시적인 context는 PIPELINE_MEDIA_RESOURCE_DIR를 사용한다. 동작을 실제 실행한 모든 context는 소유 임시 경로이며 original Git runtime/다른 프로젝트 state는 생성·변경하지 않았다.

최종 actual media 증빙은 **final-exec-errors/**다. source/input/baseline/config/harness/tool instrument SHA를 입력 파일에 저장하고 해당 JSON/SHA 및 directory를 fsync한 뒤 측정을 시작했다. baseline은 3f86d6999d4a6b00e6221510a0728358747fa997의 process-local 구현이며 후보는 소유 diff의 exact source snapshot이다. 기존 F93 영상 첫9초 clip, 두 Node 각각 영상3개×구간4개, JPEG48개다. native tool instrument는 lease descriptor를 실제 FFmpeg child에 전달한다.

| 정확 관측 | Baseline | Candidate |
| --- | ---: | ---: |
| 두 Node 합산 cold command peak | 8 | **4** |
| cold FFmpeg calls | 24 | 24 |
| 각 Node JPEG frames | 48 | 48 |
| restart FFmpeg calls | 0 | 0 |

모든 output manifest/hash가 같다. 입력과 frozen source는 before/after 동일했고 종료 후 소유 work directory 부재를 확인했다. 실제 invalid media 실패 후 own cache가 보존됐고 valid clip 성공 후 own cache만 삭제됐으며 다른 sentinel은 유지됐다. source-validation.json은 최종 runtime source/preflight와 regression source hash를 대조한다.

실제 native4개 실행 중 Node parent SIGKILL 후에도 다섯 번째 요청은 대기했다. native 종료 뒤 admission, 명시적 SIGTERM, exec 실패 후 재시작을 확인했다. probe-saturation-validation.json은 실제 native4개가 slot을 점유할 때 기존5초 probe 제한에서 **FRAME_MEDIA_RESOURCE_BUSY**, release 뒤 같은 설치본 runnable=true를 확인한다. 대기 요청의 Node parent 종료 뒤 tool marker는 끝까지 생기지 않았다. 공유 storage 오류는 별도 FRAME_MEDIA_LEASE_UNAVAILABLE이고 실제 missing/non-executable tool은 exec126으로 기존 fallback을 유지한다.

관련 검증은 Node resource/context6개, frame/receipt/chunk regressions31개, native lease lifecycle1개 통과(38개)와 별도 actual saturation/queued-parent-exit probe다. direct candidate의 ffmpeg-static 미설치와 copied fixture Git baseline 미연결 실패를 보존하고 pinned 원본 dependency를 읽기만 하는 소유 snapshot에서 검증했다. 이후 missing-tool exec를 lease 상태 오류로 분류한 source 결함도 발견·수정했다. lease-error-classification-failure.json을 남기고 최종31개를 다시 통과시켰다. package install/upgrade는 하지 않았다.

여러 중간 source revision의 관측은 별도 폴더로 보존했다. final-exec-errors가 최종 correctness run이며 intermediate/final/final-source/admission-final/verified-final을 성능 표본으로 합치지 않는다. 최초7 paired media 관측의 cold wall 악화·CPU 증가·RSS 및 input-binding 불확실성·성능 admission 보류는 상위 REPORT.md/원자료에 그대로 남아 있다. 새 증빙은 correctness/lifecycle 관측이며 속도 개선·provider 전체 pipeline 성능을 주장하지 않는다.

보장 범위는 새 wrapper를 사용하는 같은 context의 참여 프로세스다. 구버전/비참여 process·다른 user/project·host 전체의 cap4가 아니다. live context/slot 파일을 삭제·rename하면 안 된다. opaque wrappers가 lock FD를 child에 전달하지 않으면 native lifetime 보장을 적용할 수 없다. 실제 확인한 것은 macOS native tool이며 Windows POSIX lease는 구현되지 않아 fail-closed이다. Linux/container 실제 동작·배포·operator 설정·실제 provider/다운로드/유료 추론/queue/vault/DB는 미확인 또는 미실행이다. commit/push는 하지 않았다.
