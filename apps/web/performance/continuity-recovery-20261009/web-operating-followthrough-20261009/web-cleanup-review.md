## M5 25-Object Cleanup — 독립 위험 검토

**판정: HOLD 유지 / 운영 배포 승인 불가**

검토 기준: dd9fcfd291843c59ced8d3da55fcc04e09e82b2c

제공된 동결 소스에서는 단계별 원자적 마이그레이션, 상태 해시 검증, writer fence, 실패 후 reconciliation을 확인할 수 있다. 그러나 **5단계 전체의 원자성, Storage 삭제 완료, 운영 롤백 가능성은 입증되지 않았다.**

현재 launchPolicy.state=held이며, 운영 적용·승인·배포를 증명하는 hosted receipt가 없다.

### 1\. 심각도순 발견 사항

#### \[CRITICAL\] F1. 부분 커밋 이후 전체 복구 경로 불충분

**위치**

- apps/web/scripts/supabase-migration-transaction.mjs:192-217
- apps/web/scripts/admin-record-sql-successor.mjs:355-370
- apps/web/scripts/admin-record-sql-successor.mjs:879-897

각 마이그레이션의 SQL과 ledger 기록은 하나의 트랜잭션으로 처리된다. 그러나 제공된 실행 경로는 **5개 마이그레이션 전체를 하나의 트랜잭션으로 보장하지 않는다.**

예를 들어 1~3단계가 커밋되고 4단계에서 실패하면 앞선 커밋은 유지될 수 있다.

Admission의 최초 상태는 targetCount=0을 요구하므로, 부분 적용 이후 최초 상태를 전제로 하는 단순 재실행은 적절하지 않다.

**필수 조치:** 단계별 커밋 복구 절차를 명시하고, 부분 적용 상태에서의 재입장 또는 forward recovery 경로를 검증해야 한다.

#### \[HIGH\] F2. COMMIT acknowledgement 손실 시 성공 판정이 막힐 수 있음

**위치**

- apps/web/scripts/apply-supabase-migration.mjs:517-535
- apps/web/scripts/admin-record-sql-successor.mjs:879-897

실행기는 오류 발생 후 reconciliation을 수행한다.

그러나 reconciliation이 committed를 반환하더라도 commandCompleted=false라면 성공 반환 조건에 해당하지 않아 MIGRATION\_OUTCOME\_UNCONFIRMED로 종료될 수 있다.

즉, **실제 커밋이 완료됐지만 실행기는 실패를 보고하는 상황**이 가능하다.

이는 보수적인 동작이지만 운영 복구에는 별도의 절차가 필요하다.

최종 journal의 terminal 오류 기록만으로 트랜잭션 롤백을 판단해서는 안 된다.

**필수 조치:** 원본 journal을 보존하고, ledger와 실제 schema 상태를 독립적으로 재확인한 후 다음 단계를 결정해야 한다.

#### \[HIGH\] F3. 25건 조회 제한이 전체 cleanup 완료를 보장하지 않음

**위치**

- backend/supabase/migrations/20261009091342\_admin\_record\_private\_verification\_cleanup.sql:21-43
- 같은 파일 :184-214

cleanup\_read는 state<>'done'인 작업을 최대 25건 반환한다.

문제는 다음과 같다.

- 25건은 전체 작업 수가 아닌 반환 페이지의 상한이다.
- verification key 하나가 두 버킷의 cleanup job을 생성한다.
- 따라서 verification key 25개만으로도 최대 50개 job이 만들어질 수 있다.
- 앞선 25개 job이 uncertain 또는 inflight 상태에 머무르면 후속 job의 조회가 지연될 수 있다.
- 반환값에 전체 미완료 건수나 명시적 페이지 커서가 없다.

**필수 조치:** 모든 job의 최종 상태와 두 버킷의 실제 객체 부재를 대조해야 한다.

cleanup\_read 응답 한 페이지의 성공만으로 완료 처리하면 안 된다.

#### \[HIGH\] F4. Writer fence의 실제 활성화 증거 부족

**위치**

- backend/supabase/migrations/20261009091342\_admin\_record\_private\_verification\_cleanup.sql:46-105
- 같은 파일 :226-237
- apps/web/scripts/admin-record-sql-successor.mjs:496-511

SQL에는 신규 참조와 Storage metadata 변경을 차단하는 함수가 존재한다.

그러나 제공된 다섯 번째 마이그레이션은 이 함수들의 trigger를 새로 설치하지 않는다. 기존 마이그레이션에 설정된 trigger의 존재와 활성화 상태에 의존한다.

특히 admin\_record\_object\_fence()는 특정 TUS DELETE probe를 BEFORE 단계에서 통과시키고, 후속 deferred trigger가 커밋을 차단한다는 전제를 사용한다.

**필수 조치:** 운영 DB에서 trigger의 설치 대상, 활성화 여부, 실행 시점과 deferred 동작을 검증해야 한다.

Writer fence receipt 역시 해당 시점의 상태 증거이므로 적용 직전 상태 재확인이 필요하다.

#### \[HIGH\] F5. 공유 Storage 객체 삭제 위험

**위치**

- backend/supabase/migrations/20261009091342\_admin\_record\_private\_verification\_cleanup.sql:24-43
- 같은 파일 :172-200

Cleanup job은 삭제 대상 review의 사진 키를 기준으로 생성된다.

제공된 부분에서는 동일한 Storage key를 다른 활성 review가 참조하는지 확인하는 조건이 보이지 않는다.

새로운 참조를 막는 fence는 이미 존재하는 공유 참조 문제까지 해결하지는 않는다.

또한 ON CONFLICT DO NOTHING이 적용되어 있으므로 충돌 시 기존 job과 소유 관계를 정확히 확인해야 한다.

**필수 조치:** Storage 삭제 전 모든 활성 review에 대한 참조 부재를 확인해야 한다.

다만 생략된 원본 SQL 또는 consumer에서 이 검증을 수행할 가능성은 남아 있다.

#### \[HIGH\] F6. 애플리케이션 롤백과 데이터 복구의 경계

**위치**

- apps/web/scripts/admin-record-sql-successor.mjs:480-494
- 같은 파일 :550-563
- docs/agents/release.md:5-13

Admission은 rollback deployment SHA, URL 및 ready 상태를 요구한다.

하지만 이 검증만으로 다음을 보장하지는 않는다.

- 해당 배포가 실제 운영 직전 버전인지
- 이전 애플리케이션이 변경된 DB schema와 호환되는지
- 삭제된 Storage 객체를 복원할 수 있는지

특히 Storage 삭제는 DB 커밋 이후 별도 API 작업이다.

**Vercel 롤백만으로 DB 및 Storage 상태를 되돌릴 수 없다.**

### 2\. 핵심 불변조건과 실패 대응

| 불변조건 | 실패 상황 | 필요한 대응 |
| --- | --- | --- |
| 정확한 5단계 적용 | 중간 단계 실패 | 단계별 ledger reconciliation |
| 커밋과 성공 응답 일치 | COMMIT ACK 손실 | 독립 readback 후 재개 판단 |
| Cleanup 전체 완료 | 25건 이후 미처리 작업 | 전체 job 집계 및 반복 검증 |
| Retired object 재사용 금지 | Trigger 비활성·우회 | 실제 trigger 및 writer 검증 |
| 참조 중인 객체 보존 | 다른 review가 동일 key 참조 | 삭제 전 전체 참조 검사 |
| 복구 가능 상태 유지 | DB·Storage와 앱 버전 불일치 | DB·Storage 복구와 호환성 검증 |

### 3\. 최소 운영 절차

**Preflight**

1. held → ready 전환에 필요한 실제 운영 승인 및 보호 브랜치 상태 확인.
2. Protected main revision과 source/manifest SHA 일치 확인.
3. Fresh admission, rehearsal, writer fence, rollback receipt 검증.
4. 운영 DB의 초기 ledger·schema root와 예상 상태 일치 확인.
5. 모든 writer 중지 및 기존 trigger 활성화 확인.
6. DB 복구 수단, Storage 백업 및 복원 절차 확인.

**Apply**

1. 유효한 admission과 고유 attempt ID 사용.
2. 각 단계의 SQL·ledger 원자적 적용.
3. 단계별 커밋 결과 확인.
4. ACK 손실 또는 상태 불일치 시 즉시 중단.
5. 원본 journal을 보존하고 불확실한 작업은 재전송하지 않음.

**Readback**

1. 다섯 단계의 ledger version/name/statements 검증.
2. 최종 schema root 및 RPC·trigger 상태 확인.
3. Cleanup job 전체 집계.
4. pending/inflight/uncertain 잔여 작업 확인.
5. 두 Storage bucket에서 삭제 대상의 실제 부재 검증.
6. 대상 외 객체와 활성 review 참조의 보존 확인.

**Rollback / Recovery**

1. Writer fence와 변경 중단 상태 유지.
2. DB ledger·schema·cleanup 상태를 먼저 확정.
3. DB 복구 또는 forward recovery 중 적절한 경로 선택.
4. 삭제된 Storage 객체가 있다면 독립 백업에서 복원.
5. 복구된 DB와 호환되는 애플리케이션 배포 선택.
6. 최종 DB·Storage·애플리케이션 readback 이후에만 writer 재개.

### 4\. 누락된 Hosted Evidence

현재 제공되지 않은 핵심 증거는 다음과 같다.

| 증거 | 확인 목적 |
| --- | --- |
| Protected PR·main readback | 운영 소스 승격 확인 |
| Fresh admission·rehearsal receipts | 실행 전제 충족 확인 |
| Writer fence 실측 결과 | 외부 쓰기 차단 확인 |
| 운영 DB stage-0 readback | 정확한 초기 상태 확인 |
| Trigger catalog readback | Fence 실제 적용 확인 |
| 5단계 ledger·schema readback | 마이그레이션 완료 확인 |
| 전체 cleanup job 및 Storage API 결과 | 객체 삭제 완료·보존 확인 |
| DB·Storage 백업 및 복구 검증 | 실질적인 복구 가능성 확인 |
| Vercel rollback SHA·live URL readback | 운영 배포와 롤백 대상 확인 |

### 최종 Disposition

**HOLD 유지.**

현재 소스에는 실패를 제한하고 결과를 검증하기 위한 방어 장치가 있지만, 운영 적용의 가장 중요한 경계인 **부분 커밋 복구, ACK 손실 처리, 25건 이후 cleanup 완결성, 실제 writer fence, DB·Storage 복구 가능성**은 충분히 입증되지 않았다.

특히 F1~F5의 복구 및 검증 조건을 충족하기 전에는 live rollout 진행을 권고하지 않는다.

이번 판단은 제공된 동결 소스 발췌만을 대상으로 한 독립 검토이며, 실제 배포·승인·운영 변경이 발생했다는 의미는 아니다.