# Necessary information and compact layout

The operator requested only necessary information, clear controls and higher information density across the product. This change applies a compact shared admin header, sidebar and table geometry, then restructures the KPI dashboard. Remaining public and module-specific acceptance stays in the active goal.

The five KPI cards use two columns on mobile and tablet. The last metric in the saved order spans both columns, eliminating an unused grid cell while preserving ordering. Large figures and period changes stay visible; secondary context moves into a labeled popover that opens by tap or keyboard and closes with Escape. The information target is 24px rather than 20px. Redundant KPI explanations are omitted from that popover; comparison and calculation context remain. Header copy uses plain Korean instead of implementation terms.

Shared admin padding, header height and desktop table cell spacing are reduced. Mobile menu targets and existing confirmation, authorization, warnings and database mutation logic retain their behavior. Narrow KPI cards hide the secondary sparkline so it cannot overlap the primary number. The actual trend charts remain available.

| Fixed fixture viewport | KPI area before → after | Absolute change | Relative change | Fully visible KPI count |
| --- | --- | --- | --- | --- |
| 390×844 | 854 → 362px | −492px | −57.61% | 4 → 5 |
| 834×1194 | 550 → 449px | −101px | −18.36% | 5 → 5 |
| 1440×1000 | 174.9375 → 150.78125px | −24.15625px | −13.81% | 5 → 5 |

These are observed layout measurements with one sample per viewport and the same synthetic data. A population 95% interval is not estimated; this is not a speed, productivity or cost claim. All five displayed values match and page horizontal overflow is 0px. The restaurant list contains 25 synthetic rows, has one h1 and preserves its review/refresh tabs. Full product visual acceptance and production deployment remain unverified.

During verification, the mobile chart was blank: its SVG declared 321px but painted at 0px. Installed Recharts 3.10.1 uses a zero-size inner measuring element. The old percentage width cap on its inner wrapper collapsed the chart; the cap now remains on the outer responsive container. The chart paints at 321px with no page overflow. See the [official responsive-container guidance](https://recharts.github.io/en-US/api/ResponsiveContainer/); the installed source establishes the particular zero-size wrapper behavior. Initial blank charts, a blank desktop transition frame and intermediate captures are retained as attempts, not accepted evidence.

Validation: canonical web runner 2,661 pass / 9 skip / 0 fail; affected tests 56 pass; native/compat TypeScript parity, targeted ESLint, Next 16.3.8 production build with 47 static pages and route CSS ownership pass. Obsolete class/caption expectations were updated; the requirement to display the implementation label “YouTube Data API” was removed. Security, numeric derivation, navigation and risky-action checks remain.

Evidence is under `apps/web/performance/ui-renewal-20261003/`: `density-before-20261003.json`, `density-final-20261003.json`, `density-summary-20261003.json`, accepted `density-final-{390,834,1440}.png` captures and retained attempts. This work does not establish all-page, dark-theme or reduced-motion acceptance.
