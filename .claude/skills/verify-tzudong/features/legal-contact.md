# Legal contact text

The public privacy page and the data-deletion page show the support address only after the page has hydrated. The server HTML contains the placeholder text and no `mailto:` link, so an edge rewriter cannot replace the address before React hydrates.

## Sub-features

- `legal-privacy-contact` renders `/privacy` with a contact control and no address in the server document.
- `legal-deletion-contact` renders `/data-deletion` with the support request control and the contact line, still without an address in the server document.

## How to get to it (user POV)

- Open `/privacy` from the public site and use 문의하기.
- Open `/data-deletion` and use 지원 요청 보내기 or the address button.

## Driving it with tzv

Preconditions:

- The checkout is the one under test.
- This journey is not in `scripts/journeys.mjs`. The local stack needs Docker, and that daemon is not available here, so `tzv up` cannot prove the browser path.

- **Server document.** From `apps/web`, run `bun test tests-unit/hydrated-contact-email.test.tsx`. The test renders both pages and expects no `@` and no `mailto:` in the server HTML, plus the hydrated contact markers.

## Gotchas

- A signed-in visitor who is not privacy-eligible is sent to `/auth/required?reason=privacy` by the session gate. That redirect is not evidence that these public pages failed to render.
- The dev admin bypass cookie is not proof for this page.
- Do not put the address back into the server component, and do not pass it as a prop. Next serializes Server Component props into the HTML document, and an edge rewrite of that address made hydration mismatch `#418` and blocked `email-decode.min.js`.
