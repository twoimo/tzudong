# Restaurant edit request

A signed-in user asks for a correction to a restaurant's details or reports it closed. The request is stored as a pending submission for admin review. Users reach it from the home detail panel and from the `/global-map` restaurant dialog.

## Sub-features

- `edit-home-open` opens the three-step form `맛집 수정 요청` from the home detail panel.
- `edit-home-submit` submits a changed field and stores one pending `edit` submission with an item that targets the restaurant.
- `edit-home-closure` submits a closure report with the `폐업 제보` toggle.
- `edit-signed-out` opens the login dialog instead of the form.
- `edit-global-open` opens the edit dialog from a `/global-map` restaurant.
- `edit-global-submit` stores the same submission shape from `/global-map`.

## How to get to it (user POV)

- Open a restaurant detail panel on `/` and choose `수정 요청`.
- Open `/global-map`, open an overseas restaurant, and choose its edit request action.

## Driving it with tzv

Preconditions:

- Baseline preconditions from the index hold.
- `public.restaurants_backup` has a row for `정원분식`. The stock synthetic seed does not, so the home journey stops at its first step. See Gotchas.
- For `/global-map`, an approved restaurant outside Seoul exists. The synthetic seed has none.

- **Check the precondition.** Run `tzv drive edit-request`. Step `precondition: the submission item foreign key target exists` fails with `restaurants_backup has no row for 정원분식` on a stock seed. Report the home entry as not driven, with that line.
- **Count and sign in.** Step `record the current edit submission count` writes `readback-before.txt`. Step `sign in as the seeded account through the login dialog` signs in through `/?auth=login`.
- **Open the form.** Step `open the edit request for 정원분식` opens the detail panel and chooses `수정 요청`. A dialog with the heading `맛집 수정 요청` appears. It captures `01-edit-open`.
- **Fill the steps.** Step `change the phone number, add a video link, and reach the review step` fills `전화번호` with `02-0000-0199` and chooses `다음`. On `2 / 3` it fills the first `유튜브 링크` with `https://www.youtube.com/watch?v=verifyTzv01` and chooses `다음`. The form shows `3 / 3` and the summary `제출 전 확인`. It captures `02-edit-review`.
- **Submit.** Step `submit` chooses `수정 요청 제출`. The toast `맛집 수정 요청이 성공적으로 제출되었습니다!` appears. `readback-after.txt` shows the count one higher, from the join of `restaurant_submissions` (`submission_type = 'edit'`) and `restaurant_submission_items` (`target_restaurant_id`).
- **Global map.** Run `tzv drive edit-request-global`. Step `open /global-map` waits for the fallback text `지도 없이 글로벌 맛집 둘러보기`. Step `precondition: an overseas restaurant to open` fails on the stock seed. Report that entry point as not driven, with this reason.
- **Closure and signed-out entries.** Not in the journey yet. Closure chooses the pressed toggle `폐업 제보`. Signed out, `수정 요청` opens the login dialog.

## Gotchas

- `restaurant_submission_items.target_restaurant_id` references `restaurants_backup.id`, and the synthetic seed writes only `public.restaurants`. RPC `submit_restaurant_edit_request` maps the foreign key violation to `EDIT_SUBMISSION_INVALID`, so `POST /api/mypage/submissions/edit` returns 400 and no success toast appears. The same route serves `/global-map`. On 2026-11-16 a diagnostic run with a `restaurants_backup` row for `정원분식` passed every step, then the row was deleted. Treat that as a check of the recipe, not as proof of the feature.
- Step 2 requires a YouTube link when the restaurant has none. Without it the form stays on `2 / 3` and shows `영상 1의 유튜브 링크를 입력해주세요.`
- The home form posts to `/api/mypage/submissions/edit`. The route also requires a live privacy-eligibility receipt, which the seeded account has.
- Since #3852, `/global-map` opens the same `EditRestaurantModal` and posts to the same route, so its handles and its stored shape match the home entry. An older branch still writes `restaurant_submissions` and `restaurant_submission_items` from the browser in two calls, without the restaurant id. Assert the stored shape, not only the toast.
- `/global-map` shows the fallback list `글로벌 지도 대체 목록 검색` because `tzv web` blanks the Google Maps key.
- Each successful run adds one pending submission. `tzv down --destroy` resets the database. The journey compares counts, so reruns still pass.
- Desktop renders the form as a movable panel with `[data-desktop-map-edit-panel]`. A phone-width viewport renders a bottom sheet with the same heading.
