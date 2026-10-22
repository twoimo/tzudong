import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

import { badgeViewerPhase } from "../components/restaurant/PopularityBadge";
import { publicEvidenceFrames, publicReviewedVideoFrames, publicEvidenceImageSource, publicFramePresentation } from "../components/restaurant/RestaurantEvidenceCarousel";
import { BADGE_BYTE_COUNT_IS_PASS_THRESHOLD, POPULARITY_BADGE_KINDS } from "../components/restaurant/PopularityBadge";
import { buildRestaurantSelectFields, fetchRestaurantsRecoveringMissingEmbed, RESTAURANT_EVIDENCE_FRAME_EMBED, RESTAURANT_MERGE_SELECT } from "../hooks/use-restaurants";
import { naverPlaceSearchUrl, operationalCaution } from "../components/restaurant/OperationalCautionNotice";
import {
  applyEvidenceModeration,
  EVIDENCE_MODERATION_CONFIRMATION_TEXT,
  persistEvidenceFrameModeration,
  previewEvidenceModeration,
  type EvidenceFrameModerationClient,
} from "../lib/evidence-engineering/evidence-moderation";
import { POPULARITY_MARKER_CSS, publicPopularityTier, syncPopularityMarkerInteraction, wrapMarkerWithPopularityTier } from "../lib/evidence-engineering/popularity-marker";
import { summarizeRenderSamples } from "../lib/evidence-engineering/render-measurement";
import { buildEvidenceFrame, parseEvidenceFrame, unionApprovedEvidenceFrames } from "../lib/evidence-engineering/frames";
import { MARKER_EFFECT_CONTRACT } from "../lib/evidence-engineering/constants";
import { assertSameScoringCohort } from "../lib/evidence-engineering/records";
import { EvidenceContractError } from "../lib/evidence-engineering/errors";
import { EvidenceUploadError, uploadEvidenceWebp } from "../lib/evidence-engineering/upload-evidence-frame";
import { collectRestaurantMergedMedia } from "../lib/restaurant-merged-media";
import { getNaverIndividualMarkerVisual } from "../lib/naver-map-marker-visuals";
import type { Restaurant } from "../types/restaurant";

const VIDEO_ID = "abc123DEF45";
const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

function fakeFrameClient(
  data: Array<{ moderation_status: string }> | null,
  error: { code?: string } | null = null,
): EvidenceFrameModerationClient {
  return {
    from(table) {
      if (table !== "restaurant_evidence_frames") throw new Error("wrong_table");
      return {
        update() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    select: async () => ({ data, error }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

function frame(overrides: Parameters<typeof buildEvidenceFrame>[0] extends infer T ? Partial<T> : never = {}) {
  return buildEvidenceFrame({
    frame_id: "frame-sign-1",
    content_sha256: SHA,
    video_id: VIDEO_ID,
    timestamp_ms: 125500,
    frame_type: "storefront_sign",
    evidence_level: "SOURCE_OBSERVED",
    confidence_level: "certain",
    moderation_status: "approved",
    detected_shop_name: "회전초밥",
    detected_branch_name: null,
    image_url: null,
    ...overrides,
  });
}

describe("evidence engineering remaining tasks", () => {
  test("uploads only the immutable webp key and refuses collisions", async () => {
    const bytes = webpBytes();
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const stored = new Map<string, Uint8Array>();
    const result = await uploadEvidenceWebp(
      { videoId: VIDEO_ID, timestampMs: 125500, contentSha256, bytes },
      {
        exists: async (key) => stored.has(key),
        put: async (key, body) => {
          stored.set(key, body);
          return { publicUrl: `https://cdn.example/${key}` };
        },
      },
    );
    expect(result.storageObjectKey).toBe(`${VIDEO_ID}/125500_${contentSha256.slice(0, 12)}.webp`);
    expect(result.imageUrl).toContain(result.storageObjectKey);
    await expect(uploadEvidenceWebp(
      { videoId: VIDEO_ID, timestampMs: 125500, contentSha256, bytes },
      {
        exists: async () => true,
        put: async () => ({ publicUrl: null }),
      },
    )).rejects.toMatchObject({ code: "storage_key_collision" });
    await expect(uploadEvidenceWebp(
      { videoId: VIDEO_ID, timestampMs: 125500, contentSha256: SHA, bytes },
      { exists: async () => false, put: async () => ({ publicUrl: null }) },
    )).rejects.toBeInstanceOf(EvidenceUploadError);
  });

  test("moderation requires preview, confirm, apply, and readback before an audit record", async () => {
    const preview = previewEvidenceModeration({
      frameId: "frame-sign-1",
      fromStatus: "pending",
      toStatus: "approved",
      actorId: "admin-user-1",
    });
    const applied = applyEvidenceModeration({
      frameId: "frame-sign-1",
      fromStatus: "pending",
      toStatus: "approved",
      actorId: "admin-user-1",
      previewHash: preview.previewHash,
      confirmationText: EVIDENCE_MODERATION_CONFIRMATION_TEXT,
      readbackStatus: "approved",
    });
    expect(applied.audit.toStatus).toBe("approved");
    expect(() => applyEvidenceModeration({
      ...applied.audit,
      frameId: applied.audit.frameId,
      fromStatus: "pending",
      toStatus: "approved",
      actorId: applied.audit.actorId,
      previewHash: preview.previewHash,
      confirmationText: EVIDENCE_MODERATION_CONFIRMATION_TEXT,
      readbackStatus: "pending",
    })).toThrow(/readback_mismatch/);
    const route = readFileSync(resolve(import.meta.dir, "../app/api/admin/evidence-frames/route.ts"), "utf8");
    expect(route.indexOf("requireAdmin")).toBeLessThan(route.indexOf("persistEvidenceFrameModeration"));
    expect(route).toContain("createSupabaseServiceRoleClient");
    expect(route).not.toContain('{ error: "persistence_unavailable", audit: applied.audit }');
    const updated = await persistEvidenceFrameModeration(fakeFrameClient([{ moderation_status: "approved" }]), {
      frameId: "frame-sign-1",
      fromStatus: "pending",
      toStatus: "approved",
    });
    expect(updated).toBe("updated");
    expect(await persistEvidenceFrameModeration(fakeFrameClient([]), {
      frameId: "frame-sign-1",
      fromStatus: "pending",
      toStatus: "approved",
    })).toBe("readback_mismatch");
    expect(await persistEvidenceFrameModeration(fakeFrameClient([{ moderation_status: "pending" }]), {
      frameId: "frame-sign-1",
      fromStatus: "pending",
      toStatus: "approved",
    })).toBe("readback_mismatch");
    expect(await persistEvidenceFrameModeration(fakeFrameClient(null, { code: "PGRST205" }), {
      frameId: "frame-sign-1",
      fromStatus: "pending",
      toStatus: "approved",
    })).toBe("persistence_unavailable");
  });

  test("public carousel keeps approved sign evidence and its seek url", () => {
    const approved = frame();
    const synthetic = frame({
      frame_id: "frame-synthetic",
      evidence_level: "SYNTHETIC_MOCK_TESTED",
      timestamp_ms: 2000,
      content_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const pending = frame({ frame_id: "frame-pending", moderation_status: "pending", timestamp_ms: 3000, content_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    const visible = publicEvidenceFrames([[approved, synthetic, pending]]);
    expect(visible.map((item) => item.frame_id)).toEqual(["frame-sign-1"]);
    expect(RESTAURANT_MERGE_SELECT).toContain(RESTAURANT_EVIDENCE_FRAME_EMBED);
    expect(buildRestaurantSelectFields({
      compact: false,
      includeYoutubeMetaForTheme: false,
    })).toContain(RESTAURANT_EVIDENCE_FRAME_EMBED);
    expect(RESTAURANT_EVIDENCE_FRAME_EMBED).not.toContain("ocr");
    expect(visible[0]?.youtube_seek_url).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}&t=125`);
    const carousel = readFileSync(resolve(import.meta.dir, "../components/restaurant/RestaurantEvidenceCarousel.tsx"), "utf8");
    expect(carousel).toContain('loading={presentation.loading}');
    expect(carousel).toContain('loading: "lazy"');
    expect(carousel).toContain("safe-area-inset-bottom");
    const context = frame({ frame_id: 'context-real', frame_type: 'on_site_scene', timestamp_ms: 126500, content_sha256: 'c'.repeat(64) });
    expect(publicEvidenceFrames([[context]])).toEqual([]);
    expect(publicReviewedVideoFrames([[context, pending, synthetic]]).map((f) => f.frame_id)).toEqual(['context-real']);
    expect(publicEvidenceImageSource(context)).toBe(`/evidence-frames/${context.storage_object_key}`);
    expect(() => publicEvidenceImageSource({ ...context, storage_object_key: '../secret' })).toThrow();
    const badge = readFileSync(resolve(import.meta.dir, "../components/restaurant/PopularityBadge.tsx"), "utf8");
    expect(badge).toContain("next/dynamic");
    expect(badge).not.toContain("from \"three\"");
  });

  test("operational caution ignores a plain search miss and does not use device coordinates", () => {
    expect(operationalCaution({ automaticState: "needs_review" })).toBeNull();
    expect(operationalCaution({ automaticState: "closure_candidate" })).toBe("closure_candidate");
    expect(operationalCaution({ reviewedStatus: "closed_store", reviewed: false })).toBeNull();
    expect(operationalCaution({ reviewedStatus: "relocated", reviewed: true })).toBe("relocated");
    expect(naverPlaceSearchUrl("회전초밥")).toBe("https://map.naver.com/p/search/%ED%9A%8C%EC%A0%84%EC%B4%88%EB%B0%A5");
    expect(naverPlaceSearchUrl("회전초밥")).not.toContain("37.");
  });

  test("marker wrapper stays on transform and opacity", () => {
    const visual = getNaverIndividualMarkerVisual({
      categories: ["한식"],
      category: [],
      popularity_tier: "fire",
    } as Restaurant, false);
    expect(visual.content).toContain('data-popularity-tier="fire"');
    expect(visual.content).toContain('data-restaurant-marker-kind="category"');
    expect(POPULARITY_MARKER_CSS).not.toContain("will-change");
    expect(POPULARITY_MARKER_CSS).not.toContain("drop-shadow");
    expect(POPULARITY_MARKER_CSS).toContain("prefers-reduced-motion");
    expect(POPULARITY_MARKER_CSS).toContain("animation-play-state: paused");
    const wrapped = wrapMarkerWithPopularityTier("<span>pin</span>", "fire");
    expect(wrapped).toContain("<style>");
    expect(wrapped).toContain('data-popularity-tier="fire"');
    expect(wrapped).toContain("<span>pin</span>");
    expect(publicPopularityTier("fire")).toBe("fire");
    expect(publicPopularityTier("rainbow")).toBe("rainbow");
    expect(publicPopularityTier(null)).toBe("standard");
    expect(publicPopularityTier("shadow")).toBe("standard");
    const panel = readFileSync(resolve(import.meta.dir, "../components/restaurant/RestaurantDetailPanel.tsx"), "utf8");
    expect(panel).not.toContain("resolvePublishedPopularityTier(restaurant)");
    expect(panel).not.toContain("PopularityMention");
    expect(panel).not.toContain("제일 맛있는 맛집");
    expect(panel).not.toContain('<PopularityBadge tier="standard" />');
    const rainbow = wrapMarkerWithPopularityTier("<span>pin</span>", "rainbow");
    expect(rainbow.match(/class="tz-popularity-flame"/g)).toHaveLength(1);
    expect(rainbow).toContain("fill: #2f6bff");
    const ember = wrapMarkerWithPopularityTier("<span>pin</span>", "ember");
    expect(ember.match(/class="tz-popularity-flame"/g)).toHaveLength(1);
    expect(ember).toContain("fill: #ff7b43");
    const attributes = new Map<string, string>();
    const element = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    };
    syncPopularityMarkerInteraction(element, true);
    expect(attributes.get("data-map-interacting")).toBe("true");
    syncPopularityMarkerInteraction(element, false);
    expect(attributes.has("data-map-interacting")).toBe(false);
  });

  test("merged media unions approved frames and does not promote a higher tier", () => {
    const approved = frame();
    const restaurant = {
      id: "primary",
      popularity_tier: "standard",
      evidence_frames: [approved],
      mergedRestaurants: [{
        id: "older",
        popularity_tier: "fire",
        evidence_frames: [approved],
      }],
    } as unknown as Restaurant;
    const media = collectRestaurantMergedMedia(restaurant);
    expect(media.evidenceFrames.map((item) => item.frame_id)).toEqual(["frame-sign-1"]);
    expect(restaurant.popularity_tier).toBe("standard");
    const embedded = { ...approved, image_url: undefined, timestamp_ms: String(approved.timestamp_ms) };
    const panelInput = {
      id: "panel-without-merged-field",
      restaurant_evidence_frames: [embedded],
    } as unknown as Restaurant;
    expect(panelInput.mergedEvidenceFrames).toBeUndefined();
    const fromPanelInput = collectRestaurantMergedMedia(panelInput);
    expect(fromPanelInput.evidenceFrames.map((item) => item.frame_id)).toEqual(["frame-sign-1"]);
    expect(fromPanelInput.evidenceFrames[0]?.youtube_seek_url).toBe(approved.youtube_seek_url);
    expect(fromPanelInput.evidenceFrames[0]?.image_url).toBeNull();
  });

  test("missing evidence embed falls back without dropping restaurants", async () => {
    const select = RESTAURANT_MERGE_SELECT;
    const calls: string[] = [];
    const rows = await fetchRestaurantsRecoveringMissingEmbed<[{ id: string }]>([
      ["select", select],
      ["id", "eq.1"],
    ], async (query) => {
      const chosen = String(query.find(([key]) => key === "select")?.[1]);
      calls.push(chosen);
      if (chosen.includes("restaurant_evidence_frames(")) {
        throw new Error("Supabase REST restaurants failed: 400 PGRST200 relation missing");
      }
      return [{ id: "kept" }];
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain("restaurant_evidence_frames(");
    expect(rows).toEqual([{ id: "kept" }]);
    await expect(fetchRestaurantsRecoveringMissingEmbed([
      ["select", select],
    ], async () => {
      throw new Error("Supabase REST restaurants failed: 500");
    })).rejects.toThrow(/500/);
  });

  test("badge viewer stays closed until experimental mode is opened and can close again", () => {
    expect(badgeViewerPhase(false, false)).toBe("off");
    expect(badgeViewerPhase(false, true)).toBe("off");
    expect(badgeViewerPhase(true, false)).toBe("offer");
    expect(badgeViewerPhase(true, true)).toBe("open");
    expect(badgeViewerPhase(true, false)).toBe("offer");
    const panel = readFileSync(resolve(import.meta.dir, "../components/restaurant/RestaurantDetailPanel.tsx"), "utf8");
    const badge = readFileSync(resolve(import.meta.dir, "../components/restaurant/PopularityBadge.tsx"), "utf8");
    expect(panel).not.toContain("assetAvailable={false}");
    expect(badge).toContain("onError");
    expect(badge).toContain("/assets/badges/badge_popular_fire_40.webp");
    expect(badge).toContain("/assets/badges/badge_popular_rainbow_40.webp");
  });

  test("open cross-check clauses stay locked without new formulas", () => {
    const approved = frame();
    for (const key of ["email", "face", "license_plate"]) {
      expect(() => parseEvidenceFrame({ ...approved, [key]: "hidden" })).toThrow(EvidenceContractError);
      try {
        parseEvidenceFrame({ ...approved, [key]: "hidden" });
      } catch (error) {
        expect((error as EvidenceContractError).code).toBe("personal_data_forbidden");
      }
    }
    const second = frame({
      frame_id: "frame-sign-2",
      timestamp_ms: 10_000,
      content_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const synthetic = frame({
      frame_id: "frame-synthetic",
      evidence_level: "SYNTHETIC_MOCK_TESTED",
      timestamp_ms: 20_000,
      content_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    const visible = publicEvidenceFrames([[approved, synthetic], [second, approved]]);
    expect(visible.map((item) => item.frame_id)).toEqual(["frame-sign-2", "frame-sign-1"]);
    expect(unionApprovedEvidenceFrames([[approved], [approved]]).map((item) => item.frame_id)).toEqual(["frame-sign-1"]);
    const stripped = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
    expect(approved.youtube_seek_url).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}&t=125`);
    expect(approved.youtube_seek_url).not.toBe(stripped);
    expect(() => parseEvidenceFrame({ ...approved, youtube_seek_url: stripped })).toThrow(/seek_integrity_mismatch/);
    const card = publicFramePresentation(approved);
    expect(card.href).toBe(approved.youtube_seek_url);
    expect(card.loading).toBe("lazy");
    expect(card.bulkHighResolutionFetch).toBe(false);
    expect(card.enlargement).toBe("separate_request");
    expect(MARKER_EFFECT_CONTRACT.webglContextsPerMarker).toBe(0);
    expect(MARKER_EFFECT_CONTRACT.threeJsOnMarkers).toBe(false);
    const badge = readFileSync(resolve(import.meta.dir, "../components/restaurant/PopularityBadge.tsx"), "utf8");
    const marker = readFileSync(resolve(import.meta.dir, "../lib/naver-map-marker-visuals.ts"), "utf8");
    const route = readFileSync(resolve(import.meta.dir, "../app/api/admin/evidence-frames/route.ts"), "utf8");
    expect(badge).toContain("ssr: false");
    expect(badge).toContain("scale(1.15)");
    expect(badge).toContain("prefers-reduced-motion");
    expect(badge).not.toContain("from \"three\"");
    const viewer = readFileSync(resolve(import.meta.dir, "../components/restaurant/Badge3DViewer.tsx"), "utf8");
    expect(viewer).toContain("from \"three\"");
    expect(viewer).toContain(".dispose(");
    expect(viewer).toContain("webglcontextlost");
    expect(viewer).toContain("정적 배지로 표시합니다.");
    expect(viewer).toContain("setStaticFallback(true)");
    expect(viewer).toContain("webgl_unavailable");
    expect(viewer).not.toContain("lowPower ? <p>정적 배지로 표시합니다.</p>");
    expect(marker).not.toContain("from \"three\"");
    expect(marker).not.toContain("Badge3DViewer");
    expect(POPULARITY_BADGE_KINDS).toEqual(["fire", "rainbow"]);
    expect(BADGE_BYTE_COUNT_IS_PASS_THRESHOLD).toBe(false);
    expect(badge).not.toContain("15360");
    expect(operationalCaution({ reviewedStatus: "closed_store", reviewed: true })).toBe("closed_store");
    expect(operationalCaution({ automaticState: "needs_review" })).toBeNull();
    expect(() => assertSameScoringCohort([
      {
        scoring_version: "score-v1",
        cohort_version: "cohort-a",
        computed_at: "2026-10-16T04:00:00.000Z",
        popularity_tier: "standard",
        popularity_score: 1,
      },
      {
        scoring_version: "score-v1",
        cohort_version: "cohort-a",
        computed_at: "2026-10-17T04:00:00.000Z",
        popularity_tier: "fire",
        popularity_score: 9,
      },
    ])).toThrow(/mixed_scoring_cohort/);
    const order = ["requireAdmin", "previewEvidenceModeration", "confirmEvidenceModeration", "applyEvidenceModeration", "persistEvidenceFrameModeration", "audit: applied.audit"];
    const handler = route.slice(route.indexOf("export async function POST"));
    const positions = order.map((token) => handler.indexOf(token));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  test("render summary records percentiles without a 60fps gate", () => {
    const summary = summarizeRenderSamples([10, 20, 80]);
    expect(summary.longTaskCount).toBe(1);
    expect(summary.p50Ms).toBe(20);
    expect(summary.treats60FpsAsGate).toBe(false);
    expect(summary.treatsZeroPaintAsGate).toBe(false);
  });
});
