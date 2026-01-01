# 지도 서비스 전환 전략

## 요약

쯔동여지도 프로젝트의 지도 서비스 선택 및 전환 전략 문서. 현재는 네이버 지도를 사용 중이며, 장기적으로는 오픈스트릿맵(OSM) 기반 자체 타일 서버 구축을 고려 중.

---

## 1. 오픈스트릿맵(OSM) 라이센스

### ODbL (Open Database License)

OSM은 상업적 이용이 가능하지만, 다음 3가지 조건을 반드시 준수해야 함:

#### 필수 요구사항

1. **저작자 표시 (Attribution)**
   - 지도에 "© OpenStreetMap contributors" 명시 필수
   - 웹: https://www.openstreetmap.org/copyright 링크 표시

2. **동일 라이센스 유지 (Share-Alike)**
   - OSM 데이터를 수정/개선 시 결과물도 ODbL로 공개
   - 단순 지도 표시만 하면 적용 대상 아님
   - 자체 타일 서버 구축 시 적용

3. **개방성 유지 (Keep Open)**
   - 사용자에게 ODbL 라이센스 접근 가능하도록 유지

### 네이버 지도와의 관계

- 네이버 지도는 한국 외 지역에서만 OSM을 보조적으로 사용
- 한국 내 데이터는 네이버 자체 데이터
- 네이버가 OSM을 사용한다고 해서 우리 프로젝트에 자동 허가되는 것은 아님

---

## 2. 지도 서비스 옵션 비교

### Option A: Leaflet.js + OSM 타일 (무료)

```bash
npm install leaflet react-leaflet
```

**장점:**
- 완전 무료
- Vercel 환경에서 문제없이 작동 (클라이언트 사이드)
- 오픈소스

**단점:**
- 트래픽 증가 시 OSM 공식 타일 서버 제한
- 대규모 서비스에 부적합

### Option B: Mapbox (유료/무료 플랜)

```bash
npm install mapbox-gl react-map-gl
```

**장점:**
- 무료 플랜: 월 50,000 로드
- 상용 서비스급 성능
- 글로벌 CDN
- 자동 스케일링

**단점:**
- 트래픽 증가 시 비용 발생

### Option C: Maptiler (유료/무료 플랜)

```bash
npm install @maptiler/sdk
```

**장점:**
- 무료 플랜: 월 100,000 타일 요청
- OSM 기반 + 저작자 표시 자동 처리
- Mapbox 대체제

**단점:**
- 트래픽 증가 시 비용 발생

### Option D: 자체 타일 서버

**요구사항:**
- 지속 실행되는 리눅스 서버 필요
- 최소 사양: 4코어, 8GB RAM, 100GB+ SSD
- Vercel에서는 불가능 (서버리스 환경)

**장점:**
- 대규모 트래픽 시 비용 절감
- 완전한 커스터마이징

**단점:**
- 초기 구축 비용
- 24/7 유지보수 필요
- 보안, 백업, 모니터링 등 관리 부담

---

## 3. 네이버 지도 API 정책

### 무료 한도

- **현재 (2025년 6월 30일까지)**: 월 300만회 무료
- **2025년 7월 1일부터**: AI NAVER API 무료 한도 종료, 첫 건부터 100% 유료

### 요금 (초과분)

| API | 단가 |
|-----|------|
| Web Dynamic Map | 0.1원/건 |
| Mobile Dynamic Map | 0.1원/건 |
| Static Map | 2원/건 |
| Geocoding | 0.5원/건 |
| Reverse Geocoding | 0.5원/건 |
| Directions 5 | 5원/건 |
| Directions 15 | 20원/건 |

### 중요 정책

**❌ 금지 사항:**
- 하나의 서비스에 여러 API 키 사용
- 무료 한도 우회 목적의 다중 계정
- API 키 로테이션으로 트래픽 분산

**적발 시:**
- 모든 API 키 즉시 차단
- 계정 영구 정지
- 법적 조치 가능

### 새로운 Maps 서비스

- 2025년 3월 20일 출시
- 무료 이용량 제공
- AI NAVER API에서 마이그레이션 권장

---

## 4. 비용 비교

### 월 500만회 기준

| 서비스 | 비용 (월) | 비고 |
|--------|-----------|------|
| 네이버 새 Maps | ~₩20만 | 300만 무료 + 200만 유료 |
| Mapbox Pro | ₩50~300만 | 트래픽 기반 |
| 자체 서버 (최소) | ₩65만+ | 관리 공수 미포함 |
| 자체 서버 (안정) | ₩35만+ | 관리 공수 미포함 |

### 손익분기점

**자체 타일 서버가 경제적인 시점:**
- 월 1,000만회 이상부터 검토 시작
- 월 5,000만회 이상에서 자체 서버 권장

**이유:**
- 관리 공수 고려 시 관리형 서비스가 압도적 우위
- 서버 장애, 보안, 데이터 업데이트 등 숨은 비용 큼

---

## 5. 쯔동여지도 프로젝트 전략

### 현황

- **프로젝트**: 쯔양 맛집 지도
- **구독자**: 1,290만명 (한국 40%, 해외 60%)
- **특성**: 한국 + 해외 맛집 모두 포함
- **현재**: 네이버 지도 사용 중

### 단계별 로드맵

#### Phase 1: MVP (현재 ~ 초기)

**전략:** 네이버 지도 유지

```
네이버 새 Maps 서비스
├─ 무료 한도: 월 300만회
├─ 비용: ₩0
└─ 빠른 런칭 우선
```

**장점:**
- 한국 내 최고 데이터 품질
- 이미 구현 완료
- 한국 사용자 익숙함

**단점:**
- 해외 지도 품질 낮음
- 해외 POI 데이터 빈약

#### Phase 2: 성장기 (MAU 10만~100만)

**전략:** 하이브리드

```typescript
const mapProvider = restaurant.country === 'KR' 
  ? 'naver'  // 한국: 네이버 지도
  : 'mapbox'; // 해외: Mapbox
```

**비용:**
- 네이버: ₩0~50만/월
- Mapbox: ₩5~100만/월

#### Phase 3: 대규모 (MAU 100만+)

**전략:** 자체 타일 서버 + 하이브리드

```
자체 타일 서버 (한국 + 주요 지역)
    ↓
Mapbox (기타 지역 폴백)
    ↓
Origin: PostgreSQL + PostGIS
```

**예상 비용:**
- 자체 서버: ₩50만/월
- Mapbox 폴백: ₩50만/월
- **총 ₩100만/월** (순수 Mapbox 대비 70% 절감)

---

## 6. 구현 가이드

### Vercel 환경 설정

```env
# .env.local
NEXT_PUBLIC_NAVER_CLIENT_ID=your_client_id
NEXT_PUBLIC_MAPBOX_TOKEN=your_token
NEXT_PUBLIC_MAPTILER_KEY=your_key
```

### 추상화 레이어 설계

```typescript
// lib/map/provider.ts
interface TileProvider {
  getTileUrl(z: number, x: number, y: number): string;
  getAttribution(): string;
}

class NaverMapProvider implements TileProvider {
  getTileUrl(z: number, x: number, y: number): string {
    return `https://naver.map.tile/${z}/${x}/${y}`;
  }
  
  getAttribution(): string {
    return '© NAVER Corp.';
  }
}

class MapboxProvider implements TileProvider {
  getTileUrl(z: number, x: number, y: number): string {
    return `https://api.mapbox.com/v4/mapbox.streets/${z}/${x}/${y}@2x.png?access_token=${token}`;
  }
  
  getAttribution(): string {
    return '© Mapbox © OpenStreetMap';
  }
}

class SelfHostedProvider implements TileProvider {
  getTileUrl(z: number, x: number, y: number): string {
    return `https://tiles.tzudong.com/${z}/${x}/${y}.png`;
  }
  
  getAttribution(): string {
    return '© OpenStreetMap contributors';
  }
}
```

### 지역별 프로바이더 선택

```typescript
// hooks/useMapProvider.ts
export function useMapProvider(country: string): TileProvider {
  if (country === 'KR') {
    return new NaverMapProvider();
  }
  
  // 트래픽에 따라 동적 전환
  const monthlyRequests = getMonthlyRequests();
  
  if (monthlyRequests > 50_000_000) {
    return new SelfHostedProvider();
  }
  
  return new MapboxProvider();
}
```

### 비용 모니터링

```typescript
// lib/analytics/map-usage.ts
export async function trackMapTileRequest(
  provider: string,
  country: string
) {
  await analytics.track('map_tile_request', {
    provider,
    country,
    timestamp: Date.now(),
  });
  
  // 한도 경고
  const monthlyCount = await getMonthlyCount(provider);
  if (monthlyCount > 2_800_000) { // 300만의 93%
    await sendAlert('네이버 지도 API 한도 임박');
  }
}
```

---

## 7. 최종 권장사항

### 단기 (지금)
✅ **네이버 새 Maps 서비스 사용**
- 초기 개발 속도 최우선
- 한국 시장 집중
- 무료 한도 모니터링

### 중기 (6개월~1년)
✅ **하이브리드 전략 준비**
- 추상화 레이어 구현
- 한국: 네이버, 해외: Mapbox
- 트래픽 패턴 분석

### 장기 (1년 이상)
✅ **자체 타일 서버 검토**
- 월 1,000만회 이상 시 시작
- 한국 + 주요 해외 지역만 자체 운영
- Mapbox 폴백 유지

### 체크리스트

```markdown
[ ] 네이버 클라우드 콘솔에서 한도 설정
[ ] 새 Maps 서비스로 마이그레이션
[ ] 지도 프로바이더 추상화 레이어 구현
[ ] 트래픽 모니터링 시스템 구축
[ ] 월별 비용 리포트 자동화
[ ] 저작자 표시 UI 구현 (OSM 대비)
```

---

## 참고 자료

- [OpenStreetMap 라이센스](https://www.openstreetmap.org/copyright)
- [ODbL 전문](https://opendatacommons.org/licenses/odbl/)
- [네이버 클라우드 지도 API](https://www.ncloud.com/product/applicationService/maps)
- [Mapbox 가격 정책](https://www.mapbox.com/pricing)
- [Maptiler 가격 정책](https://www.maptiler.com/cloud/pricing/)
