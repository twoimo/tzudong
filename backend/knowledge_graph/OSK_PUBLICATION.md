# 롱폼 결과의 OSK 반영

`osk_publication.py`는 기존 OSK Python 환경과 고정 engine의 공개 MCP 함수
`overview/read_node/create_node/update_node`를 로컬에서 호출한다. API 키, 영상
다운로드, 모델 호출, 패키지 설치는 없다. 기본은 계획이며 `--execute`만 쓴다.

```sh
<existing-osk-python> -B -m backend.knowledge_graph.osk_publication \
  --inventory <membership-inventory.json> --analysis-state <longform-state> \
  --model <exact-model> --model-evidence <original-model-evidence.json> \
  --timeout <analysis-timeout> --vault <authorized-vault> --engine <pinned-engine> \
  --state-dir <publication-state-outside-vault> --max-videos 1
```

계획을 확인한 뒤 동일 인자에 `--execute`를 추가한다. 완료 영수증, 분석 내용,
입력/config SHA, 정확한 모델과 **원래 모델 증빙 SHA**가 모두 맞아야 한다.
불확실하거나 부분적인 분석은 반영하지 않으며 유료 분석을 재요청하지 않는다.

pilot 제목과 `Tzudong graph metadata` schema를 유지한다. 기존 노드는 근거·주장·
고정 watch commit이 일치할 때 본문을 보존하고 publication 출처만 덧붙인다.
식당 내부 claims는 `TZ-Claim-{videoId}-R{restaurant}-{claim}`으로 추가한다.
모델 관찰은 `unverified`, 영상은 `analysisStatus: pending`이다. publication
checkpoint의 `complete`는 OSK 저장 확인이며 독립 검증 완료를 뜻하지 않는다.

영상별 checkpoint와 vault 공통 publisher 잠금을 사용한다. OSK 자체 잠금과
본문 CAS도 적용한다. 모든 쓰기는 ACK와 무관하게 readback하며, 중단 후 같은
인자로 재실행하면 저장된 노드를 재사용한다. 수동 수정, 다른 scope의 같은 제목,
손상된 checkpoint, 미완료 이전 publication은 자동 덮어쓰지 않는다. 변경된
분석의 노드 수가 줄어드는 경우 자동 삭제하지 않고 검토 코드로 중단한다.

계획은 현재 scope와 선택한 **검증된 분석 결과**의 node/edge/JSON bytes/scope
bytes/hub bytes 상한을 계산한다. 교체·중복 간선을 가산하므로 보수적인 상한이다.
5000 nodes, 20000 edges, 4 MiB projection 등 기존 한도를 넘으면 첫 쓰기 전에
차단한다. 분석 전 영상의 결과 크기는 알 수 없으므로 전체 미래 크기를 추정하지
않는다. 용량에 맞추려고 노드를 자르거나 projection 한도를 변경하지 않는다.

동일 vault에 여러 publisher를 띄워도 잠금은 공유한다. 다른 MCP 클라이언트나
직접 파일 편집도 함께 실행하지 않는 단일 작성자 운영이 전제다. 공식 update
API는 본문 hash CAS만 제공하며 scope/path CAS는 제공하지 않아, 외부 클라이언트가
read와 update 사이에 동일 바이트의 노드를 다른 scope로 옮기는 경쟁은 이 API만으로
원자적으로 막을 수 없다. 일반 본문 수정 경쟁은 CAS로 거부된다.

검증:

```sh
OSK_TEST_ENGINE=<pinned-engine> <existing-osk-python> -B -m unittest \
  backend.knowledge_graph.tests.test_osk_publication
```

모든 쓰기 검증은 subprocess의 임시 vault에서 실제 pinned OSK engine으로 실행한다.
실제 vault 반영, 예약 작업 등록, 배포는 별도 실행 작업이다.
