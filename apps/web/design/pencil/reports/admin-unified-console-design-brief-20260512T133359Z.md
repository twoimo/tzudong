# Pencil Design Brief: Unified Admin Console

## Intent
Create a Pencil board for the tzudong admin console that feels like an operator extension of the existing map app, not a generic SaaS dashboard.

## Required canvases
1. **Unified Admin Overview**: left sidebar, work queue cards, data quality cards, banner/insight summaries, right LLM advisory panel.
2. **Management Table Pattern**: shared pattern for 맛집/제보/리뷰 with filters, status chips, detail drawer, guarded action footer.
3. **Banner Management**: active/inactive banner list, media preview, display target chips, priority/status signals.
4. **Insights + LLM Session**: compact treemap/trend area and advisory session panel with checklist output.

## Visual system
- Background: warm ivory `hsl(38 30% 98%)`.
- Foreground: stone/ink `hsl(24 10% 10%)`.
- Primary: deep red `hsl(0 74% 42%)`.
- Muted surfaces: `hsl(24 6% 90%)`.
- Borders: `hsl(24 5% 83%)`.
- Radius: 8px/`0.5rem`.
- Font: `Noto Serif KR` serif stack.
- Motifs: rounded cards, pill badges, subtle red glow/shadow, translucent header/shell surfaces.

## UI content
Sidebar labels:
- Overview
- 맛집 관리
- 데이터 검수
- 제보 관리
- 리뷰 관리
- 배너 관리
- 인사이트
- 감사 로그
- LLM 운영 세션

Status chips:
- 전체, 미처리, 승인됨, 삭제됨, 승인 대기, Missing, 평가 미대상, 지오코딩 실패

Guarded apply footer:
- Preview → Confirm → Apply → Readback → Audit

LLM panel states:
- 현재 화면 요약
- 다음 검수 추천
- 위험 액션 체크리스트
- 적용은 관리자 확인 후만 가능

## Design gate
Reject the board if it uses generic blue-gray enterprise styling, ignores repo tokens, hides destructive action risk, or makes LLM actions look auto-applied.

## 2026-05-12 Update: Single-page module switching

User clarified that the unified admin should show modules inside one admin page without parent-page navigation. First implementation should use in-page module state and embedded same-origin panels for existing routes, preserving existing pages while making `/admin` the operator hub. Later waves can extract the embedded pages into native shell panels.

## 2026-05-13 Update: Two-pane workspace and collapsible sidebar
- Workspace contract changed from persistent 3-column shell to `sidebar + single content canvas`.
- Sidebar selection now replaces the whole right-side content area, so embedded admin modules feel like one console rather than a center-pane swap.
- Overview-only support panels keep LLM advisory/status context inside the content canvas; detail modules use the full canvas for iframe or audit placeholders.
- Desktop sidebar can collapse to an icon rail to maximize operational workspace width while preserving keyboard-focusable buttons and accessible labels.
- Tradeoff: iframe composition still preserves existing routes but remains transitional; a future pass should extract native module components for tighter state sharing.

## 2026-05-13 Update: Overview-only command center chrome
- Admin command-center hero, status chips, and operational summary are overview-only.
- Detail modules selected from the sidebar should own the full right-side canvas with only module-specific chrome.
- This avoids persistent dashboard context competing with embedded work screens.

## 2026-05-13 Update: Simplified sidebar masthead
- Replace the heavy shield badge masthead with a compact text-first label (`Admin` / `운영 콘솔`).
- Collapse affordance uses a ghost icon button (`PanelLeftClose/Open`) to reduce visual weight while preserving accessible labels and pressed state.

## 2026-05-13 Update: LLM sidebar item as a real canvas module
- `LLM 운영 세션` is no longer an in-page anchor; it is a sidebar module with active state.
- Selecting it replaces the full right-side content canvas with a read-only LLM operations workspace.
- The workspace keeps advisory/read-only constraints visible and repeats guarded apply principles without performing mutations.

## 2026-05-13 Update: Sidebar collapse animation polish
- Sidebar labels are hidden before the rail width collapses and revealed after expansion completes.
- Menu labels use nowrap/overflow-hidden so Korean labels do not wrap vertically during width transitions.
- The icon rail remains stable while labels fade in/out independently from the grid-column transition.

## 2026-05-13 Update: Replace iframe embedding with native module rendering
- Admin detail modules are now mounted as React content inside the `/admin` canvas rather than loaded through iframe.
- Existing route pages remain available; evaluations and banners wrappers accept embedded-mode props for reuse.
- Submissions/reviews initialize the evaluations module with prop-driven internal state instead of relying on `/admin/evaluations?view=...` route navigation.
- Tradeoff: evaluations and banners are still large route-origin modules; a later cleanup should extract smaller dedicated panel components, but the operational UX no longer reloads a nested page frame.
