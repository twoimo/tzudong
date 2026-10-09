# Sampling follow-through after the stabilized probe

The shared GenerateContent helper now filters only sampling controls at the current official 3.6+/3.5 Flash-Lite boundary. Evaluation, recheck, crawler, final merge, chunk and controlled benchmark reuse it. Older supported explicit settings and the chunk caller's earlier Gemini3 default behavior remain intact. Model, thinking, output, quota, keys, fallback, timeout and queue defaults are unchanged.

Full client tests:25 pass; chunk config/CLI tests:2 pass; synthetic cache tests:6 pass. The original probe tests are included in the full client suite. A new test-only CLI-argument failure was corrected without weakening production gates and its TAP is retained.

Controlled admission replay:28 local observations,14 paired result hashes equal and7 six-request wire hash pairs equal. Google requests:0. Raw timing/resource observations are not claimed as provider performance or savings. The prior probe evidence and source remain unchanged; this is a separate section.

Python sampling matches belonged to OpenAI/Ollama/LLaVA. Gemini RAG caption payload has no sampling controls; its topK is retrieval slicing. Those files/settings were preserved.

Official source: https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6 . This is source and isolated transport verification, not a paid/provider/operating execution or deployment receipt.
