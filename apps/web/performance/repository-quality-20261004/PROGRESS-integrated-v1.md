# Integrated quality release — observed progress v1

아직 완료 또는 운영 배포 보고서가 아니다. PR #3114 source는 보호된 승격 전이며, 사용자 요청으로 물리 Galaxy 사용을 보류했다. 소스·로컬/CI·실제 SDK 실험실·운영·field 상태를 구분한다.

실제 Naver SDK/tiles와 synthetic REST735/2000, Auth401를 사용했다. A/A22 fresh processes와 A/B44 fresh processes를 별도 driver에서 순차 실행했다. 각 count의 variant당 fresh9 관측 + warmup2를 구분하며, 한 프로세스 안의 클러스터 클릭은 1회다. 캐시/SW 비활성화, network unthrottled, viewport390×844/DPR1, CPU4. First of two visible rAF가 trusted click endpoint이고 자연 JS heap은 +600ms에 ID serialization 전에 읽었다. Forced GC0, field admission0, canonical timing admission0. n9에서 사용자 p95를 보고하지 않는다. 2000개에는 별도 A/A가 없어 개선을 주장하지 않는다.

계산: 낮을수록 좋은 값의 절대 감소는 Before−After, 상대 감소는 (Before−After)/Before×100이다. 고정 median 허용치는 지연15%, 자연heap20%이며 관측 후 변경하지 않았다. 신뢰구간은 bootstrap 10000/seed20261004, 동일 process pairs와 ABBA block에 대한 median 감소다. CI는 인과적 개선·회귀 부재 보증이 아니다. 특히 2000개 heap ABBA CI는 넓어20% 초과 회귀도 배제하지 못한다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 클러스터 펼침 735개 | Chrome mobile emulation 390×844, CPU4, variant당 fresh9 + warmup2 | clickMs (ms) | 486.500000 | 470.400000 | 16.100000 | 3.309% | paired95% [-39.40000009536743, 30.899999856948853]; ABBA95% [-20.59999990463257, 31.399999856948853]; noise 96.75999989509583 | median 회귀 허용치 통과, 추가 개선 입증 안 됨 | readiness-mobile-ui-integrated-v2-ab/raw.json; integrated-regression-summary-v2.json |
| 클러스터 펼침 735개 | Chrome mobile emulation 390×844, CPU4, variant당 fresh9 + warmup2 | naturalHeapMB (MB) | 19.106040 | 19.118724 | -0.012684 | -0.066% | paired95% [-3.7880080000000014, 0.0479680000000009]; ABBA95% [-2.4607680000000016, 2.2316119999999984]; noise 3.393712 | median 회귀 허용치 통과, 추가 개선 입증 안 됨 | readiness-mobile-ui-integrated-v2-ab/raw.json; integrated-regression-summary-v2.json |
| 클러스터 펼침 2000개 | Chrome mobile emulation 390×844, CPU4, variant당 fresh9 + warmup2 | clickMs (ms) | 471.800000 | 485.700000 | -13.900000 | -2.946% | paired95% [-53.09999990463257, 13.299999952316284]; ABBA95% [-35.69999980926514, 23.40000009536743]; noise None | median 회귀 허용치 통과, 추가 개선 입증 안 됨 | readiness-mobile-ui-integrated-v2-ab/raw.json; integrated-regression-summary-v2.json |
| 클러스터 펼침 2000개 | Chrome mobile emulation 390×844, CPU4, variant당 fresh9 + warmup2 | naturalHeapMB (MB) | 18.626264 | 18.594340 | 0.031924 | 0.171% | paired95% [-0.0014399999999987756, 6.494900000000001]; ABBA95% [-6.221883999999999, 6.503276]; noise None | median 회귀 허용치 통과, 추가 개선 입증 안 됨 | readiness-mobile-ui-integrated-v2-ab/raw.json; integrated-regression-summary-v2.json |

상세·닫기·검색·빈 결과·필터 복원·스와이프10checks/4trusted emulated swipes가 통과했다. 6 viewport 전환은735 ID 유지, padded-visible 누락0, 중복0, 지도생성1, 가로 넘침0이다. Native phone swipes나 새 배포 확인으로 확대 해석하지 않는다. 캡처는 portrait/desktop/tablet PNG 한 장씩이며, 이 정지 화면만으로 간헐 플리커 제거를 판정하지 않는다.

현재 warm240 dependent cycles/4fresh-process ABBA는 별도 진행 중이다. 이 문서는 warm 결과를 미리 포함하지 않는다. 기초 Next16.3.5/ca235 build와 Next16.3.6/34ebbb build를 비교했다. 뒤의 Python/backend/CI 변경은 별도 tree receipt로, CLI helper의 type-only 변경은 동일 transpiled runtime hash로 대조했다. 최종 production bundle와 GitSHA/alias는 별도 readback이 필요하다.

Nightly 첫 두 실패와 최신 helper-format 실패를 보존했다. 37203397175 실제 CLI2.117 output의 +10/−10 type-helper parentheses를 정확한 Git blob64a9faa7b2b1707b9abd34d638c0875c92c94a3f로 복원했고 compiler parity 진단0이다. 37204476815에서 whole local nightly all을 재검증 중이며 publication success를 선점하지 않는다.

Python cleanup macOS3.12.13과 native Linux3.12.13 각각17pass/2Windows-only skip. 신규 Windows runner 첫 실행은 Python3.12.13 binary unavailable이고,3.13.16 보충 실행의65subtest errors는 새 진단 sink의 기본CP1252가 한국어 출력을 인코딩하지 못한 fixture 결함이었다. UTF-8 sink로 수정했으며 재검증 완료를 기다린다. 운영 노드 코드의 Windows 결함으로 오분류하지 않는다.

남은 보안: 전체 web audit high7은 미패치braces dev chain이다. Supabase security advisor6groups/51grouped findings는 unique51 취약점이라는 뜻이 아니다.27 no-policy 테이블은 모두RLS true이고 anon/auth SELECT없음을 실제catalog에서 확인했다. consent view는 auth.uid filter/security barrier/NOLOGIN·non-superuser·non-bypass owner다. 공용 최소profile RPC는1..100상한, revocation RPC는capabilityguard가 있다. Catalog를 읽은 결과이며 cross-user runtime 증명이 아니다. vector schema, managed PG17.6 maintenance와 leaked-password protection은 아직 완결된 운영 remediation이 아니다. 공식 password security 문서는 해당 기능을Pro이상으로 제한한다(https://supabase.com/docs/guides/auth/password-security); billing 전환은 하지 않았다.

재현: 같은 pinned Node24.21.0과 Chrome151/Playwright1.62.1에서 신규 label로 measure-integrated-mobile-v2.mjs label aa→ab를 직렬 실행한다. plan과 helper파일은 원래 증거를 덮어쓰지 않는 새 작업 root로 함께 복사하고 label/raw 경로를 명시적으로 갱신한다. 원래 artifact 디렉터리에서는 mkdir/open wx가 덮어쓰기를 막는다. build receipts/inputs/lock hashes와 환경 snapshot을 같이 대조한다. 현 packet은 아직 unfrozen이고 최종 scorer·validator·artifact map·외부SHA·Git blob 저장 readback은 남아 있다.
