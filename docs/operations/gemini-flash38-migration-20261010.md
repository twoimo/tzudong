# Gemini 3.8 Flash 직접 호출 전환

기준 소스: `a9ce6ba2be377594e30dc865c621f2854006aa79` (`develop`), 2026-10-10.
Google의 [모델 종료 안내](https://ai.google.dev/gemini-api/docs/deprecations)는 `gemini-3.7-flash` 요청을 `gemini-3.8-flash`로 전환한다고 명시한다. [3.8 공식 모델 문서](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)는 `LOW`, `MEDIUM`, `HIGH`를 지원하고 `MINIMAL`은 거부한다.

크롤링·평가·재검수·런타임 확인·연결 점검·채널 설정의 기본 모델을 3.8로 바꿨다. 이전 환경변수의 정확한 `gemini-3.7-flash`와 `models/gemini-3.7-flash`는 호출 전에 3.8로 변환한다. 셸·Python은 단계 지문과 CLI 인자를 만들기 전에 변환하며, 관련 모델 helper도 캐시 지문에 포함한다. 기존 결과·큐·동결된 과거 성능 증빙은 수정하지 않는다. 격리된 실행·벤치마크 복사 목록에도 helper를 포함한다. helper 누락 시 셸 실행을 즉시 중단한다.

OCR은 기존 3.6 기본값을 유지하고 명시적인 3.7 설정만 전환한다. 모델 목록은 전환 후 중복을 제거해 `3.7,3.8`이 두 번 호출되지 않게 한다. 관리자 검수와 스토리보드의 기존 3.8 텍스트 모델 및 이미지 모델은 유지한다. 다른 모델 계열과 명시적인 모델 리비전은 자동 교체하지 않는다.

3.8의 `MINIMAL`은 생성 요청·쿼터 예약 전에 고정 코드 `GEMINI_THINKING_LEVEL_UNSUPPORTED`로 거부한다. 청크 실행기는 파일 업로드 전에도 확인한다. `MINIMAL`을 임의로 다른 강도로 바꿔 추론 비용을 늘리지 않는다. 토큰 상한·재시도·취소·프로젝트 공동 속도 제한·크레딧 키 우선순위는 유지한다.

| 확인 항목 | 변경 전 | 변경 후 | 해석 |
| --- | ---: | ---: | --- |
| 수정 대상 실행 파일·채널 설정 15개에서 3.7 선택 기본값·고정 요청 ID | 24 | 0 | 24개 제거, 100% 감소. 전수 소스 집계이므로 신뢰구간 비적용. 호환 인식용 3.7 문자열은 별도로 유지한다. |
| 실제 Google 추론 호출 | 0 | 0 | 이번 검증은 로컬 가짜 전송만 사용한다. |

속도·정확도·청구액 개선은 측정하지 않았으므로 주장하지 않는다. 공급자의 기존 자동 전환과 같은 모델을 직접 선택하는 변경이다. 운영 환경변수·키·결제·DB·사용 한도와 운영 실행 허용 상태는 변경하지 않는다. 소스 반영과 실제 공급자 실행·배포 확인은 별도 증빙이다.


로컬 검증 결과:

- Python 크롤러 회귀·단계 실행·미디어 후속 처리·재시작 통합: 125개 실행, 122개 통과, Windows 전용 3개 건너뜀.
- Node 공유 클라이언트·청크 요청: 29개 통과. 이전 모델의 실제 SDK 전송 URL, 응답 모델 출처, 요청 설정 보존, 최소 추론 거부 시 외부 전송·업로드·잔여 lease 0건을 검사한다.
- JS·Python·셸 모델 호환 및 입력 검증: 4개 통과.
- OCR 가짜 전송·재시도·취소: 14개 통과. 기존·신규 ID 중복 목록은 한 번만 요청되고 결과 메타데이터는 3.8을 기록한다.
- TypeScript native 7.0.2 / compatibility 6.0.2 parity: 진단 0건. OCR 변경 대상 ESLint, Bash 문법 및 diff 공백 검사 통과.

수정한 격리 fixture는 helper 누락 시 작업·출력·완료 기록 0건, 이전/신규 별칭의 캐시 동일성, 다른 모델·정책·시각 근거 변경의 무효화를 다시 검증했다.

실행 명령은 저장소 루트에서 다음과 같다. Node는 24.21.0, backend는 npm 11.6.2의 기존 lock으로 설치한 @google/genai 2.24.0을 사용했다.

```sh
node --test backend/utils/tests/gemini-model.test.mjs
node --test backend/utils/tests/gemini-client.test.mjs backend/restaurant-crawling/scripts/tests/test_gemini_chunk_generation_config.mjs
python3 -m unittest backend.utils.tests.test_run_daily_regression backend.utils.tests.test_stage_execution backend.utils.tests.test_media_review_followthrough
python3 -m unittest backend.utils.tests.test_pipeline_restart_integration
```

웹 패키지에서는 `bun test tests-unit/gemini-ocr.test.ts`, `npm run typecheck:parity`, 변경 대상 ESLint를 수행했다. 전체 테스트나 실제 공급자 품질 검증을 대신하지 않는다.
