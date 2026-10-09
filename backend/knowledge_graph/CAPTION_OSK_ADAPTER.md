# 자막 1차 노드의 typed 등록

`caption_osk_adapter.py`는 기존 `YT-tzuyang-Video-*` 9개 노드에 typed video metadata와 source/hash receipt만 덧붙인다. 본문·불확실성·ID·기존 derived-from/summary는 유지한다. 새 주장·식당·menu를 추출하지 않는다. 상태는 pending이고 evidence는 unverified인 untimed 원본 영상 링크다. start=0/end=null은 영상 또는 자막 열람 구간이 아니다. 기존 6-frame 기록도 전체 독립 검증으로 승격하지 않는다.

실제 적용 전 계획은 공식 read_node의 full preimage hash/body와 review JSON·한국어 2 tracks의 subtitle/transcript SHA를 검증한다. plan JSON의 coverage는 별도 membership revision이며 기존 longform frozen inventory/config에 넣지 않는다. root hub의 aggregate coverage와 canonical export도 이 adapter가 바꾸지 않는다. 향후 export 최신화는 별도 root coverage 검토와 승인을 요구한다.

```sh
<existing-osk-python> -B -m backend.knowledge_graph.caption_osk_adapter \
  --vault <authorized-vault> --engine <exact-pinned-engine> \
  --channel-root <canonical-channel-root> \
  --videos-membership <fresh-videos-membership.json> \
  --streams-membership <fresh-streams-membership.json> \
  --output <new-private-plan.json>
```

기본 plan만으로 vault update를 실행하지 않는다. 이번 준비 계획은 실제 API readback을 받아 순수 builder로 생성했으므로 원본 Engine 초기화·로컬 lock 경로 생성도 하지 않았다. 계획 출력은 노드 원문을 포함하므로 repository 밖 private runtime-cache에 보관한다. plan/readback 출력은 exclusive 0600 writer로 생성하고 기존 파일·symlink를 덮어쓰지 않는다. 계획 생성은 실행 허가가 아니다.

적용이 별도로 승인된 후 동일 plan을 사용한다:

```sh
<existing-osk-python> -B -m backend.knowledge_graph.caption_osk_adapter \
  --vault <authorized-vault> --engine <exact-pinned-engine> \
  --channel-root <canonical-channel-root> \
  --plan <reviewed-private-plan.json> --execute --output <new-private-readback.json>
```

publisher 공통 lock에서 9개 source/preimage를 모두 검사하고 각 mutation 직전 다시 확인한다. 공식 update_node의 expect_hash CAS를 사용하고 API ACK 여부와 무관하게 body·ID·path·기존 metadata를 readback한다. ACK 유실 시 재송신하지 않는다. source 또는 수동 편집 변경은 fixed code로 멈춘다. 부분 적용은 multi-node transaction이 아니며 이미 성공한 노드를 rollback하지 않는다. 같은 계획 재개 시 target body·기존 metadata가 정확히 같은 노드만 재사용한다. readback 실패를 원문 provider 오류로 출력하지 않는다.

외부 MCP/직접 파일 편집을 병행하지 않는 single-writer 전제가 그대로다. 본문 CAS는 경로 이동을 원자적으로 fence하지 않으므로 path/ID를 직전·직후 확인해도 외부 path 경합을 완전히 막지는 못한다. 이 한계를 metadata fallback이나 강제 overwrite로 우회하지 않는다.

```sh
OSK_TEST_ENGINE=<exact-pinned-engine> <existing-osk-python> -B -m unittest \
  backend.knowledge_graph.tests.test_caption_osk_adapter
```

실제 public API는 임시 fixture vault에서만 실행한다. 테스트 통과는 공유 vault 등록·운영 viewer·독립 영상 검증 완료를 뜻하지 않는다.
