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
selection inputs plus their hash receipts. Credentials, environment files, provider
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

Validation so far: 14 transport/failure tests and 10 cadence tests pass. An archive
of protected source `5df7c3f8` with no credential files restored 5 real public terminal
outcomes from an 18-file, 109,331-byte packet. Current probes recognized 5; after a
transcript input changed, 4; after the crawl prompt also changed, 3 Shorts remained.
Those were cache probes, with no provider or hosted write. The workflow contract
comparison preserved admission, permissions, model/environment, command/limit,
schedule and serialization. The GitHub network cache roundtrip and scheduled
execution remain unverified; local results do not establish them.

Eviction or a cache miss may repeat bounded work. This is not durable shared custody,
remote YouTube-edit detection, global exactly-once delivery, a repair for partial
multi-restaurant inserts or a proof of liveness under arbitrary arrival/provider
failure rates. The separate custody work and its legacy-uncertainty holds remain.
No token, cost, accuracy or hosted-latency improvement is claimed from these checks.
