# 확인 실행 재현

이 증거는 후보21a86dca의 성능 채택을 지지하지 않는다. 자연 종료/idle heap guard의 불확실성이 남고 field/기기/운영 성과는 포함하지 않는다. CONFIRM-REPORT-v6.md와 browser-confirm-summary-v6.json이 현재 결과다. 이전 실패와 파일럿 파일은 당시 조건의 기록으로 보존한다.

원자료 통계만 다시 계산하려면 이 폴더의 JSON 및 aggregate-browser-v6.py를 새 임시 폴더로 복사한다. 그 복사본에서 browser-confirm-summary-v6.json만 제거하고 `python3 aggregate-browser-v6.py`를 실행한다. 고정 bootstrap seed20261009/20,000회이며 저장된 원본에는 쓰지 않는다. independent-statistics-rerun-v1.json은 이 절차의 동일 바이트 SHA256을 확인한 결과다.

브라우저 재실행은 Before da4c9be와 After21a86dca를 별도 깨끗한 복제본으로 준비한다. Node24.21.0/npm11.6.2/Bun1.4.0/Next16.3.6/Chrome154.0.8037.98/Playwright1.63.0을 사용한다. 필요한 브라우저 공개 SDK/서비스 설정은 운영자가 제공하며 이 증거에는 키·.env가 없다. 각 복제본에서 npm 권위 lock으로 설치하고, build-receipts-v2.json의 distDir에 production build한다. Next 자동 tsconfig include 변화는 별도로 관리한다.

새 증거 복사본의 build-receipts-v2.json의 root 경로를 그 복제본의 apps/web 경로로 고친다. 소스 SHA/distDir/buildId 및 실제 named dist의 CSS 검증을 다시 기록한다. 기존 receipt를 새 실행의 영수증으로 부르지 않는다. 원격 SDK는 변할 수 있으므로 실제 스크립트 해시가 고정 계획과 다르면 중단하고 새 조건의 계획을 사전에 만든다.

측정 중 다른 build/profiler를 실행하지 않는다. 먼저 fixture-query-v6.test.mjs의9개 입력 계약을 확인한다. browser-confirm-plan-v6.json의 A/A4 process와 무작위 A/B9쌍을 run-browser-series-v6.mjs로 직렬 실행한다. label/output 폴더는 새 이름을 사용한다. 3000 포트 점유 시 다른 프로세스를 종료하지 않는다. REST735/Auth401은 합성, SDK/타일은 실제이며 CPU4/390×844/dpr1/touch/cache disabled/SW bypass/네트워크 무감속을 유지한다. 각 process의256동작을 독립 사용자로 계산하지 않는다.

canonical-zero-v1의 items0은 heap 측정이 canonical budget inventory에 없고 채택 근거가 충분하지 않다는 선언이다. console44 사건을 숨기지 않아 releaseBlocked=true이다. 기타0 사건은 그 범위에서 기록된 사건 수이며 미검증 운영/필드/기기에 대한 무사고 보장이 아니다. canonical scorer와 독립 validator 명령은 basis.json에, 별도 map pin은 docs/evidence에 보관한다. 전체 artifact-map과 independent verifier는 원자료·실패·스크립트의 보존을 검증하며 성능 guard 통과를 대신하지 않는다.
