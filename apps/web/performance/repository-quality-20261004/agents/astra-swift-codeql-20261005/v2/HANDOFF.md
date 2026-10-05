# Swift CodeQL source fix — v2 local build passed

The relative `main.swift` symlink fixes the observed SwiftPM entrypoint failure. Package description and a fresh real compile/link both passed. This verifies local source buildability; hosted CodeQL extraction, source attribution, and scanning remain unverified.

Workspace: `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong`  
Branch: `codex/swift-codeql-build-20261005`  
HEAD unchanged: `e39635a89a3d7e9570ca9f67cda4906af3816004`

## Source delivery set

- `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong/Package.swift`: root tools-5.5 package, one executable target, explicit `sources: ["main.swift"]`, no external dependencies or unsafe compiler flags.
- `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong/backend/restaurant-crawling/scripts/main.swift`: new relative symlink to `03-2-visual-ocr.swift`. `os.path.lexists` was false before creation; resolved path and bytes equal the original. The source patch records Git mode **120000**. Preserve that symlink mode when staging/delivering; no duplicate implementation is needed.
- `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong/.gitignore`: existing v1 addition `/.build/`, unchanged in v2.

All changes remain unstaged/uncommitted. The parent owns protected source delivery and PR3117. No original OCR or Python caller logic changed.

## Verification

| Evidence | Observed result |
| --- | --- |
| Installed runtime | macOS 26.6.2, arm64; Apple Swift 6.4 (swiftlang-6.4.0.34.1); macOS SDK 27.0 |
| `swift package describe --type json` | Exit 0 in 3.297 s; one executable product/target, source list exactly `main.swift`, zero dependencies |
| Fresh `swift build` | Exit 0 in 10.301 s; one v2 attempt, two jobs, owned build/cache directories |
| Actual compiler/link inputs | `TzudongVisualOCR.SwiftFileList` contains only the alias; `TzudongVisualOCR.LinkFileList` contains only `main.o` |
| Binary inspection | arm64 Mach-O executable with `_main`; direct Foundation, Vision and ImageIO links; unchanged CoreGraphics import compiled successfully |
| Alias identity | Relative link text exactly `03-2-visual-ocr.swift`; resolved bytes equal original and HEAD |
| Repository checks | Only the three delivery paths changed; original branch/HEAD retained; no whitespace diagnostics; source paths are not ignored |
| Outputs | Root `.build` markers remain ignored; v2 artifacts live under `/private/tmp/tzudong-swift-codeql-v2-20261005-6iaffasj` |

SwiftPM reports 48 unhandled neighboring files, including the original filename. They are not additional compilation inputs: the actual file list selects only the alias to the complete OCR implementation. The warning was retained, with no scanner exclusions or dummy code added. The resulting binary and Python caller were never executed; no images were processed.

The [SwiftPM executable-target documentation](https://docs.swift.org/package-manager/PackageDescription/PackageDescription.html#target) specifies a `main.swift` or `@main` entrypoint. Actual symlink compatibility is proven by this build. The v1 evidence already pins CodeQL's Swift-package discovery and `/usr/bin/swift build --package-path` behavior; it is reused without changing scanner configuration.

## Hashes and receipts

- Original OCR and resolved alias SHA-256: `c262b6e1df6ec5bd9f0184aa5aa2bc57e670579252be6d6cabd5425c5d86668e`.
- Unchanged Python caller SHA-256: `cb0c789756948c20eadee9beb20bdc948c40cb9bf7440cd63fd628345182077b`.
- All three v1 files (`../HANDOFF.md`, `../verification.json`, `../source.patch`) remain byte-identical; their hashes are retained in v2 JSON. The v1 build failure remains a historical receipt.
- `verification.json` records exact command argv, cwd, explicit temporary/cache overrides, exit codes, complete outputs, source/object/binary hashes, Git-mode evidence, and the bounded inspection corrections. `source.patch` contains the complete three-path candidate with the real symlink.

Local session metadata still reports `gpt-6-astra`, `xhigh`, provider `openai`, CLI `0.160.0`. These are local records, not server attestation; no model/settings changes were performed.

## Required hosted readback

After the parent delivers the verified three-path source set to main, confirm a fresh default `language:swift` analysis under `configuration46be7d0...` at the delivered main SHA. Verify package discovery, successful compilation/extraction/analysis/upload, and coverage of the original OCR logic through the alias, inspecting reported source attribution. Confirm the other five default languages remain scanned and preserve the historical Aug24 `cc4a1bfd` scan. Those prior UI facts were supplied by the user and were not independently revisited here.

No commit, push, deployment, other-task contact, scanner/security/permission change, global Xcode change, tool installation, paid-capacity change, phone work, or OCR execution occurred. Parent-owned delivery, Nightly/TS sampling, browser state, memory, and shared evidence freeze remain outside this work.
