# 검수·재시작 후속 검증 · 2026-10-04

응답 불확실 상태의 스토리보드 snapshot을 서버가 읽도록 `uncertain`을 허용했다. 수동 맛집 검수는 같은 불확실 응답의 재시도에 실행 ID를 보존하고, 미리보기를 취소하면 다음 실행에 새 ID를 쓴다. 실제 Next 화면의 390·834·1440px에서 각각 응답 유실 2회 → 같은 ID 재시도 → 취소 → 새 ID 성공을 확인했다. 각 화면의 가로 넘침은 0px, 페이지 오류 0건, 예상 밖 쓰기 0건이다. 모의 API만 사용했고 운영 DB·모델 호출은 0회다. 오류 메시지는 상태 readback 뒤에도 유지하고 열린 확인창 안에서 읽을 수 있다.

규칙 평가의 불확실 결과는 `.pending`에 기록하며 활성 입력으로 공개하지 않는다. 실패한 결과는 성공 종료로 기록하지 않는다. LAAJ는 완료 receipt와 출력 해시가 맞는 규칙만 소비한다. 대상 없음·자막 없음·receipt 없음·규칙 손상·규칙 삭제의 오래된 LAAJ 결과와 receipt는 잠금 안에서 `.superseded`로 옮겨 정확한 바이트를 보존한다. 결정적인 부정 판정과 다음 성공 결과는 완료 receipt로 발행한다. selection → rule → LAAJ 순서의 잠금을 소비 중 유지하며 POSIX 자식 프로세스에도 넘긴다. 입력 변환의 동시 변경·재시작 검사와 실제 shell 중복 실행 검사는 모의 공급자를 사용한다.

미디어 캐시 삭제는 성공을 먼저 저장한 뒤 수행한다. 삭제의 PermissionError는 성공 상태와 OK manifest를 보존하고 고정 코드로 cleanup 보류를 기록한다. 이미 확정된 공급자·DB 작업을 다시 실행하지 않는다. 이는 실제 정리 실패를 주입한 기능 검사이며 전체 파이프라인 지연이나 RSS 개선의 새 측정은 아니다.

스토리보드 claim의 호환 모델 필터를 LIMIT 64보다 먼저 적용하는 새 마이그레이션 `20261004023841_storyboard_claim_capability_order.sql`을 준비했다. 적용된 SQL은 수정하지 않았다. PostgreSQL 17.6의 독립 DB에서 원래 이력과 보존된 배포 receipt 이력을 각각 실행했다. 이전에는 호환되지 않는 작업 65개 뒤의 호환 작업 1개를 claim하지 못했고, 변경 후 해당 작업 1개를 claim했다. 이전 작업 65개와 RPC owner·ACL·invoker·search_path·volatility·parallel 속성은 보존됐다. 두 실행에서 각각 21개 조건을 확인했다. 실제 공급자 호출은 0회다. 자료는 `storyboard-claim-capability-{original,receipt}-20261004.json`이다.

깨끗한 source replay의 invoker 검사보다 storyboard bridge를 먼저 실행하도록 정본 catalog generator와 격리 마이그레이션 workspace에 의존성을 명시했다. canonical 적용 SQL과 배포 이력은 보존한다. 관련 source/workspace·generator·stage 실행 검사 16개와 shell syntax가 통과했다. Docker 공간 제약 때문에 이 변경 뒤의 전체 catalog replay는 로컬에서 실행하지 않았으며 새 PR head의 CI에서 확인한다.

재검수 claim이 비어 있어도 다른 worker의 queued/running 작업이 있으면 새 영상 한 슬롯을 예약한다. 상태 readback이 불완전하면 역시 한 슬롯을 보수적으로 예약한다. 기존 한도 \(B=3\)에서 신규 영상 한도는 \(B-R\), \(R\in\{0,1\}\)이다. queued/running/empty와 불완전 receipt를 포함한 관련 Python 검사 19개가 통과했다. 이는 당시 상태의 예약 결정 검사이며 별도 호스트의 동시 작업 전체를 원자적으로 제한한다는 증빙은 아니다.

Gemini permit release는 공급자 응답을 재전송하지 않고 최대 3회 재시도한다. 완료 후 정리에 실패한 lease는 같은 Node 프로세스의 다음 호출 전에 다시 정리한다. 복구되지 않으면 새 공급자 호출을 막으며 살아 있는 작업을 시간만으로 회수하지 않는다. acquire 시점의 환경과 quota scope를 release/cooldown에도 사용한다. 실제 SQLite·살아 있는 Node PID·실패하는 Python release subprocess로 검증해 확정 응답 보존, 복구 전 추가 공급자 호출 0회, 복구 뒤 새 호출 성공과 남은 lease 0개를 확인했다. Node 24 SDK/timeout/cooldown 검사 12개가 통과했다.

폐기한 Codex/GPT 스토리보드 proof npm 명령, live 생성 E2E와 해당 source 문구 검사를 제거했다. 기존 CLI 이름의 수신 stub은 고정된 `storyboard_gemini_only` 거부만 반환한다. 현재 Gemini worker의 `--help`를 확인했고 운영 runbook을 실제 한 작업용 명령으로 바꿨다. 이번 검증은 실제 유료 생성을 실행하지 않았다.

전체 웹 검사는 최종 기술 식별자 보존 보완 직전 2,705 통과·9 건너뜀이다. 이후 Sentry 관련 14개가 통과했다. 관련 Python은 restart/stage/media 37개, 규칙 평가 16개, source replay/history/stage 16개이며 stage 5개는 두 묶음에 중복된다. 수치를 합산해 독립 표본으로 보고하지 않는다. 이 보고서는 기능·동시성·복구 증빙이며 처리시간·비용 개선율과 95% 신뢰구간은 새로 주장하지 않는다. 기존 성능 증빙과 회귀·한계는 별도 성능 보고서에 유지한다.

새 SQL의 운영 적용, 전체 catalog CI, 보호된 승격·배포와 실제 Sentry 이벤트 readback은 아직 완료되지 않았다. Sentry 조직 저장 지역 선택과 결제 수단 삭제의 대체 수단 의존성도 남아 있다. Copilot code scanning은 이전 head에서 월간 quota 초과(402)로 실패했으며 추가 유료 한도나 검사 우회를 적용하지 않았다.
