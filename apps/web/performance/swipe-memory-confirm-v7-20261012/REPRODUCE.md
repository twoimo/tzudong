# 재현

통계 재계산은 전체 JSON과 aggregate-browser-v7.py를 새 임시 폴더에 복사하고 그 복사본에서만 browser-confirm-summary-v7.json을 제외한 뒤, pinned Python3.12.14로 실행한다. 기존 원본/실패/frozen evidence는 수정하지 않는다. independent-statistics-rerun-v1.json은 optimized 모드에서도 같은 바이트가 계산된 결과다.

브라우저 재실행은 Before da4c9be17e54733414cc7e1d2f8365d25bee4d87과 After21a86dca974f9bbdeed52d19d2fde0e9cc1fcac6을 별도 checkout으로 준비한다. Node24.21.0/npm11.6.2/Bun1.4.0/Next16.3.6/Chrome154.0.8037.98/Playwright1.63.0을 유지하고 두 build-receipts-v7.json의 distDir에 production build한다. 각 checkout 실제 helper/lock/BUILD_ID 바이트를 확인해 새로운 receipt를 기록한다. 키는 운영자의 기존 로컬 환경을 사용하며 증거 패키지에 복사하지 않는다.

새 evidence root에 driver/plan/receipt를 복사한다. receipt.root만 새 checkout의 apps/web 절대 경로로 변경하고 기존 source/dist/build/hash를 실제 새 빌드 값에 맞게 확인한다. 3000 포트가 점유돼 있으면 다른 서비스를 종료하지 않는다. fixture-query-v7.mjs는 alias/address/NULL/order/select/range 지원과 알 수 없는 제어의 fail-closed 계약을 유지한다. SDK SHA가 사전 값과 다르면 새 조건의 계획을 먼저 만들고 기존 결과와 합치지 않는다.

다른 local build/test/profiler를 중지한 측정 창에서 pinned Node로 run-browser-series-v7.mjs를 실행한다. 사전 plan의 AA4/AB18 순서를 바꾸거나 표본을 제외하지 않는다. 각 process256동작은 독립 사용자가 아니다. CPU4/cache disabled/SW bypass/390×844/dpr1/네트워크 무감속, REST735/Auth401 합성, 원격 SDK/타일 실제, mouse click/fill 동작이다. 물리 touch나 Samsung Internet으로 보고하지 않는다. profiler/forced GC는 primary에 사용하지 않는다.

모든 receipt22개/동등성/SDK/소스 검사가 통과한 뒤 aggregate-browser-v7.py를 실행한다. 고정 seed20261009/20,000 bootstrap과 20% heap/15% 입력 guard를 유지한다. 자연 종료와5초 idle의 상대 CI가 기준 초과를 배제하지 못하면 미채택 상태를 유지한다. 88정지 캡처로 플리커 빈도나 지속 시간을 계산하지 않는다.

canonical-zero-v4/basis.json에는 canonical scorer/독립 validator 명령이 저장돼 있다. 재실행 때는 새 root로 복사해 새 artifact-root를 지정하고 scored 출력이 존재하지 않는 별도 복사본에서 scorer를 실행한다. score는 sidecar를 자동 생성하지 않으므로 실제 scored SHA256 한 줄을 별도로 만들고 validator map에 바인딩한다. heap metric은 canonical budget에 없으므로 items0/admitted0을 유지한다. v1–v3 packaging 실패도 보존한다.

전체 evidence artifact-map의 별도 SHA는 docs/evidence/swipe-memory-confirm-v7-20261012.md, 독립 verifier는 backend/bin/verify_swipe_memory_confirm_v7_20261012.py에 있다. hash/형식 통과는 메모리 guard 또는 배포/field 성공을 대신하지 않는다.
