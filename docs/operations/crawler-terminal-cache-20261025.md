# Scheduled terminal-input cache

Fresh GitHub Actions checkouts otherwise lose explicit Shorts and absent-restaurant
outcomes. They can repeatedly select the newest excluded videos before reaching
older eligible videos. Mac keeps its local files; this change adds a small optional
transport for the hosted runner's public terminal inputs.

The alternative is a shared database completion ledger. That would introduce a new
authoritative skip decision and require a separate migration/ownership contract.
This cache deliberately leaves admission with the existing evaluator: import bytes,
then check current source recipes, input content, producer receipts and outputs.
A cache hit is not a completion or authorization receipt.

Only current explicit `no_restaurants`, `all_names_null` and Shorts outcomes are
exported. The allowlist contains per-video public metadata/transcript/crawl and
selection inputs plus their hash receipts. A video with a visual-location input is
excluded as a whole: that source may contain raw OCR, and dropping just that file
would not preserve the input set bound by the existing receipts. Crawl and selection
can retain visual copies after that source is removed, so every JSONL record and
nested object is also checked for nonempty `visual`, `texts`, `raw_ocr` and `ocr_text`
fields. A tainted video is excluded; duplicate JSON keys fail closed. Shorts carry
only metadata and their exclusion marker. The shared backend privacy boundary also
checks every primitive and normalized field name for supported contact/credential
patterns, including email and phone text in public descriptions/captions. Any match
or string longer than 4,096 characters excludes the whole video; no authenticated
input is redacted into a different input. Import enforces the same content and
Shorts limits before writing any packet file. Credentials, environment files, provider
logs, OCR/user submissions, media, pending-write payloads and delivery receipts are
excluded. GitHub documents that fork pull requests may read default-branch caches;
this packet must therefore remain public-source material. See the
[official cache reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

Restore/save run only inside the existing trusted protected-default-branch job.
Permissions, schedule, concurrency lane, model settings, freeze and the pipeline's
three-video limit remain unchanged. The reviewed official cache action is pinned
to v6.1.0 commit `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`; its two actions use
Node 24. A run/attempt-specific immutable key and one prefix allow later runs to
find the latest packet. Cache failures are optional; they do not suppress the
ordinary evaluator or create a new hosted write retry.

Packets are bounded to 200 videos, 1,600 files, 2 MiB per file and 16 MiB of encoded
JSON. Content hashes, exact paths, duplicate names, symlinks and conflicts with local
files are checked before restore writes. Existing evidence is never overwritten.
Hashes detect content corruption; they do not authenticate a malicious cache writer.
The protected cache scope supplies that trust boundary. Packet-size accounting is
linear in encoded content, rather than repeatedly serializing the growing packet.
The existing evaluator's discovery/probe costs remain separate from these bounds.

Validation so far: 29 transport/failure tests and 26 local freshness tests pass.
OCR path, historical-copy and stale-Shorts regressions failed against earlier
candidates and pass with whole-video exclusion, minimal Shorts files and restore
rejection. Public-description contact, historical/nested transcript contact,
normalized sensitive-key and restore-before-write regressions also pass.
An archive of protected source `5df7c3f8` with no credential files restored 2 of the
5 actual terminal outcomes (one Short and one explicit no-restaurant video) from an
8-file, 94,544-byte packet. Three videos were excluded by the privacy boundary;
their content/matches were not retained in evidence. Changing the accepted transcript
left only the Short reusable. Restoring that transcript then independently changing
the crawl prompt also left only the Short. The older 5-outcome experiment predates
the contact-data guard and is not the admitted packet or a current privacy proof.
Those were cache probes, with no provider or hosted write. The workflow contract
comparison preserved admission, permissions, model/environment, command/limit,
schedule and serialization. The GitHub network cache roundtrip and scheduled
execution remain unverified; local results do not establish them.

Eviction, bounds, privacy exclusions or a cache miss may repeat bounded work. This
cache does not establish progress past a full batch of excluded videos; durable
terminal custody remains a separate dependency. This is not durable shared custody,
remote YouTube-edit detection, global exactly-once delivery, a repair for partial
multi-restaurant inserts or a proof of liveness under arbitrary arrival/provider
failure rates. The separate custody work and its legacy-uncertainty holds remain.
No token, cost, accuracy or hosted-latency improvement is claimed from these checks.
