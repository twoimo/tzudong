# 목표 실행 목록 — 2026-10-14

전체 완료가 아니다. 최신 지시대로 휴대폰을 사용하지 않는다. 아래 검증은 소스, 로컬 실행, 실제 SDK, 운영, field를 구분한다. 기존 목록과 실패 증거는 보존한다.

| 우선순위 | 작업 | 확인된 상태 | 다음 실행 및 완료 조건 |
|---|---|---|---|
| P0 | PR3201 검토 4건 | data 승격 d608d9f9 완료, main 승격 검토 미해결 | preflight 시간 제한, 저장된 리허설 admission 결속, 독립 checksum pin, 최신 검증 기록을 수정·검증하고 새 보호 PR로 전달 |
| P0 | SQL 실행·증거 정확성 | 수정은 작업 복제본에 있으며 운영 변경 없음 | 관련 unit·타입·린트, 정확한 PG17.6 격리 replay·rollback·실패 경로, 현재 source hash 확인 |
| P0 | 보호 승격·운영 배포 | SDK 복구와 readiness는 data에 있으며 main 미승격 | codex→develop→data→main, exact-head CI·검토 해결, 현재 production rollback, READY·alias·SHA·실제 사용자 흐름 확인 |
| P0 | 11단계 리뷰·미디어 | launch held, hosted apply 없음 | 새 source/rollback/7 writer fence 관측·rollback rehearsal·원래 UUID 확인·원자 apply/readback. 형식 검사만으로 gate 충족 주장 금지 |
| P0 | private verification | 과거 8개/9.81MB 계획 | 최신 참조·바이트·권한 확인, private 사본 검증 후 public 삭제, 관리자 접근·익명 거부·캐시 확인 |
| P0 | 메모리 회귀 | A/A4 + A/B9쌍 총22프로세스 완료. end heap 33.244544→35.616036MB, 20% guard 불확실 | 후보 ca7674c5 승격 제외. 큰 데이터 요청·SDK 자원 수명 경로를 실제 trace로 진단한 뒤 새 후보 사전 계획·동등 조건 비교 |
| P0 | 플리커 | 기존 증거 보존, 전체 제거 미입증 | 검은 사각형·marker/타일 공백 각각 픽셀·타임라인·발생률·지속시간·캡처 한계, normal/reduced motion 비교 |
| P1 | 사용자 흐름 매트릭스 | 실제 SDK 복구4/4, 반복 선택 동등성 | desktop/tablet/mobile 에뮬레이션, empty/2000/slow/cache/뒤로/연속입력/viewport/복귀. 실기기로 일반화 금지 |
| P1 | 쯔양 리뷰 전수 검사·개선 | Gemini3.8Flash High 분류1659행, 수정21안 staged, 적용0 | 최신 분모·원문·관리자 preimage, 2개 교정·1개 표시만 수정·1개 보류, Preview/Confirm/Apply/Readback/Audit |
| P1 | 랭킹·공통헤더·PNG·timestamp·필터 | 기존 소스·체크포인트 | 최종 운영 SHA에서 정상/빈 결과/실패·반응형·접근성 확인 |
| P1 | transition·scroll | 스킬 설치·기존 구현 | reduced motion·키보드·취소/재삽입·스크롤/선택 보존, 프레임·운영 검증 |
| P1 | Cloudflare 무료 활용 | 기존 읽기 증거, 유료 변경0 | 현재 대용량 object·캐시·전송·요청량/무료 한도 확인; 비용 변경 없이 실제 경로 개선 |
| P1 | prospective field v2 | v1 histogram은 사용자의 수가 아님; 브라우저/tablet/eligible 분모 부족 | 수집 전에 cohort·지원/누락·중복/의존성·표본/기간·회귀 기준 고정, 계측→전송→저장→집계·실사용 평가 |
| P1 | 증거 봉인·전달 | remote 16packet/523file 확인, 신규4packet 미봉인 | 원시22회·실패할당·보안·리뷰 수정안의 map/독립 pin/validator·원격 바이트 동등성, 최종 정량표·재현 절차 |
| 제외된 검증 | Galaxy Chrome·삼성 인터넷 | 사용자 “휴대폰 없이 검증해” | 기기를 점유하거나 재승인 요청하지 않는다. 이번 실행에서는 미검증으로 보고 |

이 순서는 실제 배포 차단과 정확성을 먼저 해결한다. 작은 ID 비교 후보의 결과를 개선으로 채택하거나 고정 memory/latency guard를 완화하지 않는다. 운영 writes·완료 상태는 실제 영수증을 확보한 후 별도 후속 기록에 반영한다.
