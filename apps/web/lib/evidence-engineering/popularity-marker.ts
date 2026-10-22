export const POPULARITY_MARKER_CSS = `
.tz-popularity-marker { position: relative; width: 100%; height: 100%; isolation: isolate; }
.tz-popularity-flame { position: absolute; width: 24px; height: 32px; left: 50%; bottom: calc(100% - 2px); z-index: 300; pointer-events: none; transform: translateX(-50%); animation: tz-popularity-flame 1.4s ease-in-out infinite; }
[data-popularity-tier="fire"] .tz-popularity-flame-outer { fill: #e10600; }
[data-popularity-tier="fire"] .tz-popularity-flame-core { fill: #ffe14a; }
[data-popularity-tier="ember"] .tz-popularity-flame-outer { fill: #ff7b43; }
[data-popularity-tier="ember"] .tz-popularity-flame-core { fill: #fff1c2; }
[data-popularity-tier="rainbow"] .tz-popularity-flame-outer { fill: #2f6bff; }
[data-popularity-tier="rainbow"] .tz-popularity-flame-core { fill: #e8f0ff; }
@keyframes tz-popularity-flame {
  50% { transform: translateX(-50%) translateY(-2px) scale(1.06); opacity: 0.85; }
}
[data-map-interacting="true"] .tz-popularity-flame { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .tz-popularity-flame { animation: none; }
}
`;

const FLAME_SVG = '<svg class="tz-popularity-flame" viewBox="0 0 32 42" aria-hidden="true" focusable="false"><path class="tz-popularity-flame-outer" stroke="#fff7ed" stroke-width="1.4" d="M17 1c3 12-7 14-6 22 3-2 5-5 5-8 12 9 17 26 0 26C-3 41-3 24 6 15c0 6 1 8 3 9C6 15 19 12 17 1Z"/><path class="tz-popularity-flame-core" d="M17 24c1 6-5 7-4 11 5 4 12-2 4-11Z"/></svg>';

const POPULARITY_TIER_RANK = { standard: 0, rainbow: 1, ember: 2, fire: 3 } as const;

export function publicPopularityTier(value: unknown): "fire" | "ember" | "rainbow" | "standard" {
  return value === "fire" || value === "ember" || value === "rainbow" ? value : "standard";
}

export function bestPopularityTier(current: unknown, next: unknown): "fire" | "ember" | "rainbow" | "standard" {
  const left = publicPopularityTier(current);
  const right = publicPopularityTier(next);
  return POPULARITY_TIER_RANK[right] > POPULARITY_TIER_RANK[left] ? right : left;
}

export function popularityFlameMarkup(tier: unknown): string {
  const safeTier = publicPopularityTier(tier);
  if (safeTier === "standard") return "";
  return `<style>${POPULARITY_MARKER_CSS}</style>${FLAME_SVG}`;
}

export function wrapMarkerWithPopularityTier(innerHtml: string, tier: "fire" | "ember" | "rainbow" | "standard" | null | undefined): string {
  const safeTier = publicPopularityTier(tier);
  return `<style>${POPULARITY_MARKER_CSS}</style><div class="tz-popularity-marker" data-popularity-tier="${safeTier}">${innerHtml}${safeTier === "standard" ? "" : FLAME_SVG}</div>`;
}

export function syncPopularityMarkerInteraction(
  element: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
  interacting: boolean,
): void {
  if (interacting) element.setAttribute("data-map-interacting", "true");
  else element.removeAttribute("data-map-interacting");
}
