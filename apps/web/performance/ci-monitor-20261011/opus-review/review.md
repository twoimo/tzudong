## 최종 검토: 3대 결함과 최소 수정

**1. 점근 복잡도: 매 주기 전체 이력을 다시 읽을 위험**
- 모델: 주기당 비용 = 목록 페이지 수 + (신규/진행 중 run 수 × jobs 페이지 수).
- 문제: 목록을 매번 처음부터 페이지네이션하면 주기당 O(H)입니다. 그러면 이력이 누적될수록 총비용이 O(H²)로 커집니다.
- 문제: 장시간 진행 중이거나 queued에 머문 run은 매 주기 재조회됩니다.
- 최소 수정: `created>=워터마크−겹침창(예: 48h)` 필터, `per_page=100`, ETag 조건부 요청을 씁니다.
- 최소 수정: 진행 중 run은 최대 재조회 횟수를 두고, 초과하면 stale로 표시합니다.
- 절감 효과는 측정 전까지 주장하지 않습니다.

**2. 캐시 완결성: attempt와 페이지 누락**
- jobs API의 기본값은 `filter=latest`입니다. 재시도 전 attempt의 job과 step이 조용히 사라집니다.
- 목록 페이지네이션 중 새 run이 들어오면 경계에 있는 run이 누락될 수 있습니다.
- `updatedAt`만으로는 job 확정 여부를 보장하지 못합니다.
- 최소 수정: 키는 (runID, attempt)로 하고, `/attempts/{n}/jobs`로 attempt별로 저장합니다.
- 최소 수정: 받은 job 수가 `total_count`와 같고, 모든 job에 `completed_at`이 있을 때만 immutable로 확정합니다.
- 최소 수정: 404나 보존기간 만료는 tombstone으로 남겨 결측과 구분합니다.

**3. 통계 cohort와 반복 검정: 실효 표본 과대평가**
- 같은 SHA나 tree 안의 run은 독립이 아닙니다. 기존 근거도 실효 n은 run 9가 아니라 tree 3에 가깝습니다.
- run 단위 bootstrap은 CI를 과도하게 좁힙니다.
- n=7에서 p95는 사실상 최댓값입니다.
- 6시간마다 CI를 갱신해 신호를 띄우면 optional stopping으로 위양성이 누적됩니다.
- cancel/fail의 소요시간은 절단값이라 분포에 섞으면 편향이 생깁니다.
- q(대기시간)는 시간대와 runner 가용성에 교란됩니다.
- 최소 수정:
  - 단위를 source tree로 두고, cluster 중앙값과 cluster bootstrap을 씁니다.
  - p95는 cluster 20개 이상일 때만 보이고, 그 미만은 "insufficient"로 표시합니다.
  - 판정은 주 1회 고정 비교로 하거나 always-valid CI를 씁니다.
  - cancel은 censored로 분리합니다.
  - q와 t를 따로 보고합니다.

## 근거 해석 주의

- 변경 후 743초 / 2528초는 n=1입니다. 개선 신호로만 기록하고 인과를 주장하지 않습니다.
- Local 49%는 duplicate typecheck에 한정된 결과입니다. 전체 CI로 외삽하지 않습니다.

## 다음 최적화 방향

T = max_j(q_j + t_j)이므로, 임계경로가 아닌 job을 줄여도 T는 줄지 않습니다.

- WindowsBun은 721초로 743초에 근접하고 악화되었습니다. 임계경로일 가능성이 큽니다.
- 순서:
  1. job별 q/t 분해로 임계경로를 확인합니다.
  2. WindowsBun에서 setup, install, test 단계별 시간을 확인합니다.
  3. 캐시 적중 여부와 shard 분할 가능성을 확인합니다.
- W는 비임계 job의 중복 setup과 cache miss를 제거해 줄입니다.
- 필수검사 보존, 자동 조치 0 원칙은 유지합니다.