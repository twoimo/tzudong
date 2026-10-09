# 실제 materialization 기반 그래프 CMS 확인 · 2026-10-09

HEAD3f86d699의 fixed export를 **기존 readLocalKnowledgeGraph**로 읽어 기존 관리자 CMS fixture에 연결했다. 30노드/88연결, eligible1,071/analyzed0, pending1,071/failed0, 자막1차9개를 확인했다. 과거 readonly 감사 이후 root가 실제 등록·export 갱신한 상태다. 과거 보고서는 수정하지 않았다.

## 실제 브라우저 결과

| 조건 | desktop1440×1000 | tablet834×1112 | mobile390×844 |
| --- | --- | --- | --- |
| 실제 reader30노드·88연결 렌더 | 통과 | 통과 | 통과 |
| 헤더 분석0/1,071 | 통과 | 통과 | 통과 |
| ‘원성식당’ 요약 검색→일치1개 | 통과 | 통과 | 통과 |
| 그래프 선택→근거 상세·시각 미검토 | 통과 | 통과 | 통과 |
| 목록30개·대기1,071/실패0 | 통과 | 통과 | 통과 |
| Escape·검색 해제·빈 검색 | 통과 | 통과 | 통과 |
| 검사 시 document/body 가로 넘침 | 없음 | 없음 | 없음 |

소유 headless Chromium의 새 context만 사용했다. pageerror0, 외부 요청0, mutation시도0. 관리자 인증·나머지 데이터는 합성 fixture다. materialization 읽기부터 검색/선택 응답까지 실제 reader를 사용하지만 운영 인증·배포·vault 최신성·독립 영상 검증을 증명하지 않는다. reduced motion 조건이며 세 viewport는 실기기 검증이 아니다. 초기/선택/목록 각3개 총9개 캡처를 보존했다.

## 확인된 구체적인 사용성 결함

초기 그래프의 자막1차9개 모두 ID가 11자로 잘려 보여 영상의 주제/제목을 알아보기 어렵다. `mobile-initial.png`에서 `3Z-ngM3DVi0…`, `F93TnnxCNvY…`처럼 단계 표시마저 잘린다. 현재 `AdminKnowledgeGraphPanel.tsx`의 132×44 카드가 node.label을11자로 자르고, caption adapter가 label을 `videoId · 자막 1차 검토`로 만든 것이 직접 원인이다. 요약 검색은 정상이나 목록도 영상 제목 대신 같은 ID label을 표시한다.

private caption-review의 **title 필드만**9개 읽었다. 실제 제목9개가 존재하고 원성식당 제목과 video-index의 해당 제목이 일치함을 확인했다. review 원문·plan·transcript·title 원문을 repository에 복사하지 않았다. `caption-title-read-summary.json`은 제목 존재 여부와 SHA만 기록한다. export의 KnowledgeNode에는 sourceTitle/displayTitle 필드가 없으므로 UI만 바꿔 실제 제목을 표시할 수 없다. 요약을 실제 제목처럼 추정하거나 기존 분석상태를 덮어쓰지 않았다.

해결 경로는 실제 public title을 검증·bounded하게 typed display metadata에 연결하고, projector/export로 전달한 다음 제목/단계/ID를 구별하여 렌더하는 것이다. 책임 경로는 backend/knowledge_graph/caption_osk_adapter.py, osk_projection.py, apps/web/types/knowledge-graph.ts 및 AdminKnowledgeGraphPanel.tsx다. 공유 vaultwrite/export 재등록은 이번 scope에서 금지되어 제품 소스를 수정하지 않았다. 원본 제목을 신뢰할 수 있는 공개 metadata로 전달할 계약과 root의 후속 등록 단계가 남는다. 기존 node ID/evidence/pending과 분석0을 보존해야 한다.

## 상태의 의미

자막1차9는 분석 완료9가 아니다. 헤더의 분석0/1,071과 별개이고, 선택 상세는 ‘미확인 근거는 독립 검증 중입니다’, 영상 링크 ‘0:00 · 미확인’, 요약 ‘시각 미검토’를 유지한다. 기존 모델 관찰 노드가 있다는 사실도 독립 시각/음성 완료로 승격하지 않았다. caption evidence의 start0/endnull은 전체 재생·검증 구간이 아니다.

browser-results의 `detailDescribesUnverified:false`는 잘못된 단어 ‘미검증’를 검사한 참고 metric이다. 실제 표시는 ‘미확인’이다. acceptance assertions는 `시각 미검토`와 first-pass label을 확인하여 통과했고, raw 결과를 그대로 보존했다. `interpretation.json`에 이 불일치를 명시했다. 실제 미확인 표현을 성공으로 숨긴 수정은 없다.

## 소유·종료와 source 경계

- 소유 fixture는20384, synthetic Supabase20383, 별도 dev20382와 dist `.next-graph-followthrough`를 사용했다. 기존PID57309/19872는 변경하지 않았다.
- unified fixture session44627, dev64202는 SIGINT 후 exit0. 브라우저 runner28393도 exit0이며 finally에서 browser.close 완료. 종료 후 세 소유 port의 listener0을 확인했다.
- 기존 fixture의 `snapshot.nodes`는 현재 shard format에 맞지 않으므로 **새 증빙 폴더의 복사본만** 실제 reader에 연결했다. 운영 API/DB forward·쓰기 분기는 거부한다.
- dev compiler가 추가한 tsconfig의 두 소유dist include만 제거했다. Next 자동 CLAUDE.md 생성 block은 parent가 이미 보던 shared 변경 가능성이 있어 삭제하지 않았으며 root에 알린다. 제품 설정을 강제로 reset하지 않았다.
- queue 재개/모델/유료API/다운로드/운영DB/배포/vaultwrite/commit/push 없음. 앱 전체 재빌드·운영 검증은 하지 않았다.

9캡처와 reader/browser 결과·재구축 scripts는 artifact-map으로 묶는다. 소유 generated dist는 artifact-map이나 commit 입력에 포함하지 않는다. 소스 제목 연결 결함 및 전수/운영 검증은 열린 상태다.


## 후속 구현 분리

이 문서의 readonly 감사와 원시 증거는 당시 상태다. 이후 title 계약 구현·격리 검증·공유 미적용 경계는 [TITLE_ENRICHMENT.md](TITLE_ENRICHMENT.md)에 별도로 기록했다.
