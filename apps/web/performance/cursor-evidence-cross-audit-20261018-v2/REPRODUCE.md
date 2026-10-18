# 교차 감사 증거의 재검증

## 실행 시점 모델 설정 근거

`antithesis-mode-provenance-v1.json`은 실제 원본 CUA 기록에서 선택한 여섯 call/output의 모드·도구·첨부 이름 행만 보존한다. 전송 직전, 전송 직후, 연구 착수 화면에서 최고가와 Deep Research가 함께 관측됐다. 입력문에 최고가라고 쓴 내용으로 대체하지 않는다. 다른 탭의 현재 composer와 실행 시점 설정은 별개이며 backend identity는 미확인이다.

원본 transcript는 비공개 로컬 기록으로 Git에 포함하지 않았다. 원본에 접근 권한이 있는 운영자는 `python3 extract-antithesis-mode-provenance-v1.py <원본 transcript> <새 출력 경로>`로 재추출할 수 있다. 스크립트는 해당 대화의 session_meta.id를 먼저 검사하고 정확한 여섯 쌍만 선택하며 기존 출력 파일을 덮어쓰지 않는다. 기록의 원본 행·prefix 해시는 그 비공개 원본과의 대조에 쓰이며, 원본 없이 provider backend를 독립 인증하는 수단이 아니다. `mode-provenance-identity-negative-v1.json`에 다른 대화 ID의 출력 거부 결과를 보존했다.

## 저장 파일과 구현 경계 확인

현재 `completion-manifest.json`은 `in_progress`다. 완료한 웹 보고서는 ChatGPT thesis 한 건뿐이며 Gemini antithesis와 ChatGPT reverse는 아직 없다. 원본 보고서와 봉인된 delivery 폴더는 변경하지 않는다.

프로젝트 Node24/Bun1.4 환경에서 repository root를 기준으로 실행한다.

```sh
/opt/homebrew/opt/node@24/bin/node apps/web/performance/cursor-evidence-cross-audit-20261018-v2/verify-completion-manifest.mjs
cd apps/web
bun test performance/cursor-evidence-cross-audit-20261018-v2/capability-boundaries.test.mjs performance/cursor-evidence-cross-audit-20261018-v2/manifest-integrity.test.mjs
```

첫 검사는 JSON 구조, source bundle 및 보고서·검증 파일의 SHA256/bytes, finding ID 중복과 증거 참조를 실제 파일에서 확인한다. 현재 보고서1건/지적20건/검증파일55건을 확인하고 `missingStages: [antithesis, reverse]`, `completionEligible: false`를 출력해야 한다. 이 값은 저장 증거의 구조적 조건이며 실제 리서치 완료·모델 backend·동작 수정·현장 성과를 인증하지 않는다. 완료 상태는 실제 UI terminal receipt, 세 단계 전문, 현재 소스와 실제 조치까지 별도로 검토해야 한다.

manifest-integrity 검사는 실제 별도 Node 프로세스와 임시 파일로 premature complete, 보고서 바꿔치기, source bundle 바꿔치기, 중복 finding을 거부한다. 실행 결과5pass/11assertions/0fail을 보존했다. 임시 negative fixture는 테스트가 만든 고유 디렉터리만 정리하며 사용자 파일은 건드리지 않는다.

capability-boundaries는 실제 private API와 합성 clock/readiness를 사용한다. 11pass/31assertions/0fail이며 실제 위치·권한·운영 쓰기는 없다. 최초 .test.ts의 Bun 실행 성공과 Next app typecheck의 bun:test module 오류를 모두 보존했다. 같은 검사를 .test.mjs로 바꾸고 native/compat parity0/3184inputs를 확인했으며 프로젝트 exclusion·의존성을 완화하지 않았다.

원래 첫 보고서의19개 지적과 taxonomy 지적은 findings-thesis-followup-v1.json에 연결된다. 판정은 아직 로컬 후속 검토이며 왕복 웹 합의가 아니다. pending request는 공통 coordinate.py의 같은 state/FIFO를 사용한다. 현재 업로드할 두 파일은 plan-source-manifest-v3.json에 해시로 고정돼 있다. 새 전송은 반드시 실제 reserved 응답과 현 UI 계정·Argon 최고가·Deep Research 동시 확인 후 한 번만 수행한다.

새 결과를 기존 로그/원문/봉인된 root에 덮어쓰지 않는다. 다른 output 버전을 쓰고 manifest 변경 전 snapshot을 보존한다. log 파일의 타이밍 차이를 성능 개선으로 해석하지 않는다.
