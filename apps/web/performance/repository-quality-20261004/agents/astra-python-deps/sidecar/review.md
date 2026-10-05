# Python dependency sidecar review — 2026-10-04

Scope: read-only source/test review of `/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong`. Initial HEAD was `4295fd54411ac8a4c304dce89efbb6f96e90935c`; initial `git status --short` was empty. Read current `AGENTS.md`, `docs/agents/verification.md`, privacy guidance and relevant data-contract entries. No installs, test execution, source/manifest edits, network requests, DB/crawler operations, Git writes or remote mutations were performed. This file is the only sidecar artifact. PR snapshot/version/resolver/audit decisions remain with the source owner.

## Owner update received after initial review

- Owner reports Scrapling 0.4.15 requires Playwright >=1.62.0; candidate playwright==1.62.0 installs and pip check passes. This is owner-supplied resolver evidence, not a sidecar execution.
- Owner reports actual baseline transcript import fails on undeclared tqdm. Both task-local environments now contain official tqdm==4.70.1 to expose subsequent behavior; a direct requirement is a source-grounded adjustment because the script imports tqdm at line 27.
- Owner baseline: control 21 pass; crawler 24 pass plus transcript import failure; pipeline 54 run with 3 pre-existing process-cleanup failures and 3 skips (2 Windows, reconciliation absent). Owner is diagnosing those failures, writing real-SDK contracts and running audit/integration. No duplication by sidecar. Treat unchanged baseline process failures separately from a dependency regression.

## Findings grounded in current source

| Upgrade surface | Actual caller / risk | Required offline evidence |
| --- | --- | --- |
| langgraph 1.2.1 → 1.2.12; pydantic 2.13.4 → 2.13.5 | No direct imports of either SDK in `backend/pipeline/*.py`. `state.py:76` uses stdlib TypedDict, dataclasses and Annotated reducers; the LangGraph description does not establish a graph implementation. Actual LangGraph graphs found in thumbnail/storyboard components have separate manifests outside this integration. | Real package import/version check plus existing pipeline validators/data contracts. A synthetic StateGraph reducer/checkpoint test can be supplemental only; it cannot establish production graph coverage. Do not expand unrelated component requirements. |
| langchain-core 1.6.0 → 1.6.5; Pydantic transitive behavior | Crawler `03-1-generate-transcript-context.py:30,162,278,367,443`: load_prompt, ChatOpenAI/ChatOllama construction, prompt → LLM → StrOutputParser, Document → model_dump → JSONL. Existing crawler pins langchain/langchain-community/langchain-openai/langchain-ollama separately. | Keep actual installed LangChain, OpenAI and Pydantic classes. Check both real LLM constructors, locally loaded `generate_context_en.yaml` and `parse_error_context.yaml`, chain output and Document serialization. Test in the owner's actually resolved crawler environment; a separate pipeline-only install does not establish this dependency closure. |
| openai 3.3.1 → 3.16.1 | `02-collect-meta.py:468` uses `chat.completions.create`, then `choices[0].message.content.strip()`. A 401/AuthenticationError sets the process-wide `OPENAI_AD_ANALYSIS_DISABLED_REASON`; other errors return None without that latch. Transcript ChatOpenAI is another actual OpenAI consumer. | Real OpenAI client with httpx MockTransport: success list/string/None output, current nullable-content failure behavior, 401 latch and subsequent no-dispatch, 429 non-latching behavior. Use explicit fixture key, in-memory logger and client retry=0 in the test fixture; preserve production retry/model/provider defaults. Assert request model/temperature/message truncation and bounded log codes, never retain request bodies. |
| google-api-python-client 2.196.0 → 2.200.0 | `01-collect-urls.py:100` builds YouTube v3 and executes channels.list + paginated playlistItems.list; `02-collect-meta.py:531` executes videos.list. SDK request generation and discovery data matter, not just import success. Both collection scripts call load_backend_env at import. | Real bundled static discovery and real request builders, injected httplib2 fixture transport: two playlist pages, no-items response, real HttpError, videos fixture. Patch thumbnail transport separately. Disable dotenv loading before importing scripts; never run main. Assert existing output fields and pagination/request arguments. |
| scrapling[fetchers] 0.4.8 → 0.4.15; curl_cffi 0.15.0 → 0.16.3 | No direct imports of either package in crawler scripts. Actual nearby consumer is `backend/bin/naver_scrapling_fetch.py:37–68`: Fetcher.get(impersonate="chrome", stealthy_headers=True, timeout=seconds), page.body/status/url, strict single-JSON stdout. Source is outside direct write scope. | Keep real Fetcher/session/response conversion; replace the installed curl transport boundary, not Fetcher itself. Check forwarded options, UTF-8 bytes/replacement decoding, status/url and one JSON stdout line. Inspect installed source to locate the real native execution seam. Python socket patches alone do not block libcurl; never permit Curl.perform/native I/O. Generic import/Fetcher stubs leave this gap open. No fix to this helper without owner scope decision. |
| yt-dlp[default] 2026.7.4 → 2026.8.19; curl_cffi integration | `03-2-visual-location.py:168` shells out with format/section arguments. `08-chunk-multimodal-crawling.sh:493` detects a Chrome target by exact table regex, then passes --impersonate Chrome and --js-runtimes deno/node. The shell chooses an existing home-local executable before PATH (`:467`), so a venv test cannot prove deployed binary selection. | Run only local --version/--list-impersonate-targets with --ignore-config/--no-cache-dir; compare target table to current Chrome regex. Parse actual CLI options offline with the real parser. Capture download_sampled_video argv with subprocess blocked and a task-local fake result file; never supply a live video URL to executable yt-dlp. Real downloads/anti-bot/extractor behavior remains unverified. |
| psycopg2-binary 2.9.11 → 2.9.13 | Actual manifest is `backend/pipeline-control/requirements.txt`; Python module directory is `backend/pipeline_control`. pool.py:28/70 uses real ThreadedConnectionPool; batch_upsert.py:78/83 and outbox.py:202/225 use Json adapters. persist.py:123–126 uses connect; pg_store/publish paths consume those connection contracts. | Real import/native libpq load, Json adapter and ThreadedConnectionPool with only psycopg2.connect returning a fake connection. Exercise get/put/close and commit/rollback-on-error. Keep real Json bound parameters in batch_upsert and outbox fake cursors, checking Unicode/quotes/nulls, decoded result and fixed error codes. No libpq connection attempts or SQL execution. Actual transaction/CAS/concurrency behavior remains unverified here. |
| Owner-required Playwright 1.59.0 → 1.62.0 | `gemini_scrapling_fallback.py:132–164` uses sync_playwright, connect_over_cdp, contexts/new_context or Chrome launch_persistent_context with profile args. Upload paths call Locator.set_input_files and Page.expect_file_chooser → FileChooser.set_files. Existing test injects fake Playwright, even when it is installed but not already imported. | Inspect real generated API signatures using the command below. This catches removed/renamed arguments without starting a driver. It does not prove CDP, uploads or real browser behavior. Do not invoke _open_gemini_browser: it probes port 9222 and can attach to the authenticated Chrome session or create/open a real profile. |

Potential SDK incompatibility is not yet demonstrated by this review. Resolver constraints/native wheels and the above installed-API checks must settle it; do not change callers speculatively. No old web/backend pins from PR2906 were evaluated for import or restoration.

## Existing tests that do not establish upgraded SDK behavior

- `scripts/tests/test_collect_meta_thumbnail_security.py:13–29` conditionally replaces whole googleapiclient.discovery and openai modules on ImportError and leaves them in sys.modules. All seven tests concern thumbnail HTTP/filesystem boundaries; even with packages installed they do not exercise Google request generation or OpenAI completions. Require real imports first for any SDK compatibility result.
- `scripts/tests/test_transcript_context_backend.py` has seven real-module import/configuration/requests-mocked tests. It does **not** stub all LangChain; it also never calls build_context_llm, run_chain, Document construction or serialization.
- `scripts/tests/test_gemini_scrapling_fallback_regression.py:11–22` injects whole fake Playwright modules via setdefault and fake pages; production fallback imports Playwright, not Scrapling. It proves no Scrapling/curl compatibility.
- `backend/restaurant-evaluation/scripts/tests/tzuyang-case-review-pack.test.mjs:290,329` replaces the Python Scrapling helper with a fake Node script; it covers subprocess/result handling only.
- `scripts/tests/test_chunk_download_retry.py` only asserts shell source strings. `test_visual_location.py` does not exercise real downloader execution. Heatmap download tests use fake yt-dlp executables; they do not validate the new CLI.
- `pipeline_control/tests/test_slice0_control_plane.py:983,1112,1192` replaces the driver loader with FakePsycopg2/FakePg. `test_batch_upsert.py:115` replaces the entire loader and Json with a lambda. PoolFailClosedTests never constructs the installed real pool; MemoryOutboxTests exercises the memory implementation.
- `pipeline/test_data_contracts_unittest.py:94–108` replaces Supabase for boundary fixtures, not the upgraded SDKs. Its stdlib data-contract checks do not establish LangGraph/Pydantic API behavior.

Run selected modules in separate processes. Otherwise permanent SDK stubs and the two different `utils` import roots can contaminate later results.

## Bounded commands for the owner (not executed by sidecar)

Use the owner's **already prepared** task-local environments and temp directory. Set PIPELINE_PY, CRAWLER_PY and CONTROL_PY to absolute interpreter paths and TASK_TMP to an existing task-owned directory. The five selections below are exact reproduction/reference commands, **not a request to repeat the owner's completed checks**. Use only a missing selection or an affected test after a concrete source change; reuse existing baseline evidence. Static inventory: **72 methods**, not 72 passed tests.

Runtime evidence: control Dockerfile selects Python 3.12; the relevant security-audit/test workflow selects 3.11; hosted daily-crawler selects 3.12. No root .python-version was found. Validate the 3.12 runtime and 3.11 CI dependency closure without changing those pins. Missing prerequisites are not SDK regressions or passes.

The shell helper below is a proposed owner-run launcher, not a installed/verified test harness. It isolates environment and transient FileStore state, prevents credential-file loading, blocks subprocesses/sockets/libpq connections, and emits only summarized unittest results. It is bounded to the listed Python tests; it is **not** a native-network sandbox for curl or yt-dlp.

```sh
cd /Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong
: "${PIPELINE_PY:?absolute task-local baseline or candidate interpreter required}"
: "${CRAWLER_PY:?absolute task-local baseline or candidate interpreter required}"
: "${CONTROL_PY:?absolute task-local baseline or candidate interpreter required}"
: "${TASK_TMP:?existing task-owned temp directory required}"

offline_unit() {
  local review_python="$1"
  shift
  TMPDIR="$TASK_TMP" "$review_python" -B - "$@" <<'PY'
import contextlib, importlib, io, json, os, socket, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

targets = sys.argv[1:]
root = Path.cwd()
scratch = Path(os.environ["TMPDIR"]).resolve()
assert scratch.is_dir()
kept = {k: os.environ[k] for k in ("PATH", "TMPDIR") if k in os.environ}
os.environ.clear()  # only this test process; no shared environment mutation
os.environ.update(kept)
def denied(*args, **kwargs):
    raise AssertionError("offline_boundary_dispatch")

with tempfile.TemporaryDirectory(prefix="deps-review-", dir=scratch) as temp:
    os.environ["PIPELINE_CONTROL_STORE_PATH"] = str(Path(temp) / "store.json")
    with contextlib.ExitStack() as guards:
        for target in ("socket.socket.connect", "socket.socket.connect_ex",
                       "socket.create_connection", "socket.getaddrinfo",
                       "socket.socket.bind", "subprocess.Popen", "os.system"):
            guards.enter_context(patch(target, side_effect=denied))
        # The transcript script owns a different utils namespace: fresh process.
        if not any("test_transcript_context_backend" in t for t in targets):
            sys.path.insert(0, str(root / "backend"))
            runtime_paths = importlib.import_module("utils.runtime_paths")
            guards.enter_context(patch.object(runtime_paths, "load_backend_env",
                                               return_value=None))
        if any("pipeline_control" in t for t in targets):
            import psycopg2
            guards.enter_context(patch.object(psycopg2, "connect", side_effect=denied))
        if any("test_collect_meta_thumbnail_security" in t for t in targets):
            import googleapiclient.discovery, openai  # forbid optional whole-SDK stubs
        loader = unittest.TestLoader()
        suite = unittest.TestSuite()
        sink = io.StringIO()
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            for target in targets:
                if target.endswith(".py"):
                    p = Path(target)
                    suite.addTests(loader.discover(str(p.parent), pattern=p.name))
                else:
                    suite.addTests(loader.loadTestsFromName(target))
            result = unittest.TextTestRunner(stream=sink, verbosity=0).run(suite)
        print(json.dumps({
            "run": result.testsRun,
            "failure_ids": [t.id() for t, _ in result.failures],
            "error_ids": [t.id() for t, _ in result.errors],
            "skipped_ids": [t.id() for t, _ in result.skipped],
            "unexpected_successes": [t.id() for t in result.unexpectedSuccesses],
        }))
        raise SystemExit(0 if result.wasSuccessful() and not result.skipped else 1)
PY
}

offline_unit "$PIPELINE_PY" \
  backend.pipeline.test_validators_unittest \
  backend.pipeline.test_data_contracts_unittest.DataContractBaselineTests
# 36 methods; deliberately excludes unrelated reconciliation-manifest class.

offline_unit "$CRAWLER_PY" \
  backend/restaurant-crawling/scripts/tests/test_transcript_context_backend.py
offline_unit "$CRAWLER_PY" \
  backend/restaurant-crawling/scripts/tests/test_collect_meta_thumbnail_security.py
offline_unit "$CRAWLER_PY" \
  backend/restaurant-crawling/scripts/tests/test_chunk_download_retry.py
# 7 + 7 + 6 methods, separate processes.

offline_unit "$CONTROL_PY" \
  backend.pipeline_control.tests.test_postgres_control.PoolFailClosedTests \
  backend.pipeline_control.tests.test_slice0_control_plane.PersistSoTTests \
  backend.pipeline_control.tests.test_batch_upsert.BatchUpsertClientTests
# 3 + 10 + 3 methods; excludes HTTP servers, real PostgreSQL and SQL-layout suites.

"$PIPELINE_PY" -B -m pip check
"$CRAWLER_PY" -B -m pip check
"$CONTROL_PY" -B -m pip check
"$CRAWLER_PY" -B -m yt_dlp --ignore-config --no-cache-dir --version
"$CRAWLER_PY" -B -m yt_dlp --ignore-config --no-cache-dir --list-impersonate-targets
```

Add the installed-SDK cases in the findings table to owner-owned targeted tests/harnesses. For LangChain, wrap the actual ChatOpenAI factory only to inject fixture httpx clients; preserve the actual constructors, chaining, response parsing and Pydantic classes. For Google, keep discovery/request objects real and supply fixture httplib2 transport. For psycopg2, leave _load_psycopg2/Json/pool intact and replace only connect/cursor boundaries. For Scrapling, a fake Fetcher is insufficient.

Do not run `test_publication_cas_postgres` or `test_publish_queue_postgres`: their opt-in tests create clusters and execute SQL. Do not run complete `test_postgres_control`/`test_slice0_control_plane` modules: they also include HTTP server tests. Do not invoke collect/crawl/main or environment-contract commands with artificial production secrets.

No pip-audit result was produced here. Owner performs the authorized advisory query/resolution independently; an unavailable audit or a skipped DB/SDK test is recorded as unverified. Final baseline → candidate reconciliation and PR adjudication remain with the owner.

Additional bounded command for the newly identified Playwright adjustment; no browser/driver/network is started. Run only if the owner's new SDK contracts do not already cover these signatures:

```sh
"$CRAWLER_PY" -B - <<'PY'
from importlib.metadata import version
from inspect import signature
from playwright.sync_api import BrowserType, Browser, BrowserContext, Locator, Page, FileChooser
cases = [
    (BrowserType.connect_over_cdp, (None, "http://127.0.0.1:9222"), {}),
    (BrowserType.launch_persistent_context, (None, "/unused-offline-profile"),
     dict(channel="chrome", headless=False, locale="ko-KR",
          args=["--profile-directory=Default", "--remote-debugging-port=9222"])),
    (Browser.new_context, (None,), {}),
    (BrowserContext.new_page, (None,), {}),
    (BrowserContext.close, (None,), {}),
    (Page.expect_file_chooser, (None,), dict(timeout=8000)),
    (Locator.set_input_files, (None, "/unused-offline-video.mp4"), {}),
    (FileChooser.set_files, (None, "/unused-offline-video.mp4"), {}),
]
for method, args, kwargs in cases:
    signature(method).bind(*args, **kwargs)
assert isinstance(Browser.contexts, property)
assert isinstance(BrowserContext.pages, property)
print({"playwright": version("playwright"), "signature_checks": len(cases),
       "browser_started": False, "runtime_browser_behavior": "unverified"})
PY
```

## Verified session identity

- Native sidecar thread/session record ID: `01a10658-08f4-75a1-84f7-f94e5f3efebf`.
- Parent: `01a10657-0201-7350-a73d-88dd8ce446ca`; source `subagent.thread_spawn`, depth 2, nickname Cicero.
- Evidence file: `/Users/twoimo/.codex/sessions/2026/10/04/rollout-2026-10-04T18-56-35-01a10658-08f4-75a1-84f7-f94e5f3efebf.jsonl`.
- Line 1: session_meta.id matches CODEX_THREAD_ID, model_provider=openai, originator=Codex Desktop, cli_version=0.160.0. Line 11: current turn `01a10658-0b0c-75f1-b9ca-bf2d9c59d92e`, model=gpt-6-astra, effort=xhigh. Subsequent tool-call/result and token_count records confirm active execution in this turn; this is stronger than a selected UI label.
- The inherited second session_meta describes the parent; it is not this sidecar's identity. CODEX_SESSION_ID is a different host context identifier and was not substituted for CODEX_THREAD_ID.
- This verifies local native provider/model/effort execution metadata. No independent server-side model attestation or wire trace was collected.
