읽기 전용 감사 결과입니다. 수정·테스트·DB 실행은 하지 않았습니다.

1. **[P1] 복구 operation과 실제 워크플로 실행이 결속되지 않습니다.**  
   [rerun route](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/apps/web/app/api/admin/ocr-receipts/rerun/route.ts:180)는 현재 모델 설정으로 입력을 만들지만 dispatch에는 operation ID·target generation·snapshot이 없습니다. [workflow inputs](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/apps/web/lib/ocr/workflow-dispatch.ts:32)도 `reviewIds/modelPolicy/thinkingLevel`뿐이고, [worker](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/apps/web/lib/ocr/admin-receipt-processor.ts:626)는 실행 시점의 최신 generation을 읽습니다.  
   복구 전 대기하던 작업이 rotation 후 실행되거나 동일 operation 재전송 사이 설정이 바뀌면, 서로 다른 `model_policy` 또는 `input_context_hash`가 [durable unique key](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/backend/supabase/migrations/20261013190000_durable_receipt_ocr_results.sql:493)에 별도 행을 만들어 같은 recovery generation에서 Gemini 호출이 두 번 가능해집니다. 사진 변경 후 작업도 승인 snapshot과 다른 사진을 처리할 수 있습니다.  
   operation receipt에 target generation, 사진 snapshot, 정확한 모델·thinking/input binding을 저장하고 workflow에 전달해야 합니다. worker는 provider 호출 전에 이를 원자적으로 검증해야 하며, operation 없는 이전 작업은 recovery generation을 처리하지 못해야 합니다. 필수 반례 테스트는 “이전 queued run이 rotation 뒤 시작”, “동일 operation 재시도 사이 설정 변경”, “rotation 뒤 사진 변경”입니다.

2. **[P1] 서버 정책을 UI가 우회할 수 있습니다.**  
   [route](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/apps/web/app/api/admin/ocr-receipts/rerun/route.ts:108)는 명시적 preview action일 때만 복구 상태를 읽습니다. `action`이 없는 요청은 pending 행에서 reset을 건너뛰고 [그대로 dispatch](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/apps/web/app/api/admin/ocr-receipts/rerun/route.ts:255)합니다. 오래된 클라이언트나 직접 요청이 operation ID·복구 전용 비용 확인을 우회할 수 있고, 다른 관리자도 actor mismatch를 우회해 이미 회전된 generation을 dispatch할 수 있습니다.  
   서버가 모든 pending rerun에서 preview 상태를 확인해 `eligible/recovery_in_progress/processing`이면 정확한 recovery operation을 요구해야 합니다. 신규 미처리 `not_indeterminate`만 일반 dispatch를 허용하는 route 동작 테스트가 필요합니다.

3. **[P1] 비용 확인을 취소해도 다음 클릭에서 확인이 생략됩니다.**  
   [SubmissionListView](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/apps/web/components/admin/SubmissionListView.tsx:863)는 새 operation을 map에 저장한 뒤 [확인창](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/apps/web/components/admin/SubmissionListView.tsx:871)을 띄웁니다. 사용자가 취소하면 map이 남고, 다음 클릭은 `canReuseRetained=true`라 확인 없이 진행됩니다.  
   확인 성공 뒤에만 operation을 보존하거나 취소 시 즉시 삭제해야 합니다. “첫 확인 취소 → 두 번째 클릭”에서 다시 확인하며 POST 0회인지 검증해야 합니다.

4. **[P1, 107 상호작용] 108이 106에서 발견된 초기 default ACL 결함을 다시 만듭니다.**  
   [108 migration](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/backend/supabase/migrations/20261019130000_receipt_ocr_indeterminate_recovery.sql:532)은 알려진 역할만 revoke하고, [capability getter](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/backend/supabase/migrations/20261019130000_receipt_ocr_indeterminate_recovery.sql:497)는 sealed catalog와 allowlist 행만 봅니다. 107의 `aclexplode` 검사는 106 객체 전용이므로 108 신규 함수·테이블을 보호하지 않습니다. `supabase_admin` 같은 별도 default privilege가 붙어도 ready가 될 수 있습니다.  
   108 전용 owner/ACL canonical predicate가 필요하며, 실제 default-ACL 반례와 배포 후 grant drift에서 capability가 held가 되는 PG17 테스트가 필요합니다.

5. **[P2] TypeScript readback이 SQL CAS를 완전히 재검증하지 않습니다.**  
   [helper](/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/apps/web/lib/ocr/admin-receipt-recovery.ts:163)는 rotated 응답의 `previous_generation`이 요청의 `expectedGeneration`과 같은지 확인하지 않습니다. RPC drift가 다른 이전 generation을 반환해도 route는 dispatch합니다. equality와 새 generation의 비동일성 검증 및 위조 응답 단위 테스트가 필요합니다.

6. **현재 초안 불완전 상태:** migration은 `20261019130000`으로 옮겨졌지만 manifest, compiler, unit test와 migration 내부 capability version은 아직 `20261019110800`을 가리킵니다. 이는 진행 중 편집으로 보이며 현재 validator는 통과할 수 없습니다.

확인된 안전한 부분도 있습니다. recovery와 publish의 lock 순서는 `review → generation → result`로 일치합니다. 이전 generation의 late publish는 거부됩니다. `processing`을 자동 rotation하지 않는 동작도 안전한 fail-closed 정책입니다. 프로세스가 provider dispatch 뒤 죽으면 processing이 장기간 남을 수 있지만, 시간만으로 indeterminate로 바꾸면 실제 provider 호출과 중복될 수 있으므로 자동 전환하면 안 됩니다. 복구하려면 GitHub/provider 실행 identity와 terminal 증거를 별도로 영속화해야 합니다. 관리자 변경은 현재 actor mismatch로 fail-closed되고, 삭제된 review는 FK cascade/conflict로 막힙니다.

현재 SQL fixture의 late-publish 검증은 순차 실행입니다. 실제 두 세션에서 publish와 recovery가 맞물리는 lock 경합 테스트는 아직 없습니다. 협업 메시지 도구가 이 하위 작업에서 제거되어 `recovery108_finish`에 직접 전달하지 못했으므로, 위 1–5를 그 작업자에게 전달해야 합니다.
