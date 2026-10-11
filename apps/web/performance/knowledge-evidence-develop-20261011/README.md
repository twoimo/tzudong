# Knowledge evidence display on current develop

## Source and checks

- Candidate HEAD: `14ccd8775e52ab81143626515f850ee544907da9`
- Knowledge graph revision: `285ba23b0eacb4a7069205b90e772b613daeadc6f34bbc18f0ad73afb3da6150`
- Product change: current video ID, exact start–end range, and verification state in the evidence sheet; `0/null` remains `전체 영상 · 미확인`.
- Related checks: 32 passed, 0 failed, 1,495 assertions; targeted ESLint passed; TypeScript native/compatibility parity passed with 0 diagnostics.
- The first dependency-missing failures are retained separately. The clean candidate had no `node_modules`; passing checks used the pinned continuity worktree dependency tree through a temporary symlink and removed it afterward.
- The two retained Next stdout logs end with whitespace. The full staged whitespace check reports those two log warnings; the source check excludes only this directory's `.log` evidence and passes. The retained log bytes are not trimmed to turn that check green.

`reader-contract-results.json` is produced by a fail-closed direct reader probe. For a one-node page, it asserts that the selected node ID is absent from `page.nodes`; it does not assign a constant success flag. It also asserts exact equality for `videoId`, `startSeconds`, `endSeconds`, URL, and status for both bounded and whole-video evidence.

## CUA fixture

The three services used fixed loopback-only endpoints during the run:

- Visible CUA bootstrap: `http://127.0.0.1:20504/fixture-login`
- Viewer: `http://127.0.0.1:20504/admin?module=knowledge-graph`
- Current Next source: `http://127.0.0.1:20502`
- Synthetic Supabase: `http://127.0.0.1:20503`

Start command from `apps/web`:

```sh
performance/knowledge-evidence-develop-20261011/start-loopback.sh
```

The bootstrap is evidence-local HTML. Its visible `검증 화면 열기` button sets only `tzudong:e2e-admin-shell-bypass=1` in this loopback origin and then navigates to the knowledge graph admin module. It does not use the product authentication route or a cookie.

The start script refuses occupied ports, creates an owned temporary dependency symlink only when needed, uses a dist directory already present in `tsconfig.json`, writes a distinct log pair per run, and removes the symlink on shutdown. The fixture transport accepts only fixed loopback origin-form reads; it does not forward hosted requests or browser credentials. Mutation requests are rejected by the fixture gateway.

The first gateway page read timed out while Next performed its cold compile; the retained second read returned 200 with 225,760 bytes. The API reader returned 200 after the port allowlist was corrected in the evidence-local transport copy. The final runtime was stopped through the owning script's signal trap; ports 20502, 20503, and 20504 had zero listeners and the owned dependency symlink was absent afterward.

## CUA verification

`cua-results.json` records a scoped pass against the current local viewer. The final measurements were:

- Three graph snapshots at 1440, 1024, and 390 CSS pixels: 30 rendered nodes, 88 rendered edges, and document width equal to viewport width in every case.
- Six final evidence displays, bounded and whole-video at each of those widths.
- Bounded evidence: `QWtvZ6NfNJ8`, `1:21–1:24 · 미확인`, exact `https://www.youtube.com/watch?v=QWtvZ6NfNJ8&t=81s`.
- Whole-video evidence: `3Z-ngM3DVi0`, `전체 영상 · 미확인`, exact `https://www.youtube.com/watch?v=3Z-ngM3DVi0`.
- One separate 1280-pixel bounded preflight is retained and is not counted among the six final cases.
- Ten raw CUA screenshots are retained as JPEG files: three graph views, six final evidence views, and the 1280-pixel preflight. Their original bytes were JPEG, so the misleading `.png` suffix was changed to `.jpg` without re-encoding.
- Passive CDP event cursor 72–382 was complete: 0 runtime exceptions, 0 external requests, and 0 write requests. The observed requests in that window were loopback GETs.
- The console window contained 0 errors and 0 warnings within its 100-entry limit. That interface did not expose a truncation signal, so this is a bounded console claim.

Reproduce the CUA interaction with the documented UI surfaces:

1. Start the fixture script above and use `cua.createBrowserTab("iab", "http://127.0.0.1:20504/fixture-login", { visible: true })` to create a fresh visible in-app browser tab.
2. Read the current DOM, locate the visible button named `검증 화면 열기`, and activate it with the semantic UI click API. Do not set local storage through hidden evaluation.
3. On the knowledge graph page, read the DOM role state, locate the search textbox, enter the exact title, wait until the `.admin-cms-toolbar` reports `aria-busy=false`, and activate the uniquely identified graph node through the normal button/UI action.
4. Read the dialog and its link attributes to capture the visible video ID, visible range/status, and exact `href`; dismiss it through the visible close control.
5. Repeat bounded and whole-video selection at 1440, 1024, and 390 CSS-pixel viewports, and save one graph screenshot plus both evidence screenshots at each width.
6. Use a passive CDP observation window for `Runtime.exceptionThrown` and `Network.requestWillBeSent`, then read the console buffer. Count external origins and non-GET/HEAD/OPTIONS requests without injecting state.

Setup observations remain evidence rather than product claims: the previous owned tab was a connection-refused document, so a fresh tab was required; the initial accessibility click did not leave bootstrap while the semantic click did; guessed accessibility selectors did not match the live DOM; and one immediate 1024-pixel result click did not open detail. Selection succeeded after `aria-busy=false`, but the pending-state value at the ignored click was not captured and is not asserted.

This run used synthetic local auth/read fixtures. It does not verify real admin authentication, a hosted database, providers, billing, deployment, a greater-than-100-node graph, or a production deep-link flow. The event window began after initial navigation, and no latency or performance improvement is inferred from these UI cases.
