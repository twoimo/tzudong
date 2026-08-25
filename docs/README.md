# Docs

Canonical writing lives next to the code it describes. This tree is the
cross-cutting index.

Keep at the repository root: `README.md`, `README.ko.md`, `LICENSE`,
`AGENTS.md`, `SECURITY.md`, `CHANGELOG.md`, `CHANGELOG.ko.md`.

## Layout

| Path | What belongs here |
| --- | --- |
| [product/](product/) | Durable product/UX design. `DESIGN.md` is the public-surface contract. |
| [operations/](operations/) | How we run Nightly, crawlers, and operator playbooks that are still current. |
| [archive/handoffs/](archive/handoffs/) | Dated session notes. Not source of truth. |
| `backend/ARCHITECTURE.md`, `backend/DATA_CONTRACTS.md` | Pipeline architecture and data contracts. Stay next to backend. |
| `backend/docs/`, `apps/web/docs/` | Package-local how-tos. Stay next to that package. |

Do not dump new session transcripts into `operations/`. Put them under
`archive/handoffs/YYYY-MM-DD-…`.
