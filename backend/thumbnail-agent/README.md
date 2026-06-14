# Thumbnail Backend Agent

Thin LangGraph-style backend orchestration surface for the admin YouTube thumbnail generator.

It does **not** replace the web app's exact OpenAI `gpt-image-2` provider. The agent returns a structured concept/layout/prompt-addendum/review brief; the Next.js API then calls the existing provider layer so model provenance remains centralized.

## Local command bridge

```bash
THUMBNAIL_AGENT_COMMAND=../../backend/thumbnail-agent/scripts/run-thumbnail-agent.py
THUMBNAIL_AGENT_ROOT=../../backend/thumbnail-agent
THUMBNAIL_AGENT_PYTHON=python3
THUMBNAIL_AGENT_RUNTIME=local_graph
THUMBNAIL_AGENT_TIMEOUT_MS=120000
```

The command reads JSON from stdin or `THUMBNAIL_AGENT_JSON` and emits compact JSON with `concept`, `layoutBrief`, `promptAddendum`, `safetyReview`, `nextActions`, `warnings`, and `diagnostics`.

## Runtime fallback and retrieval risk contract

`THUMBNAIL_AGENT_RUNTIME=local_graph` now runs through the LangGraph graph when
`langgraph` is installed, and through a small LangGraph-compatible local runner
only when the `langgraph` package itself is missing. A broken or incompatible
installed LangGraph import fails explicitly instead of being disguised as package
absence. The fallback is orchestration-only and reports
`diagnostics.graphRuntime = "langgraph-compatible-fallback"`; it never generates
images and never changes the exact `gpt-image-2` provider boundary.

Automatic reference retrieval is active by default through
`backend/thumbnail-agent/scripts/retrieve-thumbnail-references.py`. If optional
BGE packages are unavailable, the adapter uses deterministic local vector and
lexical reranking (`local-char-ngram-v1`, `local-lexical-reranker-v1`) and the UI
must not label the result as BGE. For exact BGE labels, install the optional
package set:

```bash
python3 -m pip install -r backend/thumbnail-agent/requirements-bge.txt
```

Only diagnostics that explicitly report `BAAI/bge-m3` and
`BAAI/bge-reranker-v2-m3` with reranker operations enabled are surfaced as BGE
model-use proof.
