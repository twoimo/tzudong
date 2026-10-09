판정: **전송 스키마와 캐시 fail-closed 설계에서 즉시 수정해야 할 고심각도 결함은 찾지 못했습니다.** 다만 코드 1건의 조건부 stale-cache 위험과, 증거 해석상 3건의 과장 위험이 있습니다. 이번 리뷰에서는 테스트나 provider 호출을 실행하지 않았습니다.

| 심각도 | 발견 | 트리거 / 근거 | 최소 수정 |
| --- | --- | --- | --- |
| **중** | **실제 영상 내용 변경 감지는 contentSha256이 있을 때만 보장됨** | inventory에서 contentSha256은 optional이고(longform\_analysis.py (line 295)), cache input identity도 videoId + durationSeconds + contentSha256만 사용합니다(longform\_analysis.py (line 533)). 같은 YouTube ID·동일 duration으로 내용이 바뀌고 hash가 계속 None이면 이전 분석을 재사용할 수 있습니다. | 실제 콘텐츠 변경 검출을 보장한다고 표현하려면 신뢰 가능한 content revision/hash를 필수화하거나, hash가 없는 경우 그 보장을 명시적으로 제외. |
| **중·증거** | **HTTP 200은 wire transport acceptance만 입증** | 실제 probe는 HTTP 200, wire validation=true지만 fullValidatorPass=false, originalSchemaConstraintPass=false이며 hasVideo=false입니다(root-readback.json (line 4), root-readback.json (line 28)). 파일 자체도 영상 품질을 not\_evaluated로 올바르게 제한합니다(root-readback.json (line 49)). | 이후 보고에서 “Gemini 영상 schema 검증 완료”라고 확대하지 말고 **365-byte wire schema transport accepted**로 한정. |
| **중·정량** | **속도·토큰·비용 개선 수치는 아직 비교 근거 없음** | 이번 실측은 no-video 1회, 2.838956s, 253 tokens뿐입니다(root-readback.json (line 16)). 실제 영상 호출은 0회이고(root-readback.json (line 38)), 구·신 timing 조건도 동일하지 않습니다. 5,335→365 bytes 축소는 schema 크기 증거이지 latency/token/cost 절감 증거는 아닙니다(proposal.md (line 19)). | matched-condition 반복 A/B 전에는 절감률을 주장하지 말고 1회 관측값만 기록. |
| **낮음·증거** | **predecessor cache reuse 검증은 synthetic mutation 기반** | focused test는 현재 fixture 결과를 predecessor identity/request hash로 다시 materialize한 뒤 restart/duplicate/rejection을 검사합니다(test\_longform\_segments.py (line 62), test\_longform\_segments.py (line 157)). 따라서 실제 과거 paid receipt 재사용 실증과는 구분해야 합니다. | evidence 명칭을 synthetic predecessor continuity로 유지하고, 필요하면 과거 실제 receipt를 **읽기 전용**으로 별도 검증. |

좋은 부분도 확인됩니다. wire schema가 느슨해져도 실행 결과는 validate\_analysis를 통과해야 저장되고(longform\_analysis.py (line 437), longform\_analysis.py (line 1217)), 저장 캐시도 semantic validation, segment receipt/evidence SHA, observation을 다시 검사합니다(longform\_analysis.py (line 764), longform\_analysis.py (line 1088)). uncertain/비성공 receipt는 새 POST로 승격되지 않고 readback\_required로 닫힙니다(longform\_analysis.py (line 928)). 현 소스·focused test·wire evidence 파일의 SHA도 각 artifact map과 전부 일치했습니다.

따라서 현재 증거로 말할 수 있는 범위는 \*\*“wire transport 수용 확인 + synthetic cache continuity/fail-closed 확인”\*\*까지입니다. **full-video 품질, 실제 영상 토큰 비용, latency 개선, 운영 비용 절감은 아직 미검증**입니다. 보존 보고서의 113 tests / 8 skipped, predecessor 4 tests PASS 기록은 확인했지만(implementation-proof.json (line 51)), 이번 독립 리뷰에서 그 테스트들을 재실행하지는 않았습니다.

