"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const Badge3DViewer = dynamic(
  () => import("./Badge3DViewer"),
  { ssr: false, loading: () => null },
);

export const POPULARITY_BADGE_KINDS = ["fire", "rainbow"] as const;
export const BADGE_BYTE_COUNT_IS_PASS_THRESHOLD = false;
const BADGE_SRC = {
  fire: "/assets/badges/badge_popular_fire_3d.webp",
  rainbow: "/assets/badges/badge_popular_rainbow_3d.webp",
} as const satisfies Record<(typeof POPULARITY_BADGE_KINDS)[number], string>;

export type BadgeViewerPhase = "off" | "offer" | "open";

export function badgeViewerPhase(experimental3D: boolean, open: boolean): BadgeViewerPhase {
  if (!experimental3D) return "off";
  return open ? "open" : "offer";
}

export function PopularityBadge({
  tier,
  experimental3D = false,
}: {
  tier: "fire" | "rainbow" | "standard";
  experimental3D?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  if (tier === "standard" || assetFailed) return null;
  const phase = badgeViewerPhase(experimental3D, open);
  return (
    <section aria-label="인기 맛집 배지" className="tz-popularity-badge">
      <style>{`
        .tz-popularity-badge img { transform: scale(1); }
        @media (hover: hover) and (prefers-reduced-motion: no-preference) {
          .tz-popularity-badge:hover img { transform: scale(1.15); }
        }
      `}</style>
      {/* eslint-disable-next-line @next/next/no-img-element -- Static badge WebP hides itself when the file is missing, and the hover scale targets this img. */}
      <img
        src={BADGE_SRC[tier]}
        alt={`${tier} popularity badge`}
        width={40}
        height={40}
        onError={() => setAssetFailed(true)}
      />
      {phase === "offer" ? (
        <button type="button" onClick={() => setOpen(true)}>3D 보기</button>
      ) : null}
      {phase === "open" ? <Badge3DViewer tier={tier} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
