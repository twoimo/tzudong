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
