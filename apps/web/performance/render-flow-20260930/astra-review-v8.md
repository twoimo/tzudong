독립 검토 v8 · 2026-09-30

검토한 원시 자료는 **v6에서 도입된 화면 밖 culling의 복귀 시 0-DOM 회귀가 v7에서 완화됐다는 제한된 결론**을 지지한다. exact readback의 ID↔SDK 좌표와 전후 rAF 수치를 독립 재계산했다. 새 P1 실패 근거는 발견하지 않았다. 원래 baseline 대비 성능 개선, 실제 Naver SDK, 물리 화면의 깜박임 해소 또는 전체 성능 통과로 확대할 수 없다. 최종 A/B admission은 보류한다.

**필수 보완 1 — P2, 관측 공백을 포함한 전체 구간의 통과로 해석하지 않기.**

[전후 공통 측정 코드](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/flicker-pan-after-v1/flicker-pan.mjs.txt:18)는 복귀 명령 이후 중심 좌표가 원래 값과 일치하는 rAF에서 전역 marker DOM 개수를 센다. 첫 0개 프레임부터 다음 양수 프레임까지를 span으로 삼고, 엄격한 `duration > 250`을 판정한다. 이 계산과 raw의 span·프레임 수·최대 간격·boolean은 모두 일치했다. 검토한 20회에 열린/right-censored span은 없다.

그런데 v7 desktop attempt 0과 4는 **첫 양수 프레임 직후 각각 291.8ms, 274.9ms** 동안 다음 rAF 관측이 없다. 양 끝 개수는 143→143이다. 다른 desktop 3회도 224.8–249.3ms 공백을 기록했다. 이 시간에 계속 마커가 보였는지, 재제거·복원이 있었는지는 이 표본으로 판단할 수 없다. 첫 양수 DOM이 곧바로 paint됐다는 증거도 아니다. 코드의 `flickerObserved:false`와 기존 unobserved 주석 자체는 이 한계와 양립하지만, 이를 “전체 복귀 구간의 250ms 이상 시각 결함 0”으로 집계하면 과장이다.

같은 raw의 PerformanceObserver에는 복귀 후 long task가 매회 하나씩 있다. desktop v6 140–197ms(중앙값 171), v7 230–279ms(248); mobile v6 51–62ms(57), v7 83–95ms(91)다. DOM 복원 지연 감소와 함께 이 수치를 남겨야 한다. 순차 실행·공유 호스트인 작은 표본이므로 차이의 원인을 제품 변경으로 확정하거나 별도의 성능 회귀 판정을 내리지는 않는다.

작은 보완안: 원본 JSON을 유지하고 후속 요약에 `observedZeroSpanMs`, `maxReturnedRafGapMs`, `unobservedGapOver250`, 복귀 후 long task를 함께 표기한다. desktop v7은 “관측된 >250ms 0-DOM span 0/5; >250ms 미관측 간격 2/5”로 보고한다. 물리 픽셀 주장은 별도 paint/filmstrip 증거가 있을 때만 한다. 이번 감사에서 sampler나 source를 수정하지 않았다.

**필수 보완 2 — P2, exact-readback의 plan 연결 정정.**

[readback 보존 코드](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/marker-dom-readback-final-v4/marker-dom-readback.mjs.txt:5)는 `plan-v5.json`을 하드코딩해 복사한다. 따라서 이 묶음의 `plan-v5.json.txt`는 v6 plan(hash `81fdeda1cb3dbd8d48e8209c44bb3d28ee572f70b60da6b33b87661429d60b0c`)이고, raw의 v7 receipt는 [plan-v6.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/plan-v6.json)의 hash `effbc7f636f5a4cfa0efba1725006e751869d9084db59ba5062527b0f481c9af`를 가리킨다. 실제 v7 source/build 연결은 아래처럼 별도로 일치하므로 ID 정확성 관측을 기각할 이유는 없지만, 묶음의 plan snapshot을 v7 계약으로 인용하면 안 된다.

작은 보완안: 보존된 plan-v5/raw를 덮어쓰지 말고, 새 evidence index에서 raw hash → v7 receipt → 위 plan-v6 hash를 연결한다. 다음 실행부터 실제 receipt에 연결된 plan을 복사한다. 현재 문서에 그 정정 연결을 기록하며 기존 파일은 보존했다.

**재계산 결과와 표본 단위.**

| 관측값 | v6 before-v3 desktop | v7 after-v1 desktop | v6 before-v3 mobile | v7 after-v1 mobile |
| --- | ---: | ---: | ---: | ---: |
| fresh-context 측정 횟수 | 5 | 5 | 5 | 5 |
| 복귀 0-DOM span 중앙값(ms) | 158.4 | 8.4 | 308.2 | 16.7 |
| span 범위(ms) | 150.0–158.5 | 7.6–16.7 | 307.4–316.1 | 16.3–16.9 |
| 관측된 span >250ms | 0/5 | 0/5 | 5/5 | 0/5 |
| span당 0개 프레임 수 | 18–19 | 1–2 | 37–38 | 2 |
| 최종 marker DOM 개수 | 모두 143 | 모두 143 | 모두 55 | 모두 55 |
| 복귀 rAF 최대 간격 범위(ms) | 140.9–191.6 | 224.8–291.8 | 42.3–59.2 | 74.9–92.4 |

각 case 파일과 합본 raw가 동일하고 attempt 0–4 누락·중복이 없다. 모든 case의 frame/map 최종 생성 수는 1이다. page error와 unexpected console error는 0; desktop의 console 1건은 blockedTransport 1건과 일치하므로 “console error 자체가 0”이라고 쓰지는 않는다.

전후 모두 같은 스크립트로 각 context에서 cluster를 클릭하고, 한 번 away→return을 완료한 뒤 두 번째 왕복을 기록한다. warmup 복귀는 marker DOM 양수 조건이며 추가 350ms settlement는 없다. mobile의 350ms는 cluster 클릭 전 화면 위치 조정 뒤에 있다. raw의 측정 직전 개수도 모두 143/55다. 이 순서는 재현하고자 한 빠른 재복귀와 맞는다. 다만 요청 cache-hit 기록을 저장하지 않았으므로 “한 차례 왕복으로 준비한 두 번째 pan”이 직접 입증된 표현이다.

각 viewport의 before 5회와 after 5회는 별도 실행 묶음이다. 같은 attempt 번호가 무작위/교차 A/B pair를 만들지 않는다. 두 viewport를 합쳐 n=10인 한 모집단이나 rAF 수를 독립 표본으로 취급하지 않는다. 첫 attempt만 CDP trace를 추가했고 나머지 4회는 trace가 없다. 이 구성은 전후 동일하지만, 동일 build의 모든 표본이 동일 계측 비용을 가진 것은 아니다. 이 작은 순차 자료로 paired bootstrap CI나 일반적 개선율을 주장하지 않는다.

모든 case의 프레임 간격 중앙값은 약 8.3ms이고, 0-DOM span 경계 부근 간격은 최대 9.4ms다. v6 mobile은 첫 0개부터 마지막 0개 표본까지도 299.2–307.5ms이므로 250ms 초과 판정이 단일 프레임 경계 선택 때문에 생긴 것은 아니다. v7의 8.4/16.7ms는 1–2 rAF 간격에 해당하는 관측값이며 밀리초 단위의 물리 paint 정밀도를 뜻하지 않는다. 이 250ms는 전후 보존 스크립트에 동일하게 들어 있는 운영상 회귀 기준으로, 보편적 UX 기준이나 primary budget을 대체하지 않는다.

관측은 return 이후 약 2초이며, selector는 실제 map rectangle과 교차하는 픽셀이 아니라 document 전체의 marker DOM이다. per-frame ID·좌표·hit-test·paint를 검사하지 않는다. 별도의 exact readback은 최종 ID 정확성을 보강하지만 이 시간축 전체에 대한 정확성 증명은 아니다. desktop trace는 각각 screenshot 5개뿐이고 최대 screenshot 간격도 before 328.913ms, after 303.101ms다. mobile trace는 각각 231/203개이나 attempt 0에 한정된다. trace mark `flow.nativeCluster.beforeClick`은 실제 코드상 cluster 클릭·warmup 뒤, 측정 pan 직전에 찍힌다. 그 이름으로 click latency를 산출하면 안 된다.

**정확성 readback은 2개 context의 6회 왕복이다.**

[marker-dom-readback-final-v4/raw.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/marker-dom-readback-final-v4/raw.json)의 두 case 모두 phase `complete`다. before 및 각 return에서 expected/actual 정렬 ID 집합, ID uniqueness, missing/unexpected 배열을 직접 대조했다. 각 tuple의 ID suffix로 fixture index를 복원하고 `lat=37.5+0.003*(i%40)`, `lng=126.96+0.003*floor(i/40)`와 SDK 좌표를 다시 비교했다. 결과는 desktop 143, mobile 55, 중복·누락·예상 밖 ID·좌표 불일치 0이다. 모든 return은 초기 ID 집합 그대로, 중심 37.5512/126.9882, zoom 14, mapCreates 1이다. 모든 away는 expected=actual=0이다.

[readback loop](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/marker-dom-readback-final-v4/marker-dom-readback.mjs.txt:20)는 사전 warmup 없이 cycle 0/1/2를 수행한다. 따라서 **6회 전체를 독립적인 cached-cycle 6표본이라고 쓰지 않는다.** 정확한 표현은 “2개 fresh context × 3회 왕복; 각 context의 두 번째·세 번째, 총 4회가 선행 왕복 이후”다. cache-hit 자체의 별도 readback은 없다. `settle`은 100ms 간격 검사에서 처음 valid/zoom14인 순간 반환하며 두 프레임 안정성이나 12초 지속 관측을 요구하지 않는다. 12초는 실패 대기 상한이다. 같은 스크립트에서 보였던 지속 blank가 이번 6회에는 재현되지 않았다는 증거로 충분하며, 수명 전체의 무재발 보장은 아니다. 저장된 expected 집합은 비교했지만 raw에 bounds/maprect가 없어 viewport membership을 독립적인 픽셀 자료로 재구성한 것은 아니다.

**source/build 및 보존 증거 연결.**

| 자료 | 연결된 build ID | 3개 제품 파일 patch SHA-256 |
| --- | --- | --- |
| flicker-pan-before-v3 | `uqeszApikRN4PIuKNfHiF` (v6) | `a2c4c1c7c315623f8171cd9a40f88086e6cea37d48eff309f4a7985de0097d98` |
| flicker-pan-after-v1, marker-dom-readback-final-v4, regression-candidate-v7-v1 | `IudS4C9U60JOVFefHNMHz` (v7) | `7157ecbccd22d9315f0d3cd344b003741ac30fbcafb36b5dc1ba59b77fc68819` |

두 build의 보존 BUILD_ID, source.patch, build.log와 각 receipt의 10개 input hash가 모두 일치한다. flicker/readback raw의 full receipt는 각 build receipt와 같다. regression raw의 간략 buildId/sourceTree/patch도 v7과 같다. 현재 세 제품 파일 diff hash는 위 v7 patch와 같고 NaverMapView hash는 `9236d84284cc28b1e569db22e979bd1f8a6800a577a234c549126548e5503287`이다. 이는 로컬 증거의 연결 검증이며, 브라우저 응답에서 배포 bundle hash를 새로 읽은 검증은 아니다.

전후 `flicker-pan.mjs.txt`는 byte 동일(hash `486eefa8bf2580515445ee9d3f7c5a459a20d51fd9742c391453b30eec286967`), runtime 차이는 기본 candidate v6→v7뿐이다. 공통 import인 `mobile-home-map-helpers.ts`의 현재 hash `e8398491f4d45b860165646a785f01694b6f6262f4f4f25554b555bff38fd0de`는 receipt의 sourceCommit `da805ea2602f4ed83e6e77e52e9da0b74ba2f8c5`에서도 같다. 개별 run이 이 helper bytes를 따로 snapshot한 것은 아니다. 브라우저 기록은 모두 Chromium `151.0.7922.34`, Node receipt는 `v24.21.0`이다. CPU4, synthetic 735 rows, mocked SDK, desktop 1440×900/mobile 390×844 조건이며 native cluster click 뒤의 pan은 provider mock API다.

| 원시 파일 | SHA-256 |
| --- | --- |
| regression-candidate-v7-v1/raw.json | `e28934e25403c3850a8a6818a84fcdda6bbb4eaee0f3ebfc7d530b7906b60fa9` |
| marker-dom-readback-final-v4/raw.json | `fb81716ecb45735e43949be833d33dd8140b3ba70dddc8285c99c94e7d70800b` |
| flicker-pan-before-v3/raw.json | `be0c419bc29ea2818ea71335b9aa0168b2aee19366d1bf472903e6a9bcf5fac4` |
| flicker-pan-after-v1/raw.json | `9c475c5ed01660cc7dd1f06877dbde7d9e929209759ed8c06c5bf55e4fe20676` |

regression raw의 4개 case는 60+62+24+24=170 checks, failure 0으로 합계와 일치한다. 이 계약은 기존 syntheticTouch helper를 포함하므로 별도로 진행 중인 native touch 결과를 대신하지 않는다. 기존 parity-v7-v2 로그는 diagnostics 0/logicalInputs 2368, unit 로그는 111 pass/0 fail, CSS-v7-v2 로그는 산출물을 기록한다. ESLint 로그가 비어 있다는 사실만으로 종료 코드까지 독립 확인한 것은 아니다. 부모의 실행 결과와 이번 보존 로그 검토를 구분한다.

이 flicker 묶음에는 외부 CPU/load resource snapshot이 없고 GPU 부하도 관측하지 않는다. CPU4는 renderer throttling 설정이지 호스트 부하 통제가 아니다. 공유 호스트의 busy 조건을 지워 quiet 성과로 제출할 수 없다. plan-v6의 50ms/10%, noise floor, 교차 pair 단위와 resource admission 정책은 그대로 남는다. 기존 A/A의 큰 변동을 이 작은 flicker 표본으로 대체하지 않는다. NativeTouch, 최종 paired-v6 및 secondary-v5는 이번 감사 범위에 포함하지 않았으며 그 통과를 선인정하지 않는다.

[delegation-routing.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/delegation-routing.json)에 보존된 native extraction은 해당 agent의 `gpt-6-astra`, `max`, assistant response 존재, 빈 error_codes를 기록한다. 이번 응답에 대한 새 vendor transport trace/request ID나 quota 잔량을 확보한 것은 아니다. 별도 모델 요청·fallback·quota 조회를 실행하지 않았다.

검사 범위는 보존 스크립트/JSON/trace의 로컬 파싱, fixture 수식 대조, hash 연결 및 기존 로그 읽기다. 브라우저·빌드·테스트·새 성능 측정을 실행하지 않았다. **유일한 작성 경로는 `/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/astra-review-v8.md`다.** 제품 source·tests·plans·runtime·원시 증거·기존 리뷰는 수정하지 않았다. v7 source 소유권은 부모에게 반환된 상태로 유지한다.
