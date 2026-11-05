## 5. 결함별 판정 — `TH-M-01`부터

이하 내용은 앞선 1\~4절의 연속이다. 새 첨부 `source-core-continuation.txt`에서 이전에 `SOURCE_MISSING`으로 분류한 핵심 함수 본문을 확인했으므로, 해당 소스 의존 판정을 갱신한다.

### 5.1 추가 소스 접근 영수증

소스 기준: `ac80e35da566db242420a62bbf3e3320b5c00e76` 변경 상태: 첨부에 따르면 기존 원본과 동일하며 dirty delta 없음.

| 확인한 소스                                              | 실제 확인한 구현                                                                                 | 판정에 미치는 영향         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| `scripts/build-public-popularity.ts`                | `mergeRestaurants(rows, () => 'standard')`, 영상별 조회수 최댓값, 국내·해외 분리, `Math.ceil(n * p) - 1` | 백분위·코호트 판정 가능      |
| `lib/evidence-engineering/frames.ts`                | `parseEvidenceFrame`, `sameIdentity`, `unionApprovedEvidenceFrames`                       | 승인·중복·충돌 판정 가능     |
| `lib/evidence-engineering/published-popularity.ts`  | `parsePublicPopularityPublication`, `lookupFor`, `resolvePublishedPopularityTier`         | 게시 멤버십·병합 등급 판정 가능 |
| `lib/evidence-engineering/guards.ts`                | `requireTimestampMs`, `requireImageUrl`, `requireContentSha256`                           | 입력값 검증 범위 확인       |
| `lib/evidence-engineering/upload-evidence-frame.ts` | WebP 헤더·SHA-256·충돌 검사                                                                     | 업로드 경계 확인          |
| `scripts/publish-evidence-frames.ts`                | 소유 맛집·영상 일치, 실경로 검사, 확인 해시, `wx` 쓰기                                                       | 정적 게시 경계 확인        |
| `lib/naver-map-marker-visuals.ts`                   | 개별 마커 캐시 키에 `popularityTier` 포함                                                           | 등급 변경 시 캐시 갱신 근거   |
| `lib/naver-map-cluster-visuals.ts`                  | 클러스터 HTML 캐시 키에 등급 포함                                                                     | 클러스터 등급 변경 반영 근거   |
| `lib/cluster-marker.ts`, `lib/clustering.ts`        | `popularityFlameMarkup`, `bestPopularityTier` 호출                                          | 클러스터 집계 및 표시 경로 확인 |

실제 소스의 대표 구문은 다음과 같다.

```
const percentile = (p: number) =>
  counts.length
    ? counts[Math.max(0, Math.ceil(counts.length * p) - 1)]
    : null;
```

```
if (copies.some((copy) => !sameIdentity(anchor, copy))) {
  throw new EvidenceContractError(
    EvidenceContractCodes.duplicateFrameConflict
  );
}
```

```
for (const member of members ?? []) {
  if (lookup(member.id) !== tier) return 'standard';
}
```

```
if (
  !restaurant ||
  restaurant.status !== 'approved' ||
  extractCanonicalYouTubeVideoId(restaurant.youtube_link) !== frame.video_id
) {
  throw new Error('frame_restaurant_video_mismatch');
}
```

이들은 파일명이나 해시가 아닌 실제 함수 본문에 근거한 관찰이다. 이전 `SOURCE_MISSING` 표시는 해당 구현들에 한해 해소한다. 단, 실제 게시 입력 JSON, 원본 WebP 바이트, 네이티브 테스트 실행 결과, 운영 readback은 새 첨부에 포함되지 않았다.&#x20;

source-core-continuation.txt



### 5.2 결함·조건 판정표

| 안정 ID     | ADR / 위험                        | Severity | 증거 등급           | 판정          |
| --------- | ------------------------------- | -------- | --------------- | ----------- |
| `TH-M-01` | ADR-M1 / 국내 개별·클러스터 등급 유지       | MEDIUM   | SOURCE_OBSERVED | CONDITIONAL |
| `TH-M-02` | ADR-M1 / 해외 마커의 동일 등급·변경 데이터 갱신 | MEDIUM   | SOURCE_OBSERVED | ACCEPT      |
| `TH-M-03` | ADR-M1 / 클러스터 캐시와 제자리 변경        | MEDIUM   | SOURCE_OBSERVED | CONDITIONAL |
| `TH-P-01` | ADR-P1 / 백분위·동점·게시 수학           | HIGH     | SOURCE_OBSERVED | CONDITIONAL |
| `TH-P-02` | ADR-P1 / 코호트 분류·입력 적격성          | HIGH     | SOURCE_OBSERVED | CONDITIONAL |
| `TH-P-03` | ADR-P1 / 역사적 조회수 라벨과 신선도        | MEDIUM   | SOURCE_OBSERVED | CONDITIONAL |
| `TH-P-04` | ADR-P1 / 게시 멤버십과 병합 충돌          | MEDIUM   | SOURCE_OBSERVED | CONDITIONAL |
| `TH-E-01` | ADR-E1 / 승인·L1 구분               | HIGH     | SOURCE_OBSERVED | CONDITIONAL |
| `TH-E-02` | ADR-E1 / 병합 프레임 소유권             | HIGH     | SOURCE_OBSERVED | DEFER       |
| `TH-E-03` | ADR-E1 / URL·이미지 실패·표시          | MEDIUM   | SOURCE_OBSERVED | CONDITIONAL |
| `TH-S-01` | ADR-S1 / 게시 경로·파일 충돌·부분 쓰기      | HIGH     | SOURCE_OBSERVED | CONDITIONAL |
| `TH-R-01` | 릴리스 / 실제 게시 SHA·자산 readback     | HIGH     | UNVERIFIED      | DEFER       |
| `TH-R-02` | 릴리스 / Nightly와 운영 배포 분리         | MEDIUM   | SOURCE_OBSERVED | CONDITIONAL |

`ACCEPT`는 해당 결함의 존재 또는 조치 필요성을 수용한다는 뜻이다. `CONDITIONAL`은 소스상 보호가 확인되더라도 지정된 네이티브·통합 검증을 통과하기 전에는 완전한 승인으로 볼 수 없다는 뜻이다.

### TH-M-01 — 국내 개별 마커와 클러스터의 등급 유지

ADR-M1 / Severity MEDIUM / CONDITIONAL

`getNaverIndividualMarkerVisual`의 캐시 키와 객체별 stamp에는 모두 다음 필드가 포함된다.

```
popularityTier: publicPopularityTier(restaurant.popularity_tier)
```

`getNaverClusterMarkerVisual`도 다음과 같이 등급을 키에 포함한다.

```
const visualKey =
  `${currentIndex}:${publicPopularityTier(popularityTier)}`;
```

따라서 입력 등급이 변경됐는데도 동일한 캐시 키로 기존 HTML을 재사용한다는 일반적 주장은 성립하지 않는다.

클러스터 등급은 `createClusterIndex`의 `map/reduce`에서 집계되며, 행정구역 및 서울 자치구 클러스터도 `bestPopularityTier`로 누적한다.

남은 조건: 실제 Naver SDK 마커의 `setIcon`, 선택 상태, 클러스터 재구성 및 지도 이동 경계가 최신 등급을 적용하는지 확인해야 한다. 헬퍼의 캐시 키 정확성만으로 전체 지도 갱신을 인증할 수 없다.

필수 테스트는 동일 ID에 대해 `standard → fire → rainbow → standard`를 적용하고 개별 마커, Supercluster, 행정구역 클러스터, 선택된 마커를 각각 확인하는 것이다.

### TH-M-02 — 해외 마커의 동일 등급 데이터 변경 누락

ADR-M1 / Severity MEDIUM / ACCEPT

앞서 확인한 `OverseasMap.tsx`의 기존 마커 갱신 조건은 `data-popularity-tier`가 변경됐는지에 집중한다.

다음 반례가 성립한다.

1. ID가 `r1`인 마커가 `fire`, 이름 `A`, 카테고리 `한식`으로 렌더링된다.
2. 동일 ID의 새 데이터가 `fire`, 이름 `B`, 카테고리 `일식`으로 도착한다.
3. 등급 비교 결과는 동일하므로 HTML 갱신 분기가 실행되지 않는다.
4. 마커의 표시 내용은 이전 데이터와 불일치할 수 있다.

이는 등급 소실 결함은 아니지만 마커 표시의 stale reuse 결함이다.

최소 수정 방향은 등급 외에 실제 HTML에 영향을 주는 필드를 비교하는 것이다. 단순히 매 렌더마다 `innerHTML`을 재설정하면 선택 상태·포커스·이벤트 수명주기에 영향을 줄 수 있으므로 피한다.

제안 테스트:

```
const before = {
  id: "r1",
  name: "A",
  category: "한식",
  popularity_tier: "fire",
};

const after = {
  ...before,
  name: "B",
  category: "일식",
};

// 동일 ID와 등급을 유지해도 표시 이름/카테고리는 갱신되어야 한다.
expect(markerContentAfterUpdate).toContain("B");
expect(markerContentAfterUpdate).not.toContain("A");
```

필수 조치: 마커 표시 입력에 대한 변경 감지와 선택 상태 복원 테스트. 실제 Naver/MapLibre 브라우저 경계 확인 전까지 수정 완료는 `UNVERIFIED`다.

### TH-M-03 — 클러스터 캐시의 제자리 변경

ADR-M1 / Severity MEDIUM / CONDITIONAL

`clustering.ts`의 `clusterEntriesCache`는 배열 길이와 ID·주소·좌표·카테고리를 비교한다. 반면 캐시된 파생 항목에는 `popularity_tier`가 포함되지 않는다.

특히 `seoulGroupingCache`는 `entriesRef` 동일성을 재사용 조건으로 사용한다.

형식적으로,

\\[ \text{entryCurrent}(r) = f(id,address,lat,lng,category) \\]

이고, 등급만 바뀐 경우

\\[ f(r\_{\text{before}})=f(r\_{\text{after}}) \\]

가 성립한다.

하지만 캐시된 서울 자치구 그룹의 `popularityTier`는 이전 등급을 보유할 수 있다.

실제 반례 후보:

```
const restaurants = [restaurantA, restaurantB, restaurantC];

getRegionalClusters(restaurants);
const first = getSeoulDistrictClusters(restaurants, 3);

restaurantA.popularity_tier = "fire";

getRegionalClusters(restaurants);
const second = getSeoulDistrictClusters(restaurants, 3);

// 동일 배열/객체 제자리 변경 시 새 등급이 반영되어야 한다.
expect(second.clusters[0].popularityTier).toBe("fire");
```

이는 테스트를 실행한 결과가 아니라, 캐시 키의 의존 필드 누락에서 도출한 재현 조건이다.

최소 수정안 — PROPOSED

`RestaurantClusterEntry`와 `isClusterEntryCurrent`에 정규화된 등급을 포함한다.

```
 type RestaurantClusterEntry = {
     id: string;
+    popularityTier: "fire" | "ember" | "rainbow" | "standard";
     address: string;
@@
 const createClusterEntry = (restaurant: Restaurant): RestaurantClusterEntry => {
     const lat = restaurant.lat;
     const lng = restaurant.lng;
     return {
         id: restaurant.id,
+        popularityTier: publicPopularityTier(restaurant.popularity_tier),
@@
 const isClusterEntryCurrent = (
     restaurant: Restaurant,
     entry: RestaurantClusterEntry
 ): boolean =>
     entry.id === restaurant.id
+    && entry.popularityTier === publicPopularityTier(restaurant.popularity_tier)
```

이 변경은 기존 캐시 구조를 유지하면서 등급 변경 시 파생 항목과 서울 그룹화를 무효화한다.

단, 일반적인 React 데이터 흐름에서 새 배열을 생성하는 경우에는 이미 재계산될 수 있다. 따라서 이를 운영에서 재현된 오류라고 단정하지 않는다.

### TH-P-01 — 게시 백분위와 역사적 등급 수학

ADR-P1 / Severity HIGH / CONDITIONAL

추가 소스에서 `buildPublicPopularity`의 계산 방식을 확인했다.

그룹별 조회수는 연결된 영상의 최댓값이다.

\\[ V_g = \max\_{v\in L_g} \operatorname{views}(v) \\]

유효 조회수가 없는 그룹은 `null`이고, 백분위 계산의 분모에서 제외된다.

코호트 \\(c\\)의 유효 그룹 조회수를 오름차순 정렬한 배열을 \\(x_1,\ldots,x_n\\)이라 하면:

\\[ Q_c(p)=x\_{\max(1,\lceil np\rceil)} \\]

이며 `fire`, `ember`, `rainbow`는 각각 P98, P95, P85 임계값을 사용한다.

코드는 다음 순서로 등급을 배정한다.

```
group.viewCount >= cut.fireAt
  ? 'fire'
  : group.viewCount >= cut.emberAt!
    ? 'ember'
    : group.viewCount >= cut.rainbowAt!
      ? 'rainbow'
      : 'standard'
```

수학적 판정: nearest-rank 구현 자체는 선언된 P98/P95/P85 규칙과 일치한다. 그러나 동점이 존재하면 해당 등급의 실제 그룹 수는 정확히 2%, 5%, 15%가 아닐 수 있다.

예를 들어 유효 그룹 100개에서 98번째·99번째·100번째 조회수가 모두 동일하면, P98 이상인 그룹은 3개다.

또한 작은 코호트에서는 임계값이 겹칠 수 있다. \\(n=10\\)이면 P95와 P98 모두 최댓값이므로 `ember` 그룹이 0개가 될 수 있다.

따라서 게시된 `15/21/71/628`은 실제 산출물의 등급별 개수이지, 백분위 정의에서 자동으로 보장되는 개수가 아니다.

현재 추가 소스는 알고리즘을 확인시켜 주지만, 원시 `source.rows`와 `metrics.rows`가 없으므로 이 네 숫자를 독립 재계산할 수 없다.

또한 `evidence.policy` 문자열은 `p95-p85`를 포함하지만 실제 구현은 P98도 사용한다.

```
policy:
  'map-cohort-max-linked-video-views-nearest-rank-p95-p85-v1'
```

이것은 정책 식별자의 설명 불완전성이다. 외부 소비자가 정책 문자열을 기준으로 재현하거나 비교한다면 혼란을 일으킬 수 있다.

조치 기준: 기존 게시 버전을 조용히 재명명하지 않는다. 차기 정책 버전에서 P98/P95/P85를 모두 명시하고, 기존 버전과 결과의 대응 관계를 기록한다.

필수 검증은 동일 원시 입력으로 재빌드한 `entries`, 코호트별 `knownGroups`, 임계값, 동점 수, null 수를 기존 게시 산출물과 비교하는 것이다.

### TH-P-02 — 코호트 분류와 승인 입력

ADR-P1 / Severity HIGH / CONDITIONAL

`buildPublicPopularity`는 다음 조건으로 해외 코호트를 결정한다.

```
const overseas =
  countries.some((country) =>
    restaurantMatchesOverseasCountry(r, country)
  ) ||
  Number(r.lat) < 32 ||
  Number(r.lat) > 40 ||
  Number(r.lng) < 124 ||
  Number(r.lng) > 132;
```

문제 1 — 결측 좌표의 숫자 변환

JavaScript에서:

```
Number(null) === 0
```

이므로 주소상 국내 맛집이라도 `lat` 또는 `lng`가 `null`이면 해외 판정이 발생할 수 있다.

이는 코호트 분모와 백분위 임계값에 영향을 주는 실제 코드 경계다.

문제 2 — 승인 상태의 직접 필터 부재

제공된 빌더는 `source.rows`를 `mergeRestaurants`에 전달하기 전에 `status === 'approved'`로 직접 필터링하지 않는다.

따라서 입력 파일이 승인된 행만 포함한다는 외부 계약이 깨지면 비승인 행이 등급 계산에 참여할 수 있다.

문제 3 — 병합 그룹의 대표 좌표

`mergeRestaurants`는 유효 좌표를 가진 그룹 구성원의 좌표를 대표 좌표로 선택한다. 병합 구성원 간 국내·해외 속성이 충돌하면 대표 좌표 기반 분류가 실제 영상·매장 소유권을 정확히 나타낸다고 보장할 수 없다.

최소 방어 수정 방향:

```
- const rows = source.rows.map((r) => ({
+ const rows = source.rows
+   .filter((r) => r.status === 'approved')
+   .map((r) => ({
      ...r,
      approved_name: r.name
- })) as unknown as Tables<'restaurants'>[];
+ })) as unknown as Tables<'restaurants'>[];
```

좌표 분류는 다음처럼 유효한 숫자일 때만 적용하도록 분리해야 한다.

```
const lat = r.lat;
const lng = r.lng;

const hasValidCoordinates =
  typeof lat === "number" &&
  typeof lng === "number" &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 &&
  lng >= -180 && lng <= 180;

const outsideDomesticBounds =
  hasValidCoordinates &&
  (lat < 32 || lat > 40 || lng < 124 || lng > 132);
```

단, 이 변경을 적용하면 과거 게시 산출물의 분모와 등급이 달라질 수 있다. 기존 데이터를 무단 재계산·재게시하지 말고, 먼저 입력 승인 계약과 실제 결측 좌표 분포를 확인해야 한다.

### TH-P-03 — 데이터 관측 시점과 사용자 라벨

ADR-P1 / Severity MEDIUM / CONDIT