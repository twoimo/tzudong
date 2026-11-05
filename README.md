<div align="center">
  <img src="apps/web/public/logo.png" width="72" alt="Tzudong Map logo" />
  <h1>Tzudong Map · 쯔동여지도</h1>
  <p>A restaurant map built around places featured in Tzuyang videos.</p>
  <p>
    <a href="https://www.tzudong.app">Explore the map</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="docs/README.md">Documentation</a> ·
    <a href="CHANGELOG.md">Changelog</a>
  </p>
  <p>
    <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs" />
    <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?logo=react&amp;logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&amp;logoColor=white" />
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Auth-3ecf8e?logo=supabase&amp;logoColor=white" />
  </p>
</div>

[Features](#features) · [Preview](#preview) · [Local development](#local-development) · [Repository](#repository) · [Documentation](#documentation)

## Features

- **Discover restaurants:** browse domestic and overseas maps, search and filter places, and open restaurant details with video sources.
- **Keep track of visits:** reviews, stamps, rankings, likes, and profiles connect discovery with community activity.
- **Manage the data:** the guarded admin console supports review, moderation, source checks, and audited changes.
- **Prepare visual content:** storyboard and thumbnail workspaces support planning, generation, and revision.
- **Process video evidence:** backend workers handle crawling, evaluation, media processing, and publication payloads.

## Preview

Recorded interface demos from the repository:

<p align="center">
  <img src="apps/web/public/images/readme-product-tour.gif" width="900" alt="Desktop map browsing and restaurant details" />
</p>

<details>
<summary>Mobile screens and storyboard workspace</summary>

<table>
  <tr>
    <td width="50%"><strong>Home map</strong><br /><img src="apps/web/public/images/readme-mobile-home-map.gif" alt="Mobile map and restaurant details" /></td>
    <td width="50%"><strong>Review feed</strong><br /><img src="apps/web/public/images/readme-mobile-reviews-feed.gif" alt="Mobile review feed" /></td>
  </tr>
  <tr>
    <td width="50%"><strong>Stamp passport</strong><br /><img src="apps/web/public/images/readme-mobile-stamp-passport.gif" alt="Mobile stamp passport" /></td>
    <td width="50%"><strong>Ranking and profile</strong><br /><img src="apps/web/public/images/readme-mobile-leaderboard-ranking.gif" alt="Mobile rankings and profile" /></td>
  </tr>
</table>

![Storyboard workspace](apps/web/public/images/readme-storyboard-demo.gif)

</details>

## Local development

Use **Node.js 24.x** and **npm 11.6.2**, as declared in [apps/web/package.json](apps/web/package.json). The local database setup also needs Python 3 and Docker with Compose; follow the pinned prerequisites in the [local stack runbook](docs/operations/nightly-regression.md#local-compose-bootstrap).

1. Clone the repository and install the web dependencies:

   ```sh
   git clone https://github.com/twoimo/tzudong.git
   cd tzudong/apps/web
   npm ci
   ```

2. From the repository root, prepare and migrate the repository-managed [local Supabase stack](backend/supabase/README.md) using the [bootstrap instructions](docs/operations/nightly-regression.md#local-compose-bootstrap).
3. Return to `apps/web` and start the development server:

   ```sh
   npm run dev
   ```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The runner checks the generated local environment, service readiness, browser origin, and migration ledger before starting Next.js. Hosted debugging and map-provider configuration have separate setup instructions in the [web development guide](apps/web/README.md).

Bun is supported for everyday development. npm's manifest and lockfile remain the release package authority. Common checks from `apps/web` are:

```sh
npm run lint
npm run test:unit
npm run typecheck:parity
```

Choose checks for the affected behavior using the [verification guide](docs/agents/verification.md).

## Repository

| Path | Responsibility |
| --- | --- |
| [apps/web/](apps/web/) | Next.js public app, restaurant maps, community features, and guarded admin console. |
| [backend/](backend/) | Pipeline control, crawlers, evaluation, media workers, and Supabase migrations. |
| [docs/](docs/) | Product design, architecture, operations, and release guidance. |

The web app and backend workers share Supabase as their persistence boundary. Long-running crawling and media work belongs to backend workers. See the [backend architecture](backend/ARCHITECTURE.md) and [data contracts](backend/DATA_CONTRACTS.md) for the detailed flow.

| Web stack | Tooling and services |
| --- | --- |
| Next.js 16 · React 19 · TypeScript | Tailwind CSS · Radix UI · Lucide |
| Node.js 24.x · npm 11.6.2 | Bun for everyday development |
| Supabase | PostgreSQL · Auth · Storage |

Exact dependencies are in [package.json](apps/web/package.json) and [package-lock.json](apps/web/package-lock.json).

## Documentation

| Start here | Contents |
| --- | --- |
| [Documentation index](docs/README.md) | Cross-project guides and where documentation belongs. |
| [Web development](apps/web/README.md) | Local and hosted development, configuration, and web commands. |
| [Backend operations](backend/README.md) | Pipeline entry points, environment contracts, and run summaries. |
| [Product design](docs/product/DESIGN.md) · [Architecture diagrams](docs/architecture/) | Product surfaces and system diagrams. |
| [Verification](docs/agents/verification.md) · [Nightly operations](docs/operations/nightly-regression.md) | Scoped checks and the independent regression lane. |
| [Release guide](docs/agents/release.md) | Protected promotion, rollback, and deployment readback. |
| [Performance evidence](apps/web/performance/) · [Changelog](CHANGELOG.md) | Dated measurements, their scope and limits, and change history. |

Changes follow the protected `develop → data → main` path. A production release needs the approved commit and deployment readback described in the release guide. CI, Nightly regression, and production deployment are tracked separately.

## Security and license

Report security issues using [SECURITY.md](SECURITY.md). Source license: [MIT](LICENSE).
