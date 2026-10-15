# 일반 마커 DOM 재사용 — 실제 SDK 진단 체크포인트

64회 검색·선택·상세·리뷰 표시 흐름에서 SDK 아이콘 교체가 2,207회에서 1,143회로 줄었다. 마커 생성은 양쪽 모두164개였고, 마지막 활성 마커96개의 화면 식당 ID와 SDK 내부 ID 불일치는 양쪽 모두0이었다. 각 버전당 독립 실행1회인 인과 진단 결과다. 메모리·입력 지연 개선, 운영 성과 또는 전체 목표 완료를 입증하지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 감소 | 상대 개선 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 검색→식당 선택→상세·리뷰 표시64회 | production/실제 Naver SDK/각1독립 프로세스, 내부64동작 | SDK setIcon 호출 | 2,207 | 1,143 | 1,064 | 48.2102% | 독립 표본1쌍, CI산출 안 함 | 호출 감소 관찰, UI시간·메모리 성과 미판정 | ui-pilot-before-64/raw.json, ui-pilot-after-64/raw.json |
| 같은 흐름 | 위와 동일 | 마커 생성 | 164 | 164 | 0 | 0% | 위와 동일 | 생성 수 동일 | 위와 동일 |
| 마지막 활성 마커 점검 | 각96활성 마커, 독립 사용자 표본 아님 | 화면/SDK 식당 ID 불일치 | 0 | 0 | 0 | 계산 안 함 | 한 시점 전수 점검, 오류 확률0을 뜻하지 않음 | 관찰된 불일치 없음 | 각 raw.json의 actualSdkIdentityCheck |
| 동일 래퍼만 허용했던 첫 후보4회 | production/각1프로세스/내부4동작 | SDK setIcon 호출 | 40 | 40 | 0 | 0% | CI산출 안 함 | 효과 없음, 40프로세스 본 측정 시작 전에 중단 | ui-pilot-before-4/raw.json, ui-pilot-after-4/raw.json |
| 자연 메모리·입력 반영 지연 | A/A4 + A/B18쌍, 각256동작으로 사전 고정 | 종료/idle heap, 선택 지연 중앙값 | 미집계 | 미집계 | 미산출 | 미산출 | 전체40실행 수집·독립 재구성 대기 | 별도 실행 중, 채택0 | 부모 폴더 natural-progress-v2.json 및 MEASUREMENT-PLAN-v2.json |

절대 감소=before−after, 상대 개선=(before−after)/before×100이다. 0인 기준값에서 배수·개선율을 계산하지 않는다. 같은 프로세스 안의64동작을64개의 독립 표본으로 취급하지 않는다. 누적 호출 감소율을 다른 개선율에 더하지 않는다.

## 원인과 변경

기존 코드의 `class`·UUID만 같은 검사는 실제 renderer의 category 래퍼를 제외했다. 이를 허용한 af04e9c0 후보도 실제 SDK에서는40→40회로 효과가 없었다. 추가 계측에서 서로 다른 식당으로 교체되는30경로 모두 래퍼의 style만 달랐고, 추가된 CSS속성은 cursor였다. SDK의 기본 cursor는 pointer로 문서화돼 있다. [Naver Marker 공식 문서](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Marker.html).

1ec70384 후보는 원시 HTML이 UUID 한 곳을 제외하고 같을 때만 DOM 비교를 수행한다. 전체 앱 래퍼가 일치하거나, 일반 category 래퍼에 정확히 `style="cursor: pointer;"` 하나만 추가돼 있고 원래 모든 속성·자식이 같을 때만 식당 ID를 갱신한다. 다른 이미지·배지·앵커·메타데이터·접근성 속성·추가 style·다른 cursor·특수 마커는 전체 교체를 유지한다. SDK가 수정한 리뷰 overlay는 보수적으로 전체 교체한다. 기존 클릭 리스너는 한 개이며, 현재 식당 콜백을 다시 연결한다.

직렬화 길이를 L이라 하면 기존 DOM 파싱과 추가 동일성 비교는 O(L)이며 임시 문자열 공간도 O(L)이다. 새 캐시나 인덱스는 추가하지 않았다. 이번64회 진단에서는 SDK 전체 아이콘 교체1,064회를 피했다. SDK 내부 할당 비용·GC·전체 UI시간을 이 이론으로 환산하지 않는다. 마커 생성164회와 setMap4,032회는 감소하지 않았으므로 이 비용은 남아 있다.

## 조건과 검증

- Before275fb4bedcaabfe151658acebeaf4611d9db9115, After1ec703840670c922dbccc661c1efdd10ad257cdb. Next16.3.8, Node24.21.0, Bun1.4.0, npm11.6.2 release lock. 두 named production build와 실제 dist CSS gate 통과.
- Chrome155.0.8059.40,390×844/DPR1/touch emulation/CPU4배 제한, cache off·SW bypass. 실제 원격 SDK·지도 타일과 합성 REST735승인+735삭제 별칭/검증 리뷰, Auth401을 사용했다. 실제 사용자 데이터·물리 모바일·필드 표본이 아니다.
- SDK200 응답의 SHA256은802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1이며 stub을 사용하지 않았다. 서버·브라우저를 독립 프로세스로 다시 시작했다. 두64회 실행은 같은 순서로 수행한 진단1쌍이다.
- 관련 unit34통과/1,231 assertions, 해당 소스·테스트 린트와 diff검사, native7.0.2/compat6.0.2 parity0진단 통과. 실제 브라우저 DOM18경로에서 재사용·이미지 보존·현재 클릭·해제 후 오래된 클릭 차단·변경 시 전체 교체를 점검했으며 등록·제거한 리스너 수가 일치했다.
- real-dom-check-v1/v2는 번들 테스트 도구에 compile-time public client-ID 대체가 없어 실패했다. v3는 통과했지만 SDK cursor를 흉내내지 못했다. v4는 SDK cursor와 추가 style/다른 cursor까지 검사해18/18통과했다. v4 당시 base commit과 실제 dirty source의 관계는 dom-v4-source-binding.json과 validation-v3.json에 명시했다. marker source hash는 최종1ec70384와 같다. 후속 unit32통과/1실패는 테스트 대역에 getAttribute가 빠진 문제였고 원인과 수정 후 결과를 보존했다.
- 자연40회 측정은 강제 GC·HeapProfiler 없이 실행한다. 이 체크포인트의 인과 진단은 자연 측정 후 별도 강제 GC/구조 진단을 수행했으므로 메모리 admission에 사용하지 않는다. 원시 heap 문자열·스냅샷·인증정보는 저장하지 않았다.

## 플리커·보안·완료 범위

각 실행의 처음과 마지막에 정지 화면2장을 저장했다. 연속 영상·프레임을 수집하지 않아 간헐적 플리커 발생률·지속시간을 판정할 수 없다. 이번 변화로 검은 사각형이 제거됐다고 주장하지 않는다.

여섯 진단 프로세스에서 CSP console6건과 네트워크 관찰9건을 보존했다. 관찰은 겹칠 수 있다. 차단된 vendor origin은 `https://kr-col-ext.nelo.navercorp.com`이었으며 CSP 허용 범위를 넓히지 않았다. 지도·마커 렌더 관찰은 이 오류가 무해하다는 증명이 아니다. canonical scorer와 validator는 모두 통과했지만 items0/admitted0/releaseBlocked=true이며 전체 성능 통과가 아니다.

소스는 별도 후보 브랜치에만 있다. 승격·운영 배포·실제 사용자 field 성과0, 물리 모바일 검증 제외다. 자연 메모리20%·지연15% guard, 전체 반복 결과·독립 집계·기능 동등성·잔여 플리커·운영 SQL/미디어·릴리스 readback·prospective field는 남아 있다. 실행 중인 자연 series를 이 불변 파일들에 덮어쓰지 않는다.
