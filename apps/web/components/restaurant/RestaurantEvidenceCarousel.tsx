"use client";

import { useState } from "react";
import { ChevronDown, Film } from "lucide-react";
import { isLevel1SourceObserved, parseEvidenceFrame, approvedEvidenceFramesOrEmpty } from "@/lib/evidence-engineering/frames";
import type { RestaurantEvidenceFrame } from "@/lib/evidence-engineering/types";

export function evidenceFrameEmbedRow(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const record = item as Record<string, unknown>;
  const timestamp = record.timestamp_ms;
  const timestampMs = typeof timestamp === "string" && /^[0-9]+$/.test(timestamp)
    ? Number(timestamp)
    : timestamp;
  return {
    frame_id: record.frame_id,
    content_sha256: record.content_sha256,
    video_id: record.video_id,
    timestamp_ms: timestampMs,
    storage_object_key: record.storage_object_key,
    youtube_seek_url: record.youtube_seek_url,
    frame_type: record.frame_type,
    evidence_level: record.evidence_level,
    confidence_level: record.confidence_level,
    moderation_status: record.moderation_status,
    detected_shop_name: record.detected_shop_name ?? null,
    detected_branch_name: record.detected_branch_name ?? null,
    image_url: record.image_url ?? null,
  };
}

export function publicEvidenceFrames(groups: readonly unknown[][]): RestaurantEvidenceFrame[] {
  return publicReviewedVideoFrames(groups).filter(isLevel1SourceObserved);
}

// Reviewed video context may be shown, but does not become L1 identity proof.
export function publicReviewedVideoFrames(groups: readonly unknown[][]): RestaurantEvidenceFrame[] {
  const parsed = groups.map((group) => group.flatMap((item) => {
    try {
      return [parseEvidenceFrame(evidenceFrameEmbedRow(item))];
    } catch {
      return [];
    }
  }));
  return approvedEvidenceFramesOrEmpty(parsed).filter(
    (frame) => frame.evidence_level === "SOURCE_OBSERVED",
  );
}

export function publicEvidenceImageSource(frame: RestaurantEvidenceFrame): string {
  const valid = parseEvidenceFrame(frame);
  return valid.image_url ?? `/evidence-frames/${valid.storage_object_key}`;
}

export function frameLabel(frame: RestaurantEvidenceFrame): string {
  if (frame.frame_type === "storefront_sign") return "매장 간판";
  if (frame.frame_type === "publisher_location_caption") return "영상의 매장 안내";
  return frame.frame_type === "menu_receipt" ? "메뉴·영수증 장면" : "영상 속 현장 장면";
}

export function publicFramePresentation(frame: RestaurantEvidenceFrame): {
  href: string;
  loading: "lazy";
  bulkHighResolutionFetch: false;
  enlargement: "separate_request";
} {
  return {
    href: frame.youtube_seek_url,
    loading: "lazy",
    bulkHighResolutionFetch: false,
    enlargement: "separate_request",
  };
}

export function EvidenceFrameImage({ frame, className = 'rounded-t-xl' }: { frame: RestaurantEvidenceFrame; className?: string }) {
  const [failed, setFailed] = useState(false);
  const presentation = publicFramePresentation(frame);
  if (failed) return <span role="status" className="flex aspect-video items-center justify-center rounded-t-xl bg-muted px-3 text-center text-xs text-muted-foreground">장면 이미지를 불러오지 못했어요. 원본 영상에서 확인해 주세요.</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Immutable reviewed frames use native lazy images.
    <img src={publicEvidenceImageSource(frame)} alt={frame.detected_shop_name ?? frameLabel(frame)}
      width={640} height={360} loading={presentation.loading} decoding="async" onError={() => setFailed(true)}
      className={`aspect-video w-full object-cover ${className}`} />
  );
}

export function RestaurantEvidenceCarousel({ frames, videoId, label = "영상 속 장면" }: {
  frames: readonly RestaurantEvidenceFrame[][];
  videoId?: string;
  label?: string;
}) {
  const visible = publicReviewedVideoFrames(frames).filter((frame) => !videoId || frame.video_id === videoId);
  if (visible.length === 0) return null;
  return (
    <section aria-label="쯔양 영상 근거와 방문 장면">
      <details className="group/scenes min-w-0 rounded-lg border border-border bg-muted/20">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{label}</span>
          <span className="text-muted-foreground">{visible.length}장</span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground group-open/scenes:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-2 border-t border-border px-3 py-3">
          <p className="text-xs text-muted-foreground">장면을 누르면 영상의 해당 시점으로 이동해요.</p>
          {visible.some((frame) => !isLevel1SourceObserved(frame)) && (
            <p className="text-2xs text-muted-foreground">현장 장면은 영상의 맥락이며, 매장 신원을 확인하는 간판·매장 안내와 구분해요.</p>
          )}
          <div className="grid min-w-0 grid-cols-2 gap-2">
            {visible.map((frame) => {
              const presentation = publicFramePresentation(frame);
              return (
              <a
                key={frame.frame_id}
                href={presentation.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block min-w-0 overflow-hidden rounded-xl border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${frameLabel(frame)} ${Math.floor(frame.timestamp_ms / 60000)}분 ${Math.floor(frame.timestamp_ms / 1000) % 60}초 영상 열기`}
              >
                  <EvidenceFrameImage key={`${frame.storage_object_key}:${publicEvidenceImageSource(frame)}`} frame={frame} />
                  <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2 py-2 text-2xs">
                    <span className="min-w-0">{frameLabel(frame)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{Math.floor(frame.timestamp_ms / 60000)}:{String(Math.floor(frame.timestamp_ms / 1000) % 60).padStart(2, "0")}</span>
                  </span>
              </a>
              );
            })}
          </div>
        </div>
      </details>
    </section>
  );
}
