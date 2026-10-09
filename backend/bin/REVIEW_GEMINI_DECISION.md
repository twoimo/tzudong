# Gemini 검수 판단 계약

`run_restaurant_review_automation.py`는 기존 재검수 1회 호출에 5개 LAAJ 평가와 `approve | hold | recheck` 추천을 함께 요청한다. `review_decision_gemini.mjs`는 정확한 `gemini-3.8-flash`만 사용하며 기존 funded 환경 키 선택과 프로젝트 공동 RPM/동시성 lease를 재사용한다. `LAAJ_THINKING_LEVEL`을 보존하고 미설정이면 기존 기본값 `MEDIUM`을 사용한다. 출력 한도 4096, 단일 SDK 시도, 추가 모델·fallback·별도 판단 호출은 없다. `review_rule_evaluation.py`는 공유 rule 평가의 해외 위치 Gemini CLI fallback을 이 worker 경로에서만 비활성화하며 위치를 미확인 보류로 남긴다. 공유 rule 원본과 다른 실행 경로는 변경하지 않는다. 기존 hosted runner의 `--recheck-limit 1`, 일일 처리 슬롯 1개 예약, 후속 `--recheck-limit 0`은 그대로다.

새 migration은 기존 자동 승인 후보를 `queued / gemini_decision_required`로 전환한다. 완료 저장 시 Gemini 추천과 모든 기존 서버 검증이 동시에 충족되어야 승인한다. 관리자/사용자 작성 보호, 원본 fingerprint, 정책 버전, stop, 중복, 식당 identity, 좌표, 7개 평가와 독립 위치 근거, 카테고리, 일일 승인 한도를 서버가 다시 검사한다. Gemini 추천만으로 서버 제약을 우회할 수 없다. 기존 preview의 `approve` 수는 결정론적 자격 후보 수이며 아직 모델 추천을 받은 승인 수가 아니다.

추천에는 6개 승인 근거 코드가 모두 필요하고, 보류/재검수에는 허용된 불충분·충돌 코드가 필요하다. 원본 식당·자막·모델 내용은 명령이 아닌 비신뢰 근거로 취급한다. 입력 원본 row SHA와 실제 prompt SHA를 별도로 묶는다. 응답 모델 버전, STOP, 단일 후보, JSON 형식, 입력 SHA, 코드 allowlist를 확인한다. 타임아웃·부분 응답·잘못된 추천은 고정 코드로 실패하고 동일 입력을 자동 재요청하지 않는다. 저장 ACK 유실은 동일 lease의 `read`만 수행하며 판단이나 저장을 다시 보내지 않는다. 해결되지 않은 항목은 확인 가능한 terminal 상태 또는 운영자의 새 입력/명시적 복구를 기다린다.

한도 도달 시 유효 추천과 변경 후 fingerprint를 저장한다. 다음 허용 시점에 동일 정책/입력과 모든 서버 제약을 재검증하여 추가 Gemini 호출 없이 승인할 수 있다. 모델이 `recheck`를 추천한 동일 입력은 자동 반복 호출하지 않는다. 모든 신규 승인에 선행 추천이 있지만, 추천 시점과 적용 시점이 다를 수 있다. 모델 품질·교정 정확도는 측정하지 않았으며 `confidence` 필드를 허용하지 않는다.

판단 이력에는 고정 코드, 해시, 모델/프롬프트 버전, 실제 결론, 시각만 남긴다. 이와 별도로 식당의 `evaluation_results`와 실제 `eval_basis`는 기존 검증된 도메인 결과 그대로 보존하며 완료 응답 전에 저장 readback을 확인한다. 평가 근거는 provider 진단 로그와 구분한다. 원문 자막·요청은 권한 제한된 임시 디렉터리에서 기존 parser/transform에 전달한 뒤 삭제하고, 비밀·개인정보·raw OCR·원문 자막을 평가 근거에 복사하도록 요구하지 않는다. 공개 식당 필드의 기존 저장 계약을 유지한다.

## Web snapshot의 선택 필드

새 SQL이 적용된 DB만 아래 메타데이터를 반환한다. 기존 DB 또는 필드 부재를 enabled 정책만으로 Gemini 가동 상태로 표현하지 않는다. 단계는 기존 `items[].state`, 서버 고정 사유는 `items[].reason`이다.

```ts
judgmentEngine?: {
  provider: "gemini";
  model: "gemini-3.8-flash";
  promptVersion: "restaurant-review-v1";
  requiredForApproval: true;
  maxCallsPerClaim: 1;
};
items[].geminiDecision?: null | {
  schemaVersion: 1;
  model: "gemini-3.8-flash";
  modelVersion: "gemini-3.8-flash";
  promptVersion: "restaurant-review-v1";
  inputSha256: string;
  promptSha256: string;
  recommendation: "approve" | "hold" | "recheck";
  evidenceCodes: string[];
  outcome: "approve" | "hold" | "recheck" | "deferred" | "blocked";
  decidedAt: string;
};
```

## 적용 경계와 검증

`20261004120000_restaurant_review_gemini_decision.sql`은 **미적용** 신규 migration이다. 기존 automation → manual guards → claim progress → identity → category 계약 뒤에 적용한다. 기존 migration은 변경하지 않았다. 운영 적용 시 기존 자동 운영을 중지한 상태에서 SQL을 먼저 적용하고 새 worker와 read 모델을 배포·확인한 다음 승인된 재개 절차를 따른다. 구 worker의 추천 없는 완료는 신규 SQL에서 거절된다. SQL 적용 전에는 구 tick의 즉시 승인 동작이 남아 있으므로 새 코드만으로 운영 반영을 주장하지 않는다.

로컬 검증: PG 17.6/ICU78의 고유 disposable DB에서 service_role로 11개 시나리오, worker/runner 24개 테스트, 새 Node helper 6개 테스트, 기존 SDK/공동 budget 13개 테스트를 실행했다. 관리자 변경·잘못된 모델/입력/추천·7평가·identity·좌표·카테고리·동시 완료·중복·stop·한도·ACK 유실·만료를 포함한다. 보호 위반 0, 실제 parser/transform을 통과한 합성 판단 1회, 설치 SDK의 가짜 전송에서 요청 상한 1회를 확인했다. 이 결과는 실 모델의 판단 정확도를 증명하지 않는다. 실제 provider 호출·운영 DB 적용·키 읽기·배포는 0회다.

```sh
python3 -m unittest backend.bin.tests.test_restaurant_review_automation -q
node --test backend/bin/tests/review_decision_gemini.test.mjs
node --test backend/utils/tests/gemini-client.test.mjs
TZUDONG_REVIEW_GEMINI_LOCAL_PG=1 \
TZUDONG_TEST_PG_SOCKET=/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-17.6-icu78/socket \
TZUDONG_TEST_PG_PORT=18802 \
PYTHONPATH=/Users/twoimo/.codex/runtime-cache/tzudong-warning-audit-python:. \
python3 -m unittest backend.supabase.tests.test_restaurant_review_gemini_decision.ReviewGeminiTests -v
```
