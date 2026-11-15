# Admin console access

The admin console at `/admin` opens only for a signed-in admin whose account is active. A signed-out visitor is sent to the login dialog. A signed-in non-admin or a disabled admin is sent back to `/`, and the admin APIs refuse them.

## Sub-features

- `admin-signed-out` redirects `/admin` to `/?auth=login&reason=admin&next=/admin` and returns 401 from `/api/admin/*`.
- `admin-active` renders the console navigation `관리자 통합 메뉴` and returns 200 from `/api/admin/pending-counts`.
- `admin-disabled` sends a disabled admin away from `/admin` and returns 401 or 403 from `/api/admin/*`.
- `admin-non-admin` sends a signed-in user without the admin role to `/`.

## How to get to it (user POV)

- Open `/admin` directly, or follow `/admin?module=<id>` from a bookmark.
- Sign in from the redirected login dialog and land back on `/admin`.

## Driving it with tzv

Preconditions:

- Baseline preconditions from the index hold.
- No other browser uses the seeded account's admin access on this stack, because the journey disables the account for one step.

- **Signed out.** Run `tzv drive admin-gate`. Step `signed-out visitor is sent to the login dialog` opens `/admin` in a fresh context. The URL becomes `/` with `auth=login` and `reason=admin`, and the visible `#login-email` field appears. It captures `01-signed-out`. A request to `/api/admin/pending-counts` returns 401.
- **Active admin.** Step `seeded admin signs in and reaches the console` signs in through the login dialog and opens `/admin`. The navigation `관리자 통합 메뉴` appears. It captures `02-admin-console`. The same API returns 200.
- **Arrange a disabled admin.** Step `arrange: add a backup admin so the seeded admin may be disabled` creates `verify-backup-admin@local.invalid` through the loopback GoTrue admin API, gives it the `admin` role, and sets the seeded account to `account_status = 'disabled'` with `disabled_at`. `readback-disabled.txt` shows `disabled`.
- **Disabled admin.** Step `disabled admin is turned away from the console` reloads `/admin` in the signed-in context. The URL leaves `/admin`, the admin navigation is absent, and the API returns 401 or 403. It waits for the home map, captures `03-disabled-admin`, and logs where the browser landed. On 2026-11-16 it landed on `/` and the API returned 403.
- **Restore.** Step `restore: re-enable the seeded admin and delete the backup admin` always runs. It fails unless `readback-restored.txt` shows `active` and `readback-restored-users.txt` shows one auth user.
- **Non-admin entry.** Not in the journey yet. It needs a second, privacy-eligible, non-admin user. See Gotchas.

## Gotchas

- Triggers refuse to disable or demote the last active admin. The journey adds the backup admin first for that reason.
- The seed refuses to rerun while more than one auth user exists. Always let the restore step delete the backup admin. If a run dies before it, delete `verify-backup-admin@local.invalid` with the GoTrue admin API or run `tzv down --destroy`.
- The middleware signs out any session without live privacy eligibility, and a new account has none. A fresh non-admin user must finish the onboarding prompt `현재 개인정보 처리방침과 연령 확인을 완료해주세요.` before it reaches the admin check. Otherwise the run proves the privacy gate, not the admin gate.
- On `main` at the time of writing, the page gate checks `account_status` and `requireAdmin` also checks `disabled_at`. To prove a change that unifies them, add a step that sets only `disabled_at` and expects the same rejection.
- The Playwright config enables the `x-e2e-admin-bypass` header path and the dev bypass cookie. A pass under either bypass is not evidence for the real gate. `tzv` sets neither.
- There is no Korean denial message on these redirects. Assert the URL, the absent navigation, and the API status.
