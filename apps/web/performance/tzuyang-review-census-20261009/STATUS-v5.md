# 전수 검사 결과 수신의 추가 결함과 복구 준비

기존60요청 Batch는 `JOB_STATE_SUCCEEDED`로 종료했지만 검토 결과의 추가 채택은0건이다. 11개 응답은 행을 객체로 반환하지 않았고, 47개는 행 개수가 다르며, 2개는 rows가 없거나 배열이 아니었다. 완료224/전체1659는 그대로다. STOP/modelVersion 확인만으로 행 전체 검사 성공을 만들지 않는다. private 응답60개·해시·사용량을 보존했다.

실제 완료 Batch의 token metadata는 prompt279775/candidate26460/thought2297218/total2603453이다. 이 수치를 유효한 검사량이나 비용 절감으로 해석하지 않으며 금액은 불명이다. `batch-rejection-readback-v2.json`에 형식별 거부와 해시를 보존했다. primitive/null 행을 받아 파서가 마지막 요청 이전에 중단되던 경로도 보완해60개를 모두 검증하고 `rejected`로 끝냈다.

설치 SDK의 offline fake transport로60개 요청을 직렬화한 결과 프롬프트 텍스트·입력 텍스트·JSON schema·HIGH·metadata가 모두 의도와 같았다. 실제 공급자의 내부 처리나 원인은 이 검사로 확인되지 않는다. `offline-wire-verification-v2.json`은 네트워크0, 실제 키0의 검사다. 실패를 단순한 SDK 누락 또는 공급자 결함으로 단정하지 않는다.

실패/취소/만료를 계속 pending으로 표시하던 source 경로를 고쳤다. 부분 완료·paused·unknown도 구분한다. 형태·key·중복·누락·null·state drift 검증7건이 통과했다. 이전 v1 source와82개 파일의 동결 checkpoint는 수정하지 않았다.

전체1435건을 다시 제출하지 않았다. 같은 첫8개(r0224~r0231)를 [Google 공식 Batch API 문서](https://ai.google.dev/gemini-api/docs/batch-api)의 `responseSchema` 형식으로 바꾸고, 객체/8개 cardinality/key enum 및 사용자 메시지의 task instruction을 명시한1개 HIGH 파일럿만 생성했다. 편집 판단 기준은 기존 prompt v1과 동일하다. 작은 파일럿이 유효하게 끝나기 전에는 전체 재시도를 하지 않는다.

파일럿 job은 `batches/ou10609mribyd7b806gebolzxtvkjmcjngzv`, request SHA `68e0a651cabab971291b2bcc0a6fb26a512bc8ea869f73590ca4e5f602567539`, input SHA `15cef2bc99725755b7d3def73e2e8aca52d48032af825d1a0fe9f920098bb15b`, 실제 요청 model=`gemini-3.8-flash`, thinking=`HIGH`다. 생성 후 같은 ID의 RUNNING을 readback했다. 이를 검사 성공으로 합산하지 않는다. 정상 추론 요청이며 새 유료 용량 구매·키 변경·운영 데이터 수정은0이다.

다음에는 해당 파일럿의 기존 job을 GET으로 수신하고 정확 model/STOP/8개 객체/키·issue schema를 검증한다. 성공 시 partial checkpoint와 이미 완료된 key 집합을 바인딩한 다음 나머지 계획을 만든다. 기존 full-run v1~v6 또는 옛60개 생성 루프를 그냥 재실행하면 안 된다. source drift·삭제/빈 상태·최종 의미 대조·guarded 운영 변경은 별도 미완료다.
