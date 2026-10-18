# Handoff v4 — new valid retained marker review fixed; continue delivery

Read v3 for exact project/runtime/rollback/evidence instructions. Latest user still asks finish3307CI → data→main → production and real URL verification. Continue without phone/ADB, force/admin merge, direct protected writes, SQL/Storage/DNS or paid capacity. Do not report original full performance goal complete.

Actual progress:
- PR3309 merged develop7b042c43b91c5abbea9faabd737e754a3b8ffa2d, tree070a79a76c1cba8c3b14060fcae9cc64af6a0994.
- PR3307 final exact-head43SUCCESS/unresolved0, normal merged data at a3af881cb475b004d6dbd3b138a9793bf0d8cc89, same tree. Receipt data-final-new-head-ci-v6.json and protected-data-merge-v1.json.
- Created data→main PR3311 https://github.com/twoimo/tzudong/pull/3311, head a3af881cb475b004d6dbd3b138a9793bf0d8cc89. All40CIpassed, but ONE valid new thread PRRT_kwDOQGRyNc6tocJs blocks. Do not resolve before fix reaches data. Read main-final-ci-v1.json. Main unchanged00234a368ee64f273fb396a3eb307ad187c7fafd; NO production/env/SQL changes.

New source fix:
Checkout /Users/twoimo/Documents/projects/tzudong-evidence-unblock, branch codex/retained-public-tier-20261018, HEAD2210f9e2d7c5800a91c798b9097fd5cf5b4b960e, tree00f9e43076e42efdd6c732a53046c54b9e0d626c. Fresh from develop7b. Source2files committed, no tracked dirty changes. Only owned packet/handoffs/pins untracked.
PR3312 https://github.com/twoimo/tzudong/pull/3312 -> develop. Current CI watcher unified session90832, log retained-source-ci-watch-v1.log. Latest snapshot retained-source-ci-v1.json; 8success,9inprogress,skip1,neutral1,unresolved0 at07:55UTC. Inspect fresh current state rather than assume.

Review defect: home history compact searchedRestaurant omits popularity_tier; outside current bounds/filter it gets retained by buildRestaurantsForSwipe, and marker uses raw missing/stale grade while shared detail uses public lookup. Fix NaverMapView: memoize publication-projected selected/search objects, use their tiers in markerKindSignature and those same objects for markerVisible*→restaurantsForSwipe. Existing raw object/history storage/IDs/names/coords/user-submission visibility/dedup semantics preserved. No network/newglobalcache. Two current memo slots only. Current empty publication O(1).

New test naver-retained-publication.test.ts extracts actual component variable bindings into VM with actual signature/swipe helpers and injected public lookup. It executes against old source too: before1pass/2fail. After related23pass/172assertions; prior assertion mistake (standard wrapper DOES have attribute; source CSS contains strings) is preserved as after-v1.log; corrected real-wrapper assertion passed after-v2. Existing history/expanded cluster16pass/77assertions. Targeted lintpass; TSparity0/3181; Next16.3.8 production .next-retained-publication-20261018-v1 and actual CSS gatepass; offline production Chromium3/3 in4.8s. Only own2tsconfig generated includes removed, tracked tsconfig clean. Details retained-publication-validation-v1.json, source.patch, delivery-source-manifest-v3.json45files. No performance/memory/field gain claim.

Source follow-up audit: other direct visual draws use canonical display/expanded lookup. Selected-only effect resolves canonical lookup and does not overwrite the retained raw projection. No broader marker helper/DB changes. Public schema2 remains empty/unpublished. Do not activate fake tiers to make live screenshots show badges.

Next protected steps:
1 finish3312 exactHEADCI/reviews, normal merge develop;
2 create new develop→data PR (3307 already merged; cannot reuse), wait relevant exactHEADCI/reviews, merge normally;
3 confirm3311head updates to new data, fix actually present, resolve only PRRT_kwDOQGRyNc6tocJs, wait NEW head CI/reviews; do not reuse old40green;
4 normal3311merge main, verify main/tree equals candidate;
5 fresh exact project/rollback/live preflight, update only TZUDONG_APPROVED_PRODUCTION_SHA production sensitive, reconcile exactSHA deployments, one Git production create, READY+alias+health+actual functional/assets readback;
6 report/seal map/pin/independent verifier/credential scan/evidence-only push+remote byte proof. See v3 for IDs/scripts. Main source candidate changed, so use new manifestv3 tree00f9, not old070a.

App attachments3311 and3312 each attempted once; stalled.3311 stopped unknown.3312 currently functions exec cell119 running attachment, outcome unknown; stop later without retry. Existing3307unknown/3309stoppedunknown. Do not remove unrelated artifacts or try app-control safety denial bypass.

Live verification scripts/prep:
- run-production-verification-v1.py FINAL_MAIN_SHA orchestrates live-v3 expected schema2, assets-v1, console-v2 then checks4WebP hashes against exact Git blobs. After receipts do NOT exist. Never overwrite.
- run-public-alias-readback-v1.mjs FINAL_MAIN_SHA verifies root/www health/redirect exactSHA; prepared, not executed.
- run-live-visual-readback-v1.mjs FINAL_MAIN_SHA captures map-only3viewportPNGs (safe public defaults, no device location/auth/body), guards existing paths. Prepared, not executed. Actually inspect resulting pixels.
- NEW run-live-history-readback-v1.mjs before|after SHA: actual Naver cluster/marker→detail→full /feed navigation→browser back→same detail+marker→close,3viewports, no query/ID/body persisted. Baseline oldlive00234 running in unified session59837. Poll it first; may need diagnose failed stage without overwriting receipt. After not executed.
- Baseline live-readback-before-v3 had core flowsall3passed, pageerror0/overflow0, console6/2/2. Known CSPnelo/eval and announcements/ad_banners401 unresolved. Unauthenticated preview API302 protected; preview-api-readback-v1.json says not evaluated, do not call API successful. Do not broaden protection for optional preview testing.

Env inspection: MCP filter_project_envs decrypt=false failed403forbidden; explicit same-scope CLI fallback succeeded listing only approvedSHA metadata (Encrypted/Production). No secret read/pull/rotation or env write. Existing CLIowner credentials exact project valid. Tool fallback docs give vercel api/v10/projects/{id}/env GET if needed, do not retrieve decrypted values. CLI56.5.0 env update flags --value --sensitive --yes verified; preserve project/team and production only.

Evidence folder now3.6MB+logs. Preflight credential scan157files/3377865bytes hits0; final new files need final scan. Frozen child23/map1356df... unchanged and reverified. Root map not sealed yet. No generated personal memory changed. OSK overview already done once; current integration capture and next-unit organization engine reject remain, not completed. MEMORY.md776–784 used, final required citation rollout01a0d4b7-9081-7901-8a57-9b8b9bc702bf.
