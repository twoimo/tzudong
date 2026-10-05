야간 local publication 검증이 canonical migration 100개를 99개로 기대하면서 `100 != 99`·`receipt_ledger_state`로 중단됐습니다. Builder·verifier·ledger와 관련 fixture를 정확한 100개 계약에 맞추고, 누락·추가·변조는 계속 거부합니다. 적용된 SQL은 변경하지 않습니다.

추적된 assets·원본 폰트·build/ship·performance 문서 디렉터리 4개를 layout manifest에 추가하고 기존 대응/소유/alias 검사를 유지했습니다. 현행 후보 reconciliation은 바뀐 두 파일 해시와 집계만 갱신했습니다.

검증: Python3.11.17 publication40/40, seed21/21 및 replay/migration27/27, layout·rename·source recovery·reconciliation87/87. 최신 develop 통합 후 reconciliation7/7 및 layout `ok=true`/37directories/0missing/0alias. 실제 canonical nightly publication은 원격 실행으로 별도 확인하며, 성공 전에는 #2843을 닫지 않습니다.
