# taste-skill 관리자 콘솔 개선

공식 `Leonxlnx/taste-skill` commit `f624f37a8c650b9cc550253104925efe4c8de246`을 설치하고, `dense-tiles / The well-kept board` 방향과 seed `331628995`를 선택했다. 사용자 요청에 따라 이후 디자인 판단에 `frontend-design`과 `redesign-skill`을 사용하지 않았다. 설치·원본 스킬 파일 해시는 증빙 디렉터리의 `skill-installation.json`에 있다.

운영자가 목록을 찾고, 근거를 확인하고, 작업 결과를 구분하는 CMS로 정리했다. 상단 제목·건수·주요 작업, 목록/상세 구획, 검색·필터, 선택·위험·보류 상태를 공통 스타일로 맞췄다. 사이드바 15개 목적지를 포함하며 파이프라인과 지식 그래프는 시각화가 주 화면이다. Pretendard와 브랜드 빨강은 유지했다. 불필요한 그라디언트·그림자·장식선과 이모지를 정리하고 의미 있는 표·폼 경계, 데이터 색상, 포커스, 보류 상태는 보존했다. 모듈 진입 효과는 160ms/4px이며 reduced motion 설정을 존중한다.

스킬 원문은 마케팅 페이지용이다. 사용자가 지정한 CMS 범위에 맞춰 이미지·히어로·애니메이션 개수를 검사 통과용으로 추가하지 않았다. 공식 source lint는 여전히 exit 1, 73 findings(57 FAIL/16 WARN)이다. 독립 검토에서 CMS에 필요한 65개 패턴과 정규식 오탐 8개로 분류했으며, 실제 지적 2개는 수정했다. 이는 스킬 검사 전체 통과나 정량적 사용성 점수가 아니다.

## 측정

| 항목 | 변경 전 → 후 | 절대 차이 | 변화율 | 표본·환경 | 95% CI |
| --- | --- | --- | --- | --- | --- |
| 공통 페이지 제목 | 16 → 18px | +2px | +12.5% | 15개 메뉴 × 1440/834/390px | 해당 없음: 결정적 기하 검사 |
| 밝은 녹색 트리맵 글자 대비 | 2.11897 → 7.71792:1 | +5.59895 | +264.23% | 배경 `#30cc5a`, 흰색 → `#17202f` | 해당 없음: 상대 휘도 계산 |
| 다크 검사기의 저대비 표본 | 12 → 0 | −12 | −100% | 같은 6개 메뉴 × 2개 폭 | 해당 없음: 검사기 표본 전수 |

변화율은 `(후−전)/전 × 100`이다. 대비는 sRGB 선형화 후 상대 휘도의 `(Lmax+0.05)/(Lmin+0.05)`로 계산했다. 저대비 표본은 전체 텍스트나 독립 고유 요소의 개수가 아니다. 초기 before 캡처에는 로딩 화면이 있어 제목·기하만 비교하며, 행 밀도·작업 시간·사용성·성능·금액 절감의 전후 주장을 하지 않는다.

## 디자인 전달본 `a6160a87`의 로컬 검증

- Canonical unit: **3,815 pass / 0 fail / 11 skip**, 466파일(일반 445 + 격리 21), 22/22 프로세스. Node24.21.0/Bun1.4.0, 실행 중 test/product/runner drift 0. 이전 실패 두 실행과 런타임·inventory 정정은 별도 영수증에 보존했다. 영향 검사와 겹치므로 수를 합산하지 않는다.
- 변경한 TS/TSX/JS/MJS의 ESLint 52파일과 후속 테스트 1파일 통과. TypeScript native7.0.2/compat6.0.2 비교는 당시 3,324 입력·진단 0이다.
- Next16.3.8 production build, route CSS boundary 통과. 앱 manifest 1,593파일의 실행 전후 drift 0, 생성 설정 복구 오류 0. 이 전달본의 build 이후 변경은 빌드 대상에서 제외된 unit 테스트 1개와 performance 전용 검사 스크립트뿐이었다. 아래 리뷰 후속의 새 제품 소스 검증과 구분한다. 이 manifest를 저장소 전체 전이 입력의 완전성으로 확대하지 않는다.
- 같은 로컬 production 번들에서 밝은 화면 45개, 실제 dark class를 확인한 화면 12개, 합성 성공 화면 9개를 확인했다. 저장한 각 화면의 주요 헤더·main은 1개, 문서 가로 넘침·브라우저 pageerror·검사기 저대비 표본은 0이다.
- 첫 밝은 실행은 32개 뒤 모바일에서 중단됐다. production CSP가 로컬 mock Supabase 주소를 차단한 것을 확인했다. 남은 13개는 합성 세션, 두 읽기 RPC의 브라우저 내 응답, 해당 브라우저 문서 응답의 고정 mock 주소 1개 허용으로 검사했다. 제품 CSP·운영 설정은 수정하지 않았다. 원래 timeout과 root error 화면을 보존했다.
- 합친 밝은 화면에는 console error 53개·request failure 232개가 있다. 차단·취소·오류 상태가 포함되므로 깨끗한 네트워크 실행, 실제 인증·CSP·업무 성공으로 해석하지 않는다. pageerror 0은 React 오류 경계가 없다는 뜻도 아니다. 최종 채택 화면에 한정한 지표다.
- 사이드바 15개 이동, 접힌 메뉴/focus, 모바일 메뉴, 파이프라인 키보드/상세, 그래프 필터/근거, 사용자·제보·리뷰 필터/상세와 스토리보드 held 상태는 별도 합성 상호작용에서 확인했다. 첫 22/25와 후속 4/4(인증 전제 포함)는 다른 실행이다. 과거 console/network 오류와 잘못된 screenshot 경로는 reconciliation sidecar에 공개했다.

## OCR 후속과 남은 운영 경계

`a6160a87` 전달 뒤 원격 리뷰를 확인하여 영수증 선택·복구와 스토리보드 작업자의 오류 처리를 추가 보강했다. 이 후속은 디자인 화면 증빙을 덮지 않고 `apps/web/performance/admin-taste-review-20261015/`에 분리했다.

- 새 영수증 선택·삭제·닫기·unmount는 진행 중인 이미지 준비를 취소하고 generation을 무효화한다. 이전 이미지의 늦은 완료가 현재 선택을 덮거나 OCR을 시작하지 못한다.
- OCR 스트림이 끊기면 기존 결과의 상태만 확인한다. `processing` 응답만 최대 4회 조회하며 간격은 최대 750ms다. 불확실한 결과·404·다른 오류·취소에서 공급자를 재호출하지 않는다. 이것은 DB 요청 총량이나 네트워크를 포함한 전체 시간 상한이 아니다.
- 스토리보드 모델 목록의 속도 제한은 첫 오류에서 continuous worker를 종료하며 자동 재시도는 0회다. 일시 공급자 실패는 catalog 호출 총 3회와 30초·60초 cooldown으로 제한하고 소진 뒤 추가 호출을 차단한다. 검증된 목록이 없으면 heartbeat·claim하지 않는다. 인증·권한·잘못된 목록·취소도 계속 실패로 처리한다. 이 상한은 catalog 메서드 호출 수이며 전체 HTTP 요청·wall-clock 상한이 아니다. 120회 poll의 메타데이터 읽기 6회는 기존 캐시의 결정적 회귀 검사이며 이 패치의 새 성능·비용 개선 수치가 아니다.
- 첫 후속의 관련 검사 11파일은 **189 pass / 0 fail / 0 skip**, 제품·테스트 입력 drift 0이었다. 당시 ESLint·parity·Next16.3.8 build·CSS 경계와 앱 manifest 1,593파일 drift 0을 보존했다. 이후 독립 감사에서 사용자 모드 전환·직접 입력 취소 및 catalog 재시도 경계를 추가 수정했으므로 이 결과를 새 소스의 최종 검증으로 재사용하지 않는다. 전체 3,815개 결과와도 합산하지 않는다.
- 최종 취소 경계는 사진 준비의 generation과 OCR 시작·복구의 generation을 분리한다. 사진만 첨부로 바꾸면 사진 준비는 유지하고 OCR lease를 무효화한다. 직접 입력 선택은 진행 중인 stream/status를 취소하며 늦은 완료의 필드·결과 ref·자동 이동을 막는다. 지연 압축·지연 상태 응답을 포함한 결합 영향 검사 **196 pass / 0 fail / 0 skip**, 13파일, source drift 0이다. 최신 parity는 입력 3,324개·진단 0이다. 최종 Next16.3.8 build·CSS 경계도 앱 manifest 1,593파일 drift 0·설정 복구 오류 0으로 통과했다. 이 최종 결과는 이전 189개와 겹치므로 합산하지 않는다.

롱폼 inventory는 예정·진행·종료 직후 stream을 근거와 함께 보존하되 분석에서 제외한다. 탭 membership은 영상 ID로 합치고 Shorts 제외와 completed stream 우선 분류를 적용한다. 집합을 영상 탭 `V`, 완료 stream `C`, Shorts `S`, 미완료 stream `A`라 하면 분석 대상은 `E=(V∪C)∖S∖A`, 영상 건수는 `|E∖C|`, 완료 stream 건수는 `|E∩C|`다. 원본 탭별 건수는 별도로 보존한다. 32MiB를 넘는 출력은 staging·교체 전에 거부한다. 프로젝트 venv Python3.14.8에서 materialize → readback → CLI consumer 건수 비교를 포함한 관련 **50/50** 검사가 통과했다. 이는 실제 YouTube 수집이나 영상 분석 실행 증거가 아니다.

GitGuardian 신규 탐지 3건(`#38246983`, `#38246985`, `#38246984`)은 소스 SHA-256 두 개와 Git 커밋 ID 한 개의 오탐으로 검증했다. 사용자가 이 세 건만 승인한 뒤 각 건을 한 번 처리했고 `Ignored / False positive`를 개별 readback했다. 원본 증거·스캐너 설정과 이전 `#38234125`는 변경하지 않았다.

전달본 `a6160a87`의 원격 CI 실패도 분리했다. Ubuntu·Windows npm은 frozen 독립 Node 측정기의 지역 변수 `module`에 Next 전용 규칙이 적용된 단일 lint 오류다. 원본 바이트를 수정하지 않고 기존 exact-file 예외 목록에 이 측정기 한 개만 추가했다. 파일은 계속 lint하며 일반 authored runner의 해당 규칙과 측정기의 다른 Next 규칙이 켜져 있음을 기존 회귀에서 확인했다. 전체 ESLint는 통과했고, 후속 assertion 수정 파일도 targeted lint를 통과했다. 최초 assertion은 설치 설정에 없는 `no-debugger`를 가정해 실패했으며 실제 켜진 규칙으로 정정한 기록을 보존했다. orchestration-readiness는 `.taste-skill` 구조 명세 누락이 원인이었고 source 분류를 추가한 뒤 실패 단계의 5개 모듈 **82/82** 및 구조 검사 누락 0·tracked directories 40을 확인했다. 이것은 다음 원격 attempt의 통과를 뜻하지 않는다.

후속 `df328697`에서 Ubuntu npm·Bun이 통과했다. 오케스트레이션은 이후 source reconciliation 재현성 검사에서 실패해, 기존 generator로 변경된 두 파일의 blob hash와 집계 hash만 갱신했다(3줄 추가/3줄 삭제). 관련 운영 소스·reconciliation 검사 **10/10**과 generator `--check`가 통과했다. 이 후속에는 앱 소스·스킬 방향·기존 증빙 변경이 없다. 증빙은 [조정 명세 재현성](../../apps/web/performance/admin-taste-ci-followup-20261016/orchestration-reconciliation-followup.json)에 분리했으며 다음 원격 head의 결과는 별도로 확인한다.

관리자 OCR은 server-only 공통 처리기를 HTTP 경계와 신뢰된 Actions worker에서 재사용한다. 기존 모델·thinking 정책을 그대로 전달하고 최대 50건 직렬 배치, 데이터 소유권/저장 readback, snapshot CAS를 검증한다. 동시 초기화는 한 요청만 성공하며 후속 행 충돌은 부분 초기화를 명시하고 dispatch하지 않는다. 대기 중인 결과의 재시도는 같은 generation을 유지한다. 요청 접수와 실행 완료를 구분하도록 안내를 수정했다.

GitHub 204는 접수 증거이며 응답의 `workflowDeliveryVerified`는 false다. 전역 concurrency는 실행 1개와 대기 1개를 유지하므로 새 요청이 기존 대기 run을 대체할 수 있다. 행은 pending으로 남아 명시적 재시도로 복구한다. durable outbox·자동 연속 배치·완료 후의 늦은 재시도와 새 작업 구분은 구현하지 않았으며 exactly-once 전달을 주장하지 않는다.

이 디자인 작업에서 hosted DB·Storage·공급자 쓰기와 실제 생성/승인/삭제는 수행하지 않았다. 보호 브랜치 승격, held/ready 배포, 새 운영 적용 관측·fence, 운영 SQL과 실제 OCR/자동 승인/스토리보드/Storage readback은 장기 목표의 미완료 항목이다. 롱폼 전체 분석과 독립 검증도 이 화면 검사로 완료되지 않는다.

증빙: [최종 검증 요약](../../apps/web/performance/admin-taste-20261015/verification-summary-final.json), [최종 화면 요약](../../apps/web/performance/admin-taste-20261015/view-summary-final.json), [전체 테스트](../../apps/web/performance/admin-taste-20261015/canonical-unit-final2.json), [production build](../../apps/web/performance/admin-taste-20261015/build-report-final.json), [스킬 검사 분류](../../apps/web/performance/admin-taste-20261015/taste-source-lint-classification.json).

리뷰 후속: [최종 결합 영향 검사](../../apps/web/performance/admin-taste-review-20261015/affected-tests-integrated-final.json), [최종 후속 build](../../apps/web/performance/admin-taste-review-20261015/build-report-review3.json), [사용자 의도 취소](../../apps/web/performance/admin-taste-review-20261015/ocr-user-intent-review2.json), [공급자 재시도 상한](../../apps/web/performance/admin-taste-review-20261015/storyboard-catalog-review2.json), [롱폼 CLI 통합](../../apps/web/performance/admin-taste-review-20261015/longform-inventory-review2.json), [린트 경계](../../apps/web/performance/admin-taste-review-20261015/ci-lint-review2.json), [구조 명세](../../apps/web/performance/admin-taste-review-20261015/ci-layout-review.json), [보안 오탐 readback](../../apps/web/performance/admin-taste-review-20261015/gitguardian-false-positive-readback.json). 첫 단계의 선택 경합·상태 복구·189개 검사·build 및 중간 실패 영수증도 같은 디렉터리에 그대로 보존했다.
