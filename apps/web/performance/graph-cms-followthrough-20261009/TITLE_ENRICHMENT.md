# 실제 source title enrichment · 구현/격리 검증

기존 readonly 감사의 원시 캡처/결과는 그대로 보존했다. 이 후속 구현은 확인된9개 caption ID-only 표시 결함을 해결하기 위한 **별도 title migration 계약**이다. 공유 vault/canonical export 적용은 helper가 실행하지 않았다.

## 출처와 display 계약

9개 `caption-review.json`의 title은 기존 `source/corpus/video-index.json` 같은 video ID의 title과 정확히 일치했다. source-file 바이트 수·SHA, title UTF-8 바이트 수·SHA는 `title-source-bindings.json`에 있다. 제목을 모델·요약·자체 추론으로 만들거나 번역/가공하지 않았다. raw caption·private plan·node 본문을 repository에 복사하지 않았다.

기존 `tzudong-caption-registration/v1` adapter/decoder/receipt는 변경하지 않았다. 새 producer `backend/knowledge_graph/caption_title_enrichment.py`가 현재 API preimage 뒤에 별도 `## Tzudong caption title enrichment`/`tzudong-caption-title/v1` receipt만 append한다. 기존 metadata, original label, pending, evidence, v1 receipt와 원문은 prefix로 바이트 보존된다. receipt는 정확한 source title, video ID, title/review/index SHA 및 `observation: caption-first-pass`를 바인딩한다.

projector/export/strict reader에 선택적 `displayTitle` + `displayStage: caption-first-pass` 쌍을 전달했다. video에만 허용하며512 Unicode scalar 한도, 빈 문자열·C0/DEL/C1 control·한 필드만 존재하는 경우·임의 completion stage를 거부한다. 레거시 필드/ID fallback은 유효하다. 검색은 source title + original label + summary를 읽는다.

그래프 카드는 source title과 ‘자막 1차 · 미확인’을 별도 줄에 표시한다. 목록/상세와 accessible 이름·tooltip에서도 제목/단계를 구별한다. 전체 제목은 상세와 accessible name에 유지하고 한글/emoji는 Unicode scalar 단위로 줄인다. coverage/analyzedCount를 제목 개수로 변경하지 않았다.

## CAS/preimage 계획: root 검토 후 적용

private plan: `/Users/twoimo/.codex/runtime-cache/tzudong-caption-title-20261009-1791510040932/plan.json`

SHA256: `4aba5bb9c4c257d49b1c37f2a323cdc44b71e52ef91434dbc7f90d99a156f4cb` · 86,787bytes · 0600, 상위 소유 디렉터리0700.

공개 요약 `title-cas-plan-summary.json`에는9개 현재 API hash/id/path, preimage/target body SHA와 source-file binding만 있다. private 본문/제목을 공개 요약에 넣지 않았다. root는 이 SHA와 현재 source/preimage를 검토한 뒤 기존 exact-pinned Engine의 overview/read 경계를 유지하여 `title.apply(engine, canonicalChannelRoot, savedPlan)`을 실행할 수 있다. 결과는 새 private0600 output에 저장하고 공식 API readback 및 canonical export 재물질화/reader 결과를 별도로 확인해야 한다. 이 helper는 apply 또는 canonical export write를 실행하지 않았다.

apply는 whole-set source/preimage 검사 → 각 mutation 직전 재검사 → 공식 update_node expect_hash CAS → ID/path/body/metadata readback을 사용한다. source와 일치하지 않는 fabricated title은 plan hash를 다시 계산해도 거부한다. ACK 유실은 caller의 명시적 readback/재개로 target body가 정확히 같은 노드만 재사용하고 blind resend하지 않는다. 부분 성공은 원자적9노드 transaction이 아니며 자동 rollback하지 않는다.

이것은 v1 등록 완료 뒤 수행하는 명시적 migration이다. 저장된 v1 decoder/plan validation은 그대로 통과한다. title migration 후 과거 v1 apply는 fail-closed하여 enrichment를 덮어쓰지 않는다. 따라서 migration 이전 v1 plan을 새 단계의 재개 plan으로 재사용하지 않고 새 title plan/checkpoint를 사용해야 한다. 계획이 stale하면 강제 overwrite하지 말고 root가 현재 상태를 검토한다.

## 검증 결과

| 검증 | 실제 결과/범위 |
| --- | --- |
| exact-pinned OSK public API, disposable vault | title/v1 관련9개 unittest 통과: 등록→title append→projection/shard, source fence, 전체 CAS fence, ACK 유실 후 재개, idempotency, 원문/v1 metadata 보존, fabricated title/unsafe receipt 거부 |
| 기존 projector/sharder 격리 회귀 |32개 통과. 공유 vault write/모델/다운로드 없음 |
| 웹 unit/source-reader |26개/3files 통과. strict file reader의 optional fields와 title-only search 포함 |
| targeted authored-source ESLint | exit0 |
| npm run typecheck:parity | exit0, diagnostics0 |
| 실제 브라우저 | desktop1440×1000, tablet834×1112, mobile390×844: source title 검색→1개→선택/상세, 목록30, Escape/empty search, 분석0/1,071 유지. pageerror0, 외부0, mutation0 |

브라우저는 current30-node/88-edge 고정 export를 읽은 뒤 검토된 private plan의 title receipt를 projector parser로 해석하여 **private disposable fixture export**에만 붙인 결과다. 실제 readLocalKnowledgeGraph를 사용했고 인증/기타 CMS API만 합성 fixture다. 제목이 공유 vault나 운영 viewer에 반영됐다는 증거가 아니다.

처음 strict reader가 새 필드를 거부한503/브라우저 실패는 `title-enriched-browser-first-failure.json`에 보존했고 strict admission을 수정했다. 이후 실제 file reader regression과 세 폭 브라우저가 통과했다. 기존 raw/실패 assertions를 삭제하거나 성공으로 바꾸지 않았다.

`title-enriched-browser-results.json`의 `initialNodes:39`는 SVG text elements(30개 title +9개 stage)를 세던 기존 측정 이름이다. node 개수로 해석하면 안 된다. 응답총수/목록 및 검색 해제 후30개 node assertion은 통과했다. 이 불일치는 raw를 수정하지 않고 여기 명시했다. 새9개 `title-enriched-*.png`에서 제목/단계와 분석0을 직접 확인했다. 기존9개 ID-only 캡처는 비교 입력으로 남아 있다.

## 종료·경계

소유 fixture14436, dev57354, browser3040 모두 exit0/정리 완료. 첫 실패 runner89124도 exit1 후 finally로 브라우저를 닫았고 이전 fixture7394도 종료했다. 소유 ports20402/20403/20404 listener0. 기존PID57309/19872 유지. 소유 dist는 ignored generated output이며 증빙/commit map에 포함하지 않았다.

compiler가 추가한 tsconfig의 소유2개 include만 제거했고 expected JSON 및 HEAD JSON과 equality를 확인했다(`title-tsconfig-restoration.json`, 원래 SHA776471d5…). CLAUDE.md shared/generated block은 수정·stage하지 않았다. unrelated parent/user source도 보존했다.

남은 단계는 root의 공유 title CAS 적용→readback→canonical export 재물질화→실제 reader/운영 viewer 확인 및 final build/통합 검사다. 원본 제목/1차 검토는 독립 영상·음성 완료 증거가 아니며 모델/queue/운영/commit/push는 변경하지 않았다.
