# Tzudong (`ac80e35da566db242420a62bbf3e3320b5c00e76`) 공개 인기 등급·영상 근거 프레임 반대 감사 보고서

## 1. 첨부별 실제 소스 대조 영수증 및 `SOURCE_MISSING` 경계

본 감사는 일반 추론(Deep Research 미사용)으로 수행되었으며, 첨부된 3개 파일(`chatgpt_master_plan.md`, `source-core-continuation.txt`, `source-remaining.txt`)의 실제 본문만을 근거로 삼는다. 해시·파일명 에코를 본문 열람으로 취급하지 않으며, 실행하지 않은 테스트나 조회하지 않은 원격 상태를 실제 검증한 것으로 표시하지 않는다.

### 1.1 첨부 1 (`chatgpt_master_plan.md`) 대조 표본 및 ID 드리프트 확인

* **핵심 판정 및 분포 표본 (1절, 9절)**: 승인·병합 맛집 그룹 `735 = 15(fire) + 21(ember) + 71(rainbow) + 628(standard)`, 공개 영상 프레임 `12개(맛집 4곳, on_site_scene, SOURCE_OBSERVED)`, 관측 기간 `2026년 6~7월`, 최종 결론 `CONDITIONAL — 소스 검토는 진전됐으나, 새로운 게시 변경을 완전히 검증했다고 승인할 수 없다.`를 확인했다.


* **Part 1 대 Part 2/3의 ID 의미 표류(Meaning Drift) 적발**: `chatgpt_master_plan.md` 8절은 `"앞선 두 부분의 ID 의미는 유지한다"`고 주장하지만, 실제로는 5절 첫 번째 표(Part 1 말미 절단부)와 5.2절 판정표(Part 2) 사이에서 `TH-P-01~04`의 의미와 판정이 아래와 같이 치환·변형되었다 (`CONTRADICTED`).



| ID | Part 1 (5절 초기 표) 의미 및 판정 | Part 2/3 (5.2절·8절) 변경된 의미 및 판정 | 의미 표류(Drift) 분석 |
| --- | --- | --- | --- |
| `TH-P-01` | 공개 분포 재계산 필요 (`HIGH`, `CONDITIONAL`)

 | 백분위·동점·게시 수학 (`HIGH`, `CONDITIONAL`)

 | 초기 `TH-P-01`(분포 재계산)과 초기 `TH-P-02`(동점·소규모 코호트)가 하나로 병합됨.

 |
| `TH-P-02` | 동점·소규모 코호트 경계 확인 (`MEDIUM`, `CONDITIONAL`)

 | 코호트 분류·입력 적격성 (`HIGH`, `CONDITIONAL`)

 | 초기 `TH-P-04`(국내·해외 분류·누락값 정책)의 주제가 `TH-P-02`로 이동하고 심각도가 상향됨.

 |
| `TH-P-03` | 과거 조회수와 맛 평가 구별 (`MEDIUM`, `ACCEPT`)

 | 역사적 조회수 라벨과 신선도 (`MEDIUM`, `CONDITIONAL`)

 | 단순 라벨 확인(`ACCEPT`)에서 채택 영상의 실제 `fetched_at`/`bucket_started_at` 기간 검증(`CONDITIONAL`)으로 변경됨.

 |
| `TH-P-04` | 국내·해외 분류·누락값 정책 확인 (`MEDIUM`, `DEFER`)

 | 게시 멤버십과 병합 충돌 (`MEDIUM`, `CONDITIONAL`)

 | 초기 의미를 버리고 `parsePublicPopularityPublication`·`resolvePublishedPopularityTier` 검증으로 완전히 대체됨.

 |

### 1.2 첨부 2 (`source-core-continuation.txt`, 11개 핵심 모듈 전수 확인)

11개 모듈 전체 본문이 누락 없이 확인되었다 (`SOURCE_OBSERVED`):

1. `apps/web/scripts/build-public-popularity.ts`:
```ts
const rows = source.rows.map((r) => ({ ...r, approved_name: r.name })) as unknown as Tables<'restaurants'>[];
...
const overseas = countries.some((country) => restaurantMatchesOverseasCountry(r, country)) || Number(r.lat) < 32 || Number(r.lat) > 40 || Number(r.lng) < 124 || Number(r.lng) > 132;
...
const percentile = (p: number) => counts.length ? counts[Math.max(0, Math.ceil(counts.length * p) - 1)] : null;

```




2. `apps/web/lib/evidence-engineering/frames.ts`:

```ts
if (typeof record.storage_object_key === "string" && record.storage_object_key !== frame.storage_object_key) {
  throw new EvidenceContractError(EvidenceContractCodes.storageKeyMismatch);
}
...
if (copies.some((copy) => !sameIdentity(anchor, copy))) {
  throw new EvidenceContractError(EvidenceContractCodes.duplicateFrameConflict);
}

```


3. `apps/web/lib/evidence-engineering/published-popularity.ts`:

```ts
if (data.entries.length > 0 && (data.publicationVersion === 'unpublished' || data.sourceRevision === null)) return fail();
...
if (members[0] !== row.restaurantId) return fail();
...
for (const member of members ?? []) {
    if (lookup(member.id) !== tier) return 'standard';
}

```


4. 기타 8개 모듈: `guards.ts` (`requireTimestampMs`, `requireImageUrl`, `safeCount`), `storage-key.mjs` (`formatStorageObjectKey`), `upload-evidence-frame.ts` (`assertWebpBytes`, `uploadEvidenceWebp`), `publish-evidence-frames.ts` (`previewFramePublication`, `publishFrameFiles`), `naver-map-marker-visuals.ts` (`getNaverIndividualMarkerVisual`), `naver-map-cluster-visuals.ts` (`getNaverClusterMarkerVisual`), `cluster-marker.ts` (`createClusterMarkerHTML`), `clustering.ts` (`restaurantsToGeoJSON`, `getRegionalClusters`, `getSeoulDistrictClusters`).

### 1.3 첨부 3 (`source-remaining.txt`) 대조 표본 및 절단(`SOURCE_MISSING`) 명세

* **본문 확인 완료 (20개 모듈 전체 + 21번째 파일 일부, `SOURCE_OBSERVED`)**:
* `apps/web/components/map/OverseasMap.tsx` (기존 마커 갱신 경계):
```tsx
const marker = markersRef.current.get(restaurant.id)!;
const element = marker.getElement();
const tier = restaurant.popularity_tier ?? 'standard';
if (element.querySelector('[data-popularity-tier]')?.getAttribute('data-popularity-tier') !== tier) {
    element.innerHTML = buildOverseasMarkerHtml({ imagePath: getRestaurantCategoryIcon(restaurant), name: restaurant.name, popularityTier: tier });
    const activeId = getOverseasMarkerActiveId({ searchedRestaurantId: searchedRestaurant?.id, selectedRestaurantId: selectedRestaurant?.id });
    applyOverseasMarkerSelectedState({ container: element.querySelector('.marker-container'), isSelected: restaurant.id === activeId, markerElement: element });
}

```





* `apps/web/components/restaurant/PopularityBadge.tsx`: `if (tier === "standard" || tier === "ember" || assetFailed) return null;` 및 `"2026년 6–7월 수집 기준 · 맛 평가가 아니에요"` 확인.


* `apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx`: `publicReviewedVideoFrames`, `publicEvidenceImageSource`, `frameLabel` 확인.


* 이외 `route.ts`, `filter-state.ts`, `Badge3DViewer.tsx`, `RestaurantDetailPanel.tsx`, `maps.ts`, `overseas-regions.ts`, `use-restaurant-detail.tsx`, `use-restaurants.tsx`, `useDevicePerformance.ts`, `integrations/supabase/types.ts`, `device-location-map.ts`, `device-performance.ts`, `badge-device-capability.ts`, `badge-viewer-lifecycle.ts`, `constants.ts`, `errors.ts`, `popularity-marker.ts` 전문 확인.


* `apps/web/lib/evidence-engineering/public-popularity-publication.json`: `schemaVersion: 2`, `publicationVersion: "video-views-20261022-v1"`, `sourceRevision: "13ded67a820549ae51f5b966104bf900c22aeb1a"`, 첫 엔트리 `0022b9ec-...`부터 `"restaurantId": "95aa0445-354a-41ef-a623-fe0f2933925...` 지점까지 총 218개 엔트리(중 `fire` 6, `ember` 8, `rainbow` 27, `standard` 177) 확인.




* **`SOURCE_MISSING` 선언 (첨부 3의 대용량 파일 이후 절단 구간)**:
`source-remaining.txt`가 `types.ts`(108,964B)와 `public-popularity-publication.json`(138,754B) 본문 도중(`95aa0445-...`)에서 절단되어,(1) `public-popularity-publication.json`의 나머지 517개 엔트리 본문과 (2) 그 뒤에 위치한 나머지 28개 스코프 경로(`NaverMapView.tsx`, `naver-map-sidepanels.tsx`, `lib/overseas-map-marker-helpers.ts`, `lib/overseas-map-helpers.ts`, `lib/overseas-map-restaurant-helpers.ts`, `lib/overseas-region-matching.ts`, `lib/restaurant-merged-media.ts`, `lib/youtube-url.ts` 및 단위 테스트 파일들)의 본문은 `SOURCE_MISSING`이다. 또한 원본 동결 입력(`approved-source-rows.json`, `metrics.json`), DB 영수증, 실제 WebP 바이너리 12개, 로컬 테스트 실행 로그는 첨부되지 않았다(`UNVERIFIED`).



---

## 2. 종합 판정 매트릭스 (기존 `TH-*` 12건 + 신규 실증 결함 `GEM-*` 4건)

| ID | 대상 / 소스 위치 | 심각도 | 증거 등급 (환경) | Pro 판정 | 본 감사 판정 | 핵심 결론 및 Pro 보고서 반박 요지 |
| --- | --- | --- | --- | --- | --- | --- |
| `TH-M-01` | 국내 마커·클러스터 등급 유지 (`naver-map-marker-visuals.ts:171-225`, `naver-map-cluster-visuals.ts:43-112`) | `MEDIUM` | `SOURCE_OBSERVED` + `SOURCE_MISSING` (`NaverMapView.tsx`) (`lab`) | `CONDITIONAL` | **CONDITIONAL** | 시각 헬퍼 캐시 키에 `popularityTier`가 포함됨은 확인. 단, `NaverMapView.tsx` 본문이 `SOURCE_MISSING`이므로 SDK 아이콘 교체·선택 상태 통합 검증이 조건임.

 |
| `TH-M-02` | 해외 마커 기존 DOM 갱신 누락 (`OverseasMap.tsx:332-340`) | `MEDIUM` | `SOURCE_OBSERVED` (`lab`) | `ACCEPT` | **ACCEPT** | 등급(`data-popularity-tier`)만 비교하여 동일 등급 내 이름·카테고리 아이콘 변경 시 `innerHTML`이 갱신되지 않는 결함 확인.

 |
| `GEM-M-01` | 해외 마커 클릭 클로저·좌표 고착 및 `(0,0)` 마커 생성 (`OverseasMap.tsx:316-340`, `use-restaurants.tsx:432,607`) | `HIGH` | `SOURCE_OBSERVED` (`lab`) | 미식별 (누락) | **ACCEPT** | **신규 결함**: 기존 마커 재사용 시 최초 `addEventListener('click', ...)`가 초기 `restaurant` 객체와 초기 콜백을 영구 캡처하여 등급/리뷰수 갱신 후에도 클릭 시 구 데이터를 전달하며, `setLngLat` 미갱신 및 결측 좌표 `(0,0)` 마커 생성이 발생함.

 |
| `TH-M-03` | 클러스터 파생 캐시 제자리 변이 (`clustering.ts:111-143, 355-430, 646-659`) | `LOW` | `SOURCE_OBSERVED` (`lab`) | `CONDITIONAL` | **CONDITIONAL** | React 정상 흐름(`mergeRestaurants`/`projectPublishedPopularityTier`)은 새 배열·객체를 반환하나, `clustering.ts` 자체 주석 계약(제자리 수정 감지) 대비 `isClusterEntryCurrent`와 `geoJsonCache`에 `popularityTier`가 누락되어 있음.

 |
| `TH-P-01` | 백분위(`nearest-rank`)·동점·735개 분포 및 정책 문자열 (`build-public-popularity.ts:28-40`) | `HIGH` | `SOURCE_OBSERVED` + `UNVERIFIED` (`lab`) | `CONDITIONAL` | **CONDITIONAL** | `Math.ceil(n * p) - 1` 및 `>=` 비교는 표준 nearest-rank 정의와 합치함. 단, 원시 입력 JSON과 `publication.json` 후반부(517개) 부재로 `15/21/71/628` 전수 재계산은 `UNVERIFIED`이며, `policy` 문자열에 `p98`이 누락됨.

 |
| `TH-P-02` | 코호트 분류 `Number(null)` 및 승인 필터 (`build-public-popularity.ts:16-26`) | `HIGH` | `SOURCE_OBSERVED` (`lab`) | `CONDITIONAL` | **ACCEPT** (Pro 패치는 **REJECT**) | `status === 'approved'` 필터 부재 및 결측 좌표의 해외 오분류는 실제 결함임. **단, Pro가 제안한 패치는 `mergeRestaurants`가 결측 좌표를 `lat: 0, lng: 0`(유한 숫자)으로 먼저 변환한다는 사실을 간과하여 여전히 해외로 오분류하므로 반증·교정함**.

 |
| `GEM-P-01` | `approved_name` 덮어쓰기 및 국내외 위도 경계 불일치 (`build-public-popularity.ts:16,25`, `RestaurantDetailPanel.tsx:699-702`) | `MEDIUM` | `SOURCE_OBSERVED` (`lab`) | 미식별 (누락) | **ACCEPT** | **신규 결함**: (1) `{ ...r, approved_name: r.name }`이 기존 `r.approved_name`을 덮어쓰며, (2) 빌더(`lat < 32 || lat > 40`)와 상세 공유 URL(`lat < 33 || lat > 39`)의 해외 판정 위도 경계가 불일치함.

 |
| `TH-P-03` | 역사적 조회수(2026년 6~7월) 라벨 및 `ember` 배지 비표시 (`PopularityBadge.tsx:104,130`) | `MEDIUM` | `SOURCE_OBSERVED` + `UNVERIFIED` (`lab`) | `CONDITIONAL` | **CONDITIONAL** | 배지 문구는 조회수 기준임을 명시하나 원시 `metrics.rows` 부재로 채택 영상의 관측 시점이 모두 2026년 6~7월인지는 `UNVERIFIED`임. 또한 `PopularityBadge.tsx:104`는 `tier === "ember"`일 때 `null`을 반환함.

 |
| `TH-P-04` | 게시 멤버십 및 병합 등급 강등 보호 (`published-popularity.ts:43-53, 76-88`) | `LOW` | `SOURCE_OBSERVED` (`lab`) | `CONDITIONAL` | **ACCEPT** (임의 승격설 **REJECT**) | `members[0] === row.restaurantId`, 사전순 정렬·중복 금지, `lookup(member.id) !== tier` 시 `'standard'` 강등이 소스에서 완결적으로 증명됨.

 |
| `TH-E-01` | 승인 맥락 프레임(`on_site_scene`)과 L1 신원 증거 구분 (`frames.ts:75-82`, `RestaurantEvidenceCarousel.tsx:27-42,75-78`) | `MEDIUM` | `SOURCE_OBSERVED` (`lab`) | `CONDITIONAL` | **CONDITIONAL** | 코드상 `isLevel1SourceObserved`는 `storefront_sign`·`publisher_location_caption`만 L1으로 인정하여 `on_site_scene` 자동 승격설은 반증됨. 단, 캐러셀 제목(`영상에서 확인한 간판·방문 장면 📸`)은 간판 프레임이 0개일 때도 고정 노출됨.

 |
| `TH-E-02` | 병합 프레임 소유권 및 PostgREST 임베드 누락 (`publish-evidence-frames.ts:24`, `use-restaurants.tsx:42,596-645`) | `HIGH` | `SOURCE_OBSERVED` + `UNVERIFIED` (`lab`) | `DEFER` | **CONDITIONAL** | 게시 시점에는 `restaurant.id`와 `video_id` 일치를 검증하나, 런타임 병합 시 타 영상 형제 레코드의 프레임이 함께 묶일 수 있고 12개 프레임 매니페스트 원시 대조표는 미첨부(`UNVERIFIED`)임.

 |
| `GEM-E-01` | 병합 프레임 충돌 시 `unionApprovedEvidenceFrames` 미포착 예외로 인한 상세 화면 크래시 및 `image_url` 임베드 누락 (`RestaurantEvidenceCarousel.tsx:32-42`, `use-restaurants.tsx:42`) | `HIGH` | `SOURCE_OBSERVED` (`lab`) | 미식별 (누락) | **ACCEPT** | **신규 결함**: (1) `publicReviewedVideoFrames`가 `parseEvidenceFrame`만 `try/catch`로 감싸고 `unionApprovedEvidenceFrames`는 감싸지 않아 병합 레코드 간 동일 `frame_id`/`storage_object_key` 충돌 시 상세 패널 전체가 크래시하며, (2) `RESTAURANT_EVIDENCE_FRAME_EMBED`에 `image_url` 컬럼이 누락됨.

 |
| `TH-E-03` | 프레임 이미지 URL 검증 및 로드 실패 폴백 부재 (`guards.ts:121-135`, `RestaurantEvidenceCarousel.tsx:92-100`) | `MEDIUM` | `SOURCE_OBSERVED` (`lab`) | `CONDITIONAL` | **ACCEPT** | `PopularityBadge.tsx`와 달리 `RestaurantEvidenceCarousel.tsx`의 `<img>`에는 `onError` 상태 폴백이 없어 정적 WebP 로드 실패 시 깨진 이미지 아이콘이 그대로 노출됨.

 |
| `TH-S-01` / `GEM-S-01` | 프레임 게시 파일시스템 경계 및 `mkdir` 선행 경합 (`publish-evidence-frames.ts:41-63`) | `MEDIUM` | `SOURCE_OBSERVED` (`lab`) | `CONDITIONAL` | **CONDITIONAL** | `realpath`, WebP 헤더·SHA-256, `wx` 플래그가 확인되나, `mkdir(dirname(file), { recursive: true })`가 `realpath(dirname(file))` 심볼릭 링크 검사보다 먼저 실행(`GEM-S-01`)되고 다중 파일 쓰기가 비원자적임.

 |
| `TH-R-01` | 프로덕션 SHA·배포·자산 바이트 readback | `HIGH` | `UNVERIFIED` (`field`) | `DEFER` | **DEFER** | 로컬/온라인 무접속 감사 환경이므로 라이브 엔드포인트(`/api/public-popularity`) 및 12개 WebP 바이트는 미검증(`UNVERIFIED`)으로 분리 보존함.

 |
| `TH-R-02` | 기존 배포와 Nightly(`39457197351`) 실패 분리 | `LOW` | `SOURCE_OBSERVED` (`lab`) | `CONDITIONAL` | **ACCEPT** | Nightly(`39457197351`, `receipt_ledger_state`) 실패는 영수증 OCR/원장 경계이며 공개 인기도·프레임 정적 자산과 독립된 이슈로 분리 추적함.

 |

---

## 3. 핵심 쟁점별 수식·소스 도출, 반례 및 최소 교정 패치

### 3.1 `TH-P-02` & `GEM-P-01`: 결측 좌표의 `(0, 0)` 변환 함정 및 Pro 패치 반증

* **소스 위치**: `apps/web/scripts/build-public-popularity.ts` 줄 16~26, `apps/web/hooks/use-restaurants.tsx` 줄 432~433, 605~608, `apps/web/components/restaurant/RestaurantDetailPanel.tsx` 줄 699~702.


* **반증 및 도출**:
1. `buildPublicPopularity` 줄 18은 `mergeRestaurants(rows, () => 'standard')`의 반환값 `r`에 대해 코호트를 분류한다.


2. 그런데 `mergeRestaurants` 내부의 `projectSingletonRestaurant`(`use-restaurants.tsx:432-433`)와 다중 병합 루프(`use-restaurants.tsx:605-608`)는 원본 행의 `lat: null, lng: null`을 이미 `lat: 0, lng: 0` (타입 `number`)으로 강제 변환해 반환한다:


```ts
const latLngRestaurant = groupRestaurants.find((restaurant) => restaurant.lat && restaurant.lng) || mainRestaurant;
const lat = latLngRestaurant?.lat || 0;
const lng = latLngRestaurant?.lng || 0;

```






3. 따라서 `chatgpt_master_plan.md`가 `TH-P-02`에서 제안한 수정 코드(`typeof r.lat === "number" && Number.isFinite(r.lat) && r.lat >= -90 && r.lat <= 90`)는 `r.lat === 0, r.lng === 0`에서 `hasValidCoordinates === true`가 되고, 이어서 `0 < 32`가 참이 되어 결측 좌표 국내 맛집을 **여전히 100% 해외(`overseas`) 코호트로 오분류한다 (`REJECT`)**.
4. 또한 줄 16의 `{ ...r, approved_name: r.name }`은 `status === 'approved'`를 확인하지 않을 뿐 아니라 원본에 `approved_name`이 있을 때 `r.name`으로 덮어쓰며, `RestaurantDetailPanel.tsx:700`의 공유 링크 해외 판정(`lat < 33 || lat > 39`)은 빌더(`lat < 32 || lat > 40`)와 제주도/북단 경계($32 \le \text{lat} < 33$, $39 < \text{lat} \le 40$)에서 불일치한다(`GEM-P-01`).


* **최소 교정 패치 (`PROPOSED`)**:

```diff
--- a/apps/web/scripts/build-public-popularity.ts
+++ b/apps/web/scripts/build-public-popularity.ts
@@ -13,16 +13,26 @@
   const source = JSON.parse(sourceBytes.toString()) as { rows: Array<Record<string, unknown>> };
   const metrics = JSON.parse(metricBytes.toString()) as { rows: Array<{ video_id: string; view_count: number | string; fetched_at: string; bucket_started_at: string }> };
   const byVideo = new Map(metrics.rows.map((r) => [r.video_id, r]));
-  const rows = source.rows.map((r) => ({ ...r, approved_name: r.name })) as unknown as Tables<'restaurants'>[];
+  const rows = source.rows
+    .filter((r) => r.status === 'approved')
+    .map((r) => ({ ...r, approved_name: (r.approved_name ?? r.name) as string })) as unknown as Tables<'restaurants'>[];
   const countries = [...new Set(Object.values(OVERSEAS_REGIONS).map((r) => r.country))];
   const groups = mergeRestaurants(rows, () => 'standard').map((r) => {
     const members = r.mergedRestaurants?.length ? r.mergedRestaurants : [r];
     const ids = [...new Set(members.map((m) => m.id))].sort();
     const videos = [...new Set(members.map((m) => extractCanonicalYouTubeVideoId(m.youtube_link ?? '')).filter((v): v is string => !!v))];
     const observed = videos.flatMap((id) => {
       const metric = byVideo.get(id); const count = Number(metric?.view_count);
       return metric && Number.isSafeInteger(count) && count > 0 ? [{ videoId: id, count, observedAt: metric.fetched_at || metric.bucket_started_at }] : [];
     });
-    const overseas = countries.some((country) => restaurantMatchesOverseasCountry(r, country)) || Number(r.lat) < 32 || Number(r.lat) > 40 || Number(r.lng) < 124 || Number(r.lng) > 132;
+    const coordMember = members.find(
+      (m) => typeof m.lat === 'number' && typeof m.lng === 'number'
+        && Number.isFinite(m.lat) && Number.isFinite(m.lng)
+        && (m.lat !== 0 || m.lng !== 0),
+    );
+    const outsideDomesticBox = coordMember !== undefined
+      && (coordMember.lat! < 32 || coordMember.lat! > 40 || coordMember.lng! < 124 || coordMember.lng! > 132);
+    const overseas = countries.some((country) => restaurantMatchesOverseasCountry(r, country)) || outsideDomesticBox;
     return { restaurantId: ids[0], memberRestaurantIds: ids, name: r.name, cohort: overseas ? 'overseas' : 'domestic', viewCount: observed.length ? Math.max(...observed.map((m) => m.count)) : null, observed };
   });

```

* **네이티브 검증 (`PROPOSED`)**: `{ id: 'kr-null', status: 'approved', name: '국내무좌표', road_address: '서울특별시 중구 세종대로 110', lat: null, lng: null }` 입력 시 `mergeRestaurants` 통과 후에도 `cohort === 'domestic'`으로 분류되고 `status: 'pending'` 행이 제외되는지 단위 테스트로 검증한다. (기존 게시본 `video-views-20261022-v1`은 운영자 검토 없이는 무단 재생성하지 않는다.)

---

### 3.2 `TH-P-01`, `TH-P-03`, `TH-P-04`: 백분위 수학, 동점·소규모 코호트, 멤버십 불변식

* **소스 위치**: `apps/web/scripts/build-public-popularity.ts` 줄 28~40, `apps/web/lib/evidence-engineering/published-popularity.ts` 줄 25~98, `apps/web/components/restaurant/PopularityBadge.tsx` 줄 104, 130.


* **수학적 도출 및 검증**:
* 각 코호트 $c \in \{\text{domestic}, \text{overseas}\}$에서 유효 조회수($\text{viewCount} \in \mathbb{Z}^+$, `Number.isSafeInteger(count) && count > 0`)를 가진 그룹들의 오름차순 정렬 수열을 $x_0 \le x_1 \le \dots \le x_{n-1}$ ($n = \text{knownGroups}$)이라 할 때, 코드의 임계값 인덱스는 $k(p) = \max(0, \lceil n p \rceil - 1)$이다.


* 등급 판정 조건은 $v \ge x_{k(0.98)} \implies \text{fire}$, $x_{k(0.95)} \le v < x_{k(0.98)} \implies \text{ember}$, $x_{k(0.85)} \le v < x_{k(0.95)} \implies \text{rainbow}$이다.


* **소규모 코호트 및 동점 퇴화(Degeneracy) 증명**:
* 만약 코호트 크기 $n \le 20$이면 $\lceil 0.98 n \rceil = \lceil 0.95 n \rceil = n$이 되어 $k(0.98) = k(0.95) = n - 1$이므로 $\text{fireAt} = \text{emberAt}$가 된다. 이 경우 `v >= cut.fireAt`가 먼저 평가되므로 해당 코호트에서는 **`ember` 등급이 구조적으로 0개**가 된다.


* 반대로 임계값에 동점이 다수 존재하면 상위 등급 비율이 명목상 $2%/5%/15%$를 초과할 수 있다.




* **게시 멤버십 보호(`TH-P-04`) 증명**: `parsePublicPopularityPublication`은 전역 `seen` 집합과 `members[i-1] >= member` 검사로 (a) 전체 게시물 내 어떤 레스토랑 ID도 두 그룹에 중복 속할 수 없고, (b) 각 그룹의 `memberRestaurantIds`는 엄격한 사전순 오름차순이며 `members[0] === row.restaurantId`임을 강제한다. 또한 런타임 `resolvePublishedPopularityTier`는 `members` 중 단 하나라도 `lookup(member.id) !== tier`이면 즉시 `'standard'`로 강등한다.


* **UI 표시 경계(`TH-P-03`)**: 지도 마커(`popularity-marker.ts:4-8`)는 `fire`, `ember`, `rainbow` 모두 불꽃 SVG를 그리지만, 상세 배지 컴포넌트(`PopularityBadge.tsx:104`)는 `if (tier === "standard" || tier === "ember" || assetFailed) return null;`로 `ember` 등급을 숨기며 `RestaurantDetailPanel.tsx` 본문에는 `<PopularityBadge>` 마운트 자체가 없다 (`NaverMapDetailPanelShell` 등 외부 래퍼는 `SOURCE_MISSING`).





---

### 3.3 `TH-M-01`, `TH-M-02`, `GEM-M-01`, `TH-M-03`: 국내·해외 마커 및 클러스터 캐시 경계

* **소스 위치**: `apps/web/components/map/OverseasMap.tsx` 줄 262~271, 297~366, `apps/web/lib/clustering.ts` 줄 111~143, 355~430, 646~659.


* **`OverseasMap.tsx`의 복합 Stale 결함 (`TH-M-02` + `GEM-M-01`)**:
1. `OverseasMap.tsx:316-321`은 마커 최초 생성 시에만 `el.addEventListener('click', ...)`를 등록하고 `markersRef.current`에 보관한다.


2. 이후 `restaurantsToShow`가 갱신될 때 `else` 분기(줄 329~338)는 오직 `data-popularity-tier !== tier`일 때만 `element.innerHTML`을 다시 쓰며, (a) 동일 등급 내 이름·카테고리 아이콘 변경을 무시하고(`TH-M-02`), (b) 등급이 바뀌어 `innerHTML`을 다시 쓸 때조차 **`el`의 클릭 리스너가 최초 마운트 시점의 `restaurant` 객체와 초기 콜백(`onRestaurantSelect`, `onMarkerClick`, `moveToRestaurant`)을 그대로 참조**하며, (c) 좌표 변경 시 `marker.setLngLat`를 호출하지 않는다(`GEM-M-01`).




* **최소 교정 패치 (`PROPOSED`) — `OverseasMap.tsx` 및 `clustering.ts**`:

```diff
--- a/apps/web/components/map/OverseasMap.tsx
+++ b/apps/web/components/map/OverseasMap.tsx
@@ -85,6 +85,9 @@
     const mapContainer = useRef<HTMLDivElement>(null);
     const map = useRef<maplibregl.Map | null>(null);
     const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
+    const latestRestaurantsRef = useRef<Map<string, Restaurant>>(new Map());
+    const onRestaurantSelectRef = useRef(onRestaurantSelect);
+    const onMarkerClickRef = useRef(onMarkerClick);
+    const moveToRestaurantRef = useRef<(restaurant: Restaurant) => void>(() => {});
     const deviceLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
@@ -295,6 +298,10 @@
     useEffect(() => {
         if (!map.current || !isMapLoaded) return;
+        onRestaurantSelectRef.current = onRestaurantSelect;
+        onMarkerClickRef.current = onMarkerClick;
+        moveToRestaurantRef.current = moveToRestaurant;
+        latestRestaurantsRef.current = new Map(restaurantsToShow.map((r) => [r.id, r]));

         const currentMarkerIds = new Set(restaurantsToShow.map(r => r.id));
@@ -306,8 +313,12 @@
         // 2. Add or update markers
         restaurantsToShow.forEach(restaurant => {
+            const lat = Number(restaurant.lat);
+            const lng = Number(restaurant.lng);
+            if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;
+            const imagePath = getRestaurantCategoryIcon(restaurant);
+            const tier = restaurant.popularity_tier ?? 'standard';
+            const nextHtml = buildOverseasMarkerHtml({ imagePath, name: restaurant.name, popularityTier: tier });
             if (!markersRef.current.has(restaurant.id)) {
-                const imagePath = getRestaurantCategoryIcon(restaurant);
-
                 const el = document.createElement('div');
                 el.id = `marker-${restaurant.id}`;
                 el.style.width = `32px`;
                 el.style.height = `32px`;
                 el.style.cursor = 'pointer';
-                el.innerHTML = buildOverseasMarkerHtml({
-                    imagePath,
-                    name: restaurant.name,
-                    popularityTier: restaurant.popularity_tier,
-                });
+                el.innerHTML = nextHtml;
+                el.dataset.markerRenderKey = `${tier}|${imagePath}|${restaurant.name}`;

                 el.addEventListener('click', (e) => {
                     e.stopPropagation();
-                    onRestaurantSelect?.(restaurant);
-                    onMarkerClick?.(restaurant);
-                    moveToRestaurant(restaurant);
+                    const current = latestRestaurantsRef.current.get(restaurant.id) ?? restaurant;
+                    onRestaurantSelectRef.current?.(current);
+                    onMarkerClickRef.current?.(current);
+                    moveToRestaurantRef.current(current);
                 });

                 const marker = new maplibregl.Marker({ element: el })
-                    .setLngLat([Number(restaurant.lng), Number(restaurant.lat)])
+                    .setLngLat([lng, lat])
                     .addTo(map.current!);

                 markersRef.current.set(restaurant.id, marker);
             } else {
                 const marker = markersRef.current.get(restaurant.id)!;
+                marker.setLngLat([lng, lat]);
                 const element = marker.getElement();
-                const tier = restaurant.popularity_tier ?? 'standard';
-                if (element.querySelector('[data-popularity-tier]')?.getAttribute('data-popularity-tier') !== tier) {
-                    element.innerHTML = buildOverseasMarkerHtml({ imagePath: getRestaurantCategoryIcon(restaurant), name: restaurant.name, popularityTier: tier });
+                const nextKey = `${tier}|${imagePath}|${restaurant.name}`;
+                if (element.dataset.markerRenderKey !== nextKey) {
+                    element.innerHTML = nextHtml;
+                    element.dataset.markerRenderKey = nextKey;
                     const activeId = getOverseasMarkerActiveId({ searchedRestaurantId: searchedRestaurant?.id, selectedRestaurantId: selectedRestaurant?.id });
                     applyOverseasMarkerSelectedState({ container: element.querySelector('.marker-container'), isSelected: restaurant.id === activeId, markerElement: element });
                 }

```

```diff
--- a/apps/web/lib/clustering.ts
+++ b/apps/web/lib/clustering.ts
@@ -355,6 +355,7 @@
 type RestaurantClusterEntry = {
     id: string;
     address: string;
     lat: Restaurant['lat'];
     lng: Restaurant['lng'];
     categoryLabel: string;
+    popularityTier: "fire" | "ember" | "rainbow" | "standard";
     hasCoordinates: boolean;
     region?: string | null;
     district?: string | null;
 };
@@ -382,14 +383,16 @@
         lat,
         lng,
         categoryLabel: clusterCategoryLabel(restaurant),
+        popularityTier: publicPopularityTier(restaurant.popularity_tier),
         hasCoordinates: Boolean(lat) && Boolean(lng),
     };
 };

 const isClusterEntryCurrent = (restaurant: Restaurant, entry: RestaurantClusterEntry): boolean =>
     entry.id === restaurant.id
     && entry.address === clusterAddressOf(restaurant)
     && Object.is(entry.lat, restaurant.lat)
     && Object.is(entry.lng, restaurant.lng)
-    && entry.categoryLabel === clusterCategoryLabel(restaurant);
+    && entry.categoryLabel === clusterCategoryLabel(restaurant)
+    && entry.popularityTier === publicPopularityTier(restaurant.popularity_tier);

```

---

### 3.4 `TH-E-01`, `TH-E-02`, `TH-E-03`, `GEM-E-01`, `TH-S-01`, `GEM-S-01`: 영상 근거 프레임 및 정적 게시기

* **소스 위치**: `apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx` 줄 32~42, 74~106, `apps/web/hooks/use-restaurants.tsx` 줄 42, `apps/web/lib/evidence-engineering/frames.ts` 줄 173~214, `apps/web/scripts/publish-evidence-frames.ts` 줄 41~63.


* **핵심 결함 도출**:
1. **`GEM-E-01` (병합 프레임 충돌 시 상세 패널 미포착 예외 크래시 및 `image_url` SELECT 누락)**:
* `publicReviewedVideoFrames`(`RestaurantEvidenceCarousel.tsx:32-42`)는 개별 `parseEvidenceFrame`은 `try/catch`로 감싸지만 `unionApprovedEvidenceFrames(parsed)`는 `try/catch` 없이 호출한다. 병합된 두 레코드의 임베드 프레임에서 동일 `frame_id`의 메타데이터가 다르거나(`duplicateFrameConflict`), 승인/거절이 충돌하거나(`moderationConflict`), 서로 다른 `frame_id`가 동일 `storage_object_key`를 가리키면 `unionApprovedEvidenceFrames`가 `EvidenceContractError`를 던져 상세 데이터 훅(`use-restaurant-detail.tsx:30`)과 상세 패널(`RestaurantDetailPanel.tsx:871`) 전체가 깨진다.


* 또한 `use-restaurants.tsx:42`의 `RESTAURANT_EVIDENCE_FRAME_EMBED`에 `image_url` 컬럼이 빠져 있어 DB에 저장된 `image_url`이 항상 `undefined -> null`로 소실된다.




2. **`TH-E-01` & `TH-E-03` (헤더 문구 및 이미지 로드 실패 폴백)**:
* `visible` 프레임에 `isLevel1SourceObserved`가 하나도 없을 때(현재 게시된 12개 프레임 모두 `on_site_scene`)에도 `<h3>`가 `"영상에서 확인한 간판·방문 장면 📸"`으로 렌더링되며, `<img>`에 `onError` 핸들러가 없어 이미지 404/디코딩 실패 시 깨진 프레임이 남는다.




3. **`TH-S-01` & `GEM-S-01` (`publishFrameFiles`의 `mkdir` 선행 문제)**:
* `publish-evidence-frames.ts:47-48`에서 `await mkdir(dirname(file), { recursive: true })`를 실행한 뒤에야 `await realpath(dirname(file))`가 `physicalOutput + sep` 하위인지 검사한다. 부모 경로의 심볼릭 링크 검사를 `mkdir` 이전에 수행하거나 `output` 생성 직후 하위 디렉터리 심볼릭 링크 여부를 먼저 검증해야 한다.






* **최소 교정 패치 (`PROPOSED`) — `RestaurantEvidenceCarousel.tsx` 및 `use-restaurants.tsx**`:

```diff
--- a/apps/web/hooks/use-restaurants.tsx
+++ b/apps/web/hooks/use-restaurants.tsx
@@ -39,3 +39,3 @@
-export const RESTAURANT_EVIDENCE_FRAME_EMBED = "restaurant_evidence_frames(frame_id,content_sha256,video_id,timestamp_ms,storage_object_key,youtube_seek_url,frame_type,evidence_level,confidence_level,moderation_status,detected_shop_name,detected_branch_name)";
+export const RESTAURANT_EVIDENCE_FRAME_EMBED = "restaurant_evidence_frames(frame_id,content_sha256,video_id,timestamp_ms,storage_object_key,youtube_seek_url,frame_type,evidence_level,confidence_level,moderation_status,detected_shop_name,detected_branch_name,image_url)";

```

```diff
--- a/apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx
+++ b/apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx
@@ -1,3 +1,4 @@
+import { useState } from "react";
 import { isLevel1SourceObserved, parseEvidenceFrame, unionApprovedEvidenceFrames } from "@/lib/evidence-engineering/frames";
 import type { RestaurantEvidenceFrame } from "@/lib/evidence-engineering/types";
@@ -39,5 +40,9 @@
-  return unionApprovedEvidenceFrames(parsed).filter(
-    (frame) => frame.evidence_level === "SOURCE_OBSERVED",
-  );
+  try {
+    return unionApprovedEvidenceFrames(parsed).filter(
+      (frame) => frame.evidence_level === "SOURCE_OBSERVED",
+    );
+  } catch {
+    return [];
+  }
 }
@@ -68,11 +73,14 @@
 export function RestaurantEvidenceCarousel({ frames }: { frames: readonly RestaurantEvidenceFrame[][] }) {
-  const visible = publicReviewedVideoFrames(frames);
+  const [failedFrameIds, setFailedFrameIds] = useState<ReadonlySet<string>>(() => new Set());
+  const visible = publicReviewedVideoFrames(frames).filter((frame) => !failedFrameIds.has(frame.frame_id));
   if (visible.length === 0) return null;
+  const hasLevel1 = visible.some(isLevel1SourceObserved);
   return (
     <section className="py-2 pb-[env(safe-area-inset-bottom)]" aria-label="쯔양 영상 근거와 방문 장면">
       <p className="text-2xs font-bold tracking-wide text-brand-garden-text">쯔양 영상 속 그 장면</p>
-      <h3 className="mb-2 text-sm font-black tracking-tight">영상에서 확인한 간판·방문 장면 📸</h3>
+      <h3 className="mb-2 text-sm font-black tracking-tight">
+        {hasLevel1 ? "영상에서 확인한 간판·방문 장면 📸" : "영상에서 확인한 방문·현장 장면 📸"}
+      </h3>
       {visible.some((frame) => !isLevel1SourceObserved(frame)) && (
         <p className="mb-2 text-xs text-muted-foreground">현장 장면은 영상의 맥락을 보여주며, 매장 신원을 확인하는 간판·매장 안내와 구분해요.</p>
       )}
@@ -96,6 +104,9 @@
                 height={360}
                 loading={presentation.loading}
                 decoding="async"
+                onError={() => {
+                  setFailedFrameIds((prev) => new Set(prev).add(frame.frame_id));
+                }}
                 className="aspect-video w-full rounded-t-xl object-cover"
               />

```

---

## 4. 필수 네이티브 검증 체크리스트 (`PROPOSED`) 및 최종 판정

1. **게이트 1 — 인기도 빌더 및 코호트 경계 (`TH-P-01`, `TH-P-02`, `GEM-P-01`)**:
* `bun test`로 (a) `lat: null, lng: null`인 국내 승인 맛집이 `mergeRestaurants`를 거친 뒤에도 `domestic` 코호트로 분류되는지, (b) `status !== 'approved'` 행이 빌더에서 즉시 제외되는지, (c) 원시 스냅샷(`13ded67a820549ae51f5b966104bf900c22aeb1a`) 대비 `735`개 그룹(`15/21/71/628`)과 모든 유효 채택 영상의 관측 시각(`2026-06`~`2026-07`)이 결정론적으로 일치하는지 검증한다.




2. **게이트 2 — 해외 마커 및 서울 자치구 캐시 (`TH-M-02`, `GEM-M-01`, `TH-M-03`)**:
* 동일 `id` 마커의 등급이 바뀌거나 동일 등급에서 이름·카테고리가 바뀐 뒤 마커를 클릭했을 때 최신 `restaurant` 객체가 `onRestaurantSelect`/`onMarkerClick`에 전달되는지, 그리고 동일 배열 참조에서 `popularity_tier` 제자리 변경 시 `getSeoulDistrictClusters`가 갱신된 등급을 반환하는지 검증한다.




3. **게이트 3 — 프레임 병합 충돌 안전성 및 이미지 실패 폴백 (`TH-E-01..03`, `GEM-E-01`)**:
* 병합된 두 레코드에 충돌 프레임(`duplicateFrameConflict` / `moderationConflict`)이 있을 때 `publicReviewedVideoFrames`가 예외를 던지지 않고 빈 배열(`[]`)로 fail-closed 처리하는지, 이미지 `onError` 시 깨진 카드가 제거되는지, 12개 공개 WebP 파일의 실바이트 SHA-256이 `content_sha256` 및 매니페스트 소유권(`restaurant_id`, `video_id`)과 일치하는지 검증한다.





**최종 감사 결론**: **CONDITIONAL**. `published-popularity.ts`의 멤버십 정렬·충돌 시 `'standard'` 강등(`TH-P-04`)과 `frames.ts`의 L1/맥락 구분 수식(`TH-E-01`)은 소스에서 건전함이 입증되었으나, `buildPublicPopularity`의 결측 좌표 `(0,0)` 변환 함정(및 이를 잡지 못하는 Pro 패치 오류, `TH-P-02`/`GEM-P-01`), `OverseasMap.tsx`의 기존 마커 클릭 클로저·HTML 고착(`TH-M-02`/`GEM-M-01`), `RestaurantEvidenceCarousel.tsx`의 미포착 병합 충돌 예외·이미지 에러 미처리(`GEM-E-01`/`TH-E-03`), 그리고 `SOURCE_MISSING` 구간 및 원시 입력/자산 바이트 대조(`TH-R-01`)가 선결되어야 완전 승인이 가능하다. 기존 운영 배포와 Nightly(`39457197351`) 실패는 별개 경계로 보존한다.