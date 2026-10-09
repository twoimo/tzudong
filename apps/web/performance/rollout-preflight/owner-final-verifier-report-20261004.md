> Historical preparation snapshot. Current operating state is ledger78; use hosted-owner-final-readback-20261004-v2.json and the main operations report. This source-ready/testing snapshot predates the G016 identity correction.

# PG17 owner 복구와 최종 verifier 준비

최종 source ready. 운영 연결·DDL·grant·secret 읽기·commit/push는 이 작업에서 수행하지 않았다. 13개 chain 적용과 ledger75/기존62 보존은 root의 실제 운영 readback으로 전달받았다. base62 선택형 팩을 재사용하지 않는다.

최종 준비 디렉터리: `/Users/twoimo/.codex/runtime-cache/tzudong-owner-recovery-stages-20261004-astra-final`. 앞선 `astra`/`astra-v2` 디렉터리는 검토 중 초안이며 적용용이 아니다.

1. **ledger75 사전 검사:** 최종 디렉터리의 `before-recovery-read-only.sql`. postgres/PG17, 정확한 role 속성·멤버십, owner/body/ACL/search_path, 13개 ledger version/name 및 count75를 검사한다. 전체 기존 ledger 배열 SHA 보존은 root의 fresh ledger readback과 별도로 대조한다. 이 SQL을 운영에서 실행한 결과는 아직 없다.
2. **원본 복구만 별도 적용:** `20260906064252_g014_pg17_workflow_owner_contract.sql`. source SHA256 `8196f4fd81f2059e0da427d7022f5b7f768a945f7adbe7188f5409b540d25483`, 원본 byte 불변. 성공 후 ledger76·owner body `345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d`·self-grant 제거를 readback한다.
3. **새 verifier만 별도 적용:** `20261004115554_g014_pg17_owner_final_verifier.sql`. source SHA256 `a2a50b992a973c7eb12fe447769dc15374690f55488632a8c6e11119ea99ec97`. ledger76 및 정확한 복구 영수증을 먼저 요구한다. 기존 catalog-slice 임시 definer 패턴을 재사용한다. 임시 self-grant는 ADMIN=false/INHERIT=false/SET=true이며 assertion 전에 제거한다. owner assertion과 G014 3개를 owner 권한으로 호출하고 checker는 즉시 self-drop한다. 완료 전후 memberships/roles/non-temp functions/schema/default ACL/ledger 메타데이터가 같아야 한다. 성공 후 ledger77과 helper 부재·USAGE/SET 부재를 readback한다.

두 후속 파일 timestamp가 13chain의 마지막 `20261004120000`보다 앞서므로, 각 fresh75/76 history mirror 팩에 해당 source **한 개만** 넣고 `--include-all --skip-vault`를 사용한다. 사전 dry-run pending도 정확히 한 개여야 한다. 두 source를 합치거나 version alias를 새로 만들지 않는다. 이 준비 디렉터리는 단계별 source이며 완성된 CLI history workspace가 아니다. 각 팩은 그 시점의 실제 ledger metadata를 읽어 만들고, source SHA를 실행 전에 재확인해야 한다.

CLI 2.119.0의 원본 복구 실제 fixture 적용 영수증은 statement_count=1, statement SHA `92e475c2ca55bb82ad8132ced6b0ecda473508f2b035f59d3d6140b2e2481f8d`, PostgreSQL `to_json(statements)::text` 배열 SHA `42af1eec6543319af14934859b15cbb3c77e6a6ceea80cdc1d9432783491b0aa`다. CLI가 마지막 delimiter와 바깥 공백을 ledger에 포함하지 않으므로 파일 SHA와 다르다. 새 verifier는 이 실제 측정된 영수증을 검사하며 다른 기록을 추정해 허용하지 않는다.

## 검증 범위와 재시작

`TZUDONG_OWNER_FINAL_PG=1 python3 -m unittest -v backend.supabase.tests.test_g014_owner_final_verifier`: **11 tests PASS, 9.127초**. 새 전용 socket-only native PostgreSQL17.6 cluster를 생성·종료했고 공유18802 cluster는 변경하지 않았다. 테스트는 immutable 원본 복구 SQL을 그대로 사용한다. 광범위한 G014 3개는 명시적인 fixture assertion과 테스트 복사본의 SHA 치환으로 권한·호출·정리 경로를 검증했다. 실제 운영 catalog 전체 assertion 통과나 canonical full replay를 증명하는 결과는 아니다. production source는 이 fixture 본문을 거부한다.

- 성공, 3개 assertion 각각의 실패, 명시 rollback, private helper 충돌, 예상 밖 default EXECUTE grant, app-role 호출, 본문/ACL/role/member/ledger drift를 검사했다.
- 서버를 실제 `pg_ctl stop -m immediate`로 중단하고 재시작해 진행 중 verifier의 helper와 임시 역할 변경이 rollback됨을 확인했다. 재시도 성공, 기존 메타데이터 보존도 확인했다.
- CLI 2.119.0에서 원본 복구와 fixture verifier를 별도 적용하여 version/name을 별도로 기록하고 ledger75→76→77을 확인했다. 운영 영수증으로 재사용하지 않는다.
- stage2 성공 후 stage3 실패하면 stage2를 재실행하지 않는다. ledger76·복구된 owner 상태를 다시 확인하고 stage3 실패 원인만 해결한다. stage3 성공 여부가 불확실하면 ledger77과 helper/role readback을 먼저 확인한다.

root가 전달한 실제 13chain 후 body SHA는 catalog `9c96bfdf0c80af38fcfe61b4f36bbc22df99aca76be56ce2758e950a7a5e4d28`, definer `a5fff8ca63e34d41fc7c56e5a646023d44645750a7abf9ae0c0efc35818aa964`, public RPC `f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef`, owner `5515d2269ddf0ffa26a414f21989b60dce1a41002440f0a81d3c646b34774b40`이며 사전 검사 고정값과 일치한다. definer는 immutable 소스 재구성으로 `065ace… → 3a367… → a5fff8…` 변환도 검증했다.

새 verifier는 hosted stage ledger에 맞춘 additive 운영 source다. 공유 G014 replay/security manifest의 새 source 등록과 필요한 replay adapter는 root의 별도 후속 범위이며 여기서 변경하거나 통과했다고 주장하지 않는다.
