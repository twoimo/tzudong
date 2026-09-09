<div align="center">

# Tzudong Map

**Map-first restaurant discovery platform and AI storyboard production workspace.**

[![Live App](https://img.shields.io/badge/live-tzudong.app-4F46E5?logo=vercel&logoColor=white)](https://tzudong.app)
[![Release](https://img.shields.io/github/v/release/twoimo/tzudong?color=blue&logo=github)](https://github.com/twoimo/tzudong/releases/latest)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Auth-3ecf8e?logo=supabase&logoColor=white)](https://supabase.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

<p align="center">
  <a href="#features"><b>Features</b></a> •
  <a href="#product-tour"><b>Product Tour</b></a> •
  <a href="#tech-stack"><b>Tech Stack</b></a> •
  <a href="#quick-start"><b>Quick Start</b></a> •
  <a href="README.ko.md"><b>한국어 문서 (Korean)</b></a>
</p>

</div>

---

Tzudong Map turns video-featured restaurant evidence into a production-grade map service: users search and explore verified locations on mobile, operators moderate and review data, and creators generate multi-cut video storyboards through an integrated AI workspace.

<h2 id="features">Features</h2>

- **🗺️ Interactive Map Discovery**: Search, category filters, clustered food markers, geolocation routing, and rich restaurant detail bottom sheets.
- **🎬 AI Storyboard Workspace**: Chat-driven storyboard planning, automated 10-cut visual scene generation, metadata management, and provider routing.
- **🔍 Evidence Verification Pipeline**: Automated crawling, multi-stage Rule / LLM-as-a-Judge validation, and structured Supabase ingestion.
- **👥 Community & Engagement**: Verified receipt reviews, stamp passport check-ins, leaderboards, and user profiles.

---

<h2 id="product-tour">Product Tour</h2>

### Desktop Discovery & AI Storyboard

**Interactive Map & Detail Bottom Sheet**
<p align="center">
  <img src="apps/web/public/images/readme-product-tour.gif" width="900" alt="Tzudong Map desktop product tour" />
</p>

**AI Storyboard Workspace (10-Cut Scene Generation)**
<p align="center">
  <img src="apps/web/public/images/readme-storyboard-demo.gif" width="900" alt="Storyboard workspace generating a 10-cut storyboard" />
</p>

### Mobile Experience

<table>
  <tr>
    <td width="50%">
      <strong>Home Map</strong><br />
      <small>Browse food markers & view restaurant details</small><br />
      <img src="apps/web/public/images/readme-mobile-home-map.gif" alt="Home map mobile demo" />
    </td>
    <td width="50%">
      <strong>Reviews Feed</strong><br />
      <small>Explore real-time reviews & photo feeds</small><br />
      <img src="apps/web/public/images/readme-mobile-reviews-feed.gif" alt="Reviews feed mobile demo" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Stamp Passport</strong><br />
      <small>Check in at visited places & earn stamps</small><br />
      <img src="apps/web/public/images/readme-mobile-stamp-passport.gif" alt="Stamp passport mobile demo" />
    </td>
    <td width="50%">
      <strong>Leaderboard & Profile</strong><br />
      <small>Track rankings, activity, and saved bookmarks</small><br />
      <img src="apps/web/public/images/readme-mobile-leaderboard-ranking.gif" alt="Ranking and profile mobile demo" />
    </td>
  </tr>
</table>

---

<h2 id="tech-stack">Tech Stack</h2>

- **Frontend**: Next.js 16 (App Router, Turbopack), React 19, TypeScript
- **Styling & UI**: Tailwind CSS, Lucide Icons
- **Backend & Database**: Supabase (PostgreSQL, Auth, Row Level Security, Storage)
- **AI & Pipelines**: LLM-as-a-Judge evaluation, prompt pipelines, multi-model image generation
- **Tooling**: Node 24.x, Bun

---

<h2 id="quick-start">Quick Start</h2>

### Local Development

```bash
# Clone the repository
git clone https://github.com/twoimo/tzudong.git
cd tzudong

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to view the application.

---

## License

[MIT License](LICENSE)
