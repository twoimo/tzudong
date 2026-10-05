# Swift CodeQL manifest candidate — build blocked

The root manifest is discoverable and describes exactly the existing OCR CLI, but the real local package build failed. **This is a retained failing candidate, not a verified fix or a delivery recommendation.** No further build attempts were made.

Workspace: `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong`  
Branch: `codex/swift-codeql-build-20261005`  
HEAD unchanged: `e39635a89a3d7e9570ca9f67cda4906af3816004`

## Exact source changes

- `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong/Package.swift`: new 14-line Swift tools 5.5 manifest, macOS 10.15 declaration, one executable target with explicit source `backend/restaurant-crawling/scripts/03-2-visual-ocr.swift`, no external dependencies.
- `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong/.gitignore`: one root-only `/.build/` entry. Local Swift help probes created two build-cache markers; these were preserved and are now ignored.

The OCR source and `backend/restaurant-crawling/scripts/03-2-visual-location.py` remain byte-identical to HEAD. The caller still invokes `swift <existing-script> <frame>`; neither it nor the OCR executable was run.

## Primary-source support

Reviewed public `github/codeql` commit `7d04932ce03b907a4865daa2e633778f5650dc20`. [Package discovery](https://github.com/github/codeql/blob/7d04932ce03b907a4865daa2e633778f5650dc20/swift/swift-autobuilder/ProjectParser.cpp#L208-L218) records `Package.swift`; [autobuild selection](https://github.com/github/codeql/blob/7d04932ce03b907a4865daa2e633778f5650dc20/swift/swift-autobuilder/swift-autobuilder.cpp#L74-L95) accepts Swift packages without Xcode targets; [the build runner](https://github.com/github/codeql/blob/7d04932ce03b907a4865daa2e633778f5650dc20/swift/swift-autobuilder/BuildRunner.cpp#L88-L92) invokes `/usr/bin/swift build --package-path <manifest-directory>`.

The [GitHub overview](https://docs.github.com/en/code-security/reference/code-scanning/codeql/build-options-for-compiled-languages#building-swift) describes Xcode autobuild; SwiftPM autodetection is verified from implementation, not inferred from its manual-build advice. The implementation matches the user-supplied missing-project diagnostic. The hosted bundle/version was not inspected or attested.

## Observed verification

| Check | Result |
| --- | --- |
| Local runtime | macOS 26.6.2 (25G83), arm64; Apple Swift 6.4 (swiftlang-6.4.0.34.1); macOS SDK 27.0 |
| `swift package describe --type json` | Exit 0, 8.698 s; one executable product/target, exactly one OCR source, zero dependencies |
| `swift build` with owned storage and `--jobs 2` | Exit 1, 7.881 s; one attempt |
| Compiler failure | `-parse-as-library` rejected top-level statements/expressions in the existing script; the throwing global initializer was also rejected |
| Additional warning | 47 neighboring non-source files are unhandled; describe still lists only the intended Swift source |
| Compiler mode | `-swift-version 5`; actual target `arm64-apple-macos12.0`, despite manifest minimum 10.15 |
| Repository checks | `git diff --check` passed; branch/HEAD unchanged; only `.gitignore` and `Package.swift` in source status; root build markers ignored |

`verification.json` retains exact argv, cwd, the three explicit per-command temporary/cache environment overrides, exit codes, durations, package description, full compiler output, baseline/final hashes, and final readback commands. No environment dump, credentials, provider diagnostics, image content, or OCR output was captured. Build outputs remain under `/private/tmp/tzudong-swift-codeql-20261005-tqp9yxfx`; no tools were installed or global Xcode settings modified.

Local Codex metadata records `gpt-6-astra`, reasoning effort `xhigh`, provider `openai`, CLI `0.160.0`, and session `01a10886-b691-7843-a235-4932e7c8f8aa`. This is local metadata only, not server or model-execution attestation. The metadata's original cwd is the caller's `179f` worktree; the recorded command cwd is the requested candidate worktree.

## Limits and parent handoff

Public-source SwiftPM autobuild support is confirmed; package compilation is **failed**, and CodeQL extraction/analysis/upload/hosted success is **unverified**. The existing filename/script entrypoint is rejected by the installed build invocation. A separately scoped follow-up must establish a supported, buildable entrypoint and repeat the real compile check before source promotion. Do not promote this manifest as a verified remedy.

No branch switch, staging, commit, push, deployment, scanner/security/permission change, tool installation, paid-capacity change, other-task contact, phone work, or OCR processing was performed. All other languages and historical scan evidence remain outside this change. PR3117, source delivery, Nightly/TS sampling, browser state, memory, and the shared evidence freeze remain parent-owned.

After a verified fix is delivered to main, the parent must read back a **fresh** `language:swift` analysis under default `configuration46be7d0...`, tied to the delivered main SHA, with successful package build/extraction/upload and coverage of the OCR source. Recheck all five other default languages remain scanned, and retain the historical Aug24 `cc4a1bfd` scan. The original UI observations in this handoff are user-supplied, not independently rechecked here.

Evidence files: `HANDOFF.md`, `verification.json`, and `source.patch` (a review-only snapshot of the failing candidate, not applied elsewhere).
