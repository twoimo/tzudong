# 최종 완료 조건 재점검 — 2026-10-04

현재 운영 alias는 여전히 READY main `ca235e250957c4360ad713ffd29e118c11cc5b7c` / `dpl_D6wm9mbMeZEbLtHM3PFXMctZ9txm`이다. 기존 source·배포·20개 실제 SDK 동작 검사·787개 frozen 증거는 유지됐으며 이 턴에서 source나 운영 설정을 바꾸지 않았다.

field가 새 배포에 기록되지 않는 원인이 잘못된 client SHA 또는 QA 제외 처리인지 별도로 조사했다. 실제 public compiled client의 합성 lifecycle에서 CLS·INP·LCP 3개 생성, serving deployment SHA 일치, Cookie/Authorization/Referer 없음, QA0 delivery를 확인했다. 모든 유효한 합성 POST는 context route에서204로 응답해 production/network/DB에 보내지 않았다. synthetic visibility/input 및 fixture에 한정한 eligibility override이므로 실제 사용자나 native lifecycle 증거가 아니다. 별도 QA context의 intentionally stale SHA 요청은409 `field_release_stale`로 DB/RPC 전에 거부됐다. 신규 field admission0이다.

production 설정은 service-role key와 Supabase URL이 존재하며 manual Git SHA override가 없다. 값을 읽거나 decrypt하지 않았다. hosted catalog의 두 RPC는 SECURITY INVOKER이고 service_role만 execute, anon/authenticated는 execute 불가였다. SQL은 fixed catalog SELECT뿐이다. 이 확인들은 현재 worker의 성공적인 RPC 적재를 직접 증명하지 않는다. 새 main의 정상 real-user acceptance는 아직 관찰되지 않았다.

| 확인 대상 | 조건·표본 | Before | 현재 | 판정 | 증거 |
|---|---|---|---|---|---|
| Field cohort | readonly fixed7columns |15 old-release metric instances|15 그대로;2b94 2/1ab13, ca235 없음|matched p75/p95·개선 비교 불가|current-field-v1.json|
| Client producer | actual compiled WWW·intercepted synthetic lifecycle |새 main 미검증|3 names/SHA match, QA0, private header absence|fixture 통과·실사용 적재 proof 아님|current-field-producer-fixture-v1.json|
| Runtime error query | exact deployment·45min·level error·limit500 |미조회|exit0, JSON objects0|filtered query 결과; 전체 invocation error0 아님|current-runtime-error-query-v1.json|
| Physical Galaxy | current ADB/mDNS |연결 대기|ready0/offline0/service0|Chrome·Samsung exact-main/force-dark/flicker·memory 미완료|current-physical-readiness-v1.json|

원래 요청의7개 번호 및 추가 명시 요구를 `completion-audit-v1.json`에 대응시켰다. 완료는 입증되지 않았다. 다음은 현재 기기 연결이 복구됐을 때 Galaxy 두 브라우저의 exact-main native 검증을 진행하고, 유효한 실제 cohort가 생기면 field를 비교하는 것이다. 원래 canonical packet의 성공을 현재의 미완비6종 health coverage로 재사용하거나 미측정 gate에0을 넣지 않는다.

이 턴은 현재 배포와 collector 경로에 대한 새 증거를 확보했으므로 progress다. previously blocked goal을 resumed했으므로 blocked audit은1턴부터 다시 시작하며 이번에는 goal을 active로 둔다. 조건이 같은 후속 goal turns에서도 의미 있는 독립 작업이나 외부 변화가 없으면 지침의3턴 threshold를 적용한다. 기존 휴대폰 연결 질문은 대기 상태이며 중복 질문은 보내지 않았다.

재현: `read-production-runtime-v1.py`는 exact project/alias 검증 후 bounded log query를 실행해 count만 저장한다. `verify-current-field-producer-v1.mjs`는 설치된 Chrome·Node24로 실행한다. Node/Bun/source paths는 이 호스트 기준이며 다른 호스트에서는 path 변경 diff와 버전을 별도 기록한다. 출력은 `x`로 생성하므로 새 작업용 label/path에서 실행한다. frozen parent packet을 수정하지 않는다. field 및 privilege 재조회는 같은 MCP project에서 아래 fixed SELECT를 사용하며 whitelist columns만 저장한다. provider framing, messages, identifiers, headers, raw bodies는 버린다.

```sql
select observed_day, release_sha, device, metric, navigation, bucket, sample_count
from public.app_web_vitals_histogram
where observed_day >= date '2026-10-01'
order by observed_day, release_sha, device, metric, bucket limit 160;
```

Privilege source는 `pg_proc`와 `pg_namespace`에서 public 두 RPC 이름을 고정하고 `prosecdef`, service_role/anon/authenticated `has_function_privilege(...,'EXECUTE')` boolean만 조회했다. 실제 함수나 mutation을 실행하지 않았다. metadata verification·intercepted fixtures는 temporal field 성과로 확대 해석하지 않는다.
