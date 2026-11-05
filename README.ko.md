<div align="center">
  <img src="apps/web/public/logo.png" width="72" alt="쯔동여지도 로고" />
  <h1>쯔동여지도 · Tzudong Map</h1>
  <p>쯔양 영상에 등장한 맛집을 지도에서 찾고, 방문 경험을 나누는 서비스입니다.</p>
  <p>
    <a href="https://www.tzudong.app">지도 둘러보기</a> ·
    <a href="README.md">English</a> ·
    <a href="docs/README.md">문서 안내</a> ·
    <a href="CHANGELOG.ko.md">변경 기록</a>
  </p>
  <p>
    <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs" />
    <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?logo=react&amp;logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&amp;logoColor=white" />
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Auth-3ecf8e?logo=supabase&amp;logoColor=white" />
  </p>
</div>

[기능](#기능) · [미리보기](#미리보기) · [로컬 개발](#로컬-개발) · [저장소 구성](#저장소-구성) · [문서 안내](#문서-안내)

## 기능

- **맛집 탐색:** 국내·해외 지도에서 맛집을 검색·필터링하고, 상세 패널에서 영상 출처를 확인합니다.
- **방문 경험 공유:** 리뷰, 도장, 랭킹, 좋아요, 프로필을 통해 방문 기록과 커뮤니티 활동을 이어갑니다.
- **데이터 관리:** 보호된 관리자 콘솔에서 검수, 출처 확인, 승인과 변경 이력을 관리합니다.
- **콘텐츠 제작:** 스토리보드·썸네일 워크스페이스에서 기획, 생성, 수정을 진행합니다.
- **영상 근거 처리:** 백엔드 워커가 크롤링, 평가, 미디어 처리와 공개용 데이터 생성을 담당합니다.

## 미리보기

저장소에 보존된 화면 시연입니다.

<p align="center">
  <img src="apps/web/public/images/readme-product-tour.gif" width="900" alt="데스크톱 지도 탐색과 맛집 상세 화면" />
</p>

<details>
<summary>모바일 화면과 스토리보드 워크스페이스</summary>

<table>
  <tr>
    <td width="50%"><strong>홈 지도</strong><br /><img src="apps/web/public/images/readme-mobile-home-map.gif" alt="모바일 지도와 맛집 상세 화면" /></td>
    <td width="50%"><strong>리뷰 피드</strong><br /><img src="apps/web/public/images/readme-mobile-reviews-feed.gif" alt="모바일 리뷰 피드" /></td>
  </tr>
  <tr>
    <td width="50%"><strong>도장</strong><br /><img src="apps/web/public/images/readme-mobile-stamp-passport.gif" alt="모바일 도장 화면" /></td>
    <td width="50%"><strong>랭킹·프로필</strong><br /><img src="apps/web/public/images/readme-mobile-leaderboard-ranking.gif" alt="모바일 랭킹과 프로필" /></td>
  </tr>
</table>

![스토리보드 워크스페이스](apps/web/public/images/readme-storyboard-demo.gif)

</details>

## 로컬 개발

[apps/web/package.json](apps/web/package.json)에 선언된 **Node.js 24.x**와 **npm 11.6.2**를 사용합니다. 로컬 데이터베이스에는 Python 3와 Docker Compose도 필요합니다. 고정된 도구 버전과 준비 사항은 [로컬 스택 운영 안내](docs/operations/nightly-regression.md#local-compose-bootstrap)를 따릅니다.

1. 저장소를 복제하고 웹 의존성을 설치합니다.

   ```sh
   git clone https://github.com/twoimo/tzudong.git
   cd tzudong/apps/web
   npm ci
   ```

2. 저장소 루트에서 [준비 절차](docs/operations/nightly-regression.md#local-compose-bootstrap)에 따라 저장소가 관리하는 [로컬 Supabase 스택](backend/supabase/README.md)을 생성하고 마이그레이션합니다.
3. `apps/web`로 돌아와 개발 서버를 실행합니다.

   ```sh
   npm run dev
   ```

[http://127.0.0.1:3000](http://127.0.0.1:3000)을 엽니다. 실행기는 생성된 로컬 환경, 서비스 준비 상태, 브라우저 origin, 마이그레이션 대장을 확인한 뒤 Next.js를 시작합니다. Hosted 디버깅과 지도 공급자 설정은 [웹 개발 안내](apps/web/README.md)를 참고하세요.

일상 개발에는 Bun도 사용할 수 있습니다. 릴리스 패키지의 기준은 npm manifest와 lockfile입니다. `apps/web`에서 사용하는 주요 검사 명령은 다음과 같습니다.

```sh
npm run lint
npm run test:unit
npm run typecheck:parity
```

변경한 동작에 필요한 검사는 [검증 안내](docs/agents/verification.md)에 따라 선택합니다.

## 저장소 구성

| 경로 | 역할 |
| --- | --- |
| [apps/web/](apps/web/) | Next.js 공개 앱, 맛집 지도, 커뮤니티, 보호된 관리자 콘솔. |
| [backend/](backend/) | 파이프라인 제어, 크롤러, 평가, 미디어 워커, Supabase 마이그레이션. |
| [docs/](docs/) | 제품 설계, 아키텍처, 운영과 릴리스 안내. |

웹 앱과 백엔드 워커는 Supabase를 데이터 저장 경계로 사용합니다. 오래 걸리는 크롤링·미디어 처리는 백엔드 워커가 맡습니다. 상세 흐름은 [백엔드 아키텍처](backend/ARCHITECTURE.md)와 [데이터 계약](backend/DATA_CONTRACTS.md)에 있습니다.

| 웹 스택 | 도구·서비스 |
| --- | --- |
| Next.js 16 · React 19 · TypeScript | Tailwind CSS · Radix UI · Lucide |
| Node.js 24.x · npm 11.6.2 | 일상 개발용 Bun |
| Supabase | PostgreSQL · Auth · Storage |

정확한 의존성은 [package.json](apps/web/package.json)과 [package-lock.json](apps/web/package-lock.json)을 기준으로 확인합니다.

## 문서 안내

| 시작점 | 내용 |
| --- | --- |
| [문서 색인](docs/README.md) | 공통 안내와 문서별 위치. |
| [웹 개발](apps/web/README.md) | 로컬·Hosted 개발, 환경 설정, 웹 명령. |
| [백엔드 운영](backend/README.md) | 파이프라인 진입점, 환경변수 계약, 실행 요약. |
| [제품 설계](docs/product/DESIGN.md) · [아키텍처 도식](docs/architecture/) | 제품 화면과 시스템 구조. |
| [검증](docs/agents/verification.md) · [Nightly 운영](docs/operations/nightly-regression.md) | 변경 범위별 검사와 독립 회귀 검사. |
| [릴리스 안내](docs/agents/release.md) | 보호된 승격, 롤백, 배포 후 확인. |
| [성능 근거](apps/web/performance/) · [변경 기록](CHANGELOG.ko.md) | 측정 시점·범위·한계와 변경 이력. |

변경은 보호된 `develop → data → main` 순서로 승격합니다. 운영 배포에는 릴리스 안내에 따른 커밋 승인과 배포 후 확인이 필요합니다. CI, Nightly 회귀 검사, 운영 배포 상태는 각각 기록합니다.

## 보안과 라이선스

보안 문제는 [SECURITY.md](SECURITY.md)에 따라 제보해 주세요. 소스 라이선스는 [MIT](LICENSE)입니다.
