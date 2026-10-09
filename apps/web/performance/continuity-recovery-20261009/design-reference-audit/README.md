# 디자인 레퍼런스 증거 인덱스 · 2026-10-09

## 결론

지정된 로컬 범위(`docs/operations`, `apps/web/performance`)에는 사용자 제공 12개 레퍼런스를 실제 공개 화면에서 탐색한 보존 증거가 있다. 직접 증거는 `design-reference-followthrough-20261009`의 12개 URL record, 1440×900 홈 캡처 12개, 추가 컴포넌트 캡처 8개, DOM 로그와 해시 지도다.

이 증거가 곧 12개 모두의 역사적 채택을 뜻하지는 않는다. 과거 결정 문서가 명시적으로 주 기준으로 선택한 것은 Tremor의 표·차트·필터와 shadcn/ui의 메뉴·입력·대화상자다. 나머지 10개는 후속 감사에서 현재 구현과 비교하거나 제외 범위를 기록한 자료이며, 원본별 과거 선택 → 코드 변경의 인과 receipt는 현재 검색 범위에서 발견되지 않았다.

이번 인덱스 작성에서는 브라우저를 열지 않았고 새 provider 호출도 하지 않았다. 제품 소스와 기존 증거는 수정하지 않았다. 아래 `현재`는 이 worktree의 파일 내용과 보존 artifact를 뜻하며 production 배포 상태를 뜻하지 않는다.

## 주요 보고서 2개

| 보고서 | 역할 | 현재 파일 SHA-256 | 판단 |
| --- | --- | --- | --- |
| `apps/web/performance/design-reference-followthrough-20261009/README.md` | 12개 실제 접근, 캡처·DOM·컴포넌트 비교, 현재 구현 대응과 제한 | `99ccff2fefbfe55847c310c71b2076bf674cb242cc2d7bb56eb06e6c5f8e248e` | 실제 탐색의 1차 인덱스. 현재 대응 관계이며 과거 채택의 소급 증명은 아님 |
| `docs/operations/ui-and-gemini-renewal-20261003.md` | 공통 UI 변경과 Tremor/shadcn 방향 설명 | `20910b3653fd5cf49eca6437cc56dd4d810c1c8f7424c93c281e0e9c1bd669b0` | 구현·결정 보고서. 12개 각각의 탐색 receipt는 아님 |

보조 결정 기록 `docs/operations/active-goal-scope-20261003.md`의 현재 SHA-256은 `b075d5bd7574035807d656553fa2f34f814b6fad76dbd53c862b694a665579ad`다. 이 문서는 12개를 열어 비교했다는 서술과 Tremor/shadcn 선택을 보존하지만, 당시 Rare UI 미리보기 제한도 명시한다.

## 증거 체인

| 파일 | 현재 SHA-256 | 용도 |
| --- | --- | --- |
| `apps/web/performance/design-reference-followthrough-20261009/artifact-map.json` | `76d35484cbae3ee1c724f368ed4c6dfbe6c1ba38b57ae5c8ad5221bcf1ab034f` | 캡처·로그·record별 바이트 수와 SHA-256 연결 |
| `apps/web/performance/design-reference-followthrough-20261009/verification-summary.json` | `95c6b0cfb56dd34ca4e5d8f45efa40a92f9b7d58649bbbd7473ee299b2e77806` | 공개 홈 접근 12, 채택 가능 캡처 20, 제외 보존 캡처 2, 제품 소스 미수정, 인증/유료·전체 반응형·접근성 미포함 |
| `apps/web/performance/design-reference-followthrough-20261009/implementation-source-manifest.json` | `65c78829303d89beb19a098e4eea918872d4a8c12ebfe2bbd159ee9029eed92e` | 비교 시점 구현 파일 12개의 SHA-256 |
| `apps/web/performance/design-reference-followthrough-20261009/records-batch-1.json` | artifact map의 `0f932a9d170a0949e477af53c5a76a20e8d4acc7d2adad43a61d668d81b292ee` | Supahero, Dark Design, Mac App Supply, Layers의 요청 URL·실제 URL·title·홈 캡처 |
| `apps/web/performance/design-reference-followthrough-20261009/records-batch-2.json` | artifact map의 `afd14089963a30d173081680c33ba36128a646a34a1399a73329e5d50ae681a8` | Loadmore, Beautiful UI, BeUI, Rare UI의 같은 record |
| `apps/web/performance/design-reference-followthrough-20261009/records-batch-3.json` | artifact map의 `bc6fe3191689563ad6158a85f9bf90842b400e0c1fe692f006569508366a2f77` | Transitions, shadcn/ui, 21st.dev, Tremor의 같은 record |

`verification-summary.json`의 보존 시점 repository head는 `3f86d6999d4a6b00e6221510a0728358747fa997`다. 이 인덱스 작성 시점의 worktree head는 `c483542c480225af6830e10d1c29365f2b010989`이며, 아래 연결 소스의 내용 SHA는 보존 manifest와 일치한다.

## 12개 실제 탐색 증거와 채택 판단

홈 캡처는 모두 `apps/web/performance/design-reference-followthrough-20261009/screenshots/` 아래에 있다. SHA-256은 `artifact-map.json`과 현재 파일을 대조한 값이다.

| 레퍼런스 | 보존된 실제 탐색 증거 | 현재 구현 연결 | 채택 판단 |
| --- | --- | --- | --- |
| Supahero | `01-reference.png` · `4cbcd79eee2062b125abc8470cd8763cf836d8465d895f46f386c82909b48692` | `components/home/map-panel-chrome.tsx`의 지도·사진 중심 공통 chrome | 탐색됨. 브랜드·이미지 보조 비교이며 큰 hero 여백은 CMS에 채택하지 않음 |
| Dark Design | `02-reference.png` · `4a6a3bdc2d6b8c97aec9ba8b3a992c766acf1b4580ff7119f88f9fa2a1114291`; `02-software-filter.png` · `53db8d01f7f99cba78c94391ebb4c918ff26d61b24c8727bafd486b4385dc3e5` | `styles/admin-ui.css`의 대비·구분선·작은 필터 | 탐색됨. 현재 대응만 있으며 앱 전체 dark theme 채택 아님 |
| Mac App Supply | `03-reference.png` · `f9c8ce69a0a7008927b024c9f8c6acbd1fffd3489d1ba1211e9e10ffbc010e61` | `AdminOperationsPanel.tsx`의 목록·상세, desktop inspector/mobile Sheet | 탐색됨. 네이티브 앱 설치·실행이나 과거 채택 인과는 미확인 |
| Layers | `04-reference.png` · `bbc6885c8851fa5dd561a03d3060d53c87fe90d106e01c72bb6a3f4a55dcdf39` | 브랜드 탐색 보조와 기존 짧은 panel motion의 경계 비교 | 탐색됨. 영상 배경·생성·템플릿은 CMS 채택 대상에서 제외 |
| Loadmore | `05-reference.png` · `9bebdbee02db21764d6087b032d4706fd89dcfef313df16c00f41f409f92de3f` | `styles/admin-ui.css`의 wrap·44px action | 탐색됨. 작은 필터·모바일 흐름 비교이며 실기기·개별 갤러리 전수 확인 아님 |
| Beautiful UI | `06-reference.png` · `532818798f72c0cb9422f1c383b8b56409f6a5a1a87d6bd4bbef9b2ac8530516`; stable Records `768a0ab74c14e44ca7d3cbc2185a6e5a546d0a08a56af973065f4394654a75f4`; stable Diff `67aeea0c10a18ba2d4e1bb5873f88a2b4eed0abc8410729b5d8bb0694afcc742` | `AdminOperationsPanel.tsx`의 상태·정렬·표와 Preview → Confirm → Apply → Readback → Audit | 탐색됨. 현재 비교 자료이며 데모 정책·수치를 운영 정책으로 채택하지 않음 |
| BeUI | `07-reference.png` · `c5651844e52300c76943fddc9b27860a9918fb73715fee1794f191d522a494e0`; `07-sortable-list.png` · `35c0c41d19d9462839e6393d3f779028e3042bcb5d14b8b1fa2c174479823d5a` | `components/ui/dialog.tsx`, `ScrollEffects.tsx`의 focus·키보드·reduced motion | 탐색됨. 장식 animation·유료 Data Table 설치는 제외; 접근성 전수 증거 아님 |
| Rare UI | `08-reference.png` · `e5ca4bd8bcad0772c390760d02960a9eb790db5205d03052c04605a6b50b9a91`; `08-bounce-sidebar.png` · `ac3749962b275ed7c24ce3c68bb1b14c11ba3e5db34cac05a019ef1f09ba6cd2` | 관리자 sidebar 그룹·현재 항목·작업 상태 | 후속 감사에서는 공개 컴포넌트 접근 증거가 있음. 과거 보안 제한 기록은 그대로 두며 spring marker·행 재배치는 채택하지 않음 |
| Transitions | `09-reference.png` · `25f46753b8f14563f37eb22bab388a10c60adb9d8033137e9b9e57ba8d27f7ef` | `styles/product-ui.css`의 140ms/240ms와 reduced motion | 탐색됨. 짧은 panel/menu 범위 비교이며 전체 page·table animation 채택 아님 |
| shadcn/ui | `10-reference.png` · `8d561a277c03b8e905cf7eb8a09ee248666562efe33335723101d853bed1d278`; Data Table `f9f97e31a92f02dbd91ddaaffa85cd3a99068337184581cc79bee653feb8cb0d`; Sidebar `54b56fb188e07fc5e664f6efaa6c0e526aa1bccfd1ef6fdbaff3d0a5521b1348` | `components/ui/table.tsx`, `components/ui/dialog.tsx`, `AdminPageHeader.tsx`, operations UI | 실제 탐색 증거와 과거의 명시적 주 기준 선택이 모두 있음. 현재 docs Base와 pinned Radix를 같은 코드로 주장하지 않음 |
| 21st.dev | `11-reference.png` · `f3d8f853fa7db246d01033b40a5debf8b72d768908dc15eefda06614be3a9362` | 작은 action·공통 UI 재사용의 보조 비교 | 탐색됨. CMS 밀도 표준이나 shimmer/counter 데이터 상태는 채택하지 않음 |
| Tremor | `12-reference.png` · `78e003f45e7ef6319edeb4f10d71bf039a8fa3fed4a15475065026a6b2ad01d8`; Table `1a9e7a553fd66fd32971bd9153f8d2f3353dec2eb8e3ffc610ca43e035dda591` | `styles/admin-ui.css`의 table/toolbar/footer와 `AdminOperationsPanel.tsx`의 행·상세 | 실제 탐색 증거와 과거의 명시적 표·차트·필터 주 기준 선택이 모두 있음. 홈페이지 마케팅 여백은 CMS 기준 아님 |

## 현재 공통 header/CMS 소스 연결

아래는 소스 파일을 수정하지 않고 현재 내용을 SHA-256으로 다시 읽은 결과다. 모두 `implementation-source-manifest.json`과 일치한다.

| 역할 | 현재 소스 | 현재 SHA-256 | 레퍼런스 연결 |
| --- | --- | --- | --- |
| 공개 공통 map header/chrome | `apps/web/components/home/map-panel-chrome.tsx` | `d788279b7edb1a0a6f60f8305f284e70c6a71e6aef84ae51a8dd558dcb4af17c` | Supahero의 이미지·브랜드 탐색 보조와 목적상 대응 |
| 관리자 공통 page header | `apps/web/components/admin/AdminPageHeader.tsx` | `017edb22125132ee64885236c2d40a554b34364696ed58061c1d3647794a22f6` | shadcn/ui의 이름 있는 탐색·메뉴 composition과 대응 |
| 관리자 공통 module shell | `apps/web/components/admin/AdminEmbeddedModuleShell.tsx` | `3a157aec7dbfc2c7ed3ca872618f927bc117b1059e0f0bfa425a4bf82ac9e5f8` | 설명 카드보다 작업 공간을 앞세우는 공통 구조 |
| 고밀도 CMS 작업 패널 | `apps/web/components/admin/AdminOperationsPanel.tsx` | `b88367d4b6832063f9e8fa1ad1136cf746882daa7050562b7dfcd433039c205f` | Tremor table/filter, shadcn Data Table, Beautiful UI 상태·diff, Mac App Supply 목록·상세와 대응 |
| 식당 관리 CMS workspace | `apps/web/components/admin/RestaurantManagementWorkspace.tsx` | `4e02f26c7be0acdce7819e33b5ed344cea2ae759ee521972d70852ddaa6ebc7b` | 목록과 선택 항목 동시 표시의 실제 관리 화면 연결 |
| 공통 관리자 밀도·table·toolbar CSS | `apps/web/styles/admin-ui.css` | `248a28f912a3e8a806566ceaffe9a4efc65b22bc5e31b9811c24bba066e4d9df` | Tremor, Dark Design, Loadmore의 표·경계·작은 필터 대응 |

## 열린 공백

- 12개 원본 각각에 대한 과거 선택 → 구체 변경 commit/line → 검증 receipt 연결은 발견되지 않았다. 후속 감사의 유사성 매핑으로 이 공백을 닫지 않는다.
- 공개 홈과 선택 컴포넌트만 보존됐다. 모든 컴포넌트, 인증·유료 영역, tablet/mobile, 실제 사용자 성공, 전체 접근성·반응형은 미확인이다.
- Beautiful UI의 초기 Records/Diff 2개는 scroll 안정화 전 잘못된 섹션을 담아 제외 상태로 보존됐고, stable 캡처 2개만 채택 증거로 사용한다.
- 검색은 요청대로 `docs/operations`와 `apps/web/performance`에 한정했다. 이 범위 밖의 대화·외부 문서 전체에 증거가 없다고 단정하지 않는다.
- 이 인덱스는 로컬 source/artifact 연결이다. production 렌더·배포·실운영 결과를 증명하지 않는다.
