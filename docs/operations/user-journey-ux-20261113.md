# 사용자 동선 QA와 UI 개선 — 2026-11-13

## 범위와 판단

운영 사이트 `https://www.tzudong.app/`에 사용자가 승인한 계정으로 로그인한 뒤 실제 탐색, 저장 목록, 리뷰, 제보, 계정 화면을 확인했다. 이 문서는 계정 식별자·이메일·개인 리뷰 본문·저장 목록·인증 정보를 기록하지 않는다. 공개 지도 화면만 이미지로 보존한다.

개선 코드는 Draft PR의 후보 변경이며 아직 운영에 반영하지 않았다. 운영 화면에서 발견한 문제, 후보 소스 검사, 후보 배포에서 실행한 수동·CI 브라우저 검사와 아직 확인하지 않은 범위를 구분해 기록한다.

기존 크림·먹색, 한국어 글꼴, 실제 음식 사진과 지도 중심 구성은 제품에 맞는다. 시각적 문제는 **부분적인 과장 문구, 장식 이모지, 과한 굵기, 작은 조작 영역, 반복되는 강한 버튼**이다. 더 큰 문제는 북마크에서 상세로 갈 수 없는 동선, 오류를 빈 데이터처럼 보여주는 상태, 닫힌 폼의 키보드 초점 손실이다. 기존 브랜드를 유지하면서 사용자 행동과 복구 경로를 우선 개선했다.

관찰 환경은 데스크톱 클라우드 브라우저, 1363×936 뷰포트다. 운영 홈의 테마 버튼 5개 높이는 DOM으로 각각 32px임을 확인했다. 44px는 이 패치의 터치 조작 설계 목표이며 WCAG AA의 모든 대상에 대한 의무 수치라고 해석하지 않는다. 이 작업은 실제 사용자 모집 연구, 성능 벤치마크, 전체 WCAG 적합성 인증이 아니다. 모바일 터치 크기는 구현 의도와 코드 검사를 실제 기기 측정과 구분한다.

## 실제 시나리오와 관찰

| ID | 사용자 목표와 실행 | 운영 화면 관찰 | 판단 / 대응 |
| --- | --- | --- | --- |
| S01 | 홈에서 로그인하고 내 계정으로 이동 | 안전한 로그인 완료 후 프로필과 로그아웃 동작이 나타남 | 진입 정상. 인증 경계와 실제 입력 정보는 변경하지 않음 |
| S02 | 저장한 맛집을 다시 찾아 지도에서 보기 | 북마크 식당명 클릭은 반응이 없고 영상·삭제만 제공. 제목의 상위 요소도 링크/버튼이 아님 | 높은 우선순위. 식당 제목과 명시적인 지도 링크를 canonical 복귀 URL에 연결 |
| S03 | 내 활동을 확인한 뒤 필요할 때 계정 설정 변경 | 방문·리뷰 활동과 비밀번호·6개 마케팅 버튼·과거 초안 복구가 같은 강도로 배치됨 | 활동을 먼저, 설정은 목적별 펼침 영역으로 정리. 동의 채널·야간 구분 유지 |
| S04 | 내 리뷰의 승인 상태와 수정 가능 여부 확인 | 내 리뷰 목록은 표시. 서비스 준비 중 배너와 수정/삭제 비활성 상태 | 서비스 설정에 의한 제한. UI 개선으로 기능을 임의 활성화하지 않음 |
| S05 | 신규 맛집 제보 내역 확인 | 조회 오류 발생. 다시 시도하면 로딩 후 같은 오류. 제목과 새 행동 안내도 사라짐 | 오류를 페이지 내부에 표시하고 제목·기존 내역·재시도·지도 복귀를 유지. 운영 조회 원인 해결과 구분 |
| S06 | 존재하지 않는 검색어에서 다시 찾기 | “검색 결과가 없습니다.” 한 줄만 표시 | 검색 방식 변경, 검색어 지우기, 조건 안내를 추가. 소스상 통신 실패도 빈 결과로 처리하던 문제를 별도로 수정 |
| S07 | 실제 맛집 이름으로 검색하고 상세 열기 | 결과에 이름·주소가 나타나고 식당 상세로 이동 | 정상 동작 보존. 검색 범위·집계 방식은 변경하지 않음 |
| S08 | 상세에서 브라우저 뒤로 가기로 검색 복귀 | 상세가 닫히고 이전 검색어와 결과가 복원됨 | 정상 복귀 계약 보존 |
| S09 | 상세에서 리뷰 작성 창을 열고 키보드로 닫기 | 작성 창 진입은 가능. 준비 중 배너와 다음 단계 제한. Esc는 닫지 못하고 닫기 버튼 사용 후 초점은 문서로 이동 | 기존 초안 안전 닫기 경로에 Esc 연결. opener 초점 복귀와 준비 중 업로드 제어 일관성 보완 |
| S10 | 맛집이 없는 지역을 선택한 뒤 다른 지역 탐색 | 선택 지역 0개는 맞지만 다시 연 목록에서 조회하지 않은 다른 지역까지 0개로 표시 | 현재 지역의 0과 미조회 지역을 구분. 명시적 전체 지역 보기 복구 제공 |
| S11 | 지도에서 새 제보를 시작하고 필수 항목 안내 받기 | 3단계 양식은 열림. 빈 상태의 다음 버튼은 오류를 표시하지만 초점이 버튼에 남음. 추가 카테고리 입력은 접근성 이름이 없음 | 라벨 연결, 필드별 오류, 첫 오류 초점 이동. 실제 제보는 제출하지 않음 |
| S12 | 리뷰 피드에서 내 리뷰 수정 창을 열었다가 취소 | 수정 창이 열리고 저장은 서비스 설정으로 제한. Esc는 닫지만 opener로 초점이 돌아오지 않음 | 제어형 Dialog의 열기 전 초점 저장과 닫기 후 복귀 보완. 기존 리뷰 내용은 편집하지 않음 |

검사 중 공개 리뷰·제보를 새로 게시하거나 기존 자료를 삭제하지 않았다. 비밀번호·동의 설정도 변경하지 않았다. 서비스가 보류한 등록·수정의 최종 성공을 검증했다고 주장하지 않는다.

## 구현한 주요 변경

### 탐색과 결과 복구

- 검색어와 검색 방식을 구체적으로 표시한다. 실제 지원 범위인 맛집 이름 또는 영상 제목에 맞춘 문구를 사용한다.
- 검색과 인기 목록, 상세 리뷰의 **읽기 실패**를 **확인된 0건**과 구분한다. 재시도 동작을 제공하고, 이미 읽은 결과는 가능한 경우 유지한다.
- 검색어를 지우거나 검색 방식을 바꾼 후 입력란으로 초점을 돌린다. 최근 검색 삭제는 마우스를 올리지 않아도 찾을 수 있다.
- 독립 코드 검토에서 최근·인기 선택의 늦은 응답이 새 검색어를 덮어쓰는 경쟁 상태를 재현했다. 요청 세대를 확인해 새 입력·검색 방식·다른 선택·unmount 이후의 성공/실패 응답을 무시하도록 고쳤다. 실제 컴포넌트에서 추출한 콜백을 합성 입력으로 실행한 검사이며, 운영 화면에서 같은 타이밍을 재현한 결과와 구분한다.
- “조회수 폭발”, “댓글 폭주”, “반응 찐함”을 실제 통계 기준에 맞는 표현으로 바꾸고, 기준 설명을 클릭·키보드로 열 수 있게 한다. 계산식과 순위는 그대로 유지한다.
- 영상 공개일로 정렬하는 목록을 “영상 속 맛집”, “최신 영상순”으로 표현한다. 구현 내부의 지연 로딩 설명과 TOP 5 장식을 제거한다.
- 모바일 테마는 이미 승인된 `mobile-theme-filter-reel` 소유자 안에서 한 줄로 스크롤한다. 전체 페이지의 가로 넘침을 숨기는 방식은 사용하지 않는다. 지도 상태 배지는 실제 상단 제어 높이를 따라 배치한다.
- 지역별 숫자는 현재 조회 범위에 대해서만 표시한다. 다른 지역을 아직 집계하지 않았다면 0으로 만들어 표시하지 않는다.

### 저장 목록과 계정

- 북마크의 식당명과 지도에서 보기 모두 실제 링크다. 국내·해외 좌표에 맞는 기존 `buildHomeReturnHref`를 사용해 상세를 연다.
- 프로필은 활동·등급을 먼저 보여주고 비밀번호, 마케팅 수신, 초안 복구를 목적별로 펼쳐 본다. 반복 동의 버튼의 강도를 줄였다.
- 신규 제보·수정 요청·추천 메뉴가 작성 화면이 아닌 **내역**임을 명시한다. 오류가 나도 화면 제목과 지도로 돌아가는 경로가 남는다.
- 계정 삭제 확인, 재인증, 목적·채널별 동의와 별도 야간 동의, 미성년자 제한을 유지한다.
- 후보 QA에서 발견한 로그인 창의 초점 손실은 desktop Dialog가 실제 opener를 기억하고, 닫힐 때 여전히 연결된 요소에 초점을 복귀시키도록 보완했다. 인증 성공·페이지 이동·모바일 BottomSheet의 경로는 유지한다.
- 정책 조회 실패를 무한한 “확인 중”으로 표시하던 문제를 수정했다. loading·ready·error 상태를 구분하고 오류에는 재시도를 제공한다. 재시도는 가입 탭·입력·연령·동의를 보존하며 GET만 실행한다. 15초 미응답은 오류로 종료하고, 닫기·재시도·timeout 이후 늦은 응답을 무시한다. 유효 policy ID와 hash가 없으면 기존 가입 gate가 계속 차단한다.

### 리뷰·제보 양식

- 사진 추가를 native button으로 바꾸고 사진 제거를 항상 보이는 이름 있는 조작부로 만든다.
- 카테고리 선택 상태와 해제 동작, 추가 카테고리 라벨을 명확히 한다.
- 신규 제보 검증 조건은 유지하면서 필드별 오류 설명과 `aria-invalid`를 연결하고 첫 오류로 초점을 보낸다.
- Esc와 닫기는 기존 초안 보존 경로를 사용한다. 지도 패널의 unmount와 Dialog 닫기 양쪽에서 실제 opener로 초점을 복귀시킨다.
- 영수증 자동 입력의 기능 설명은 남기되 반짝이, 과장된 약속, 사용자의 결정을 돕지 않는 모델명 표시를 정리한다.
- 리뷰 서비스 준비 중에는 파일 선택·드롭·분석 선택을 일관되게 제한하고 준비 상태를 다시 확인할 수 있다.
- 공유 완료 표시는 클립보드 쓰기가 성공한 뒤에만 나타난다.

### 공통 간격과 표현

공통 헤딩의 과도한 굵기와 자간을 정리하고 주요 제목은 600 굵기를 기준으로 본문·보조 문구와 구분한다. 입력과 텍스트 영역은 작은 화면에서 16px 글자를 사용하며, 핵심 조작부는 44px 영역을 확보하도록 구현했다. 공통 닫기 조작부에는 한국어 이름과 보이는 키보드 초점을 제공한다. 기존 색 토큰, 실제 사진, 경계선 중심의 카드, reduced-motion 대응은 유지한다.

## 사용한 스킬과 적용 판단

1. [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), 검토한 HEAD `6ae86f61f520d6ca229d2f40e070410638c908c5`.
   - 실제 Next/React/Tailwind 스택을 확인했다.
   - 첫 design-system 검색이 음악·이벤트형 화면을 추천해 부적합하다고 버렸다. 더 좁힌 식당 리뷰 디렉터리 검색에서 검색 우선순위·명확한 필터·빈 결과 복구 원칙만 적용했다.
   - 기존 한국어 글꼴과 브랜드를 일반적인 영문 템플릿으로 교체하지 않았다.
2. [unslop](https://github.com/heydamir/unslop), 검토한 HEAD `97daa3eb365670ea3f87ed85356cbfcee18105a5`.
   - 설치된 스킬이 해당 원본과 동일함을 확인했다.
   - 감사 → 제품 방향 → 간격·색·아이콘·문구·글자·배치·상세·이미지·움직임 순서로 검토했다. 충분히 기능하는 색·사진·motion 토큰은 유지했다.
   - 스킬 귀속: Damir Sokolovsky (@heydamir), CC BY 4.0. 이 작업의 감사 방식과 UI 정리 기준에 적용했다.

## 검증과 배포 기록

작업은 `main`의 `b605b68c58eac4531847c5ea15860baa68fbe1df`에서 분리했다. 운영 Vercel 프로젝트는 `twoimos-projects/tzudong`, Git 저장소 `twoimo/tzudong`, 루트 `apps/web`임을 실제 대시보드에서 확인했다. 운영 배포는 `dpl_DKfxayPRbi1RXBuM8fRoaLJE1QNJ`, SHA `27a2d2ae3675bd80c710a81e24b8cfe048baaf2c`로 유지되고 있으며, 아래 후보 UI 변경은 아직 운영에 반영하지 않았다.

### 후보 코드와 PR

로컬 소스 커밋을 만든 뒤 CLI push에 필요한 자격 증명을 사용할 수 없어, 연결된 GitHub API로 같은 소스 트리를 원격 브랜치에 게시했다. 커밋 식별자는 다르지만 **로컬과 원격의 Git tree가 동일함을 확인했다.** 원격 후보는 `preview/user-journey-ux-20261113`이며, `main` 대상 [Draft PR #3828](https://github.com/twoimo/tzudong/pull/3828)을 생성했다.

| 구분 | 커밋 SHA | Git tree |
| --- | --- | --- |
| 첫 후보의 로컬 소스 커밋 | `526656dc0a05d6189286bf56b10339bcb69caf3d` | `6855e37c6557b1e704506a39469feb66accd76fa` |
| 첫 후보의 원격 소스 커밋 | `cba9c868e10e7b2107347202822252ef9aa1c236` | `6855e37c6557b1e704506a39469feb66accd76fa` |
| CI·Preview 후속 수정의 로컬 소스 커밋 | `e23462985dc556916cd9ddc2422d5efae2cc6042` | `fa10c65fa65810b27b93d224f12d562e666e2563` |
| 후속 UI 변경의 원격 소스 커밋 | `23a090e69836e4411deb56de30f9fef1ccc5568b` | `fa10c65fa65810b27b93d224f12d562e666e2563` |

각 로컬·원격 쌍의 Git tree가 동일함을 확인했다. 원격 소스 커밋 `cba9c868…`를 가리키는 Vercel feature 배포의 **Ready** 상태와 빌드 완료 로그를 확인하고, 공개 화면과 실제 CI Chrome 검사에서 발견한 문제를 후속 수정했다. 같은 PR의 preview 브랜치를 기존 `cba9c868…` 상태를 확인한 뒤 `23a090e…`로 fast-forward했다. 이 배포도 **Ready**이며 실제 공개 화면에서 국가 선택부와 로그인 창 초점 복귀를 다시 확인했다.

이 문서의 원격 CI·배포 관찰 기준은 `23a090e…`다. 이후 확인한 **Auth 정책 조회의 잘못된 로딩 표시**, 테스트 초기화 수정과 회귀 검사를 이 문서·증거와 함께 반영한다. 이 마지막 변경의 정확한 head와 배포·CI 결과는 [PR #3828 검사](https://github.com/twoimo/tzudong/pull/3828/checks)에서 확인한다. 아래 `23a090e…`의 실제 관찰을 마지막 정책 조회 수정의 배포 검증으로 소급하지 않는다. 소스 동일성이나 Preview 빌드·일부 동선의 성공을 보호 병합 또는 운영 승격 증거로 대체하지 않는다.

### 실행한 검사와 미실행 범위

최종 검증·미리보기 상태는 아래에 기록한다. 소스/합성 실행 검사, 실제 운영 관찰, 수정본 브라우저 검증을 서로 대체하지 않는다.

| 항목 | 상태 |
| --- | --- |
| 운영 시나리오 S01–S12 | 실제 로그인 상태에서 관찰 완료. 제한·오류는 위 표에 분리 |
| 계정/auth 단위·React 렌더 검사 | 13파일, **135 pass / 0 fail / 1,551 assertions**. 실제 컴포넌트 렌더와 개인정보·삭제·재인증·route-state 경계 검사 |
| 첫 후보 web-quality·리뷰 동선·avatar 회귀 | `web-quality-performance-source.test.ts`, `restaurant-review-journey.test.ts`, `review-card-avatar.test.tsx`: **53 pass / 0 fail / 2,450 assertions** |
| 첫 후보 검색 선택·복구·전체 검색 범위 회귀 | `restaurant-search-selection.test.ts`, `restaurant-search-recovery.test.tsx`, `restaurant-search-global-scope-source.test.ts`: **20 pass / 0 fail / 106 assertions**. 마지막 검색 요청 세대 guard 포함 |
| 모바일 검색 선택 로직 | `mobile-home-search-selection.test.ts`: 앞선 실행에서 **13 pass / 0 fail**. 모바일 브라우저·기기에서 실행한 검사가 아님 |
| 작업 중의 다른 영향 범위 검사 | 홈 좁은 범위 87건, 공통 디자인 23건과 draft·OCR·사진·validator 검사를 별도 실행해 통과한 기록. 위 최종 그룹과 중복될 수 있으므로 합산하지 않음 |
| 첫 후보 TypeScript native/compat parity | **통과, 0 diagnostics.** 마지막 검색 요청 세대 guard와 `ReviewEditModal` 헤더의 `pl-6 pr-14` 간격 수정까지 포함. CI·후보 QA의 후속 수정 결과는 다음 행에 별도 기록 |
| `23a090e…` UI 소스의 TypeScript·lint | 동일한 로컬 소스 트리에서 **native/compat parity 통과, 0 diagnostics**. Content digest `75beefdb40e013cec2889f72c1dbf37879c8dce91e18ca98a7fe072b7236f2db`. 변경 TS/TSX 13파일 ESLint와 `git diff --check` 통과 |
| 마지막 정책 조회 수정의 TypeScript | 이 문서와 함께 반영하는 정책 조회·테스트 초기화 변경까지 포함해 **native/compat parity 통과, 0 diagnostics**. Content digest `7c0799d41b42eb9b4a152e8e3c7b282a095f810970cfb8ad5e441a480f821e92`. 원격 CI·Vercel 결과는 최종 PR 검사에서 확인 |
| 로컬 Next build | 초기 ref 타입 오류를 수정한 뒤 webpack 컴파일·TypeScript·58개 페이지 생성·route CSS boundary 통과. **이 빌드는 마지막 검색 요청 세대 guard와 `ReviewEditModal` 헤더의 좁은 `pl-6 pr-14` 간격 수정 전 작업트리에서 실행했다.** 최종 소스 커밋의 전체 build를 다시 완료한 것으로 취급하지 않음. 이후 검색 guard는 최종 검색 회귀로, 두 수정이 포함된 소스는 최종 parity로 확인. 헤더 간격의 브라우저 실측은 미실행 |
| 로컬 고정 Chrome for Testing 실행 | 지정된 156.0.8078.4 다운로드가 ZIP 검증 오류로 실패. 로컬에서 핀을 우회하지 않음. **CI에서는 Chrome 검사가 실제 실행되어 실패를 발견했으므로 전체 브라우저 검사를 미실행으로 취급하지 않음** |
| 로컬 HTML을 클라우드 브라우저로 열기 | `file:` 프로토콜이 브라우저 URL 보안 정책에 의해 차단. 우회하지 않음 |
| Vercel connector 프로젝트 조회 | 정확한 team/project에서도 404. 기존 로그인된 공식 대시보드에서 프로젝트 확인 가능 |
| 원격 후보 게시·PR | 원격 관찰 기준 UI 소스 커밋 `23a090e…`, `main` 대상 Draft PR #3828. 연결된 GitHub API로 게시했으며 CLI push 성공으로 기록하지 않음. 정책 조회·테스트 초기화의 마지막 head는 PR에서 확인 |
| 첫 후보의 Vercel feature build | [배포 `dpl_DG6XAbtg7vj1UjRVNnbhGwAiYtHz`](https://vercel.com/twoimos-projects/tzudong/DG6XAbtg7vj1UjRVNnbhGwAiYtHz)가 원격 소스 커밋 `cba9c868e10e7b2107347202822252ef9aa1c236`를 가리킴을 대시보드에서 확인. **Ready, 3분 26초.** 컴파일 51초, TypeScript 57초, 정적 페이지 58/58, route CSS boundary와 Deployment completed 로그 확인. Custom domain assignment는 Skipped |
| 첫 후보 Preview 공개 동선 | [첫 후보 URL](https://tzudong-ipgekqc59-twoimos-projects.vercel.app/)의 공개 화면을 **1363×936**에서 검사. 아래 표에 UI 동작, 환경 오류, 미검증 서버 동작을 분리. 이 Preview origin에서는 로그인하지 않음 |
| PR의 첫 후보 CI | `cba9c868…`의 확인한 37개 check 중 **21 success / 5 failure / 11 skipped**. 프로필 desktop 입력 크기와 접힌 초안 복구 설정을 여는 테스트 단계 등을 후속 수정. 후속 head의 필수 검사 성공은 아직 확인하지 않음 |
| 후속 소스의 Vercel build | [배포 `dpl_C8dzLbsvGvrV81kEdZqdxui9if73`](https://vercel.com/twoimos-projects/tzudong/C8dzLbsvGvrV81kEdZqdxui9if73)가 정확한 `23a090e69836e4411deb56de30f9fef1ccc5568b` 소스임을 확인. **Ready, 1분 58초**, custom domain assignment는 Skipped. [확인한 Preview alias](https://tzudong-git-preview-user-journey-ux-20261113-twoimos-projects.vercel.app/)에서 아래 후속 검사를 실행 |
| 후속 UI 소스의 CI | `23a090e…`에서 확인한 37개 check: **24 success / 2 failure / 11 skipped**. 남은 실패는 새 auth focus browser fixture의 초기화 실패 2개 시나리오와 이를 반영한 CI 집계. 이 문서와 함께 반영한 정책 조회·테스트 초기화 수정 이후 결과는 [PR 검사](https://github.com/twoimo/tzudong/pull/3828/checks)에서 확인 |
| 프로필 후속 수정 검사 | `mypage-user-journeys-render.test.ts`, `mypage-mobile-cleanup-contract.test.ts`, `web-quality-performance-source.test.ts`: **48 pass / 0 fail / 2,745 assertions**. 수정 파일 ESLint 통과. 실제 Input을 렌더해 6개 모두 공통 `lg:text-sm`을 제거함을 확인하고, 생성 CSS의 기본·64rem 이상 글자 크기가 `1rem`임을 확인. 브라우저 재측정과 구분 |
| 로그인 초점·테스트 초기화 후속 검사 | `auth-modal-focus.test.ts`, `mypage-user-journeys-render.test.ts`, `auth-existing-account-recovery.test.ts`, `privacy-onboarding.test.ts`, `auth-admin-login-redirect.test.ts`: 테스트 초기화 수정 후 **71 pass / 0 fail / 678 assertions**. 실제 AuthModal 콜백의 초점 복귀·분리된 opener·재열기와, Node process 없이 실제 번들의 모듈 초기화가 render 진입 직전까지 도달함을 검사. 테스트·fixture 3파일 ESLint와 diff 검사 통과. VM 검사는 실제 DOM mount·브라우저 focus 통과로 취급하지 않음 |
| 정책 조회 상태·재시도 최종 영향 검사 | 위 5파일에 `auth-policy-loading.test.ts`를 더한 6파일: **77 pass / 0 fail / 698 assertions**. 실제 effect의 HTTP 실패·잘못된 ID/hash·예외·정상 재시도·timeout·닫기/대체 요청 뒤 늦은 응답을 검사. 변경 Auth/test/fixture 5파일 ESLint 통과. 기존 자동 focus 2개 시나리오에 실제 AuthModal의 503→유효 GET 재시도·입력/연령 유지·동의 미선택·auth write 0 시나리오를 추가했으며, 자동 브라우저 결과는 최종 PR 검사에서 확인 |
| 수정본 브라우저 시각·모바일 검증 | 첫 후보의 공개 동선과 `23a090e…`의 국가 선택부·로그인 창 초점 복귀를 실제 desktop 브라우저에서 확인. CI에서는 프로필의 390·768·1440px 합성 Chrome 검사를 실행해 통과. Preview 로그인 요청은 사용자 취소 후 재시도하지 않아 로그인 후 동선은 **미검증**. 실제 모바일 기기·다른 브라우저별 실측·확대 검증은 **미실행** |
| 보호 병합·운영 승격 | 미수행. 운영 SHA는 `27a2d2ae3675bd80c710a81e24b8cfe048baaf2c` 유지 |

테스트 수는 실행 그룹별 수치이며 전체 고유 테스트 수로 합산하지 않는다. 첫 후보의 로컬 통과 기록, 이후 실제 CI에서 발견한 실패, 후속 수정의 로컬 검사와 원격 재실행을 구분한다.

### `23a090e…` CI의 실제 브라우저 증거와 마지막 테스트 수정

[CI 실행 43404767782](https://github.com/twoimo/tzudong/actions/runs/43404767782)에서 다음 결과를 확인했다. 각 행은 독립 실행 기록으로 합산하지 않는다.

| 검사 | 실제 결과와 근거 |
| --- | --- |
| 프로필 반응형·설정 | `profile-renewal-browser.test.ts`: **1 pass / 0 skip**, 2.54초. 실제 테스트 안에서 390·768·1440px를 순회해 설정 펼침·입력 크기·입력 유지 등을 검사. [shard 1](https://github.com/twoimo/tzudong/actions/runs/43404767782/job/131816418605) |
| desktop 탐색 패널 | `desktop-panel-renewal-browser.test.ts`: **20 pass / 0 skip**. 문자열 계약 1개와 실제 브라우저 검사 19개. [shard 3](https://github.com/twoimo/tzudong/actions/runs/43404767782/job/131816418712) |
| 이전 버전 초안 복구 | `legacy-draft-recovery-browser.test.ts`: **37 pass / 0 skip**. 명시적 펼침 이후 복구, 부분 실패 재시도와 계정 전환 보호를 포함. [shard 5](https://github.com/twoimo/tzudong/actions/runs/43404767782/job/131816418466) |
| 검색 fixture 격리 | 격리 wrapper 통과, 7.16초. [shard 1](https://github.com/twoimo/tzudong/actions/runs/43404767782/job/131816418605). 내부 건수를 추가로 추정·합산하지 않음 |
| 새 로그인 초점 fixture | **2개 시나리오 실패**. 최초 opener가 나타나기 전 초기화에서 중단되어 focus assertion까지 도달하지 않음. [shard 5](https://github.com/twoimo/tzudong/actions/runs/43404767782/job/131816418466), [실패한 CI 집계](https://github.com/twoimo/tzudong/actions/runs/43404767782/job/131818096620) |

남은 fixture 실패는 번들이 `process.env.NODE_ENV`만 치환하여, 실제 `lib/site-config`의 다른 환경 변수 접근에서 `ReferenceError: process is not defined`가 발생한 것이었다. process가 없는 VM에서 같은 초기화 실패를 재현했다. 이 문서와 함께 fixture에 테스트용 환경 객체 전체를 제공하고, 첫 mount 대기와 `pageerror`를 함께 기다려 오류가 즉시 드러나도록 수정했다. 실제 AuthModal·Radix와 유지·조건부 unmount의 두 시나리오, Escape·닫기 버튼 후 초점 assertion은 그대로 보존한다. 제품 소스를 이 fixture 오류 때문에 변경하지 않았다. 별도의 정책 조회 제품 수정과 그 GET 재시도 시나리오는 앞 행에 기록했다. 로컬 VM·단위 검사 통과와 실제 배포의 수동 초점 복귀 성공은 기록하되, 세 자동 브라우저 시나리오의 최종 결과는 [PR 검사](https://github.com/twoimo/tzudong/pull/3828/checks)를 따른다.

같은 UI 소스에 대한 [Release](https://github.com/twoimo/tzudong/actions/runs/43404767645), [Promotion Path](https://github.com/twoimo/tzudong/actions/runs/43404762120), [Security](https://github.com/twoimo/tzudong/actions/runs/43404767567), [CodeQL](https://github.com/twoimo/tzudong/actions/runs/43404767679)는 success로 확인했다. 이 결과로 실패한 CI 집계나 운영 승격을 대신하지 않는다.

### 첫 후보 Preview의 공개 사용자 동선

다음은 `cba9c868…` 배포의 관찰이다. 운영에서 로그인한 S01–S12와 다른 origin의 **비로그인 검사**이며, 실제 계정 내용이나 인증 자료를 보존하지 않았다.

첫 후보 캡처: [홈과 지도 오류](../evidence/user-journey-ux-20261113/candidate-cba9c86-home.jpg), [빈 검색 복구](../evidence/user-journey-ux-20261113/candidate-cba9c86-search-empty.jpg), [비어 있는 로그인 입력](../evidence/user-journey-ux-20261113/candidate-cba9c86-auth.jpg). 후속 패치 적용 전 화면이며 최종 후보의 시각 검증으로 취급하지 않는다.

| 동선 / 상태 | 실제 관찰과 범위 |
| --- | --- |
| 홈의 글자·조작 영역 | 주요 제목 font-weight 600, 테마 버튼 5개 높이 모두 44px. 문서 전체의 가로 넘침 없음 |
| 0건 지역에서 복구 | 울산 선택은 0건으로 표시. 지역 목록에서 선택된 울산만 0, 다른 미조회 지역에는 0을 만들지 않음. “전체 지역 보기”로 전국 715개 표시 복원 |
| 빈 검색에서 다시 찾기 | 결과 없는 맛집명 검색에 검색 방식 변경·지우기 버튼 표시. “영상 제목으로 찾기”가 검색 방식을 바꾸고 입력란으로 초점을 이동 |
| 검색·상세·뒤로 가기 | 실제 맛집명 검색으로 1개 결과 표시, 상세 진입, 브라우저 뒤로 가기로 검색어와 결과 복원 |
| 영상 제목 검색 실패 | 읽기 실패와 재시도 표시, 검색어 유지. 재시도 후에도 오류 지속. 정상 0건 또는 검색 서비스 성공으로 해석하지 않음 |
| 통계 테마 | “조회수 상위”의 기준 설명을 열 수 있음. 목록 읽기는 실패 상태로 표시. 조건을 지우면 기본 715개 표시 복원 |
| 로그인·회원가입 조작부 | desktop 입력 높이 44px·글자 14px, 닫기 44×44px. 선택 동의 펼침이 열리고 일반 동의 3개는 미선택, 야간 동의 3개는 비활성. 연령·동의 선택이나 가입 제출은 하지 않음. desktop 14px는 작은 화면의 16px 계약과 구분 |
| 로그인 창의 키보드 닫기 | Escape로 창은 닫히지만 초점이 BODY로 이동. 실제 opener를 저장·복귀하는 후속 패치를 적용했고, 아래 `23a090e…` 재검증에서 수정 확인 |
| 정책 조회 상태 | “최신 개인정보 처리방침을 확인하는 중입니다.”가 계속 표시됨. 서버 조회 실패의 원인은 미확인. 소스에서 오류 시 null을 계속 로딩으로 표시하는 UI 결함을 확인해 마지막 패치에 오류 상태·재시도·timeout을 추가. 동의 gate를 우회하거나 가입 가능으로 처리하지 않음 |
| 지도 제공자 상태 | “네이버 지도 Open API 인증이 실패했습니다”를 표시한 뒤 지도 읽기 실패 복구 화면으로 전환. Preview domain을 제공자 허용 목록에 추가하지 않음. 지도 전체 기능이나 Preview 환경의 완전한 정상 동작은 확인되지 않음 |

CI에서는 1440px 프로필 입력이 16px 기대값 대신 14px로 계산되는 회귀를 발견했다. 공통 Input의 `lg:text-sm`을 프로필 입력별 `lg:text-base`로 상쇄하는 수정과, 펼쳐진 초안 가져오기 버튼을 전제하던 브라우저 시나리오 3개에 “이전 버전 초안”을 먼저 여는 사용자 단계를 추가했다. 기존 복구·부분 실패 재시도·계정 전환 보호 assertion은 유지했다. 이러한 수정의 로컬 코드 검사는 원격 브라우저 재실행 성공을 대신하지 않는다.

운영 `27a2d2ae…`의 기존 로그인 탭에서 같은 통계 테마를 읽기 전용으로 비교했을 때 140개 결과와 정상 지도 타일이 표시되었고, 검사 후 기본 전국 715개 표시로 복귀했다. 운영은 로그인 상태, Preview는 비로그인 상태이므로 후보의 RPC 읽기 실패를 도메인 설정 하나로 단정할 수 없다. 운영의 없는 영상 검색이 기존 빈 결과 문구를 표시한 사실도 이전 코드가 오류를 숨길 수 있어 API 정상 증거가 되지 않는다. 현재 확인된 지도 원인은 후보에 표시된 Naver 인증 실패이며, 검색·통계·정책 조회의 원인과 인증된 Preview 동선은 별도 확인이 필요하다. 백엔드 설정은 변경하지 않았다.

### 후속 후보 `23a090e…`의 실제 재검증

배포가 정확한 후속 소스 SHA를 가리키는지 확인하고 [Preview alias](https://tzudong-git-preview-user-journey-ux-20261113-twoimos-projects.vercel.app/)를 열었다. 다음은 코드나 fixture 추론이 아닌 실제 desktop UI 관찰이다.

| 확인 대상 | 결과 |
| --- | --- |
| 국가 선택부 잘림 | 선택 조작부 **208×44px**. “대한민국” 텍스트의 clientWidth와 scrollWidth가 **93px로 동일**하여 말줄임 없이 표시. 카테고리 이름도 전체 표시 |
| Escape 후 로그인 opener 복귀 | 로그인 창을 Escape로 닫은 뒤 activeElement가 **BUTTON**, aria-label **“로그인 열기”**임을 확인. 첫 후보의 BODY 초점 손실 수정 확인 |
| 키보드 재열기 | 복귀한 로그인 버튼에서 Enter를 눌러 창이 다시 열리고 탭의 보이는 초점을 확인 |
| 닫기 버튼 후 opener 복귀 | 창의 닫기 버튼을 눌렀을 때도 activeElement가 **BUTTON**, aria-label **“로그인 열기”**로 복귀 |
| Preview 로그인 후 동선 | 보안 로그인 요청을 사용자가 취소함. 새로 확인한 폼은 비어 있었고 로그인 성공 신호가 없음. 재시도하지 않았으며 후보의 북마크·프로필 등 로그인 후 동선을 검증한 것으로 기록하지 않음 |

후속 후보 캡처: [국가 선택부와 홈](../evidence/user-journey-ux-20261113/candidate-23a090e-home.jpg), [로그인 창](../evidence/user-journey-ux-20261113/candidate-23a090e-auth.jpg). 초기 `cba9c868…` 캡처는 수정 전 비교 자료로 남기고 운영 baseline 이미지는 덮어쓰지 않았다. 이 재검증은 앞서 관찰한 지도 제공자·RPC·정책 조회 제한이 해결되었다는 의미가 아니다.

### 로컬 검토용 합성 UI 미리보기

별도 제공하는 `index.html`은 실제 변경 컴포넌트와 Tailwind CSS, 저장소 로고·Pretendard를 포함한 오프라인 검토 파일이다. 프로필·계정 설정, 북마크와 빈 상태, 로그인·회원가입, 제보 내역 오류 3종을 390px·1152px iframe으로 구성했다. 계정·식당·주소·수치는 합성 데이터이고 provider·auth·router·fetch와 보조 shell은 검토용 대체 구현이다. 실제 개인정보 처리방침 본문과 운영 API 동작을 검증하는 파일이 아니다.

정적 패키징 검사에서 JS 구문, sandbox iframe 2개, `connect-src 'none'`, CSS 외부 자산·미해결 import 각 0개, 저장 동작을 비활성화하는 코드를 확인했다. 인증·저장·삭제·업로드와 외부 요청을 실행하지 않도록 구성했으며 실제 계정 정보는 포함하지 않았다. **브라우저에서 파일을 열거나 차단 동작·레이아웃을 실측한 것은 아니다.**

파일에는 생성에 사용한 source commit·Git tree·정적 검사 결과를 담은 별도 manifest가 함께 제공된다. 전달본은 마지막 코드 게시 후 갱신하며, 이 문서 작성 시점의 `23a090e…` snapshot을 이후 정책 조회 수정까지 포함한 최종 파일로 고정하지 않는다. 이는 실제 변경 컴포넌트의 로컬 검토용 합성 산출물이며 배포·로그인·서버 동작 증빙을 대체하지 않는다.

공개 기준 화면: [baseline-home.jpg](../evidence/user-journey-ux-20261113/baseline-home.jpg). 식별 정보를 제외한 관찰 기록: [manual-baseline.json](../evidence/user-journey-ux-20261113/manual-baseline.json).

## 남은 검증 경계

실제 모바일 기기·브라우저별 확대·터치·전체 Tab 순서, 보류된 리뷰 등록/수정의 최종 서버 성공, 실제 제보 접수, 운영 제보 내역 조회의 서버 원인은 별도 확인이 필요하다. 시각 개선만으로 이 서비스 상태가 해결됐다고 보지 않는다. 변경된 코드는 기존 보호 병합 및 승인 SHA 배포 경로를 따른다.
