<div align="center">
  <p>
    <img src="apps/web/public/logo.png" width="72" alt="쯔동여지도 로고" />
  </p>
  <h1>Tzudong Map</h1>
  <p><strong>쯔양 영상 속 맛집을 지도 중심으로 탐색하는 제품입니다.</strong></p>
  <p>
    <a href="https://tzudong.app">라이브 앱 (외부 상태이며 이 후보에서 검증되지 않음)</a>
    ·
    <a href="https://github.com/twoimo/tzudong/releases/tag/v1.2.3">최신 릴리즈 (외부 상태이며 이 후보에서 검증되지 않음)</a>
    ·
    <a href="README.md">English</a>
    ·
    <a href="LICENSE">MIT</a>
  </p>
  <p>
    <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs" />
    <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Auth-3ecf8e?logo=supabase&logoColor=white" />
    <img alt="Runtime" src="https://img.shields.io/badge/runtime-Node%2024.x%20%2B%20Bun-c8a2c8" />
  </p>
</div>

---

Tzudong Map은 먹방 영상의 장소 근거를 사용자용 지도, 운영자용 검수 콘솔, 콘텐츠 제작용 스토리보드 워크스페이스로 바꿉니다.

## 핵심 기능

| 제품 영역 | 역할 |
| --- | --- |
| **지도 탐색** | 검색, 필터, 음식 마커 클러스터, 현재 위치 흐름, 맛집 상세 바텀시트. |
| **커뮤니티 루프** | 리뷰, 도장, 랭킹, 좋아요, 프로필 화면으로 반복 사용 경험 구성. |
| **관리자 운영** | 보호된 검수, source readback, 승인/삭제/복원, 감사 가능한 mutation 흐름. |
| **스토리보드 워크스페이스** | 채팅 기반 기획, 10컷 생성, 컷 메타데이터, 이미지 재생성, provider readiness UX. |
| **근거 중심 파이프라인** | 크롤링, Rule/LLM-as-a-Judge 평가, fail-closed 검증, Supabase 적재 payload 생성. |
## 복구 후보의 엔지니어링 및 릴리스 근거

- **도구 체인.** 웹 런타임은 Node 24.x입니다. Bun은 일상적인 설치와 유닛 흐름에서 계속 지원되지만, npm 11.6.2, `package.json`, `package-lock.json`이 릴리스 패키지 권위이며 `bun.lock`은 이 권위와 일치해야 합니다.
- **컴파일러 근거.** 네이티브 TypeScript CLI는 정확히 `7.0.2`인 `@typescript/native` 별칭이고, TypeScript `6.0.2`는 안정된 API/호환성 브리지입니다. `npm run typecheck:parity`와 `npm run typecheck:benchmark`를 사용하며 전역 컴파일러를 안내하지 않습니다.
- **성능 근거.** 표준 성능 자료는 `apps/web/performance/*`에 있고 해당 scorer/validator를 사용하며 산출물 맵은 대역 외 SHA에 연결됩니다. 보고서는 절대·상대·노이즈 예산을 명시하고 frozen-tree 근거를 보존하며, 허용된 슬라이스가 0개인 결과도 유효합니다. 보존된 원시 및 점수 산출물이 없으므로 현재 G003 측정 개선은 확립되지 않았습니다.
- **스타일 및 명명 근거.** `apps/web/stylegallery-adoption.v1.json`은 Tzudong 소유의 clean-room 채택을 기록합니다. 비라이선스 StyleGallery 커밋 `775430bbaf4ee208a642220f440f6926d79c90a3`은 질문 전용이며 코드, CSS, 산문, 이름, 테스트, 자산을 복사하지 않았고 제휴를 뜻하지 않습니다. `backend/naming-renames.v1.json`은 범위가 제한된 고신뢰 taxonomy/rename 근거이며 모든 경로 변경의 권한이 아닙니다.
- **접근성·시각·부하 근거.** WCAG 2.2 AA는 목표이며 인증 주장이 아닙니다. 포커스는 보이는 상태로 소유 스크롤 영역 안으로 이동하고, 모바일 컨트롤은 safe area를 존중하며, reduced motion을 따릅니다. 정제된 시각 근거만 보관합니다. 부하 테스트에는 승인, 비운영 범위, 제한된 볼륨, 명시적 중단 조건, 롤백, 읽기검증 영수증이 필요합니다.
- **워크트리·릴리스·Vercel 근거.** 더티 원본 워크트리는 불변이며 편집은 격리된 복구 후보에서만 하고 reset, stash, clean을 하지 않습니다. fresh-head 직렬 content-patch PR은 외부 승인과 branch protection 아래 `develop -> data -> main`으로 이동합니다. 호스팅 작업 전에 정확한 Git 통합 `tzudong` Vercel 프로젝트를 검증하고, 오래된 `web` 프로젝트를 사용하거나 DNS를 변경하지 않습니다. 릴리스와 롤백에는 승인, branch-protection, 롤백, 읽기검증 영수증이 필요합니다. 이 후보는 병합, 배포, 라이브 URL 상태를 검증하지 않습니다.

## 제품 투어

### Desktop

**지도 탐색과 맛집 상세**

<p align="center">
  <img src="apps/web/public/images/readme-product-tour.gif" width="900" alt="쯔동여지도 데스크톱 제품 투어" />
</p>

**관리자 스토리보드 워크스페이스**

![10컷 스토리보드를 생성하는 스토리보드 워크스페이스](apps/web/public/images/readme-storyboard-demo.gif)

### Mobile

<table>
  <tr>
    <td width="50%"><strong>홈 지도</strong><br /><small>마커 탐색 → 맛집 상세 전체 보기</small><br /><img src="apps/web/public/images/readme-mobile-home-map.gif" alt="홈 지도 마커 탐색과 맛집 상세 전체 화면 모바일 데모" /></td>
    <td width="50%"><strong>리뷰 피드</strong><br /><small>리뷰 스크롤 → 맛집 상세 열기</small><br /><img src="apps/web/public/images/readme-mobile-reviews-feed.gif" alt="리뷰 피드 모바일 데모" /></td>
  </tr>
  <tr>
    <td width="50%"><strong>도장 페이지</strong><br /><small>도장 맛집 탐색 → 상세 읽기</small><br /><img src="apps/web/public/images/readme-mobile-stamp-passport.gif" alt="도장 페이지 모바일 데모" /></td>
    <td width="50%"><strong>랭킹 프로필</strong><br /><small>1위 프로필 → 탭 전환</small><br /><img src="apps/web/public/images/readme-mobile-leaderboard-ranking.gif" alt="랭킹과 프로필 모바일 데모" /></td>
  </tr>
</table>

## 개인정보 보호 장치와 출시 전제조건

G010/G013/G014 소스 보호 장치는 fail-closed 개인정보 보호 경계를 구현합니다.

- 회원 생성은 게시된 한국어 개인정보처리방침의 정확한 버전과 내용 해시에 대한 명시적 확인에 결합됩니다.
- 검증된 보호자 확인 경로가 배포되고 읽기검증되기 전까지 만 14세 미만 가입은 지원하지 않으며, 우회 수단으로 생년월일·보호자 연락처·주민등록번호를 요구하지 않습니다.
- 광고성 정보 수신 동의는 목적과 채널별로 분리되고, 21:00~08:00 광고에는 같은 채널의 별도 야간 동의가 필요합니다.
- 공용 개인정보 필터는 자격 증명, 개인정보, 정밀 위치, 원본 OCR, 임의 요청 본문, 제공자 진단정보가 로그와 최소화된 감사 근거에 남지 않도록 제한합니다.
- 기기 위치는 권한 요청 직전에 고지하고 메모리에만 유지하며, 사용자가 취소하거나 흐름을 벗어나면 위치 감시를 종료합니다.
- 계정 삭제·보존·개인정보 사고 흐름은 고정 코드, 법적 보존/권한 확인, 사람이 수행하는 외부 통지를 포함한 Preview → Confirm → Apply → Readback → Audit 절차를 따릅니다.

이 소스 보호 장치는 법령 준수 또는 운영 증명이 아닙니다. 정확한 방침 게시, 한국 법률/개인정보 책임자 검토, 위치정보사업 신고 또는 비대상 근거, 만 14세 미만 지원 전 보호자/제공자 승인, 사고 신고 및 접수 근거, 운영자가 승인한 보존 분류, 운영 비밀값과 내부 capability를 갖춘 승인된 HTTPS 마케팅 제공자, 그리고 호스팅된 migration/RLS/grant/RPC/type/catalog, backup/PITR, key-management, operator-access 읽기검증에 대한 외부 근거가 확보될 때까지 출시는 차단됩니다. 위 외부 링크는 상태 참조일 뿐 이 후보에서 검증되지 않았습니다.
