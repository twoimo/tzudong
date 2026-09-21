# 이력 복원 다이어그램 검증

이 폴더의 workflow/lifecycle JSON과 HTML만 구현 대상으로 수정했다. README, 애플리케이션 소스, 마이그레이션은 수정하지 않았으며 커밋하지 않았다.

## 현재 산출물과 영수증

| 유형 | HTML | 원본 | 전달 영수증 | CUA 화면 증거 |
| --- | --- | --- | --- | --- |
| workflow | [HTML](storyboard-local-mlx.html) | [JSON](storyboard-local-mlx.workflow.json) | [deliver](storyboard-local-mlx.delivery.json) | [CUA](storyboard-local-mlx.cua-visual-check.json) |
| lifecycle | [HTML](storyboard-local-mlx.lifecycle.html) | [JSON](storyboard-local-mlx.lifecycle.json) | [deliver](storyboard-local-mlx.lifecycle.delivery.json) | [CUA](storyboard-local-mlx.lifecycle.cua-visual-check.json) |

각각 최종 `validate` 및 `deliver`: showcase 9/9, errors 0, warnings 0. 전체 SHA-256와 byte count는 전달 영수증에 있으며 현재 파일과 일치함을 확인했다. CUA에서 light 1440×900, 1600×1000, 1920×1080, 2048×1320 및 dark 양 끝 크기의 scrollWidth/scrollHeight가 viewport를 넘지 않음을 측정했다. 두 테마의 양 끝 크기 화면을 직접 확인했다. workflow 시각 보정 0회, lifecycle 1회: 중복 guided-view 패널을 제거해 1440×900의 세로 넘침을 해결했다. 원본 후보의 경로 진단 수정과 시각 보정 횟수는 별개다.

기본 `visual-check`는 CUA 외 DevTools-pipe 브라우저를 실행하므로 현재 브라우저 도구의 CUA 전용 지침에 따라 실행하지 않았다. 종료 코드를 만들거나 자동 검증 통과/브라우저 부재로 표시하지 않았다. `.cua-visual-check.json`은 별도 보충 검증이며 기존 `.visual-check.json`, contact sheet, PNG는 이전 해시에 묶인 역사 기록이다. 기존 기록에는 현재 산출물의 증거가 아니라는 표시를 추가했고 PNG는 보존했다. 이번 스크린샷은 작업의 CUA 도구 출력에서 확인했으며 새 PNG로 저장하지 않았다.

## 사실 근거와 해석 범위

- [불변 마이그레이션](../../../backend/supabase/migrations/20260920021531_storyboard_historical_restore.sql): owner 확인과 프로젝트 행 잠금 후 동일 requestId의 targetRevision/sceneNo를 판정한다. 동일 요청은 현재 snapshot을 반환하고, 다른 내용은 request_conflict. 신규 요청만 CAS와 queued/claimed busy 검사를 거쳐 적용한다.
- [production-store.ts](../../../apps/web/lib/admin/storyboard/production-store.ts): 현재 revision이 요청과 같고 활성 job이 없을 때 선택한 이력 자산의 owner/project/scene와 원본 metadata·bytes를 사전 검사한다. 재전송 및 stale/busy 판정은 RPC에 맡긴다. 원본 bytes 검사는 DB 트랜잭션 밖이며 RPC는 자산 metadata를 다시 확인한다.
- 복원은 전체 문서 또는 선택 장면을 새 프로젝트 revision = 현재 + 1로 저장한다. 복원 장면 revision = max(현재, 이력) + 1. request의 providers/동의를 되돌리지 않고, 모델 호출·새 job 없이 snapshot·request ledger·restored 이벤트를 기록한다. 이미지 bytes를 재생성하지 않는다.
- 메모리 식은 운영 추정 모델: used + additionalPeakEstimate + reserve ≤ physical; reserve = max(16 GiB, 12.5% × physical). 추가 peak 추정에 추론·PNG/WebP·업로드 버퍼를 포함하며 이미 used에 잡힌 상주량을 중복 합산하지 않는다. 디스크 크기는 상주 메모리가 아니며 추정 통과가 실행 성공을 보장하지 않는다.
- 큐 식은 단일 워커 근사의 Lindley W[n+1] = max(0, W[n] + S[n] − A[n]); S는 처리시간, A는 도착 간격이다. 활성 워커가 없으면 대기시간은 미정이며 생성시간과 다르다. 실제 큐의 가용 시점/lease/backoff/모델 자격을 모두 예측하는 SLA가 아니다.
- failed/cancelled 뒤에도 현재 revision·busy·provider·남은 작업 조건을 통과한 명시적 retry가 새 job을 만들 수 있다. ready 문서처럼 재시도할 작업이 없으면 nothing_to_retry다. lifecycle은 프로젝트 단계와 명시한 job 상태 및 lease 이벤트를 함께 보여주는 개요이며, 모든 DB 상태의 전이 표가 아니다.
- 사용자 제공 최신 운영 현황: 부모 변경 커밋 168dbcab; 실제 프로젝트 v19 ready. 워커 복구 후 장면 재생성 v18은 새 asset id이지만 같은 prompt에 같은 bytes였고, 이어 v16의 정확한 장면 복원을 수행했다고 전달받았다. 이번 문서 작업에서 운영 환경을 독립 재검증한 결과로 주장하지 않는다.

남은 제한: 기본 visual-check의 자동 receipt와 새 PNG는 미생성. 내보내기 메뉴 열기/닫기만 확인했으며 PNG/SVG 등 실제 다운로드 파일의 bytes는 검증하지 않았다. 본문은 한국어이며 고정 Viewer UI와 html lang은 English fallback이다. 추가 소스 변경이나 운영 조치는 이 작업에서 수행하지 않았다.
