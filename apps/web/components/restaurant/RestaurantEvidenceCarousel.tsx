import { isLevel1SourceObserved, parseEvidenceFrame, unionApprovedEvidenceFrames } from "@/lib/evidence-engineering/frames";
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
  return unionApprovedEvidenceFrames(parsed).filter(
    (frame) => frame.evidence_level === "SOURCE_OBSERVED",
  );
}

export function publicEvidenceImageSource(frame: RestaurantEvidenceFrame): string {
  const valid = parseEvidenceFrame(frame);
  return valid.image_url ?? `/evidence-frames/${valid.storage_object_key}`;
}

function frameLabel(frame: RestaurantEvidenceFrame): string {
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

export function RestaurantEvidenceCarousel({ frames }: { frames: readonly RestaurantEvidenceFrame[][] }) {
  const visible = publicReviewedVideoFrames(frames);
  if (visible.length === 0) return null;
  return (
    <section className="py-2 pb-[env(safe-area-inset-bottom)]" aria-label="쯔양 영상 근거와 방문 장면">
      <p className="text-2xs font-bold tracking-wide text-brand-garden-text">쯔양 영상 속 그 장면</p>
      <h3 className="mb-2 text-sm font-black tracking-tight">영상에서 확인한 간판·방문 장면 📸</h3>
      {visible.some((frame) => !isLevel1SourceObserved(frame)) && (
        <p className="mb-2 text-xs text-muted-foreground">현장 장면은 영상의 맥락을 보여주며, 매장 신원을 확인하는 간판·매장 안내와 구분해요.</p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2" tabIndex={0} aria-label="영상 장면 가로 스크롤">
        {visible.map((frame) => {
          const presentation = publicFramePresentation(frame);
          return (
          <a
            key={frame.frame_id}
            href={presentation.href}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-[min(68vw,18rem)] shrink-0 rounded-xl border border-border bg-card sm:w-64 lg:w-72"
            aria-label={`${frameLabel(frame)} ${Math.floor(frame.timestamp_ms / 60000)}분 ${Math.floor(frame.timestamp_ms / 1000) % 60}초 영상 열기`}
          >
              {/* eslint-disable-next-line @next/next/no-img-element -- Immutable reviewed frames use native lazy images. */}
              <img
                src={publicEvidenceImageSource(frame)}
                alt={frame.detected_shop_name ?? frameLabel(frame)}
                width={640}
                height={360}
                loading={presentation.loading}
                decoding="async"
                className="aspect-video w-full rounded-t-xl object-cover"
              />
              <span className="flex items-center justify-between gap-2 px-2 py-2 text-xs">
                <span>{frameLabel(frame)}</span>
                <span className="tabular-nums text-muted-foreground">{Math.floor(frame.timestamp_ms / 60000)}:{String(Math.floor(frame.timestamp_ms / 1000) % 60).padStart(2, "0")}</span>
              </span>
          </a>
          );
        })}
      </div>
    </section>
  );
}
