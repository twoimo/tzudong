# Bookmarks

A signed-in user bookmarks a restaurant from its detail panel, sees it on `/mypage/bookmarks`, and removes it there. A signed-out visitor who chooses the bookmark button gets the login dialog instead.

## Sub-features

- `bookmark-add` adds a bookmark from the detail panel and flips the button to its remove state.
- `bookmark-list` lists the bookmark on `/mypage/bookmarks`.
- `bookmark-remove-list` removes it from the list page and shows the empty state.
- `bookmark-remove-panel` removes it from the detail panel.
- `bookmark-signed-out` asks a signed-out visitor to sign in.
- `bookmark-header` shows the count in the header `북마크` menu.

## How to get to it (user POV)

- Open a restaurant detail panel and choose the bookmark button in the `패널 동작` group.
- Open the header menu `북마크` and choose `북마크 전체보기 페이지로 이동`.
- Open `/mypage/bookmarks` directly. Signed out, it redirects to `/auth/required?reason=mypage`.

## Driving it with tzv

Preconditions:

- Baseline preconditions from the index hold.
- The seeded account has no bookmark on `정원분식`.
- `public.restaurants_backup` has a row for `정원분식`. The stock synthetic seed does not, so the journey stops at its second step. See Gotchas.

- **Check the preconditions.** Run `tzv drive bookmark`. Step `precondition: no bookmark for the seeded restaurant` fails with `bookmark already present` if a bookmark exists. Step `precondition: the bookmark foreign key target exists` fails with `restaurants_backup has no row for 정원분식` on a stock seed. Report the feature as not driven, with that line.
- **Sign in.** Step `sign in as the seeded account through the login dialog` opens `/?auth=login`, fills `이메일` and `비밀번호`, and chooses `로그인`. The toast `로그인했습니다` appears.
- **Open the detail.** Step `open 정원분식 detail` opens the panel from the popular list and captures `01-detail-before`. The `패널 동작` group shows the button `북마크 추가`.
- **Add.** Step `add bookmark` chooses `button[title="북마크 추가"]`. The button's title becomes `북마크 해제`. `readback-after-add.txt` shows one `user_bookmarks` row for the account and `정원분식`.
- **List.** Step `see it on /mypage/bookmarks` opens the page and waits for the button `정원분식 북마크 삭제` under the heading `나의 북마크 내역`. It captures `03-bookmarks-list`.
- **Remove.** Step `remove it from /mypage/bookmarks` chooses `정원분식 북마크 삭제`. The text `아직 저장한 맛집이 없습니다` appears and `readback-after-remove.txt` shows zero rows. The journey leaves the bookmarks as it found them.
- **Panel removal, signed-out, and header entries.** Not in the journey yet. Panel removal chooses `button[title="북마크 해제"]`. Signed out, the button title is `로그인 후 북마크하기 (N개)` and the login dialog opens.

## Gotchas

- `user_bookmarks.restaurant_id` references `restaurants_backup.id`, and the synthetic seed writes only `public.restaurants`. On a stock seed the add returns HTTP 409 from `POST /rest/v1/user_bookmarks`, the title never flips, and Next shows `1 Issue`. On 2026-11-16 a diagnostic run that inserted a `restaurants_backup` row for `정원분식` (id, name, status `pending`) passed every step, then the row was deleted. Treat that as a check of the recipe, not as proof of the feature. The fix belongs in the seed.
- The bookmark button has no `aria-label` or `aria-pressed`. Its `title` is the only stable handle. When the count is above 0 its accessible name can become the badge number, so never locate it by name.
- There is no success toast for a bookmark. Assert the title flip and the database row.
- The add is optimistic. The title can flip before the insert lands, so the readback polls for up to 20 s.
- Removal deletes the bookmark for every merged duplicate of the restaurant. A branch that changes duplicate handling needs a seed with a merged duplicate, which the synthetic seed lacks.
