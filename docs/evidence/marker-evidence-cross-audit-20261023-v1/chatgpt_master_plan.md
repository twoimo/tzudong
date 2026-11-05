# Tzudong — 실제 공개 인기 등급 및 영상 근거 프레임에 대한 THESIS DELTA

검토 기준: `ac80e35da566db242420a62bbf3e3320b5c00e76` 검토 방식: ChatGPT GPT-6 일반 추론, Deep Research 미사용 범위: 공개 영상 조회수 등급, 국내·해외 지도 마커와 클러스터, 승인된 영상 프레임, 상세 패널, 공개 데이터의 생성·검증·배포 경계

## 1. 핵심 판정

이번 변경은 기존의 미게시·빈 코호트(empty/unpublished cohort) 상태에 대한 단순 재검사가 아니다. 실제 게시된 조회수 등급과 영상 프레임이 사용자에게 노출되는 새로운 데이터 정확성·표시 일관성·출처 무결성 검증 단계다.

제공된 검토 브리프에 따르면 현재 공개 데이터는 다음과 같다.

| 항목            | 제공된 현재 상태            | 이번 감사의 판정           |
| ------------- | -------------------- | ------------------- |
| 승인·병합 맛집 그룹   | 735개                 | 집계 및 병합 재현 필요       |
| Fire          | 15개                  | P98 경계·동점 검증 필요     |
| Ember         | 21개                  | P95 경계·표시 경로 검증 필요  |
| Rainbow       | 71개                  | P85 경계·표시 경로 검증 필요  |
| Standard      | 628개                 | 비선정과 데이터 부재 구별 필요   |
| 공개 영상 프레임     | 12개, 맛집 4곳           | 소유권·승인·파일 무결성 검증 필요 |
| 데이터 관측 기간     | 2026년 6\~7월          | 과거 조회수임을 명시         |
| 기존 운영 브라우저 관측 | 국내 Ilmi, 해외 Wolfgang | 제한된 호스트 관측으로만 인정    |

합계는 `15 + 21 + 71 + 628 = 735`로 일치한다. 그러나 합계 일치는 등급 계산의 정확성, 개별 맛집의 적격성, 지도 표시의 완전성을 증명하지 않는다.

또한 네 가지 중요한 경계를 유지한다.

- 공개 영상 조회수 등급은 맛집의 품질·평점이 아니다.
- 승인된 `on_site_scene`은 영상의 맥락 자료이며, L1 매장 신원 증거가 아니다.
- 네 맛집에 대한 프레임 게시를 전체 맛집의 근거 확보로 일반화할 수 없다.
- 과거의 빈 코호트 검증, 브라우저 관측, 기존 배포 성공, Nightly 실패는 서로 다른 증거다.

이 보고서는 첨부된 `review-brief.md`와 `source_bundle.txt`를 기반으로 작성한다. 두 파일은 현재 프로덕션 리비전과 원래 기능 리비전, 테스트 범위, 미변경 상태를 명시한다. 다만 첨부 내용 자체가 실행 증명서는 아니므로, 코드 관찰과 실제 실행 결과를 구분한다.&#x20;

review-brief.md

source_bundle.txt



## 2. 증거 등급과 검토 한계

| 증거 등급                         | 의미                     | 이번 보고서의 적용               |
| ----------------------------- | ---------------------- | ------------------------ |
| `SOURCE_OBSERVED`             | 실제 제공된 소스 본문에서 확인      | 함수, 분기, 데이터 흐름           |
| `SYNTHETIC_MOCK_TESTED`       | 합성 입력·모의 의존성으로 실행 확인   | 새 실행 결과 없음               |
| `BOUNDARY_INTEGRATION_TESTED` | 실제 모듈 경계를 결합해 실행 확인    | 새 실행 결과 없음               |
| `HOST_TESTED`                 | 실제 호스트·브라우저 관측         | 사용자가 보존한 운영 브라우저 관측에 한정  |
| `PROPOSED`                    | 아직 구현·실행되지 않은 수정 또는 검증 | 아래 ADR/W 계획              |
| `UNVERIFIED`                  | 필요한 소스·데이터·실행 증거 부족    | 게시 산출물의 독립 재계산 등         |
| `CONTRADICTED`                | 주장에 반하는 소스·논리적 반례 존재   | 무조건적 L1 간주, 전체 식당 커버리지 등 |

환경 속성은 별도로 기록한다.

- `lab`: 이번 세션에서 네이티브 테스트를 실행하지 않았다.
- `physical`: 실제 휴대전화·태블릿 검증 증거 없음.
- `field`: 운영 환경의 통계적 지연·실사용 안정성 검증 없음.

이후 `SOURCE_OBSERVED`라는 판정은 코드 구조를 확인했다는 뜻이지 해당 기능이 운영에서 정상 동작했다는 뜻이 아니다.

## 3. 소스 접근 영수증과 실제 확인된 호출 경계

제공된 `source_bundle.txt`에서 확인할 수 있는 핵심 소스 내용은 다음과 같다. 리비전·파일 해시만 반복하지 않고 실제 코드 분기와 연결 관계를 기록한다.

### 3.1 공개 등급 API

`apps/web/app/api/public-popularity/route.ts`

```
export const dynamic = 'force-static';

export function GET() {
    const body = JSON.stringify(publicPopularityPublication);
    return new NextResponse(body, { headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=0, must-revalidate',
        etag: `"${createHash('sha256').update(body).digest('hex')}"`,
    } });
}
```

확인: 응답은 `publicPopularityPublication`의 직렬화 결과이고 ETag는 그 응답 본문에서 계산된다.

한계: 이 API만으로는 출처 데이터의 최신성, 빌드에 포함된 게시물 버전, 실제 클라이언트가 사용하는 등급과 API 응답의 일치성을 증명할 수 없다.

`force-static`과 `must-revalidate`를 함께 사용한다는 사실도 배포별 생성 시점·CDN 캐시·클라이언트 참조 버전의 동일성을 자동으로 보장하지 않는다.

### 3.2 승인 영상 프레임의 공개 필터

`apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx`

```
export function publicReviewedVideoFrames(
  groups: readonly unknown[][]
): RestaurantEvidenceFrame[] {
  const parsed = groups.map((group) => group.flatMap((item) => {
    try {
      return [parseEvidenceFrame(evidenceFrameEmbedRow(item))];
    } catch {
      return [];
    }
  }));
  return unionApprovedEvidenceFrames(parsed).filter(
    (frame) => frame.evidence_level === "SOURCE_OBSERVED",
  );
}
```

여기서 중요한 사실은 세 가지다.

첫째, 잘못된 프레임은 `parseEvidenceFrame` 예외를 통해 공개 목록에서 제거된다.

둘째, 중복 통합과 승인 여부는 `unionApprovedEvidenceFrames`에 위임된다. 따라서 그 함수의 정확한 구현을 확인하지 않고 승인 경계 전체가 안전하다고 판정할 수 없다.

셋째, `SOURCE_OBSERVED`는 이 도메인에서 영상 근거의 증거 수준을 나타내며, 감사 증거 등급의 `SOURCE_OBSERVED`와 같은 이름이지만 서로 다른 개념이다.

`publicEvidenceFrames`는 추가로 `isLevel1SourceObserved`를 적용하지만, 실제 캐러셀은 더 넓은 `publicReviewedVideoFrames`를 사용한다. 따라서 승인된 맥락 프레임의 노출 자체는 설계 의도와 부합한다.

### 3.3 상세 화면의 실제 데이터 연결

`apps/web/hooks/use-restaurant-detail.tsx`

```
return {
    ...dbData,
    popularity_tier: publishedTier(dbData.id),
    evidence_frames: publicReviewedVideoFrames([
        Array.isArray(embedded) ? embedded : []
    ]),
    address: dbData.road_address || dbData.jibun_address || '',
    category: dbData.categories,
} as Restaurant;
```

그리고:

```
const hydrated = hydrateRestaurantDetailWithMergeContext(
    primaryDetail,
    mergedCandidate ?? mergeContextRestaurant
);
return hydrated
    ? projectPublishedPopularityTier(hydrated, publishedTier)
    : null;
```

이는 상세 화면이 단순히 지도 마커의 압축 데이터를 그대로 사용하는 구조가 아니라, 병합 관계의 ID를 이용해 상세 데이터를 다시 수집하고 공개 등급을 재투영하는 구조임을 보여준다.

다만 `hydrateRestaurantDetailWithMergeContext`가 어떤 프레임을 유지하고 어떤 병합 자식의 데이터를 제거하는지는 별도 검증 대상이다.

### 3.4 실제 지도 병합 및 등급 유지

`apps/web/hooks/use-restaurants.tsx`

단일 레코드는 다음과 같이 처리한다.

```
return {
    ...restaurant,
    popularity_tier: publishedTier(restaurant.id),
    name: getRestaurantName(restaurant as RestaurantWithOptionalName),
    // ...
} as Restaurant;
```

복수 레코드 병합은 다음과 같다.

```
return {
    ...mainRestaurant,
    popularity_tier: resolvePublishedPopularityTier(
        mainRestaurant,
        publishedTier,
        groupRestaurants
    ),
    // ...
    mergedRestaurants: groupRestaurants,
} as Restaurant;
```

이는 병합 결과의 등급을 단순히 대표 레코드의 기존 필드에서 복사하지 않는다는 중요한 보호 장치다.

그러나 `resolvePublishedPopularityTier`의 정확한 우선순위가 없으면, 다음을 확정할 수 없다.

- 병합 자식에만 등급이 있을 때 유지되는지
- 서로 다른 등급이 충돌할 때 어떤 등급을 선택하는지
- 공개 목록에서 제거된 ID가 병합을 통해 다시 노출될 수 있는지

### 3.5 국내·해외 지도 소비 경계

`apps/web/components/map/OverseasMap.tsx`

```
el.innerHTML = buildOverseasMarkerHtml({
    imagePath,
    name: restaurant.name,
    popularityTier: restaurant.popularity_tier,
});
```

기존 마커의 등급 변경 시:

```
const tier = restaurant.popularity_tier ?? 'standard';
if (
    element.querySelector('[data-popularity-tier]')
        ?.getAttribute('data-popularity-tier') !== tier
) {
    element.innerHTML = buildOverseasMarkerHtml({
        imagePath: getRestaurantCategoryIcon(restaurant),
        name: restaurant.name,
        popularityTier: tier
    });
}
```

선택 상태는 재생성 뒤 `applyOverseasMarkerSelectedState`로 복원한다.

이 구현은 해외 단일 마커의 등급 변경에 대한 갱신 경로를 제공한다. 반면 마커 ID가 유지된 상태에서 이름·아이콘만 바뀌고 등급이 같으면 해당 HTML은 갱신되지 않을 수 있다. 이는 실제 소스에서 도출되는 구체적인 반례 후보이며, 아래 `TH-M-02`에서 판정한다.

국내 지도와 클러스터의 동일성은 이 코드만으로 입증되지 않는다.

### 3.6 상세 패널에서의 프레임 노출

`RestaurantDetailPanel.tsx`는 병합 미디어를 수집한 뒤 다음을 사용한다.

```
<RestaurantEvidenceCarousel
    frames={[mergedMedia.evidenceFrames ?? []]}
/>
```

또한 실제 캐러셀은 다음과 같이 URL을 구성한다.

```
export function publicEvidenceImageSource(
  frame: RestaurantEvidenceFrame
): string {
  const valid = parseEvidenceFrame(frame);
  return valid.image_url
      ?? `/evidence-frames/${valid.storage_object_key}`;
}
```

즉, 승인 프레임의 공개 URL과 `storage_object_key`에 대한 안전성은 `parseEvidenceFrame`의 검증 범위에 직접 의존한다.

이미지 요청 실패 시 자동으로 다른 영상 프레임이나 신원 근거를 대신 노출하는 동작은 제공된 캐러셀 코드에서 확인되지 않는다.

### 3.7 공개 프레임의 실제 표시 의미

```
function frameLabel(frame: RestaurantEvidenceFrame): string {
  if (frame.frame_type === "storefront_sign") return "매장 간판";
  if (frame.frame_type === "publisher_location_caption")
    return "영상의 매장 안내";
  return frame.frame_type === "menu_receipt"
    ? "메뉴·영수증 장면"
    : "영상 속 현장 장면";
}
```

이 분기는 간판·매장 안내·메뉴·현장 장면을 구별한다. 따라서 모든 프레임을 L1 신원 근거라고 주장하는 것은 코드의 의미 구분과 충돌한다.

### 3.8 접근 범위 제한

다음 핵심 구현의 완전한 본문은 현재 확인 가능한 첨부 표시 범위에서 확보되지 않았다. 이를 읽었다고 주장하지 않는다.

| 필수 구현                               | 상태               | 판단에 미치는 영향                |
| ----------------------------------- | ---------------- | ------------------------- |
| `buildPublicPopularity` 본문          | `SOURCE_MISSING` | 코호트·백분위·동점·누락값 계산 확정 불가   |
| `parseEvidenceFrame` 본문             | `SOURCE_MISSING` | URL·해시·경로·승인 필드 검증 확정 불가  |
| `unionApprovedEvidenceFrames` 본문    | `SOURCE_MISSING` | 중복 통합·승인 보존 확정 불가         |
| `resolvePublishedPopularityTier` 본문 | `SOURCE_MISSING` | 병합 등급 우선순위 확정 불가          |
| 국내 마커·클러스터 헬퍼 본문                    | `SOURCE_MISSING` | 전체 지도 일관성 확정 불가           |
| 프레임 게시 검증기 본문                       | `SOURCE_MISSING` | 파일시스템·해시·소유권 안전성 확정 불가    |
| 관련 테스트의 완전한 본문과 실행 결과               | `SOURCE_MISSING` | 기존 테스트의 실제 범위·통과 여부 확정 불가 |

이는 파일이 저장소에 없다는 판정이 아니라, 이번 응답에서 해당 본문을 검증 가능한 형태로 확보하지 못했다는 접근 상태다. 첨부 파일의 전체 소스 제공 선언을 부정하는 뜻도 아니다.

이 제한으로 인해 뒤의 해당 판정은 `CONDITIONAL` 또는 `DEFER`로 유지한다. 파일 해시만으로 구현 세부사항을 추정하지 않는다.

## 4. 공개 데이터 수학과 의미 검증

### 4.1 의도된 결과

`ADR-P1`의 의도는 식당의 맛이나 실시간 인기를 평가하는 것이 아니라, 2026년 6\~7월에 수집된 연결 영상의 조회수를 기준으로 국내·해외 식당을 별도 비교하는 것이다.

브리프가 명시한 계산 모델은 다음과 같다.

\\[ V(r)=\max\_{v\in L(r)}\operatorname{views}(v) \\]

여기서 \\(L(r)\\)은 식당 \\(r\\)에 연결된 적격 영상 집합이다.

국내·해외 코호트를 각각 \\(C_d,C_o\\)로 정의하고, 각 코호트의 P98·P95·P85 임계값을 사용한다.

이 방식은 조회수 합계가 아니라 최대값을 사용하므로, 영상이 많이 연결된 식당의 조회수를 무조건 합산하는 방식과 다르다.

다만 다음은 구분해야 한다.

- 조회수 집계 시점과 영상 게시일
- 원본 식당 레코드와 병합 식당 그룹
- 적격 영상이 없는 식당과 조회수가 낮은 식당
- 실제 백분위 임계값과 최종 등급별 개수

### 4.2 발표된 분포의 수학적 점검

전체 735개 병합 식당 그룹

Fire

## 15

2.04%

Ember

## 21

2.86%

Rainbow

## 71

9.66%

Standard

## 628

85.44%

비표준 등급은 107개, 전체의 약 14.56%다.

P98·P95·P85를 상위 2%·5%·15%의 누적 경계로 해석하면 이 비율은 설계와 대체로 양립한다. 그러나 이 숫자만으로 개별 등급이 올바르게 계산되었다고 결론 내릴 수 없다.

특히 `nearest-rank`의 정확한 구현과 비교 연산자에 따라 동점 처리가 달라진다.

예를 들어 다음과 같은 코호트가 있다고 하자.

```
조회수: [10, 20, 30, 40, 50, 50, 50, 50, 50, 100]
P85 nearest-rank:
  rank = ceil(0.85 * 10) = 9
  threshold = 50
```

`views >= threshold`라면 50 이상의 식당 6개가 상위 등급에 포함된다. 반면 정확히 상위 15%의 식당만 선택하는 순위 기반 방식이라면 다른 결과가 나온다.

임계값 기반 등급은 동점 때문에 명목상 백분위 비율과 실제 등급 비율이 다를 수 있다. 이것 자체가 결함은 아니다. 결함 여부는 명시된 정책과 실제 구현이 일치하는지에 달려 있다.

### 4.3 검증해야 할 불변식

게시 산출물 \\(P\\), 원본 스냅샷 \\(S\\), 빌더 \\(B\\)에 대해:

\\[ \operatorname{canonical}(B(S))=\operatorname{canonical}(P) \\]

또한:

\\[ N\_{\mathrm{fire}}+ N\_{\mathrm{ember}}+ N\_{\mathrm{rainbow}}+ N\_{\mathrm{standard}}=735 \\]

이외에 다음을 만족해야 한다.

1. 각 그룹의 최종 등급은 정확히 하나다.
2. 동일한 입력 스냅샷과 정책은 동일한 결과를 만든다.
3. 국내·해외 코호트 분류는 결정적이다.
4. 적격 영상이 없는 그룹의 처리 정책이 명시되어 있다.
5. 동일 영상 ID가 중복 연결되어도 조회수 계산이 불필요하게 변하지 않는다.
6. 조회수는 맛 평가, 방문 수, 리뷰 점수로 해석되지 않는다.
7. `sourceRevision`은 실제 원본 데이터의 리비전을 가리키며, 게시물 버전으로 대체되지 않는다.

브리프의 `sourceRevision`은 `13ded67a820549ae51f5b966104bf900c22aeb1a`이고 게시물 버전은 `video-views-20261022-v1`이다. 서로 다른 식별자라는 사실을 유지해야 한다.

## 5. 안정 ID별 역검증 결과

아래 ID는 이번 THESIS DELTA에 대한 신규 안정 식별자다. 이전 감사의 기존 ID를 임의로 재번호화하지 않는다.

| ID        | Severity | 판정          | 증거·환경                              | 결론                 |
| --------- | -------- | ----------- | ---------------------------------- | ------------------ |
| `TH-P-01` | HIGH     | CONDITIONAL | SOURCE_OBSERVED + UNVERIFIED / lab | 공개 분포 재계산 필요       |
| `TH-P-02` | MEDIUM   | CONDITIONAL | UNVERIFIED / lab                   | 동점·소규모 코호트 경계 확인   |
| `TH-P-03` | MEDIUM   | ACCEPT      | SOURCE_OBSERVED / source           | 과거 조회수와 맛 평가 구별    |
| `TH-P-04` | MEDIUM   | DEFER       | SOURCE_OBSERVED + UNVERIFIED / lab | 국내·해외 분류·누락값 정책 확인 |
| \`TH-M-01 |          |             |                                    |                    |

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

### TH-P-03 — 데이터 관측 시점과 사용자 라벨

ADR-P1 / Severity MEDIUM / CONDITIONAL

`PopularityBadge.tsx`는 “2026년 6–7월 수집 기준 · 맛 평가가 아니에요”라고 표시한다. 실제 게시 버전은 `video-views-20261022-v1`이고 `sourceRevision`은 이전 데이터 스냅샷을 가리킨다.

판정: 게시일과 조회수 관측일을 구별하는 방향은 적절하지만, 모든 유효 영상 메트릭의 `fetched_at` 또는 `bucket_started_at`이 표시 기간에 속하는지는 미검증이다. 특히 빌더는 그룹의 최댓값을 사용하므로 최댓값을 제공한 영상의 관측 시각을 추적해야 한다.

필수 조치: 전체 게시 그룹의 실제 채택 영상별 관측일을 검증하고, 기간 밖 값이 있으면 라벨 또는 입력을 정정한다. 게시 버전을 새 데이터 관측일로 해석하지 않는다.

### TH-P-04 — 게시 멤버십과 병합 충돌

ADR-P1 / Severity MEDIUM / CONDITIONAL

`parsePublicPopularityPublication`은 멤버 ID 중복, 정렬, 형식, 크기를 검사한다. `lookupFor`는 대표 ID뿐 아니라 모든 멤버 ID에 동일 등급을 부여한다.

`resolvePublishedPopularityTier`는 대표 레코드와 구성원의 등급이 다르면 `standard`로 되돌린다.

따라서 대표 레코드 변경만으로 최고 등급이 임의 승격된다는 지적은 REJECT한다. 실제 소스가 반증한다.

다만 병합 구성이 게시 당시와 달라진 경우에는 보수적으로 `standard`가 표시될 수 있다. 이는 데이터 무결성 보호이면서 표시 누락의 원인이 될 수 있다.

필수 검증: 게시 멤버십과 현재 승인 병합 결과를 ID 집합으로 비교한다. 충돌 시 최고 등급을 강제하지 않는다.

### TH-E-01 — 승인 프레임과 L1 신원 증거 구분

ADR-E1 / Severity HIGH / CONDITIONAL

`parseEvidenceFrame`은 허용 필드, 안전한 타임스탬프, 영상 ID, SHA-256 형식, 재생 URL과 저장 키의 일치성을 검사한다.

`unionApprovedEvidenceFrames`는 동일 `frame_id`의 내용 충돌과 승인·거절 충돌을 거부한다.

`isLevel1SourceObserved`는 승인 여부와 `SOURCE_OBSERVED` 외에도 `LEVEL1_FRAME_TYPES` 소속을 요구한다.

따라서 승인된 `on_site_scene`을 L1 신원 증거로 자동 승격한다는 주장은 REJECT한다.

다만 실제 캐러셀은 승인된 맥락 프레임도 표시한다. 상세 패널의 문구·접근성 설명이 이 구별을 유지하는지는 네이티브 DOM 검증이 필요하다.

### TH-E-02 — 병합 프레임의 소유권과 영상 일치

ADR-E1 / Severity HIGH / DEFER

`previewFramePublication`은 승인 맛집 ID와 `frame.video_id`를 원본 맛집의 `youtube_link`에 대조한다. 이는 최초 게시 시 소유권 보호다.

그러나 상세 화면에서는 병합된 맛집의 프레임이 함께 표시된다. 병합 관계가 변경되거나 서로 다른 영상의 레코드가 결합되면 최초 게시 시 검증만으로 현재 대표 맛집과의 관계를 증명할 수 없다.

남은 증거: 실제 12개 프레임의 `restaurant_id`, `video_id`, 병합 구성원 ID, 상세 패널 표시 결과를 연결한 대조표.

보호 범위: 게시 검증기는 비승인 소유자와 영상 불일치를 거부한다. 현재 병합 상태와의 지속적인 일치까지 보장하지는 않는다.

### TH-E-03 — 공개 이미지 URL과 실패 처리

ADR-E1 / Severity MEDIUM / CONDITIONAL

`requireImageUrl`은 HTTPS와 자격 증명 없는 URL을 요구한다. `parseEvidenceFrame`은 저장 키와 재생 URL을 정규식·생성 함수로 재검증한다.

그러나 HTTPS만으로 이미지 호스트의 신뢰성이나 실제 바이트의 무결성을 증명하지 않는다. 캐러셀에는 이미지 로딩 실패 시 별도 복구 UI가 확인되지 않는다.

필수 검증: 게시된 12개 URL의 HTTP 상태, MIME, WebP 디코딩, 실제 SHA-256을 검사한다. 실패 시 근거를 임의 대체하지 않고 해당 프레임의 사용 불가 상태를 명확히 표시한다.

### TH-S-01 — 프레임 게시의 파일시스템 안전성

ADR-S1 / Severity HIGH / CONDITIONAL

확인된 보호는 다음과 같다.

- `realpath`로 입력 파일이 허용 루트 내부에 있는지 검사
- 원본 맛집 JSON의 SHA-256 검증
- 승인 상태와 영상 ID 일치 검증
- WebP 헤더와 실제 바이트 SHA-256 검증
- 확인 해시 불일치 시 게시 거부
- 출력 경로 및 symlink 검사
- 기존 파일 충돌 거부, 새 파일에 `wx` 사용

잔여 경합: 경로 검사와 파일 쓰기 사이에 파일시스템 상태가 바뀔 수 있다. 또한 여러 프레임을 순차 기록하므로 중간 실패 시 일부 파일만 생성될 수 있다.

이는 일반적인 로컬 파일시스템 위협 모델에서 검토할 조건이며, 현재 공격 또는 운영 실패가 관측됐다는 뜻은 아니다.

필수 검증: symlink 교체, 기존 파일 충돌, 중간 쓰기 실패, 동일 입력 재실행을 격리된 임시 디렉터리에서 시험한다. 게시 작업 전체의 원자성이 필요하다면 staging과 최종 승격 경계를 별도 설계한다.

### TH-R-01 — 실제 게시 SHA와 운영 자산 검증

릴리스 / Severity HIGH / DEFER

현재 프로덕션 소스는 `ac80e35da566db242420a62bbf3e3320b5c00e76`로 제공됐다. 그러나 이번 세션에서는 CI, 보호 브랜치, 배포 READY, alias, 공개 URL 및 실제 자산 바이트를 조회하지 않았다.

필수 릴리스 증거:

1. 동일 소스 SHA의 보호 브랜치 병합 기록
2. 해당 SHA의 필수 CI 성공
3. READY 배포 식별자와 배포 시각
4. 프로덕션 alias가 가리키는 배포 식별자
5. `/api/public-popularity`의 실제 본문·ETag·게시 버전
6. 공개 WebP 12개의 응답 바이트·해시·디코딩 결과

자체 manifest 또는 빌드 해시만으로 실제 사용자 URL의 정확성을 인증하지 않는다.

### TH-R-02 — Nightly 실패와 기존 배포의 분리

릴리스 / Severity MEDIUM / CONDITIONAL

브리프는 Nightly 실행 `39457197351`의 실패를 별도로 기록한다. 이 실패는 기존 프로덕션 배포가 완료됐다는 기록을 자동으로 무효화하지 않는다.

반대로 프로덕션 배포 성공이 Nightly의 `receipt_ledger_state` 실패를 해결했다는 뜻도 아니다.

필수 조치: Nightly 실패 원인·재실행 결과를 별도 추적한다. 현재 공개 등급·프레임 기능에 대한 직접적인 차단 의존성이 입증되면 릴리스 게이트에 반영하되, 원인 확인 없이 둘을 동일한 실패로 분류하지 않는다.

## 6. ADR / 위험 / 작업 순서

| 순서 | ADR    | 작업 ID | 필수 작업                           | 완료 기준                           |
| -- | ------ | ----- | ------------------------------- | ------------------------------- |
| 1  | ADR-P1 | W-P1  | 게시 원시 입력·메트릭·코호트 재계산            | 735개 그룹, 네 등급, 임계값, 결측·동점 전수 대조 |
| 2  | ADR-P1 | W-P2  | 승인 필터·좌표 null·국내외 분류 반례 검사      | 비승인·결측 좌표가 부적절한 코호트에 들어가지 않음    |
| 3  | ADR-M1 | W-M1  | 국내 개별·클러스터·해외 마커 갱신 검사          | 등급·이름·카테고리 변경 후 stale 표시 없음     |
| 4  | ADR-E1 | W-E1  | 프레임 승인·소유권·병합 검증                | 12개 프레임과 4개 맛집의 연결 관계 일치        |
| 5  | ADR-S1 | W-S1  | 정적 파일 경로·충돌·부분 실패 검증            | 해시 불일치·경로 이탈·충돌이 모두 차단됨         |
| 6  | 릴리스    | W-R1  | 보호 브랜치→CI→배포→alias→URL readback | 동일 SHA와 실제 응답·자산 일치             |

## 7. 네이티브 검증 및 수용 게이트

| 게이트                | 실행해야 할 검증                                             | 수용 기준                           |
| ------------------ | ----------------------------------------------------- | ------------------------------- |
| G1 — Publication   | 고정 입력으로 `buildPublicPopularity` 재실행                   | 그룹 ID·멤버십·등급·코호트·임계값의 결정적 일치    |
| G2 — Data boundary | 승인 상태, 결측 좌표, 잘못된 조회수, 동점·소규모 코호트                     | 잘못된 승격 없음, 모든 제외 사유 설명 가능       |
| G3 — Marker        | 국내 단일·Supercluster·행정구역·서울 자치구·해외 지도                  | 선택 복원, 등급 변경 반영, 캐시 stale 재현 없음 |
| G4 — Frames        | malformed·pending·rejected·중복 충돌·병합·실제 12개 자산         | 승인된 해당 영상 프레임만 표시, L1 구별 유지     |
| G5 — Filesystem    | 임시 디렉터리에서 traversal·symlink·collision·partial failure | 허용 루트 밖 쓰기 0건, 무결성 위반 게시 0건     |
| G6 — Native build  | 프로젝트의 실제 test/typecheck/lint/build 명령                 | 필수 검사 모두 성공, 원시 로그 보존           |
| G7 — Release       | 보호 브랜치·CI·READY·alias·공개 URL·바이트 readback             | 동일 불변 SHA와 게시 산출물 일치            |

이 게이트는 \*\*제안된 검증 계획(`PROPOSED`)\*\*이다. 이번 대화에서 실행된 테스트가 아니다. 기존 390×844, 820×1180, 1440×1000 브라우저 관측은 제한된 `HOST_TESTED` 증거로 유지하며, 물리 기기·지연 시간·현장 성과를 증명하지 않는다.

## 8. ID 의미 정합성

앞선 두 부분의 ID 의미는 유지한다.

- `TH-P-01`: 백분위·동점·집계 수학. 실제 빌더 확인으로 알고리즘은 검증 가능해졌지만 원시 수치 재계산은 여전히 필요하다.
- `TH-P-02`: 승인 입력과 국내외 코호트 분류. 결측 좌표의 `Number(null)` 반례가 확인됐다.
- `TH-P-04`: 게시 멤버십과 병합 충돌. 최고 등급 임의 승격 주장은 소스에 의해 반증되며, 병합 변경에 따른 보수적 `standard` 처리만 잔여 조건이다.
- `TH-E-01/02/03`: 각각 승인·L1 구별, 병합 소유권, 이미지 URL·표시 실패다.
- `TH-S-01`: 게시 파일시스템 경계이며, `TH-R-01/02`는 운영 릴리스 및 Nightly 분리다.

`SOURCE_MISSING`이었던 핵심 함수 본문은 이번 추가 첨부로 해소됐지만, 원시 게시 입력·실제 자산 바이트·네이티브 실행·운영 readback 부재까지 해소된 것은 아니다.

## 9. 최종 결론

최종 판정: CONDITIONAL — 소스 검토는 진전됐으나, 새로운 게시 변경을 완전히 검증했다고 승인할 수 없다.

우선 조치할 실제 코드 경계는 `TH-P-02`의 결측 좌표·승인 입력 처리, `TH-M-02`의 해외 마커 stale 갱신, `TH-M-03`의 서울 클러스터 등급 캐시 무효화다.

`TH-P-01`의 백분위 구현과 `TH-P-04`의 게시 멤버십 보호는 소스에서 구체적으로 확인된다. 다만 실제 게시된 735개 그룹과 12개 프레임은 원시 입력·소유권·자산 바이트의 독립 검증이 남아 있다.

기존 배포는 기존 배포로, Nightly 실패는 별도 실패로 유지한다. 과거 빈 코호트 감사는 현재 게시 데이터의 승인 근거가 아니다.

이 보고서는 검토 및 후속 검증을 위한 기술 증거이며, 코드 수정·데이터 재게시·배포·계정·권한·비용 변경을 승인하지 않는다.