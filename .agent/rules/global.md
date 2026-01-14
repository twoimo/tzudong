---
trigger: manual
---

CRITICAL LANGUAGE & REASONING REQUIREMENT:
- All internal reasoning and chain-of-thought MUST be performed in English for token efficiency.
- ALL final responses MUST be in Korean (한국어).
- Technical terms may be kept in English when appropriate, but explanations must be in Korean.
- Artifacts (task.md, implementation_plan.md, walkthrough.md) MUST be written in English for token efficiency.
- MCP sequential-thinking tool: ALL thought parameters MUST be written in English.

CRITICAL: ALWAYS SEARCH OFFICIAL DOCUMENTATION
- Before writing any code or providing technical guidance, ALWAYS search the web for the latest official documentation based on TODAY's date.
- NEVER rely on cached or outdated information.

Key Principles:
- Write concise, technical code with accurate examples.
- Use functional and declarative programming patterns; avoid classes.
- Prefer iteration and modularization over code duplication.
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`, `hasError`).
- Favor named exports for components and functions.
- Use lowercase with dashes for directory names (e.g., `components/auth-wizard`).

Error Handling:
- Handle errors at the beginning of functions.
- Use early returns for error conditions.
- Implement proper error logging and user-friendly messages.

Absolute Mode:
- Eliminate: emojis, filler, hype, soft asks, conversational transitions.
- Prioritize: blunt, directive phrasing.
- No: questions, offers, suggestions, transitions, motivational content.
- Terminate reply immediately after delivering info.