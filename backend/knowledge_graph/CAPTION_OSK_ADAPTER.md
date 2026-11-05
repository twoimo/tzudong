# 장문 caption-review의 bounded OSK 등록 준비

`caption_osk_adapter.py`는 고정 영상 목록을 실행 허용 목록으로 사용하지 않는다. fresh `videos`·`streams`·`shorts` membership 세 파일을 모두 검증하고, completed `videos + was_live streams - shorts`와 `source/analysis/*/caption-review.json`의 교집합만 안정적인 video ID 순서로 준비한다. `is_live`·`is_upcoming`·`post_live` 또는 완료되지 않은 stream ID는 다른 탭에 중복되어도 제외한다. 2026-10-09 증빙의 1,071편은 당시 입력 결과이며 코드 상수가 아니다.

각 계획은 세 membership 파일의 전체 바이트 SHA-256, 탭별 정규화 ID 집합 SHA-256, eligible 집합 SHA-256, 발견한 모든 review와 subtitle/transcript source binding의 SHA-256을 포함한다. JSON 해석과 SHA-256은 각각 한 번 캡처한 같은 바이트를 사용한다. membership 파일은 root에서 각 경로 요소를 `O_NOFOLLOW` directory descriptor로 순서대로 고정해 읽으므로 `linked/videos.json`처럼 부모 symlink를 통한 외부 입력은 거부한다. macOS의 `/var`·`/tmp`·`/etc`는 실제 대상이 각각 예상한 `/private/...`인 경우에만 해당 canonical system root로 정규화한다. caption 누락은 `eligibleWithoutCaptionCount`에 남고 완료로 계산되지 않는다. 손상된 JSON, 중복 review/video ID, 잘못된 channel/tab, source hash 불일치는 실패한다. Shorts review는 등록 대상이 아니다.

계획의 `--max-videos`는 이번 계획의 새 등록 수를 제한하며 1 이상 10,000 이하의 명시값이 필요하다. 현재 sourceFiles·coverage revision·원본문 hash와 정확히 일치하고 untimed evidence가 해당 video ID의 `startSeconds=0/endSeconds=null`인 v1 receipt만 `alreadyRegisteredCount`로 센다. 과거 pilot receipt의 source/coverage/evidence가 현재 계약과 다르면 본문은 그대로 보존하되 `staleRegisteredCount`로 분리하고 현재 완료로 재사용하지 않는다. 새 관계·식당·메뉴·주장을 만들지 않는다.

```sh
<existing-osk-python> -B -m backend.knowledge_graph.caption_osk_adapter \
  --vault <authorized-vault> --engine <exact-pinned-engine> \
  --channel-root <canonical-channel-root> \
  --videos-membership <fresh-videos-membership.json> \
  --streams-membership <fresh-streams-membership.json> \
  --shorts-membership <fresh-shorts-membership.json> \
  --max-videos <bounded-count> \
  --output <new-private-plan.json>
```

계획은 provider 호출, media 수집, 공유 vault 쓰기를 수행하지 않는다. private plan은 OSK 본문 preimage를 포함하므로 repository 밖에 0600 새 파일로 저장한다. 계획 생성은 실행 승인 또는 claude-video 완료 증거가 아니다.

별도로 승인된 같은 범위의 적용은 계획 hash와 `--max-videos`를 확인하고 외부 checkpoint 디렉터리를 요구한다. 첫 적용은 membership·review·subtitle·transcript의 정확한 바이트를 한 번 캡처해 계획의 coverage/source hash와 대조한 뒤, private checkpoint plan 디렉터리에 hash-bound `source-snapshot.json`으로 먼저 저장한다. 재개는 mutable 원본을 다시 조합하지 않고 이 snapshot을 검증해 사용한다. snapshot 원본 총량은 128 MiB로 제한한다.

```sh
<existing-osk-python> -B -m backend.knowledge_graph.caption_osk_adapter \
  --vault <authorized-vault> --engine <exact-pinned-engine> \
  --channel-root <canonical-channel-root> \
  --videos-membership <same-videos-membership.json> \
  --streams-membership <same-streams-membership.json> \
  --shorts-membership <same-shorts-membership.json> \
  --max-videos <same-bounded-count> \
  --plan <reviewed-private-plan.json> \
  --checkpoint-dir <private-runtime-checkpoints> \
  --execute --output <new-private-readback.json>
```

각 target은 저장된 full body/hash/ID/path/metadata preimage와 `update_node(expect_hash=...)`로 CAS 보호된다. 첫 mutation 전에 아직 완료되지 않은 target 전체를 검사한다. 성공한 영상마다 plan/captured-source/coverage/after hash를 묶은 atomic checkpoint를 readback한다. checkpoint root와 plan directory는 no-follow directory descriptor로 고정하고 snapshot과 checkpoint는 no-overwrite hard-link publish로 생성한다. plan/snapshot/file symlink나 동시 directory 교체는 외부 경로에 쓰지 않고 실패한다. update 뒤 프로세스가 중단되거나 ACK가 유실되면 같은 plan 재개는 snapshot과 target body를 먼저 읽고 update를 다시 보내지 않는다. snapshot/checkpoint 손상이나 사람 편집은 fixed code로 중단한다. multi-node transaction이 아니므로 성공한 영상을 rollback하지 않는다.

mutable source 파일과 별도 OSK 저장소 사이에 원자적 transaction은 없다. 따라서 apply의 정확한 보장은 "snapshot에 캡처된 revision을 등록했다"는 것이다. 캡처 뒤 membership이나 caption source가 바뀌어도 원본을 덮어쓰거나 새 version이라고 주장하지 않는다. readback의 `sourceSnapshot.status`는 `captured`, `currentMutableSourcesCheckedAfterCapture`는 `false`이며 receipt도 later-source currency를 주장하지 않는다. 바뀐 원본으로 새 계획을 만들면 이전 receipt는 `alreadyRegisteredCount`가 아니라 `staleRegisteredCount`로 분류된다.

작업량은 membership/caption 입력 크기를 `N+C`, 선택 target 수를 `K`라 할 때 snapshot 캡처·검증 `O(N+C)`와 graph CAS/readback `O(K)`로 분리된다. target마다 전체 mutable corpus를 다시 스캔하는 `O(K·(N+C))` 경로는 없다. 2-target fake fixture는 첫 apply에서 3개 membership과 영상당 5개 caption input, 총 13개 mutable 파일을 각각 한 번 읽고 13개 manifest SHA-256 binding을 남겼으며, 같은 snapshot 재개에서는 mutable source read가 0임을 검증한다. 이는 deterministic read/hash count와 알고리즘 경계이며 paired wall-clock benchmark나 관측된 속도 향상 주장은 아니다.

등록 후에도 metadata는 `analysisStatus: pending`, evidence는 `status: unverified`, `startSeconds=0/endSeconds=null`인 시간 없는 원본 링크다. receipt는 `independentFullVisualVerified:false`와 `independentAudioVerified:false`를 유지한다. caption 준비·등록은 claude-video 분석, 독립 시청·청취, graph export, Admin materialization, 배포 성공이 아니다.

```sh
python3 -B -m unittest \
  backend.knowledge_graph.tests.test_caption_osk_adapter \
  backend.knowledge_graph.tests.test_caption_title_enrichment
```

기본 테스트는 local fake engine으로 1,071편 synthetic membership, stable selection, 새/변경/중복/누락/손상 caption, same-byte parse/hash, whole-set CAS, update 진입 시 source 변경 뒤 captured-version 표시, immutable snapshot 무결성, 원본 보존, 중단 후 exact resume, update-once, checkpoint 손상과 외부 쓰기 차단을 검증한다. `OSK_TEST_ENGINE`이 있는 title migration 테스트만 disposable vault의 실제 public API를 추가로 사용한다. 어느 테스트도 공유 OSK, provider, YouTube 또는 hosted DB를 쓰지 않는다.

별도 title enrichment apply도 mutation 전에 모든 review/index binding을 한 번 캡처하고 계획과 대조한 뒤 그 captured set만 mutation 동안 유지한다. title readback v2는 captured set SHA-256과 binding/path 수, `status: captured`, `currentMutableSourcesCheckedAfterCapture:false`를 반환한다. review와 index가 update 진입 시 함께 바뀌어도 저장된 title은 검토한 captured version으로만 설명하며 mutable title이 계속 current였다고 주장하지 않는다.
