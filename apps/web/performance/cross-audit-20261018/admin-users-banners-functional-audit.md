# 사용자·배너 관리 정상 동작 소스 감사

- 기준 소스: `86328a4c52a03e953519ea8d09b2672bef7eda57`
- 기록 시각: `2026-10-18T21:43:27+09:00`
- 범위: `AdminUsersPanel.tsx`, `admin/banners/page.tsx`, 실제 sidebar module caller, 사용자·배너 API, 배너 hook, 직접 관련 기존 테스트
- 실행 경계: 소스 읽기만 수행했다. 사용자 데이터, 브라우저, 외부 서비스, 운영 DB, 배포를 조회하거나 수정하지 않았다. 이미 통과한 suite는 반복하지 않았다.

> 후속 구현: 아래 6개 항목은 같은 working tree에서 수정되었다. 수정 후 명령·원시 결과·변경 소스 hash는 `apps/web/performance/cross-audit-20261018/admin-users-banners-fix-results.txt`에 있다. 이 문서 아래의 Source integrity는 결함을 판정한 `86328a4c` 기준 원본 hash다.

> AB-02 후속 경합도 닫았다. deferred refetch는 live editor revision과 선택을 완료 시점에 다시 읽고, 대기 중 편집은 보존한다. 새 목록에서 외부 변경·삭제가 확인되면 명시적 재열기 또는 상세 닫기 전까지 저장·삭제가 차단된다. 사용자 filter/sort/search/reset/page도 모두 기존 dirty intent 확인을 거친다.

기본 `newest` page 순서는 Supabase Auth GoTrue `admin.go`의 `created_at DESC` 동작을 전제로 연결했다. 이는 유지되는 upstream 소스 근거이며, 현재 운영 Auth API의 실제 배포 버전을 별도로 readback했다는 주장은 아니다. 이름·최근 로그인·상태 filter는 앱의 명시적 bounded scan과 partial 표시 계약을 사용한다.

## 판정 요약

검색·정렬·빈 상태의 기본 분기는 두 화면 모두 명확하다. 사용자 검색은 submit 시 서버 검색으로 전환되고, 목록 내 상태 필터와 정렬은 결정적이다. 배너 검색·상태·노출 위치·정렬은 현재 API가 반환한 전체 payload에 적용되며, 로딩·오류·필터 없음·진짜 빈 목록을 구분한다. 배너 API에는 현재 pagination/limit가 없으므로 배너 화면 자체의 누락 page는 확인되지 않았다.

권한 경계도 소스상 닫혀 있다. `/admin`과 `/api/admin/**`는 middleware에서 live session, admin role, active account를 확인한다. 사용자 GET/PATCH와 배너 GET은 handler에서도 `requireAdmin`을 호출하며, 사용자 PATCH는 same-origin mutation을 추가로 확인한다. 브라우저에서 수행하는 배너 table/Storage mutation은 active-admin RLS와 caller-owned Storage path 정책을 거친다. 로컬 소스 증거이며 hosted catalog readback을 새로 수행했다는 뜻은 아니다.

판정 당시 아래 결함은 수정이 필요했고, 후속 구현에서 각 제안 범위를 적용했다.

## AU-01 · 사용자 목록 120명 이후에 접근할 수 없음 · CONDITIONAL

적용 조건은 전체 auth 사용자 수가 120명을 초과하는 경우다. 패널은 항상 `perPage=120`만 요청하고 `page` state나 이동 제어를 갖지 않는다. API 응답의 `page`, `perPage`, `total`을 타입에는 선언하지만 상태에 보존하지 않는다. 상태 필터와 정렬도 이 첫 page에만 적용된다. footer의 “불러온 최대 120명 기준”은 제한을 알리지만 뒤 page 사용자를 선택·관리하는 경로를 제공하지 않는다.

서버 검색은 별도 경로로 최대 `5 × 200 = 1,000`명을 스캔한 뒤 결과 수를 `total`로 반환한다. 1,000명을 넘는 배치가 존재하면 이후 일치 항목이 누락되어도 응답에서 잘림을 구분할 수 없다. 현재 실제 사용자 수는 조회하지 않았으므로 적용 여부는 미확인이다.

근거:

- `apps/web/components/admin/AdminUsersPanel.tsx:353-354, 374-399, 788-790`
- `apps/web/app/api/admin/users/route.ts:115-116, 131-138, 155-165`

제안 수정 범위:

- `apps/web/components/admin/AdminUsersPanel.tsx`: `page/perPage/total` 상태, 이전·다음 page, 검색 변경 시 page reset, 선택·dirty intent 보존
- `apps/web/app/api/admin/users/route.ts`: 검색 결과가 완전하지 않으면 `truncated/hasMore`를 명시하거나 continuation 기반 검색으로 변경
- `apps/web/tests-unit/admin-user-management-source.test.ts`와 새 동작 fixture: `total=121`에서 두 번째 page 사용자 접근, page 전환 중 dirty profile 보호, 검색 잘림 표시

## AU-02 · exact readback 성공 후 목록 실패 시 상세가 예전 값으로 남음 · ACCEPT

변경 후 `loadUsers()`는 먼저 exact `user_id` readback을 수행한다. 기대값과 일치하면 즉시 pending lock을 해제하고 성공 결과를 기록한다. 이어지는 일반 목록 fetch가 실패하면 catch는 exact 사용자를 반환하지만 `setUsers`를 호출하지 않는다. 따라서 mutation 호출자는 성공으로 판정하고 “상태를 다시 확인했습니다”를 표시하는 반면, 화면의 `selectedUser`와 form은 이전 목록 값을 계속 보여 줄 수 있다.

근거:

- `apps/web/components/admin/AdminUsersPanel.tsx:337-399, 469-482`
- 기존 `apps/web/tests-unit/admin-users-mutation-scope.test.ts`는 exact 성공과 stale generation을 검사하지만, exact 성공 뒤 일반 목록 실패의 화면 state를 검사하지 않는다.

제안 수정 범위:

- `apps/web/components/admin/AdminUsersPanel.tsx`: authoritative exact row가 확인되면 현재 목록의 동일 ID를 generation-safe하게 교체한다. 일반 목록 실패 시에도 상세와 form이 확인된 상태를 반영하도록 한다.
- `apps/web/tests-unit/admin-users-mutation-scope.test.ts`: exact readback 성공 → 일반 list 실패 → pending 해제, error 표시, 동일 ID row와 상세가 새 값인 회귀 사례를 추가한다.

## AU-03 · 성공 응답의 audit receipt를 UI가 읽지 못함 · ACCEPT

패널의 `AdminUserMutationResponse`와 `getMutationAuditText`는 top-level `auditId`, `preflightAuditId`, `step`을 읽는다. 실제 PATCH 성공 응답은 `auditIds` 배열과 `audit: { readbackId, correlationId, auditIds }`를 반환한다. 따라서 성공 mutation의 감사 식별자는 생성되어도 사용자 상세 결과 문구에 항상 누락된다. 현재 source assertion은 UI가 기대하는 오래된 필드 문자열만 확인하여 API 응답과의 결속을 증명하지 못한다.

근거:

- `apps/web/components/admin/AdminUsersPanel.tsx:65-70, 147-155, 462-480`
- `apps/web/app/api/admin/users/[userId]/route.ts:430-445`
- `apps/web/lib/admin/audit-contract.ts:28-38, 66-83`

제안 수정 범위:

- `apps/web/components/admin/AdminUsersPanel.tsx`: `MutationAuditReceipt`와 일치하는 nested `audit` 응답을 파싱하고 `readbackId/correlationId`를 표시한다.
- `apps/web/tests-unit/admin-users-mutation-scope.test.ts`: 실제 route 성공 payload shape를 fixture로 전달해 감사 ID가 결과 문구에 포함되는지 검사한다.

## AB-01 · 잘못된 배너 행이 오류 없이 목록에서 사라짐 · CONDITIONAL

관리자 query는 API의 `banners` 배열을 `flatMap`으로 순회하고 `mapAdBannerRow`가 실패한 행만 조용히 버린다. 한 행만 schema/URL 계약에서 벗어나도 query는 성공 상태를 유지하고, 관리자는 부분 목록 또는 “등록된 배너가 없습니다” 빈 상태를 보게 된다. 관리자 관리 화면에서는 손상 행이 바로 수정 대상이므로 public fallback처럼 숨기면 안 된다.

근거:

- `apps/web/hooks/use-ad-banners.tsx:71-121, 160-184`
- `apps/web/app/admin/banners/page.tsx:801-815`

제안 수정 범위:

- `apps/web/hooks/use-ad-banners.tsx`: admin query는 `mapAdBannerRows`/`requireAdBannerRow`로 전부 검증해 한 행이라도 잘못되면 query error로 전환한다. public active-banner fallback은 그대로 둔다.
- 직접 관련 parser test: 정상 다중 행, 한 행 URL/schema 오류, 완전 빈 배열을 분리한다.

## AB-02 · 일반 새로고침이 열린 상세를 최신 목록과 맞추지 않음 · ACCEPT

`refreshBannerList()`는 pending readback이 없으면 refetch 결과를 사용하지 않고 반환한다. React Query 목록은 새 데이터로 갱신되지만 `editingBanner`, `formData`, `initialForm`은 선택 당시 객체를 유지한다. 편집하지 않은 상세도 서버에서 수정·삭제된 배너를 예전 값으로 보여 주고, 이후 저장하면 새 목록 상태를 오래된 form으로 덮을 수 있다.

근거:

- `apps/web/app/admin/banners/page.tsx:295-319, 645-660, 775-777`

제안 수정 범위:

- `apps/web/app/admin/banners/page.tsx`: 정상 refetch 후 editor가 clean이면 동일 ID 최신 행으로 rebase하고, 행이 사라졌으면 editor를 닫는다. dirty editor는 입력을 보존하고 최신 목록과 달라졌음을 경고한다.
- 직접 관련 component/helper test: clean selected update, selected delete, dirty selected refresh 세 경우를 추가한다.

## AB-03 · 관리자 배너 GET에 명시적 no-store 응답이 없음 · CONTRACT GAP

클라이언트 요청은 `cache: "no-store"`지만 handler의 성공·실패 응답에는 `Cache-Control: no-store`가 없다. 응답에는 비활성 배너와 `created_by`가 포함된다. middleware와 `requireAdmin` 때문에 현재 권한 우회는 확인되지 않았지만, 인증된 운영 응답의 캐시 계약은 사용자 API와 다른 관리자 API보다 약하다.

근거:

- `apps/web/hooks/use-ad-banners.tsx:165-180`
- `apps/web/app/api/admin/banners/route.ts:24-42`
- 비교: `apps/web/app/api/admin/users/route.ts:101-107, 167-180`

제안 수정 범위:

- `apps/web/app/api/admin/banners/route.ts`: auth 실패를 포함한 모든 응답에 `Cache-Control: private, no-store, max-age=0` 또는 프로젝트 표준 no-store 값을 적용한다.
- 실제 handler test: 401/403/200/500 응답 header와 `requireAdmin` 이전 service-role 미생성을 검사한다.

## 수정 후 표적 검증 명령

아래는 기존 suite 전체를 반복하지 않고 해당 범위만 검증하기 위한 명령이다. 이번 읽기 전용 감사에서는 실행하지 않았다.

```bash
cd apps/web
bun test tests-unit/admin-user-management-source.test.ts tests-unit/admin-users-mutation-scope.test.ts tests-unit/admin-exact-readback-api.test.ts
bun test tests-unit/admin-route-auth-contract.test.ts --test-name-pattern 'admin'
bun test tests-unit/mobile-desktop-parity-source.test.ts --test-name-pattern 'banner admin'
bun test tests-unit/ad-banner-url-security.test.ts
bunx eslint components/admin/AdminUsersPanel.tsx app/admin/banners/page.tsx hooks/use-ad-banners.tsx app/api/admin/users/route.ts 'app/api/admin/users/[userId]/route.ts' app/api/admin/banners/route.ts
```

수정 우선순위는 `AU-02 → AU-01 → AB-01 → AB-02 → AU-03 → AB-03`이다. AU-02는 성공 표시와 실제 상세가 충돌하고, AU-01은 적용 조건에서 관리 대상 자체가 사라진다. 나머지는 데이터 손상·동시 수정·감사 가시성·캐시 계약 조건에서 드러난다.

## 최종 CAS 감사 보완

`admin-users-banners-final-diff-findings.json`의 `CMS-FINAL-001`~`004`는 모두 실제 제어 흐름에서 성립했다. 배너 수정·삭제는 이제 화면이 관측한 `updated_at`을 API의 CAS 조건으로 전달한다. CAS 실패는 `banner_revision_conflict`와 최신 행을 반환하며, 삭제 성공은 서버가 실제 삭제한 행을 반환한다. Storage 정리는 그 삭제 행의 미디어만 대상으로 한다.

배너 저장 readback의 다른 최신 행과 삭제 readback의 잔존 행은 최신 상태를 열고 pending lock을 해제한다. 행 부재도 명시적으로 상세를 닫는다. 사용자 exact readback이 기대 상태와 다르면 최신 행을 별도 conflict로 보존하고, `최신 상태 수용`으로 추가 PATCH 없이 잠금을 해제한다. 모바일 사용자 상세·pagination은 44px 높이를 사용하고, 390px 헤더는 제목·새로고침과 3개 metric을 두 행으로 배치한다.

판정과 합성 반례 결과는 `admin-users-banners-final-resolution.json`, 명령 원문 요약은 `admin-users-banners-fix-results.txt`에 있다. 로컬 baseline에는 `updated_at` 자동 증가 함수와 trigger가 존재하지만 hosted trigger 상태는 이번 작업에서 확인하지 않았다. 실제 DB·Storage·브라우저·배포·Git mutation은 수행하지 않았다.

## Source integrity

```text
776f4c78f5bca322c52735fc5c09dd6a842f200e786101312f8e29624ce5bc66  apps/web/components/admin/AdminUsersPanel.tsx
19ca267845183b104eda2676bdd1f05419d73df8b643f799b35dca14079f81c5  apps/web/app/admin/banners/page.tsx
a060f3bb654de2dba51905920dc67da15bbe518f3ac77538d816f37225ccfde5  apps/web/hooks/use-ad-banners.tsx
f8dcebe1fac30b1d9906788712f6cb0117197a63d5b37a1751eed23dc231749b  apps/web/app/api/admin/users/route.ts
946e43b0769be3391ce7caf0cf0b4b0b05baf64204de3a812684b385c6fa16db  apps/web/app/api/admin/users/[userId]/route.ts
2f5c7ed49e3b38a489e271131f06b13e39864a4d08b179ac64c75d379ec164b1  apps/web/app/api/admin/banners/route.ts
35bfe60a0284d51ad78bb0c1ad8b1c86c86dbe13e0b1be51ff102d244965bc9c  apps/web/components/admin/AdminConsoleOverview.tsx
2450318287fc8f730e4b65e387b8d3e72254aaf2d5462060892ff6f31942ea9a  apps/web/lib/supabase/middleware.ts
```
