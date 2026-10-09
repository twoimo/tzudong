# v8 이후 추가 상태

branch는 codex/user-readiness-20261009, PR3147이다. `5a03cbfd2a8d35b6510f3e8d5fe6311c8027838f`로181개 증거·local verifier 변경을 푸시했고181개 원격 blob이 모두 바이트 일치했다. `census-field-remote-readback-v1.json`. runtime source 검증의 기준 f8e와 새 evidence HEAD를 구분한다. 5a의 CI는 마지막 확인에서 실패0/일부 진행 중이었으므로 모든 gate 완료로 선언하지 않는다. 이후 working root에 batch recovery v2 추가가 있다.

v8의 async RUNNING은 당시 상태다. 같은 Batch는 이제 SUCCEEDED지만60개 모두 census schema/coverage 불충족으로 거부했다. private final 응답을 보존했고 완료224/전체1659는 유지했다. usage2,603,453 tokens는 유효 검사나 비용 절감이 아니다. `STATUS-v5.md`와 `batch-rejection-readback-v2.json`을 먼저 읽는다.

작은8-row HIGH schema 파일럿은 새 요청1개이며 전체 재시도가 아니다. job `batches/ou10609mribyd7b806gebolzxtvkjmcjngzv`의 생성/readback RUNNING을 보존했다. 기존 receipt에서 GET만 수행한다. full rerun·blind duplicate create·키/model 변경·일반 유저 리뷰 수정은 하지 않는다. 성공한 pilot도 향후 source/key-bound checkpoint에 반영하기 전에는 completed count에 넣지 않는다.

`batch-state-v2.mjs`, `audit-response-v2.mjs`, `ingest-batch-v2.mjs`는 터미널 상태 오분류와 primitive/null의 중단을 수정했다. Node24.19.0의 local7개 검사 통과는 SDK 수신/검증 도구 근거이며 Node24.21.0의 실제 production 성능 측정을 대체하지 않는다. 전체1435개 실패를 숨기거나 JSON 문자열 배열을 review 판정으로 변환하지 않는다.

현재 공개 census root는 비동결 작업 영역이고 checkpoint-v1은 immutable82개 파일이다. 작업 영역의 admission source에서 마지막 빈 줄만 정리했고 AST 동일성·원본 byte를 증명했으며, frozen source 한 경로의 blank-at-eof whitespace만 archival attribute로 보존했다. G014·보안·기능 gate를 면제하지 않았다. .gitattributes의 이전 byte는 private runtime에 백업했다.

운영 SQL/Storage/promotion/deploy0과 phone hold는 유지한다. 다른 담당자의 M5 cleanup26→25+1 및 후속 RPC 해시 연결 source는 아직 안정 인계가 없다. exact file/commit/hash 뒤 실제 총 unit 수를 확인하며 131이라는 예상값을 확인 전 성공으로 쓰지 않는다. 기존 coordinator cursor는 :9이고 최신 내용은 M5/M6 해시 계약 수정 진행이다. 원래 memory20% guard/candidate admission0/실제 SDK pixel/기기/field-v2 분모 목표는 계속 미완료다. 전체 goal은 active다.
