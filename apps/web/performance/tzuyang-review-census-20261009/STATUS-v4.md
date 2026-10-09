# 쯔양 리뷰 전수 검사 중간 상태

전체 `restaurants.tzuyang_review` 1,659건을 한 번 keyset export했고 원문은 저장소 밖의 권한 제한된 custody에 보존했다. 원문 SHA256은 `b8f06e7c5867b5ac2d8dfe5283e1ffdcf2a103a34f2e1d29333169fe4c5d38d8`이다. 상태별 approved763/deleted890/hold6이며 빈 리뷰222건이다. 일반 사용자 리뷰는 대상이 아니다.

사용자가 지정한 실제 `gemini-3.8-flash`/`HIGH`로 224건을 완료했다. ok162/fix19/needs_source43이다. 나머지1,435건은 60개 요청의 async Batch `batches/3fga58v7b3q2chu102t5jiafi13hnu42oeqg`에서 RUNNING으로 확인됐다. 완료 응답만 실제 modelVersion·STOP·원본 키 전체·입력 해시로 검증해 받아들인다. 임시 텍스트·잘린 응답·수송 실패는 완료로 합산하지 않는다.

이미 끝난19개 수정안의 원문을 대조한 결과, 승인된 쯔양 행 중 정확히 표기만 바꾸는3개 로컬 계획을 만들었다. 굵은 Markdown 제거, 문장 마침표 앞 공백 제거, 개별 원문을 읽고 영상 인용 괄호임을 확인한 `r0127`의 시간표 제거다. 일반 시간·숫자·비판·인용·삭제/보류/채널 미확인 행은 해당 자동 계획에 넣지 않는다. 나머지16개 제안은 삭제 상태 보존 또는 의미 검토 대상으로 남겼다. 이 수치는 전체 결함률이 아니다.

일부 Gemini 제안에는 `했습니다`/`했다` 문체 혼용이 있고, 기존 모순을 매끄럽게만 바꾸거나 추천 문구의 주체를 충분히 확인하지 못한 것도 있다. 숫자 비교만으로 의미가 같다고 승인하지 않는다. 필요한 추가 문장 검토도 Gemini Flash High를 유지하며, 영상 근거가 없으면 사실을 고쳐 쓰거나 빈 리뷰를 만들지 않는다.

운영 데이터 수정은0건이다. 로컬 수정안 admission 검증7건이 통과했으며 원문·proposal hash, 전체 export fingerprint, 최신 preimage, 이후 guarded Preview→Confirm→Apply→Readback→Audit를 별도 gate로 유지한다. 삭제된 행을 복구하거나 상태를 바꾸지 않는다. 원문과 수정 내용은 public evidence에 넣지 않으며 metadata/hash만 보존한다.

재개 순서는 기존 Batch의 `ingest-batch-v1.mjs` get/ingest → `summarize-audit-v1.py <새 버전>` 전체 coverage 확인 → 원문별 문체·의미 대조 → 최신 source drift/CAS 및 관리자 경로 확인 → 안전한 변경·readback이다. Batch를 새로 만들어 같은1435건을 중복 제출하지 않는다. 이전 stream/MAX_TOKENS/504 실패와 사용량 불확실성은 보존한다. 정상 추론 비용은 발생할 수 있으며 유료 용량 구매·키 회전·모델 전환은 없다.
