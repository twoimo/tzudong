# Integrated rendering and quality progress v2

전체 목표는 active다. 최신 source는 PR3117/head19a1e1d0cab443b7386c3d489986cbb1d7f6a9d3이며 보호된 develop 승격 전이다. PR3114는 develop e396으로 병합됐다. 운영 readback은2026-10-04T17:53:38Z에 mainca235 / READYdpl_D6wm9mbMeZEbLtHM3PFXMctZ9txm / www alias 일치이며, 이후 production 변경을 이 작업에서 실행하지 않았다.

낮을수록 좋은 값의 절대 감소=Before−After, 상대 감소=(Before−After)/Before×100. 고정 median guard는 latency15%, naturalheap20%이며 관측 후 바꾸지 않았다. 동작10/10·trusted emulated swipes4·viewport 전환6/6은 actualSDK/tiles+syntheticREST, physical phone0이다. 실제SDK사용은 브라우저의 loaded/remote/mapCaptured/stubfalse와 raw로 대조한다. n9에서 사용자p95를 보고하지 않는다. qCLS/shifts 원시값은 raw에 남으며 정지PNG만으로 flicker 제거를 주장하지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 클러스터 펼침 735개 | Chrome mobile emulation/CPU4, variant당9fresh+2warmup | clickMs | 486.500000 | 470.400000 | 16.100000 | 3.309% | paired95% [-39.40000009536743, 30.899999856948853]; ABBA95% [-20.59999990463257, 31.399999856948853]; noise 96.75999989509583 | median budget 통과, 추가 개선 입증 안 됨 | integrated-regression-summary-v2.json / readiness-mobile-ui-integrated-v2-ab/raw.json |
| 클러스터 펼침 735개 | Chrome mobile emulation/CPU4, variant당9fresh+2warmup | naturalHeapMB | 19.106040 | 19.118724 | -0.012684 | -0.066% | paired95% [-3.7880080000000014, 0.0479680000000009]; ABBA95% [-2.4607680000000016, 2.2316119999999984]; noise 3.393712 | median budget 통과, 추가 개선 입증 안 됨 | integrated-regression-summary-v2.json / readiness-mobile-ui-integrated-v2-ab/raw.json |
| 클러스터 펼침 2000개 | Chrome mobile emulation/CPU4, variant당9fresh+2warmup | clickMs | 471.800000 | 485.700000 | -13.900000 | -2.946% | paired95% [-53.09999990463257, 13.299999952316284]; ABBA95% [-35.69999980926514, 23.40000009536743]; noise None | median budget 통과, 추가 개선 입증 안 됨 | integrated-regression-summary-v2.json / readiness-mobile-ui-integrated-v2-ab/raw.json |
| 클러스터 펼침 2000개 | Chrome mobile emulation/CPU4, variant당9fresh+2warmup | naturalHeapMB | 18.626264 | 18.594340 | 0.031924 | 0.171% | paired95% [-0.0014399999999987756, 6.494900000000001]; ABBA95% [-6.221883999999999, 6.503276]; noise None | median budget 통과, 추가 개선 입증 안 됨 | integrated-regression-summary-v2.json / readiness-mobile-ui-integrated-v2-ab/raw.json |
| 지도 away/return60 | fresh2process/variant×60dependent cycles, CPU4 | medianHeapMB | 32.298262 | 32.550954 | -0.252692 | -0.782% | before process range[31.989311999999998, 32.607212]; after[32.524454000000006, 32.577454]; n2/noCI | median budget 통과, 개선 입증 안 됨 | integrated-warm-minimal-summary-v1.json / integrated-warm-minimal-v1/raw.json |
| 지도 away/return60 | fresh2process/variant×60dependent cycles, CPU4 | peakHeapMB | 47.323384 | 52.912392 | -5.589008 | -11.810% | before process range[46.488488, 48.15828]; after[47.147172, 58.677612]; n2/noCI | median budget 통과, 개선 입증 안 됨 | integrated-warm-minimal-summary-v1.json / integrated-warm-minimal-v1/raw.json |
| 지도 away/return60 | fresh2process/variant×60dependent cycles, CPU4 | endpointHeapMB | 37.179700 | 24.081466 | 13.098234 | 35.230% | before process range[36.09902, 38.26038]; after[20.76218, 27.400752]; n2/noCI | median budget 통과, 개선 입증 안 됨 | integrated-warm-minimal-summary-v1.json / integrated-warm-minimal-v1/raw.json |

Cold A/A22·A/B44fresh processes, CPU4/390×844/DPR1, cache/SW disabled, remote networkunthrottled. 각 process의 trusted clusterclick은1회. 첫2visible rAF 중첫표시+600ms heap을 ID serialization전에읽었고 forcedGC0이다. Bootstrap10000/seed20261004 pairedmedian 및 ABBAblock CI. 2000개에는 A/A없음; 특히 heapABBA CI는20%초과회귀도배제하지못함. Budget는 median판정이며 모집단회귀부재보증이아니다.

기존 warm 기록62→64MB와65–78MB성장은 그대로 보존했다. 같은source A/A에서 full행735를매cycle 전송하는프로브의end86.8323/84.05734MB와, canonicalid/lat/lng를한번준비한 minimal프로브의32.526492/32.499732MB를분리했다. 각각post-final diagnosticGC는18.62–18.69MB였다. RESTrestaurants2/reviews62는같고membership735정확했다. 이는프로브관찰영향의실험이며앱최적화성과가아니다. 원래결과를덮어쓰거나실패budget를waive하지않았다. 교정된A/B는새plan에서양쪽같은minimal프로브,같은350msaway/1000msreturn으로4freshprocessABBA×60cycles를측정했다. 강제GC는마지막자연heap 뒤별도진단만실행했다. Noise를분리한개선·leak완전해소·field성과는주장하지않는다.

Warm after 개별peak47.147172/58.677612MB, before46.488488/48.15828MB를공개한다. 한afterpeak는양before보다20%이상높고 medianpeak+11.81%는고정guard안이다. rAFp95두쪽16.8ms, 차이는보수적0.1ms보고한계아래라상대변화를계산하지않았다. 이는유저latency p95가아니다.

리뷰정확성: 실제React/IndexedDB와source-derived callbacks에서 baselinee396신규3결함(변경후닫기·정리실패재시도·변경후unmount)을재현하고 after11/11,외부요청0,pageerror0을확인했다. 신규Bautosave보존,submitA제거,등록사진유지,unknowncommit/업로드경계는관련57tests로검증했다. 네트워크Supabasewrite는fixture이며운영리뷰write성과가아니다. browserProcesses1/contexts2이지독립사용자22명이아니다.

Nightly:593run37217506541의unit+27browser검사성공뒤empty unresolvedFunctions rawdiagnostic때문에publicationbuilder가거부했다. 알려진빈배열만공개영수증에서projection하고unknown/nonempty/failedcounts를거부,strict47tests통과. c135run37221500745의Local전체(unit/e2e/rowfreeproducer/validator)SUCCESS,featurePublishSKIPPED. 최신19a1의run37223585147와current-headCI는진행중이다. WindowsBun의96.9706mswarmupgap은60mscadence판정에따라무효이며retry/checkpoint/rawretention을기존예산안에복구했다. schema5와frozen4읽기호환51tests; UI성능과분리한다. Mainpublication과issue2843완료는미증명이다.

운영field실제읽기:2026-10-04T17:51:24Z LCP7/INP3/CLS5샘플. Anonymousself-report이고distinct-users는측정하지않았다. 비교가능한before/aftercohort·환경·기간·통계표본이부족해성과판정안됨. QA/automation은collector에서제외하며이실험의field/canonicaltiming admission은0이다. syntheticmetrics를운영baseline에넣지않았다.

남은범위:보호된develop→data→main승격·namedrollback/guard/READY+alias운영검증·GalaxyChrome/Samsung새source검증(사용자hold유지)·actualfieldcohort비교·source와evidence정식freeze/외부pin/Gitblobreadback. Braces공식latest3.0.3/PatchedNone/upstreamPR72open을2026-10-05재확인했다. 전체audit high7 devchain은미해결,production0으로대체/억제하지않았다. ManagedPG17.6 maintenance,vector schema,passwordPro제한·전체repositoryqueue는완료로보고하지않는다.

증거는unfrozen이며기존frozenroots/pins를바꾸지않았다. privacy패턴검사에서는1075textfiles의JWT/private-key/device-transport0; email형태3개는packagepatch명과Pythondecorator였고실제email아니다. 전체privacyaudit와최종canonicalmap/scorer/validator는추가확인이필요하다. 수정전후부호와허용치가나쁜흐름을숨기지않도록raw·rejected·observer자료를함께보존한다.
