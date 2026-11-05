# Tzudong 교차 감사·수정 및 배포 보류 근거

실제 일반 추론 감사 3건을 보존하고 유효 지적을 수정했다. 전체 CI는 수정 커밋 `2e0f8dd97e24164425653b4f3ed3153016c0878a`에서 6개 작업 모두 통과했다. **최종 소스 프리뷰와 새 운영 배포는 실제 Vercel build-rate-limit으로 보류 중이다.**

- Pro 논제: [편집 없는 전문](chatgpt_master_plan.md), 44,976 bytes.
- Gemini: [사고 수준 최고가, Deep Research 아님](gemini-report-index.md), 실제 4 Argon → 높음, [편집 없는 전문](gemini_4_argon_deescalated_report.md), 36,989 bytes.
- GPT-6 Pro 역검증: [편집 없는 전문](chatgpt_reverse_report.md), 9,631 bytes. 실제 research tool OFF.
- 판정·수정: [TH/GEM 결정과 반증](finding-adjudication-working.json), [REV-M-01](REV-M-01-resolution.json), [SDK 정리](LOCAL-RUNTIME-01-resolution.json), [추가 4건](PR3490-final-finding-resolutions.json), [CI·콜백 연결 검사](ci-source-assertion-remedy.json).
- 관련 59개 검사, 추가 source-effect 연결 검사 23개, native/compat 타입 검사와 scoped lint 통과. SDK/DOM을 대체한 검사는 SYNTHETIC_MOCK_TESTED이며 실제 provider·물리 기기 검증으로 표시하지 않는다.
- [전체 CI 재실행 결과](corrected-full-ci-readback.json), [검증 소스 파일 해시](final-verification-inputs.json), [공개 영수증 경로 가림](public-receipt-redaction.json). 전문 3건과 canonical coordinator state는 바꾸지 않았다.

## 실제 배포 경계

[Vercel 한도 근거](vercel-build-rate-limit-hold.json): 서비스가 2026-10-22T22:37:06Z에 24시간 후 재시도를 안내했다. 정확한 reset과 현재 사용 횟수는 미확인이다. 시간 경과만으로 available을 추정하지 않는다. 요금제·계정·우회 배포·생산 승인 SHA를 변경하지 않았다.

[main 승격 PR #3490](https://github.com/twoimo/tzudong/pull/3490)은 Draft다. 런타임 수정은 보호 경로로 data에 반영했고, 추가 연결 검사·증거의 data 승격은 [#3499](https://github.com/twoimo/tzudong/pull/3499)에서 추적한다. 재개 시 현재 Git과 PR head를 새로 읽는다.

[현재 운영 readback](baseline-production-readback-at-quota-hold.json)은 기존 SHA `6e6cad4e3891b3ed64a79c9a04ec38e41e53c4fb`가 정상이며 4곳의 WebP 12개와 공개 마커 735건이 유지됨을 확인한다. 이 결과는 새 수정의 운영 배포 증거가 아니다. [이전 프리뷰](pre-final-source-preview-readback.json)는 추가 4건 수정 전의 역사적 근거다.

재개 순서는 실제 한도 재확인 → 최종 소스 프리뷰와 PC·모바일·태블릿의 국내·해외 화면 확인 → 보호 develop → data → main → 그 시점의 롤백 SHA와 exact-SHA 승인 → READY·alias·health·12개 자산·실제 UI readback → manifest와 artifact map 독립 검증이다. 다른 작업·예약·계정·보호 절차를 변경하지 않는다. 기존 heartbeat tzudong은 이미 PAUSED였으며 그 상태를 보존한다.

## 별도 상태와 한계

Nightly `39457197351`은 과거 실패 근거이며 이번에 재실행·해결한 것으로 표시하지 않는다. CI 통과와 배포 상태로 Nightly 통과를 추론하지 않는다. 프레임은 4곳의 현장 맥락 12개로, L1 신원·전체 식당·물리 기기·현장 성능의 증거가 아니다. 조회 등급은 역사적 연결 영상 데이터이며 음식 품질·실시간 인기의 증거가 아니다. 메모리·physical·field·flicker 및 strict marker/CSP의 기존 미입증 범위도 별도로 유지한다.

[현재 완료·보류 manifest](completion-manifest.json). 전체 작업 완료는 아직 아니다.
