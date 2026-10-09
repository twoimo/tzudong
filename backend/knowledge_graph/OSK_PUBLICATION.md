# 롱폼 결과의 OSK 반영

`osk_publication.py`는 기존 OSK Python 환경과 고정 engine의 공개 MCP 함수
`overview/read_node/create_node/update_node/move_nodes/move_cluster`를 로컬에서 호출한다. API 키, 영상
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

`--max-videos`는 이번 호출에서 처리할 publication 작업 수를 제한한다. 같은 inventory로
반복 실행할 때 이미 완료된 영상은 분석 source/config, vault·scope binding, checkpoint,
현재 노드 hash·본문·summary·parent·경로와 root 링크를 확인한 뒤 제한 적용 전에 제외한다.
`skippedPublicationComplete`는 이렇게 검증한 제외 수다. 미완료 checkpoint, 변경 입력,
문맥 링크나 sharded 계층 이행은 작업으로 남는다. 사람 수정과 손상 checkpoint는 기존
fail-closed 검사로 중단한다. 완료 여부 판정에는 영상별 노드 point read를 사용하며 전체
scope export·용량 계산은 선택한 작업에서만 수행한다. cap에 도달하면 inventory 검색도
멈추므로 `skippedNotComplete`는 해당 호출에서 검사한 범위의 미완료 분석 수다.

pilot 제목과 `Tzudong graph metadata` schema를 유지한다. 기존 노드는 근거·주장·
고정 watch commit이 일치할 때 본문을 보존하고 publication 출처와 누락된 문맥 연결만 덧붙인다.
식당 내부 claims는 `TZ-Claim-{videoId}-R{restaurant}-{claim}`으로 추가한다.
모델 관찰은 `unverified`, 영상은 `analysisStatus: pending`이다. publication
checkpoint의 `complete`는 OSK 저장 확인이며 독립 검증 완료를 뜻하지 않는다.

publication은 공식 **v4.1.8 runtime Python 54개 전체**의 digest
`790bb32659f203c85613146fb06b8bb10c2ef404d8ec88547aded63e125f8358`만 허용한다.
projection의 4개 read API pin과 달리 MCP·writer뿐 아니라 쓰기 후 recheck/eviction
dependency도 포함한다. 이전 pin은 v4.1.3 당시 engine이며 public 함수 signature가
같아도 전체 digest 차이는 검토 없이 허용하지 않는다. 현재 pin은 공식 tag의 모든
runtime 파일과 바이트 일치 및 임시 vault의 실제 API 저장·재개·CAS·scope·출처
보존 검증을 거쳤다. 기존 원본 vault의 release baseline/보호 상태를 새로 인증하거나
publication 실행을 승인하는 것은 아니다.

공식 최신 v5.0.0은 별도 이행 범위다. [공식 이행 안내](https://github.com/lpaiu-cs/osk-system/blob/v5.0.0/docs/UPGRADING.md)는
`cite_round/read_cited` 도구 변경과 모든 기기의 일치된 업데이트를 요구한다.
이 adapter가 v5를 지원한다고 주장하지 않으며 공유 engine·client 설정을 자동
업데이트하지 않는다. v4.1.8의 exact pin 변경 증빙은
`apps/web/performance/longform-followthrough-20261009/publication-compatibility.md`에 있다.

영상별 checkpoint와 vault 공통 publisher 잠금을 사용한다. OSK 자체 잠금과
본문 CAS도 적용한다. 모든 쓰기는 ACK와 무관하게 readback하며, 중단 후 같은
인자로 재실행하면 저장된 노드를 재사용한다. 수동 수정, 다른 scope의 같은 제목,
손상된 checkpoint, 미완료 이전 publication은 자동 덮어쓰지 않는다. 변경된
분석의 노드 수가 줄어드는 경우 자동 삭제하지 않고 검토 코드로 중단한다.

계획은 현재 scope와 선택한 **검증된 분석 결과**의 node/edge/JSON bytes/scope
bytes/hub bytes 상한을 계산한다. 교체·중복 간선을 가산하므로 보수적인 상한이다.
기본 `--format single`은 기존 5000 nodes, 20000 edges, 4 MiB JSON, 64 MiB source
한도를 유지하며 초과 시 첫 쓰기 전에 차단한다.

큰 범위는 publication과 projection 양쪽에 **명시적으로 `--format sharded`**를
지정한다. source는 파일당 128 KiB 검증을 유지한 채 최대 5000개/64 MiB 페이지를
끝까지 읽는다. 고정 OSK parser·이름/id/scope resolver를 사용하고 본문 대신 identity와
hash를 보유하며, 마지막 source 재판독에서 변경·추가·삭제를 거부한다. 출력은 노드
5000개/간선 20000개/4 MiB 이하의 불변 파일과 schemaVersion 2 manifest로 나뉜다.
manifest는 모든 파일의 SHA/길이/id 범위/정확한 합계를 담고 마지막에 원자 교체된다.
이전 세대 shard는 제거하지 않는다. 웹은 인증 뒤 고정 로컬 경로에서 매번 새 manifest를
읽고 모든 shard를 검증한다. 검색·선택은 전체 범위를 사용하고 현재 노드 페이지의
연결은 별도 edge cursor로 탐색한다. 양쪽 cursor는 revision 및 query에 묶인다.

```sh
<existing-osk-python> -B -m backend.knowledge_graph.osk_projection \
  --vault <authorized-vault> --engine <pinned-engine> \
  --output <web-root>/data/knowledge-graph/tzudong.json --format sharded
```

`--format single`은 기존 노드 이름·본문·root→video 계약을 유지한다.
`--format sharded`는 영상, 식당, 페이지가 필요한 관찰에 실제 하위 폴더와 동명
의미 허브를 만든다. 일반 영상/식당/관찰 노드는 그 모음 안에 보존하며 기존 본문,
이름, ID, typed provenance와 수동 링크를 유지한다. root는 영상별 모음 허브를
가리킨다. OSK는 영상 kind만으로 structural hub가 되지 않으므로 영상에 child
링크만 추가하는 것으로 missing-hub-link를 해결했다고 하지 않는다. 각 허브는
자기 폴더의 노드와 바로 아래 허브를 직접 링크한다. 자식이 128개를 넘으면 순서
있는 관찰/출처 목록 허브로 나누며, root에 모든 claim을 펼치지 않는다.

격리 vault에서 pinned 공개 API와 `python -m osk.cli organization plan --scope
tzudong --preview`로 검증한다. 기존 flat publication은 `move_nodes`(일반 노드)/`move_cluster`(기존 하위 군집)로만 이동하며
pin과 scope topology 판정을 우회하지 않는다. 이동 직전 hash/path 및 이동 후
동일 hash/ID/path를 확인한다. 기존 수동 root 링크를 보존한 migration에는
`branch_bypass`가 남을 수 있다. 이를 없애려고 과거 링크를 삭제하거나 publication
완료를 organization review 완료로 표시하지 않는다. 새 자료의 missing/branch-bypass
0건 사례와 기존 링크를 보존한 migration은 별도 테스트다.

본문은 UTF-8 문자 경계에서 16 KiB 페이지로 나뉜다. 근거는 첫 노드부터 페이지당
16개씩 모두 보존하며 영상 요약의 합쳐진 근거에도 같은 규칙을 적용한다. 별도
`TZ-Source-*` 모음에는 검증된 analysis JSON 전체를 16 KiB 원문 바이트 페이지에
base64로 보존한다. 각 페이지는 byte offset/전체 길이/SHA256을 담는다. modality,
confidence, uncertainty, coverage, 문장과 순서를 그대로 복원할 수 있고 원문이
Markdown registry나 OSK 링크로 실행되지 않는다. 페이지는 추가 주장이나 독립
검증이 아니다. source 파일당 기존 128 KiB와 frontmatter 예약량을 유지한다.
Python label의 Unicode scalar 길이와 웹 판정도 일치시킨다.

sharded `--max-nodes`는 호출당 공개 API mutation 예산(최대 5000)이다. create,
update, move, root-link 갱신을 각각 센다. 남은 작업은 `PUBLICATION_PAGE_COMPLETED`,
`publicationComplete: false`, `remainingNodes`로 보고한다. root 링크만 남으면
`rootLinkPending: true`이며 다음 호출이 마무리한다. 이동 후 본문 갱신 직전에도
예산 1로 멈추고 재개할 수 있다. 모든 노드와 root readback 후에만
`PUBLICATION_COMPLETED`, `publicationComplete: true`가 된다. 단일 포맷은 기존처럼
영상 전체가 `--max-nodes` 이내여야 한다. checkpoint가 1 MiB를 넘으면 노드 상태도
불변 페이지와 계층 manifest로 저장한다(페이지 2000개 항목 이하, index fanout 128,
최대 8단계). 각 페이지를 source/binding SHA·bytes·이름 범위·정확한 합계로 검증한다.
이전 v1 checkpoint는 그대로 읽고, root는 모든 새 페이지 이후에 원자 교체한다.
따라서 정상 큰 결과가 32 MiB 단일 상태 문서 읽기 한도 때문에 재개 불능이 되지 않는다.

## 계층 manifest와 전체 허용 범위

v1 단일 export와 v2 manifest는 계속 읽는다. 작은 기존 v2 export의 바이트는 유지한다.
노드/간선 100만 초과 또는 descriptor 256개 초과 시 schemaVersion 3,
`tzudong-graph-tree/v1`을 사용한다. leaf shard의 5000 nodes/20000 edges 및 4 MiB는
그대로다. index와 root도 4 MiB, fanout 256 이하이며 각 descriptor에 SHA/bytes/
count/firstId/lastId/level을 넣는다. 자식의 정확한 합계와 범위, 동일 scope/revision,
한 단계 낮은 level, 순서와 중복을 검증한 뒤 모두 읽는다. 8단계 index는 정확한
JavaScript 정수 범위 전체를 표현할 수 있다. 총량 표현 경계는 `2^53-1`이며 coverage의
기존 100만 계약과 개별 source/파일/응답 한도를 늘리지 않는다.

상한 증명은 동시에 실현할 수 없는 극단값도 포함하는 보수적인 포괄 상한이다.
예상 데이터량이나 실제 저장 완료를 뜻하지 않는다. 완료 receipt admission은 모든
구간을 다시 검증하므로 restaurant별 menu/claim은 각각 100개 이하이고, 합쳐진
restaurant/summary/global claim은 각각 10000개 이하이다. 일반 노드 상한은 영상당
`1 + 10000 + 10000*200 + 10000 = 2,020,001`이다. summary 근거 최대 100만 개와
나머지 노드당 100개 근거를 16개씩 나누면 추가 근거 페이지는 최대 12,182,499개다.
claim text 2000자, uncertainty 50×2000자, scalar당 UTF-8 최대 4 bytes 및 고정 형식
예약량에 따른 추가 본문 페이지 상한은 50,254,885개다. 완료 evidence 문서 32 MiB
안의 analysis 원문은 최대 2048개 source 페이지다. ordinary node마다 모음 허브 하나,
모든 자식마다 index 하나를 예약하는 더 느슨한 상한까지 포함하면 영상당 132,958,870개,
1069편과 root는 **142,133,032,031개 노드**, 노드당 136개 간선을 예약하면
**19,330,092,356,216개 간선** 이하이다. 둘 다 `2^53-1`보다 작고, leaf당 항목 1개를
가정해도 256^9 범위 안이다. 이는 새 레이아웃의 표기/페이지 용량 증명이다. 기존
수동 노드·링크는 실제 scope preflight에 추가되며 RAM/디스크/실행시간을 보장하지 않는다.

별도의 도달 가능한 입력 검증은 100 restaurants×100 menus와 100 global claims를
담은 약 766 KiB report를 실제 parser와 completed receipt admission에 통과시킨다.
이 한 건은 10,382개 저장 노드를 만들며 같은 크기의 1069편은 root 포함 11,098,359개다.
기존 100만 제한으로는 이 정상 결과를 담지 못한다. 1,000,001 edges의 별도 합성 Python
export→불변 파일→실제 웹 reader와 다단계 index 손상/범위/누락/foreign/cursor 검사는
wire 계약 증빙이다. 실제 1069개 영상의 분석·publication·독립 검증 완료 증빙이 아니다.
실제 결과의 계획과 최종 export/readback은 별도로 필요하다.

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
