# Local contract proposal: small wire schema with unchanged strict validation

## 판정

provider의 정적 segment JSON 응답이라는 좁은 범위에서는 다음 교체가 사용자 결과 계약을 약화하지 않는다.

```text
accepted_old = original_schema ∩ existing_validator
accepted_new = small_wire_schema ∩ existing_validator
accepted_old = accepted_new
```

단, 이 결론은 production 변경 승인이나 provider 수용성 증거가 아니다. 현재 cache identity는 schema와 source byte hash를 포함하므로, 기존 성공 receipt를 재사용하고 재전송을 막는 predecessor 호환 경로가 먼저 필요하다. 그 보완 없이 source를 바꾸면 안 된다.

## 선언한 wire schema

`wire-schema.json`은 top-level object의 일곱 required key, 각 key의 JSON type, 그리고 top-level `additionalProperties: false`만 유지한다. `schemaVersion=1`, 정확한 `videoId`, nested required/additional properties, enum, min/max, maxItems와 segment boundary는 기존 `validate_analysis`가 계속 강제한다.

기존 full schema는 835초 synthetic segment 기준 canonical 5,335 bytes, SHA-256 `7168c8153f3922ebc33cfdd6f4a07e89e947374e5af882dc122bade3495a9efd`다. 제안 wire schema는 canonical 365 bytes, SHA-256 `e3f27356cdb188197c709fb607446f606fc250f60ef84bd7bd89062c2e71c360`다.

## 논리 증명

JSON duplicate key와 NaN/Infinity는 `decode`가 먼저 거절한다 (`longform_analysis.py:105-119`). segment row는 `segment_rows`가 유한 양수 duration, 1..900초 segment 크기, 최대 segment 수와 gapless start/end를 만든다 (`longform_analysis.py:673-680`). 실행과 readback은 provider text를 `decode`한 직후 같은 span으로 `validate_analysis`에 전달하고, 통과한 analysis만 evidence로 쓴다 (`longform_analysis.py:1088-1098`, `1192-1203`). 저장 evidence도 다시 같은 validator를 통과해야 한다 (`longform_analysis.py:725-761`).

고정된 유효 segment row `r`에 대해 다음 집합을 둔다.

- `O_r`: `adapter.schema(videoId, start, end)`가 받는 JSON 값
- `W`: `wire-schema.json`이 받는 JSON 값
- `V_r`: `validate_analysis(value, r)`가 받는 JSON 값

코드 대조 결과 `V_r ⊆ O_r`다. 또한 validator는 top-level exact keys와 type을 모두 강제하므로 `V_r ⊆ W`다. 따라서 `O_r ∩ V_r = V_r`이고 `W ∩ V_r = V_r`이므로 두 교집합은 같다.

| full schema 제약 | 기존 validator의 강제 | 관계 |
| --- | --- | --- |
| 모든 object의 required + `additionalProperties:false` | top-level, coverage, fact, evidence, restaurant에서 `set(value) == exact_keys` | 동일 |
| `schemaVersion` integer enum `1` | `type(...) is int` 및 `== 1` | 동일 또는 더 엄격 |
| `videoId` string enum 현재 ID | JSON domain에서 inventory string과 exact equality | 동일 |
| coverage start/end number enum segment 경계 | int/float type과 span start/end exact equality | 동일 |
| coverage complete boolean | `is True` | 더 엄격 |
| kind/modality enum | 동일한 tuple membership | 동일 |
| evidence seconds min/max | finite number 및 `segmentStart <= start <= end <= segmentEnd` | 더 엄격 |
| confidence number 0..1 | finite number, 0..1 | 동일 또는 더 엄격 |
| strings array maxItems 50 | list, 최대 50, 각 item은 nonblank string이고 길이 최대 2,000 | 더 엄격 |
| evidence/facts/restaurants maxItems 100 | segment mode에서 각각 최대 100 | 동일 |
| nested JSON type | dict/list/string/number checks | 동일 또는 더 엄격 |
| summary 내용 | schema는 빈 배열 허용, validator는 nonempty 및 최소 하나의 evidence 요구 | 더 엄격 |

`aggregateSegments=True` 경로는 provider wire 입력이 아니다. 로컬 segment 병합 후 최대 10,000개를 허용하므로 이 경로에 full wire schema와의 동치를 주장하지 않는다 (`longform_analysis.py:424`, `944-951`).

## bounded experiment

`verify_equivalence.py`는 repo에 설치된 Ajv로 old/wire schema를 평가하고, 같은 112개 candidate를 실제 `validate_analysis`와 교차했다. candidate는 valid boundary 3개와 required/additionalProperties/type/enum/min/max/maxItems/videoId/coverage/evidence/fact/restaurant 변형을 포함한다.

- validator accepted: 3
- old intersection accepted: 3
- new intersection accepted: 3
- intersection divergence: 0
- validator가 받았지만 old schema가 거절한 case: 0
- validator가 받았지만 wire schema가 거절한 case: 0

이 실험은 위 구조적 subset 증명을 보조할 뿐, 112개 fixture만으로 보편 동치를 주장하지 않는다.

## 구현 전 필요한 최소 보완

validator 자체의 segment 계약 공백은 발견하지 못했다. 구현 차단점은 cache identity 연속성이다.

`AnalysisConfig.identity`는 `responseSchemaSha256`, `adapterSha256`, `policySha256`을 포함하고 (`longform_analysis.py:327-331`), receipt 경로는 그 identity digest로 정해진다 (`525-537`). transport schema와 adapter source를 바꾸면 기존 성공 receipt는 predecessor identity 아래 남는다. 현재 predecessor 검사는 adapter/policy hash만 덮어써서 (`848-857`) response schema hash까지 달라지는 이번 변경의 이전 identity를 복원하지 못한다. 이 상태에서는 `cached_state`가 `new`를 반환해 재전송을 허용할 수 있다.

최소 보완안은 다음과 같다.

1. 현재 full response schema hash, adapter hash, policy hash를 하나의 reviewed predecessor identity로 정확히 결속한다.
2. predecessor가 있으면 현재 validator와 `validate_saved_evidence`/`verify_full_evidence`를 다시 통과한 `succeeded` evidence만 byte 변경 없이 재사용한다.
3. predecessor가 `running`, `uncertain`, `failed`, `partial`, `rejected`, `segmented`이거나 증거 검증이 불완전하면 `readback_required`로 닫고 POST를 허용하지 않는다.
4. 기존 success receipt byte가 그대로이고 `adapter.invoke`가 호출되지 않는 regression, unresolved receipt가 새 POST로 바뀌지 않는 regression을 추가한다.
5. 새 결과만 새 wire fingerprint를 사용한다. model, prompt, pinned claude-video engine과 independent quality gate는 그대로 둔다.

provider가 365-byte wire schema를 실제로 받는지는 이번 로컬 검토로 확인하지 않았다. 독립 품질도 별도 검증 대상이다. API 호출, key 조회, 835영상 재전송, cache/receipt/queue 변경, production source 변경, 다른 model/provider 사용은 모두 0회다.
