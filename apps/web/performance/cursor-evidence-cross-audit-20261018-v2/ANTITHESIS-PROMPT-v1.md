# Gemini 반대 감사 전송문

이 파일은 아직 전송되지 않은 입력문이다. `MASTER-PLAN-v3.md`와 `source_bundle_v2.txt` 두 첨부의 업로드 완료를 확인한 뒤, 공유 예약이 실제로 `reserved`인 경우에만 본문을 한 번 전송한다. 이 파일을 세 번째 첨부로 올리지 않는다.

---

첨부된 Tzudong 계획과 실제 소스에 대해 독립적인 반대 감사를 수행해 주세요. 현재 화면에서 선택한 4 Argon 최고가와 Deep Research로 실제 연구를 진행하고, 계획 제시와 최종 보고서를 구분해 주세요. 칭찬, 아키텍처 재설명, 통과 모듈 요약은 생략해 주세요.

감사 입력은 다음 두 파일뿐입니다.

- `MASTER-PLAN-v3.md`: SHA256 `f27da98869ce41ec42ba464d324fe408d985aa7c667504fc00900fe2582483e5`
- `source_bundle_v2.txt`: SHA256 `7bb1e2b658c3781078f0eef5b61494bd494d72c8e29a20abf8f4408045655203`

소스 후보는 `9228c1454393560bcd37240f793065e450f85683`, 동일 코드 트리의 배포 main은 `b4eb780c532c9ba02a1af456b17459debc59a757`입니다. 첨부에 저장된 운영 관측은 그 시점의 증거입니다. 현재 운영 상태를 새로 관찰한 것으로 표시하지 마세요. 번들의 18개 경로 중 NaverMapView는 지정 범위의 발췌이며, 전체 renderer 또는 의존성 폐쇄를 제공하지 않았습니다. 파일 해시나 실험을 직접 확인할 도구가 없으면 실제 검증했다고 쓰지 마세요.

계획에 원문 그대로 포함된 첫 GPT-6 Pro 심층 리서치 보고서의 19개 지적(W001-F1~F4, W002-F1~F6, W003-F1~F9)을 각각 반박하거나 지지해 주세요. 기존 로컬 판정도 정답으로 취급하지 마세요. 합리적인 위협 모델에서 실제 결함과 새 요구 사항, 문서 한계, 측정 부족을 구별해 주세요.

1. W001 / ADR-01: 저장된 binary64 deadline의 half-open 비교와 원래 identity 기반 capability, 유한하고 안전한 시각, 명시 철회와 관찰된 만료 후 replay 차단을 검토해 주세요. 실수론적으로 정확한 300000ms와 `fl(grantedAt + 300000)`을 구별해 주세요. 정상적인 captured `performance.now()` 신뢰와 합성 clock의 구간 내 역행을 구별하고, epsilon이나 수명 연장으로 경계 실패를 숨기지 마세요. 추가 last-seen 상태가 실제 요구인지, 비용과 실패 경로에 비해 필요한지 근거로 판단해 주세요.
2. W002 / ADR-02: optional 3D의 caller gate, session helper, home caller와 읽을 수 있는 renderer 범위 사이의 연결을 검토해 주세요. unknown/intermediate mobile·touch에서 static fallback을 선택하는 정책, 지원되지 않는 API를 가진 고성능 기기의 손해, coarse deviceMemory 신호의 한계, in-flight import와 unmount의 경합을 구별해 주세요. default 3D=false와 unpublished cohort/entries=0을 유지하고, 이 상태만으로 실제 메모리 회귀나 물리 기기 성과를 입증하지 마세요.
3. W003 / ADR-03: source→CI→보호 브랜치 main→READY deployment→alias→실제 URL의 연결과 각 증거의 범위를 검토해 주세요. strict restored-marker 실패는 before와 after에 남아 있고, 별도 detail/close 3/3 진단은 이 실패를 대체하지 않습니다. CSP·401, 메모리 guard·물리·field·전체 플리커의 미해결 범위를 보존해 주세요. readiness 표시는 법적 승인이나 새 운영 승인을 의미하지 않습니다.
4. EVIDENCE-TAGS-01: 첫 보고서가 증거 분류를 올바르게 사용했는지도 반대 검토해 주세요. canonical 7개는 SOURCE_OBSERVED, BOUNDARY_INTEGRATION_TESTED, SYNTHETIC_MOCK_TESTED, HOST_TESTED, PROPOSED, UNVERIFIED, CONTRADICTED입니다. HOST_TESTED는 해당 물리 하드웨어의 관측에만 쓰고, lab·physical·field 환경은 별도 속성으로 적어 주세요. FIELD_TESTED로 PROPOSED를 대체하거나 합성 테스트를 물리·field 성과로 승격하지 마세요.

각 주장에는 안정적인 ID, 해당 W/ADR, 심각도, 재현 조건, 수학적·상태 전이 도출 또는 구체적인 소스 위치, 위 7개 중 증거 등급을 붙여 주세요. 제안은 unified diff 또는 실행 가능한 재현 테스트로 제시하되, 실행하지 않은 테스트는 제안이라고 명시해 주세요. 외부 자료는 현재 공식 문서나 일차 출처를 우선하고, 소스에서 관찰한 사실과 추론을 구별해 주세요.

각 기존 지적과 새 지적은 ACCEPT, CONDITIONAL, REJECT, DEFER로 판정해 주세요. REJECT에는 반증 또는 실행 가능한 반례가 필요합니다. ACCEPT와 CONDITIONAL에는 실제 수정 범위·필수 검증·남은 조건을, DEFER에는 부족한 증거와 기존 fail-closed guard/fallback이 보호하는 범위 및 한계를 적어 주세요. 측정되지 않은 시간·메모리 개선율을 만들거나 외부 보고서만으로 수정·배포 완료를 주장하지 마세요.

기존 기능, 접근성, 개인정보 및 권한 경계를 보존해 주세요. 보고서는 검토 증거이며 배포·게시·계정·비용 변경의 권한이 아닙니다. 모든 지적과 근거·패치를 포함한 완전한 최종 보고서를 작성해 주세요.
