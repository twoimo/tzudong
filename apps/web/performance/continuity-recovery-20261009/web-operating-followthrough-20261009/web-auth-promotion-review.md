## READY

소스 수준에서는 Preview OAuth callback origin 처리와 release 검증 계약이 비교적 엄격하게 구성돼 있습니다.

- Preview에서는 VERCEL\_ENV === 'preview'일 때만 VERCEL\_URL·VERCEL\_BRANCH\_URL을 신뢰 후보로 사용하며, hostname이 정상적인 \*.vercel.app이고 포트·경로·query·userinfo가 없는 HTTPS origin만 인정합니다. 임의 request origin은 허용 목록과 정확히 일치할 때만 유지되고, 아니면 서버가 제공한 Preview origin으로 수렴합니다. apps/web/lib/auth/callback-origin.ts:14-29,51-69
- Google OAuth 시작점은 현재 브라우저 origin 기준으로 /auth/callback을 생성합니다. 관리자 경로일 때만 ?next=<safeRedirectTo>가 붙습니다. apps/web/components/auth/AuthModal.tsx:361-397
- 테스트는 deployment alias와 branch alias 보존, 임의 Vercel host·port·userinfo·path·query 공격 거부를 명시적으로 다룹니다. apps/web/tests-unit/auth-callback-origin.test.ts:10-82
- release workflow 자체는 protected main, 정확한 SHA, main/develop/data 동일 tree, deployment/receipt/auth evidence, 최종 live health까지 요구하도록 작성돼 있습니다. .github/workflows/ts7-release-evidence.yml:17-19,111-156, apps/web/scripts/verify-final-release-evidence.mjs:194-197,434-458,641-649

## HELD

현재 자료만으로 **Preview OAuth 실동작**과 **production/protected-main promotion 완료**를 승인할 수 없습니다.

소스에서 도출 가능한 redirect 형태는 정확히 다음입니다.

```
https://<VERCEL_URL>/auth/callback
https://<VERCEL_BRANCH_URL>/auth/callback
https://<VERCEL_URL>/auth/callback?next=<encoded-safeRedirectTo>
https://<VERCEL_BRANCH_URL>/auth/callback?next=<encoded-safeRedirectTo>
```

Production에서 브라우저가 실제 해당 origin에서 로그인 UI를 실행한다면 소스상 생성 가능한 형태는:

```
https://www.tzudong.app/auth/callback
https://tzudong.app/auth/callback
```

및 관리자 로그인 시 각각 ?next=... 변형입니다. 다만 bare domain이 로그인 UI까지 직접 제공되는지, canonical redirect가 먼저 발생하는지는 이 frozen source만으로 확정할 수 없습니다.

현재 **구체값이 없는 항목**은 실제 VERCEL\_URL, 실제 VERCEL\_BRANCH\_URL, Supabase/provider Redirect URL allowlist 내용, 현재 protected main SHA/tree, develop·data tree, 현재 production deployment ID/immutable host, rollback SHA, Vercel live URL/SHA readback, release/auth/deployment receipts 전부입니다. 테스트 fixture의 tzudong-fi9s0ycyh-twoimos-projects.vercel.app 등은 현재 배포 주소 증거가 아닙니다. apps/web/tests-unit/auth-callback-origin.test.ts:15-29

## 심각도 순 Findings

**S1 — Release blocker: exact Preview Redirect URL을 현재값으로 확정할 수 없음.**  
OAuth 클라이언트가 window.location.origin + /auth/callback을 provider에 전달하므로 실제 Preview host가 정확히 allowlist돼야 합니다. 현재 host와 provider/Supabase allowlist readback이 없습니다. apps/web/components/auth/AuthModal.tsx:364-371,389-397

**S1 — protected-main promotion 완료 증거가 전혀 없음.**  
정책은 develop -> data -> main, 현재 production에서 얻은 rollback SHA, 배포 후 Vercel deployment SHA/live URL readback을 요구합니다. frozen source는 “그렇게 검증해야 한다”는 계약만 제공하며 실행 receipt는 없습니다. docs/agents/release.md:5,9-13

**S1 — final release verifier가 요구하는 핵심 tuple/receipt를 supplied evidence가 충족하지 않음.**  
Verifier는 protected main의 정확한 SHA/tree, 세 branch의 동일 tree, Preview/Production/Known-good deployment IDs, production aliases, auth receipts와 freshness를 요구합니다. apps/web/scripts/verify-final-release-evidence.mjs:419-458,496-503

**S2 — Production NEXT\_PUBLIC\_SITE\_URL 검증이 Preview보다 약함.**  
주석은 “public HTTPS origin, no path/query/fragment”를 요구하지만 실제 코드는 new URL(configuredSiteUrl).origin만 사용합니다. 따라서 syntactically valid한 http://, custom port, path/query가 포함된 값도 origin으로 정규화되어 채택될 수 있습니다. 이 구성 drift는 fail-closed 계약과 불일치합니다. apps/web/.env.example:15-16, apps/web/lib/auth/callback-origin.ts:71-77

**S3 — Preview 신뢰 host가 모두 잘못되면 production origin으로 fallback됨.**  
보안상 임의 request host를 신뢰하지 않는 점은 좋지만, Preview OAuth 진단 시 잘못된 Vercel env가 production redirect로 보일 수 있어 실패 원인을 가릴 수 있습니다. apps/web/lib/auth/callback-origin.ts:64-77

## Source vs external evidence

| 항목 | Frozen source | 외부 증거 |
| --- | --- | --- |
| Callback 생성 규칙 | READY | 불필요 |
| Preview host 검증 로직 | READY | 불필요 |
| 실제 Preview hostname | 없음 | **필수** |
| Provider/Supabase allowlist | 없음 | **필수** |
| Protected main 여부/current SHA | workflow 요구만 존재 | **필수** |
| develop/data/main 동일 tree | verifier 요구만 존재 | **필수** |
| Production deployment/SHA/aliases | schema·검증 코드만 존재 | **필수** |
| rollback SHA | 정책 요구만 존재 | **필수** |
| 실제 OAuth 성공 | 없음 | **필수** |
| final release/live-health receipt | 없음 | **필수** |

## 최소 fail-closed 종료 순서

1. 대상 SHA의 실제 VERCEL\_URL과 VERCEL\_BRANCH\_URL을 읽어 두 Preview callback URL을 정확히 고정한다.
2. Supabase/provider allowlist에서 그 URL들과 필요한 production callback URL을 readback한다.
3. Preview OAuth를 실행해 해당 host의 /auth/callback 도착과 성공 세션을 독립 receipt로 남긴다.
4. develop -> data -> main 보호 PR 순서와 세 branch tree 동일성을 확인하고, 현재 production deployment에서 rollback SHA를 확정한다.
5. production 배포 후 deployment ID·immutable host·tzudong.app/www.tzudong.app alias·Git SHA를 readback한다.
6. release-evidence workflow가 Verify → Health → Publish까지 성공하고 fresh final receipt를 낸 경우에만 production promotion을 READY로 전환한다.

현재 결론은 **소스 계약은 부분 READY, Preview OAuth 운영 설정과 production/protected-main promotion은 HELD**입니다.