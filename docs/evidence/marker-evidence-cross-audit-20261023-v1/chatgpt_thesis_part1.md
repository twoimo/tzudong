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