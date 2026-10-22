"use client";

import dynamic from "next/dynamic";
import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useDevicePerformance } from "@/hooks/useDevicePerformance";
import { shouldUseStaticBadgeViewer } from "@/lib/evidence-engineering/badge-device-capability";
import { handleBadgeViewerCloseKey, restoreBadgeViewerFocus } from "@/lib/evidence-engineering/badge-viewer-lifecycle";

const BadgeViewerLoadingContext = createContext<{
  tier: "fire" | "rainbow";
  onClose: () => void;
} | null>(null);

function LoadingBadgeViewer({ error }: { error?: Error | null }) {
  const viewer = useContext(BadgeViewerLoadingContext);
  return viewer ? <StaticBadgeViewer {...viewer} loading={!error} /> : null;
}

const Badge3DViewer = dynamic(
  () => import("./Badge3DViewer"),
  { ssr: false, loading: LoadingBadgeViewer },
);

class BadgeViewerErrorBoundary extends Component<{
  tier: "fire" | "rainbow";
  onClose: () => void;
  children: ReactNode;
}, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed
      ? <StaticBadgeViewer tier={this.props.tier} onClose={this.props.onClose} />
      : this.props.children;
  }
}

export const POPULARITY_BADGE_KINDS = ["fire", "rainbow"] as const;
export const BADGE_BYTE_COUNT_IS_PASS_THRESHOLD = false;
const BADGE_SRC = {
  fire: "/assets/badges/badge_popular_fire_40.webp",
  rainbow: "/assets/badges/badge_popular_rainbow_40.webp",
} as const satisfies Record<(typeof POPULARITY_BADGE_KINDS)[number], string>;

export type BadgeViewerPhase = "off" | "offer" | "open";

export function badgeViewerPhase(experimental3D: boolean, open: boolean): BadgeViewerPhase {
  if (!experimental3D) return "off";
  return open ? "open" : "offer";
}

function StaticBadgeViewer({ tier, onClose, loading = false }: {
  tier: "fire" | "rainbow";
  onClose: () => void;
  loading?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { rootRef.current?.focus(); }, []);
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="3D 배지"
      tabIndex={0}
      data-badge-3d={tier}
      data-badge-viewer={loading ? "loading" : "fallback"}
      onKeyDown={(event) => handleBadgeViewerCloseKey(event, onClose)}
    >
      <p>{loading ? "3D 배지를 불러오는 중입니다." : "정적 배지로 표시합니다."}</p>
      <button type="button" onClick={onClose}>닫기</button>
    </div>
  );
}

export function PopularityBadge({
  tier,
  experimental3D = false,
}: {
  tier: "fire" | "ember" | "rainbow" | "standard";
  experimental3D?: boolean;
}) {
  const performance = useDevicePerformance();
  const useStaticViewer = shouldUseStaticBadgeViewer(
    performance,
    typeof navigator === "undefined" ? null : navigator,
  );
  const [open, setOpen] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const closeViewer = useCallback(() => {
    shouldRestoreFocusRef.current = true;
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (open || !shouldRestoreFocusRef.current) return;
    shouldRestoreFocusRef.current = false;
    restoreBadgeViewerFocus(openerRef.current);
  }, [open]);

  if (tier === "standard" || tier === "ember" || assetFailed) return null;
  const phase = badgeViewerPhase(experimental3D, open);
  return (
    <section
      aria-label="인기 맛집 배지"
      className={`tz-popularity-badge flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2 ${tier === "fire" ? "border-brand-tangerine/40 bg-brand-tangerine-tint" : "border-border bg-brand-cream"}`}
      title="연결된 쯔양 영상 조회수 기준 · 맛 평가가 아니에요"
    >
      <style>{`
        .tz-popularity-badge img { transform: scale(1); }
        @media (hover: hover) and (prefers-reduced-motion: no-preference) {
          .tz-popularity-badge img { transition: transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)); }
          .tz-popularity-badge:hover img { transform: scale(1.15); }
        }
      `}</style>
      {/* eslint-disable-next-line @next/next/no-img-element -- Static badge WebP hides itself when the file is missing, and the hover scale targets this img. */}
      <img
        src={BADGE_SRC[tier]}
        srcSet={`${BADGE_SRC[tier]} 1x, /assets/badges/badge_popular_${tier}_80.webp 2x`}
        alt={tier === "fire" ? "인기 맛집 불꽃 배지" : "인기 맛집 무지개 배지"}
        width={40}
        height={40}
        onError={() => setAssetFailed(true)}
        className="h-10 w-10 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-2xs font-bold tracking-wide text-brand-garden-text">쯔양 영상 인기 맛집</p>
        <p className="text-sm font-black tracking-tight">{tier === "fire" ? "영상 조회수 최상위 맛집" : "영상 조회수 상위권 맛집"}</p>
        <p className="text-xs text-muted-foreground">2026년 6–7월 수집 기준 · 맛 평가가 아니에요</p>
      </div>
      {phase !== "off" ? (
        <button
          ref={openerRef}
          type="button"
          className="shrink-0 rounded-full bg-brand-ink px-3 py-1 text-xs font-bold text-white"
          aria-haspopup="dialog"
          aria-expanded={phase === "open"}
          hidden={phase === "open"}
          onClick={() => {
            shouldRestoreFocusRef.current = false;
            setOpen(true);
          }}
        >
          3D 보기
        </button>
      ) : null}
      {phase === "open" ? (
        useStaticViewer
          ? <StaticBadgeViewer tier={tier} onClose={closeViewer} />
          : (
            <BadgeViewerLoadingContext.Provider value={{ tier, onClose: closeViewer }}>
              <BadgeViewerErrorBoundary tier={tier} onClose={closeViewer}>
                <Badge3DViewer tier={tier} onClose={closeViewer} lowPower={useStaticViewer} />
              </BadgeViewerErrorBoundary>
            </BadgeViewerLoadingContext.Provider>
          )
      ) : null}
    </section>
  );
}
