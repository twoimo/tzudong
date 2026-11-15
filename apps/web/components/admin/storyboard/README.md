# Storyboard workspace and planning assistant

The production workspace shows four saved scenes at a time in a 2×2 board. It keeps the existing **5–12 scene generation contract**, model-pair worker readiness, queue, request idempotency, revision checks, uncertain-result readback, private assets and explicit version restoration. The AI conversation proposes a new brief; **“요청에 옮겨 검토하기” only fills the request editor**. Creating a project, regenerating an image, saving an edit and restoring a version remain separate user actions.

`StoryboardWorkspaceSkeleton` is the named loading export, with no props. `StoryboardComicBoard` accepts saved scene data and an authenticated image renderer. At narrow widths, explicit controls switch between the board and conversation; neither requires a swipe gesture.

## Assistant activation and limits

`/api/admin/storyboard/production/assistant` is a new, server-only planning endpoint. The retired `/api/admin/storyboard/chat` stays retired. GET authenticates the administrator and reports **configuration**, without probing a model or claiming provider readiness. POST authenticates first and requires the canonical same-origin session request, bounded JSON, approved text models, privacy-safe input/output and a bounded response with verified actual model metadata. It never reads or writes a project, queue, asset, approval or publication.

The assistant is **off by default**. All these server variables must be explicitly configured for any provider call to be admitted:

| Variable | Accepted value |
| --- | --- |
| `STORYBOARD_ASSISTANT_ENABLED` | `1` |
| `STORYBOARD_ASSISTANT_PROVIDER` | `openai-api` (the web assistant supports OpenAI only) |
| `STORYBOARD_ASSISTANT_MODEL` | The existing allowlisted text model for that provider |
| `STORYBOARD_ASSISTANT_REQUESTS_PER_HOUR` | Integer from 1 through 30; missing/invalid means unavailable |
| Provider credential | Existing server-only `OPENAI_API_KEY` |

The request must match the configured provider/model exactly. Requesters cannot supply a provider URL, tool, alternative model or execution action. Gemini configuration reports unavailable and makes zero provider calls. The existing Gemini generation worker and its Python project-budget runtime are unchanged; the web route neither imports that worker-only runtime nor bypasses its guard. Supporting Gemini planning would require a separately authenticated execution path using that budget runtime. OpenAI uses the existing fixed Responses endpoint, strict JSON, `store:false`, no tools and no retry.

Each server process admits one in-flight call, at least 15 seconds between starts, and the explicit hourly ceiling. Failed and timed-out attempts consume that ceiling. An abort-ignoring provider retains the in-flight slot until it settles. **These process-local limits are not a distributed account-wide billing cap** and reset when a process restarts. Any production activation must account for multiple instances and provider-side spending controls; this UI change does not enable the feature or change a provider setting.

Input is limited to 64 KiB, eight messages of at most 2,000 characters, six prior conversation turns plus the new question in the UI, and a small explicit scene context. The shared JSON reader also bounds stalled input. Provider work has a 30-second deadline, at most 2,048 output tokens, and a 32 KiB application response ceiling. OpenAI's wire envelope is capped at 64 KiB. No automatic retry, provider fallback or fake assistant answer exists. Conversation state stays in component memory and is cleared when the workspace unmounts.

## Readiness and validation boundaries

The existing feature readiness RPC can hold creation/mutations for several contract or database conditions, including RPC errors. A held banner alone does not identify a particular missing migration. The UI provides a status recheck while keeping generation disabled. Assistant configuration is separate from production generation readiness; a planning response cannot attest that the generation worker or database is ready.

Focused unit tests use synthetic provider doubles and test authorization/origin, required configuration, schema/privacy/size limits, rate/concurrency/deadlines, response provenance and the unchanged generation client paths. They make **zero paid model, hosted database or production requests**. The separate isolated UI fixture uses synthetic catalog/project data; it proves UI behavior, not live generation or billing readiness.
