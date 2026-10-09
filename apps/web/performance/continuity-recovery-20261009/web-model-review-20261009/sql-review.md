**정적 SQL 검토 결과: 결함 4건(P0 1건, P1 2건, P2 1건)을 식별했습니다.** 운영 적용 전 P0와 P1 수정이 필요합니다.

| 심각도 | 위치 | 결함 및 발생 조건 | 최소 수정 |
| --- | --- | --- | --- |
| **P0 치명적** | admin-record-sql-successor.mjs:571-580, apply-supabase-migration.mjs:372-386 | psql --single-transaction에 \-c 또는 \-f 없이 SQL을 stdin으로 전달합니다. PostgreSQL의 해당 옵션은 \-c/\-f 실행에 적용되므로 단일 트랜잭션이 보장되지 않습니다. 현재 생성 SQL은 LOCK TABLE에서 실패할 수 있으며, 사전 검사와 reconciliation의 트랜잭션 설정도 보장되지 않습니다. | 두 실행기에 \--file=-를 추가하고 실제 PostgreSQL에서 실패 시 전체 롤백을 검증합니다. |
| **P1 높음** | admin-record-sql-successor.mjs:388-412, 539-542, 600-624 | admission의 protected-main·rehearsal·source·rollback 영수증과 writer fence는 해시 형식 및 선언된 상태만 검사합니다. 영수증 원본의 무결성, 보호 브랜치와 revision의 연결, 실제 writer 중단 상태를 확인하지 않습니다. 오래되거나 임의로 작성된 증빙도 형식 검사를 통과할 수 있습니다. | 신뢰 가능한 영수증 원본과 해시를 대조하고, revision·배포·rollback·writer fence의 실제 상태를 적용 직전 검증합니다. |
| **P1 높음** | admin-record-sql-successor.mjs:545-555 | DB 대상 검증에서 호스트 일치 **또는** postgres.<projectRef> 사용자명 일치만 요구합니다. 해당 사용자명을 가진 임의 호스트가 통과할 수 있으며 PostgreSQL URI의 연결 대상 재지정 파라미터도 제한하지 않습니다. | 허용된 direct/pooler 호스트를 각각 정확히 검증하고 연결 대상 변경 파라미터를 거부합니다. |
| **P2 중간** | supabase-migration-transaction.mjs:14-28, 91-99 | BEGIN ATOMIC 내부에서 CASE ... END의 END나 식별자 끝의 end를 블록 종료로 오인할 수 있습니다. BEGIN /\* comment \*/ ATOMIC도 인식하지 못합니다. 유효한 SQL이 잘못 분할되어 벡터 불일치 또는 컴파일 실패가 발생할 수 있습니다. | 주석을 제거한 토큰 스트림을 기준으로 블록 시작·종료를 판별하고 CASE와 중첩 구문을 구별합니다. |

**확인된 보호 로직:** 원본 statement vector의 해시·내용 검증과 원본 벡터를 이용한 ledger 기록 경로는 존재합니다(supabase-migration-transaction.mjs:119-123, 185-186, supabase-migration-bundle.mjs:238-249). 적용 오류 시 reconciliation을 수행하고 무조건 재전송하지 않는 경로도 확인됩니다(supabase-migration-bundle.mjs:308-341, apply-supabase-migration.mjs:462-488). 다만 P0 때문에 실제 실행기의 reconciliation 트랜잭션 일관성은 보장되지 않습니다.

**증거 범위:** 제공된 proof.json과 README는 PostgreSQL **17.6 로컬 합성 재현**에서 5단계 성공, 두 실패 경로의 원자적 롤백, 원본 벡터 보존, private/public cleanup 및 CAS fixture 통과를 보고합니다. 이는 운영 적용 증거가 아닙니다. 이번 검토에서 테스트를 실행하지 않았으므로 재현 결과를 독립적으로 확인한 것은 아닙니다.

**검토 공백:** .github/admin-record-sql-successor.v1.json 원문, 실제 마이그레이션 SQL 5개 및 영향받는 단위 테스트의 본문이 제공되지 않았습니다. 따라서 실제 SQL의 ownership·CAS·late-write fence 구현, 다섯 마이그레이션의 파싱 적합성, 테스트 커버리지는 확인할 수 없습니다. 별도로 진행 중인 admin user RPC 변경은 검토에서 제외했습니다.

**판정: 운영 적용 보류.** 합성 PG17.6 검증 결과는 운영 실행기의 트랜잭션 원자성과 승인 증빙의 신뢰성을 입증하지 않습니다.