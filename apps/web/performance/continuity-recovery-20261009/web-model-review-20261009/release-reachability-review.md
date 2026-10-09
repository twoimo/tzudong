**판정: P0 — 현재 ready 계약에는 Git 커밋 해시 자기참조 결함이 있습니다. 기본 실행 보류(held)는 유지해야 합니다.**

### 1\. 확정 결함: protectedRevision 자기참조

- admin-user-rpc-forward-successor.mjs:25-27,135-140 — Git 추적 대상인 고정 경로의 manifest를 읽습니다.
- :157-163 — ready 상태에서는 protectedRevision에 40자리 커밋 SHA가 필요합니다.
- :469-482 — admission.sourceRevision === manifest.protectedRevision을 강제합니다.
- :559-578 — 실제 checkout의 HEAD가 그 SHA와 같고, clean·detached 상태여야 합니다.

따라서 ready manifest를 포함하는 커밋이 자기 자신의 SHA를 manifest 내부에 기록해야 합니다.

커밋 후 SHA를 기록하면 작업 트리가 dirty가 되고, 다시 커밋하면 SHA가 바뀝니다. **일반적인 Git 커밋 절차로 충족할 수 없는 순환 계약입니다.** 이는 향후 운영 증거 부족과 구별되는 구조적 결함입니다.

### 2\. 최소 수정안

protectedRevision을 추적 manifest 내부의 필수 커밋 포인터에서 제외하십시오.

1. ready manifest와 고정 소스·도구 해시를 확정하고 보호된 main에 커밋합니다.
2. 해당 커밋의 실제 SHA R을 보호된 main readback에서 확보합니다.
3. 비추적 private admission에 sourceRevision=R과 검증 가능한 source readback을 기록합니다.
4. 실행 시 admission.sourceRevision, 검증된 protected-main SHA, 실제 clean·detached HEAD가 모두 R인지 확인합니다.

protectedRevision 필드를 유지한다면 null을 허용하도록 계약을 바꿀 수 있습니다. 이 경우 :482의 manifest 직접 비교는 **검증된 protected-main readback과의 비교**로 교체해야 합니다.

manifestSha256 결합(:480), 고정 파일 검증(:126-132,173-241), 15분 freshness(:485-492)는 유지합니다.

### 3\. protected-main readback의 필수 결합

현재 protectedSourceReadbackSha256과 operatingReadbackSha256은 64자리 해시 형식만 검사합니다(:483-484). 실제 증거의 내용이나 출처를 검증하지 않습니다.

유효한 source readback은 최소한 다음을 결합해야 합니다.

- 정확한 repository 및 보호된 refs/heads/main
- 보호 상태가 확인된 ref의 실제 커밋 SHA R
- R의 Git tree와 고정 manifest의 정확한 바이트·SHA
- manifest가 지정한 migration, acceptedSource, fiveStage, toolchain
- admission의 sourceRevision=R, manifestSha256 및 실제 checkout
- readback 시점과 admission 유효기간

운영 readback은 동일한 admission에 대해 정확한 프로젝트 aqlcofblfxdrjhhdmarw, PostgreSQL 170006, 실행 역할 postgres, 선행 ledger 85건, five-stage 정확성, 대상 RPC 부재 및 protected state root를 결합해야 합니다.

관련 검증은 :430-453,605-619에 있으나, **실제 보호된 main의 출처 증명과 readback 해시의 내용 검증은 공급된 코드에서 확인되지 않습니다.**

### 4\. 유지해야 할 실행 경계

- 프로젝트·DB 버전: JSON 5-9
- ledger 80 → 85 → 86: JSON 17-20
- migration 원본과 statement vector: JSON 33-41
- live preflight 일치: 코드 :608-619
- 불확실한 적용 결과의 재전송 방지: 코드 :533-556

현재 manifest는 held, protectedRevision=null입니다(JSON 11-16). 따라서 기본 실행 차단은 의도대로 작동합니다.

**결론:** 자기참조는 확정적인 계약 결함입니다. 보호된 main의 실제 readback, 최신 운영 상태 및 admission 증거는 아직 확보 여부가 확인되지 않은 별개의 실행 선행조건입니다. 최소 수정은 커밋 SHA 결합을 추적 manifest 밖으로 옮기고, 검증된 protected-main readback을 실행 조건으로 강제하는 것입니다.

이 평가는 제공된 스냅샷만 사용한 정적 검토이며, 런타임 실행이나 배포 검증은 수행하지 않았습니다.