# 검수 조회의 DB 페이지 처리 · 2026-10-04

검수 첫 조회와 변경 후 조회가 전체 카탈로그 JSON을 읽던 경로를 DB의 검색·필터·정렬·커서 RPC로 교체했다. 목록은 기본 50건·최대 200건이며 전체 통계는 전체 인덱스, 중복·삭제 경고는 선택 영상의 모든 관련 행을 대상으로 계산한다. 관련 행은 200건씩 읽고 경고의 개수·상위 3건만 보존한다. 상세 근거와 승인 권한은 기존 전체 행 조회에 남아 있다. 기존 전체 응답은 소비자 호환용 경로에 보존했다.

입력에 따라 변하는 표시명·분류·지오코딩 상태·검색·날짜를 비공개 읽기 인덱스로 유지한다. 기존 승인 테이블 값은 바꾸지 않는다. 새 JSON 반환은 기존 카탈로그의 명시된 컬럼 목록을 사용해 미래에 추가된 컬럼이 자동 공개되지 않도록 했다. 서버는 UUID·통계·필터·응답 크기를 검증하고, 익명·사용자 역할의 RPC/뷰 접근을 거부한다. 변경 중 조회와 이전 revision의 커서는 409로 거부한다.

원본 transforms 1,329건을 격리 PostgreSQL 17.6에 읽기 전용 입력으로 재생해 **115개 질의의 순서·식별자·전체 통계가 모두 일치**했다. 처음 대조에서 숫자 필터 3건이 달랐다. JavaScript의 16진수 `parseInt`와 IEEE 754 소수 반올림을 SQL에 반영해 수정했다. 원본 SHA256은 `73c831c808a32834b16008851dee955d2483e7f639ae675a1f2089b5d7033587`이며 원본 파일 변경은 0건이다. 운영 DB에서는 집계만 읽어 PG 17.6·1,659건·생성 시각 null 0건·비 ISO 게시일 0건을 확인했다. 그 집계는 운영 RPC 적용이나 성능 증빙을 의미하지 않는다.

반복 조회는 전체 카탈로그 대신 결과 페이지 요약을 재사용한다. 매 요청이 새 DB revision을 확인하며 동시에 시작한 조회만 revision 요청을 합친다. 동일 질의 100개는 페이지 작업 1회로 합쳐졌고, revision 변경·30초 경과·실패 뒤에는 새로 읽었다. 캐시는 최대 16개·직렬화한 요약 합계 8MiB이고 동시에 다른 페이지를 만드는 작업은 최대 4개다. 슬롯 부족은 503이며 요청을 무제한으로 쌓지 않는다. 여러 서버 인스턴스의 총 동시성 한도는 이 검증 범위가 아니다.

이름 유사도는 같은 전화번호·주소·20m 이내 좌표 중 하나가 참인 경우만 계산한다. 같은 식별명은 즉시 기존 최우선 규칙으로 반환한다. 나머지 규칙이 이 세 조건 중 하나를 필수로 요구하므로, 세 조건이 모두 거짓이면 편집 거리를 계산해도 결과는 바뀌지 않는다. 연산 수는 기존 약 \(km\)번에서 적격 비율 \(p\)에 따라 약 \(pkm\)번으로 감소한다. 1,000개 합성 행·50개 대상의 7쌍 실험에서 결과 SHA가 모두 같았고 이름 거리 계산은 41,768→1,110회였다.

| 측정 | 변경 전 → 후 | 절대 차이 | 개선율·95% CI | 표본·환경 |
|---|---|---|---|---|
| DB 읽기·JSON 해석 p75 | 120.83→17.17ms | −103.66ms | 85.79% [84.92, 87.23] | 7쌍, 로컬 PG17.6 socket·Python3.14 |
| 읽기 결과 직렬화 바이트 | 4,249,507→196,525 | −4,052,982bytes | 95.38% 감소 | 고정 1,329건, 전후 7회 동일 |
| 중복 경고 계산 p75 | 101.81→44.25ms | −57.56ms | 56.54% [54.61, 59.72] | 7쌍, Bun1.4·합성 행 |
| 중복 경고 CPU p75 | 119.63→48.81ms | −70.82ms | 59.20% [53.56, 60.61] | 같은 7쌍 |
| 50건 수정 p75 | 1.33→18.48ms | **+17.15ms** | **1,291.60% 악화** [1,178.08, 1,604.04] | 7쌍, 인덱스 trigger 유무·매회 rollback |

DB 읽기는 실제 SQL·드라이버 해석이며 Supabase HTTP·인증·브라우저 지연은 포함하지 않는다. 이전 Node 카탈로그 캐시가 적중할 때의 비용과 위 DB 수치를 동일시하지 않는다. 변경 후 첫 읽기 약 104ms 절약은 50건 수정 약 17ms 추가 비용 6회로 소진되므로, 순이익은 읽기/수정 빈도에 의존한다. 조회량이 적은 일괄 쓰기는 느려졌다. 운영 빈도와 실제 비용은 아직 측정하지 않았으며 전체 파이프라인·공식 G003·금액 절감 주장은 하지 않는다.

신뢰구간은 짝지은 7회 표본을 seed 20261004로 5,000회 재표집한 p75 변화율의 2.5/97.5 분위수다. 고정 바이트·연산 개수는 구조 검증이며 모집단 신뢰구간을 붙이지 않았다. 기존 실패 실험과 수정 후 측정을 구분해 보존한다.

검증은 전체 웹 2,704 통과·9 건너뜀·실패 0, 페이지/HTTP/경고 경계 검사, PG 정규화·권한·커서·변경·delete/truncate·타입 오류 검사와 native/compat 진단 0이다. Next 16.3.8 프로덕션 번들·타입 생성·CSS 경계도 통과했다. 작은 단위 DB에서는 인덱스를 강제해 사용 가능성을 확인하며, 실제 1,329건 EXPLAIN은 원시 측정에 별도로 보존한다. 강제 인덱스 검사 자체를 속도 증빙으로 사용하지 않는다.

새 SQL은 아직 운영에 적용하지 않았다. 기존 migration 원본은 유지하며 추가 migration과 G014 읽기 RPC allowlist/권한 계약을 함께 준비했다. 운영 적용·쿼리 계획·revision readback 및 보호된 배포와 실제 API·화면의 추가 100회 관측은 남아 있다. 증빙은 `apps/web/performance/pipeline-20261002/admin-db-read-write-raw-20261004.json`, `warning-gate-raw-20261004.json`, `admin-page-component-summary-20261004.json` 및 독립 SHA256이다.

리뷰 수·갱신 시각이 바뀌어도 기존 revision이 유지되는 추가 결함을 확인했다. 적용된 trigger는 그대로 두고 `20261004003503_admin_evaluation_display_revision.sql`로 두 컬럼의 revision 갱신을 추가했다. 조회수만 바꾸는 갱신은 여전히 제외한다. 격리 PG에서 리뷰 수 변경 후 revision 증가, 조회수만 변경 후 유지가 통과했다.

운영 보안 advisor의 기존 6개 분류도 읽었다. 이 새 로컬 SQL을 검사한 결과와 혼동하지 않는다. 서비스 전용 테이블의 무정책 RLS는 의도한 거부 경계이고, 기존 공개 항목의 변경은 이번 조회 최적화에 섞지 않았다. 기존 점검의 설명은 [무정책 RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [definer view](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [공개 확장](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [익명 함수 실행](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [사용자 함수 실행](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [유출 암호 방지](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)에서 확인할 수 있다.
