# 신규 영상 자동화 실행 복구

기준 운영 소스는 `084a3c5bb94bb5e388683d9022df228729b70edd`다. 이 문서는 수집·평가 실행 수정의 근거이며, 운영 저장·자동 승인·지도 표시 완료 영수증은 아니다.

## 재현과 변경

- 예약 실행 `40134052303/1`은 성공 종료했지만 신규 영상 3개 모두 자막 저장 검증에 실패했다. 평가 산출물과 저장 후보는 0개, 검수도 0개였다. 전체 로그 대신 고정 오류 코드와 건수만 확인했다.
- Puppeteer 수집기의 `segments` 반환값을 저장기의 canonical `transcript`로 연결했다. 기존 alias와 엄격한 내용 검증은 유지한다. 개별 실패 후 다른 영상의 저장은 계속하되, 집계 실패가 있으면 CLI는 nonzero로 끝난다.
- 새 영상에 완료 산출물이나 명시적 제외가 없으면 `evaluation_output_incomplete`로 반환한다. selection 중간 파일만으로 다음 실행에서 제외하지 않는다. 혼합 영상은 선정된 모든 음식점에 Rule/LAAJ 최종 값이 필요하며, 정상 음수 판정은 완료와 승인을 구분해 인정한다. 기존 영구 무자막 제외는 슬롯 선택 전에 적용한다.
- 설치된 `@google/genai` 2.24.0은 upload의 per-call `httpOptions`가 resumable 요청의 경로와 헤더를 대체한다. 동일 계정의 작은 비개인 테스트에서 옵션 없음은 start/body 각각 HTTP 200, 옵션 추가는 start HTTP 404였다. 생성된 자기 소유 probe 파일은 삭제 확인했다. 해당 override만 제거하고 클라이언트 timeout, deadline, 모델, 키와 재시도 설정은 유지했다.
- 종료된 작업도 포함하는 `jobs -p`가 병렬 슬롯 대기를 끝내지 않는 것을 실제 Bash에서 성공·실패 자식 각각 재현했다. 실행 중 작업만 세도록 변경했다. 진단 중 이미 API 호출이 끝난 자기 소유 worker 하나만 종료해 상위 cleanup과 실패 영수증을 마쳤다.
- hosted Actions는 `npm ci --ignore-scripts`를 유지한다. 이 모드는 ffmpeg-static 실행 파일을 설치하지 않으므로 신뢰 경로 `/usr/bin/ffmpeg`를 명시하고 apt media tools 설치·실행 확인을 추가했다. 임의 PATH 실행을 허용하지 않는다.
- 세 번째 실제 긴 영상은 최종 정리가 빈 배열의 부재 근거를 버려 저장되지 않았다. 모든 계획 청크의 파일 집합과 응답 schema를 확인하고, 전부 명시적 부재인 경우 추가 정리 호출 없이 원래 근거를 보존한다. 손상·누락·설명 없는 빈 응답은 완료가 아니다. null-name 후보는 별도로 보존하며, 최종 parser도 비어 있지 않은 문자열 근거를 검증해 JSONL에 저장한다.
- Mac 설치기에서 deferred LAAJ를 기존 Gemini 경로로 연결하고 `--review-automation`을 전달한다. limit 3·freeze·trusted ffmpeg·05:15 일정을 유지한다. 생성 파일 검증 전에는 기존 파일을 바꾸지 않으며, 등록된 agent는 자동 중단하지 않는다. 설치 실행과 운영 readback은 별도다.

## 검증 범위

- Python evaluator·데이터 계약·hosted planner·cadence 관련 **74 tests: 73 pass, 1 skip**. 평가 누락 2개와 혼합 결과/영구 제외 2개 반례는 수정 전 실패를 확인했다.
- transcript Node 검사 **32개: 24 pass, Windows 전용 8 skip**. 실제 adapter→collector→JSONL 경계를 검사했고 새 schema 회귀 1건의 수정 전 실패를 확인했다.
- pinned SDK upload 검사 고유 **4개 pass**. 실제 SDK와 합성 HTTP transport로 경로·헤더·바이트·응답·timeout/정착 경계를 검사한다. SDK는 upload의 외부 abortSignal을 전달하지 않아 늦게 시작된 body까지 포함한 강제 총 5분 종료는 주장하지 않는다.
- 관련 Gemini 오류 분류·generation config **11 pass**. workflow 신뢰 경계 Bun **5 pass / 85 assertions**. Bash slot 검사 성공·실패 두 하위 사례 모두 수정 전 timeout, 수정 후 pass. syntax·diff·YAML parsing 확인.
- 추가 merge **7 tests**, parser **7 tests**, native Bash **2 tests**를 통과했다. 부분 응답을 완료로 인정한 2개 반례와 parser의 잘못된 부재 근거 4개 하위 사례·근거 소실 반례는 수정 전 실패했다. Mac 설치기 **8 tests**와 기존 cadence **10 tests**가 통과했으며, plist 일정이 실제 소스 XML에 결속되는지 포함한다. 합성 설치 검사는 실제 HOME·launchd·provider·DB를 호출하지 않는다.
- 실제 후보 실행은 최근 롱폼 2개를 메타데이터 수집→자막→Gemini 영상 추출→Rule/LAAJ→transform까지 처리하고 `completedVideoCount=2`, `incompleteVideoCount=0`, exit 0을 확인했다. 집 먹방은 `no_restaurants` 제외, 의정부 영상은 남원집 1곳 추출이었다. 후자는 주소 근거가 부족해 pending이고 geocoding false다. 승인 기준을 낮추거나 운영 DB에 쓰지 않았다.

이 검사는 서로 다른 결정적·합성·실제 경계의 증거다. 모집단 오류율이나 처리 속도·금액 절감의 추정 표본이 아니므로 95% 구간이나 성능 향상률을 붙이지 않는다. 모델·계정·키·유료 한도·batch/day 50/50·일반 compute freeze·DB 스키마는 변경하지 않았다. 원래 외부 교차감사 예약도 유지한다.

## 남은 운영 확인

보호 순서 develop → data → main 반영 뒤, 신규 음식점의 pending 저장→실제 Gemini 검수→안전 조건을 통과한 자동 승인→공개 지도 마커를 별도 확인한다. Naver에 등록되지 않은 상호의 주소 보류는 정상 실패 경로이며 억지로 승인하지 않는다. Actions의 fresh checkout은 아직 음식점 0개 영상의 durable 완료 상태를 복원하지 않으므로 반복 슬롯 소모 문제도 남아 있다. 기존 Mac 설치는 구 소스와 deferred LAAJ 설정을 사용해 최신 source와 실행 계약의 설치/readback이 필요하다.
