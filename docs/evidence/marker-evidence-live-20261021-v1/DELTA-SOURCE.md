# Tzudong marker and real-frame delta source

Base immutable revision: 13ded67a820549ae51f5b966104bf900c22aeb1a, repository twoimo/tzudong. This attachment contains only local changes unavailable at that GitHub revision. Reuse the prior thesis; audit this new scoped delta. No repository archive.

Actual observations: 763 approved source rows, 735 merged groups; 710 groups have positive observed video views. 2026 June-July source metrics, never advertised as live/current. 36 fire groups (35 domestic, 1 overseas), 71 rainbow. Public member grades use only the reviewed snapshot, not private shadow. Twelve observed original video frames for four existing approved restaurant/video pairs are canonical DB rows with exact readback. All twelve are context on_site_scene, never L1 identity evidence. Three frames per restaurant; all image bytes preserved as lossless WebP at immutable keys. Prior UI silently omitted all of them.

Review boundary: runtime tests and manual frame inspection were performed by host, not by you. Verify source excerpts and counterexamples; do not invent executions or legal/physical/field evidence.

## Existing source changes

```diff
diff --git a/apps/web/components/map/OverseasMap.tsx b/apps/web/components/map/OverseasMap.tsx
index 20dc20d3..43a344ce 100644
--- a/apps/web/components/map/OverseasMap.tsx
+++ b/apps/web/components/map/OverseasMap.tsx
@@ -4,6 +4,7 @@ import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
 import * as maplibregl from 'maplibre-gl';
 import '@/styles/maplibre-gl.css';
 import type { Restaurant } from '@/types/restaurant';
+import { syncPopularityMarkerInteraction } from '@/lib/evidence-engineering/popularity-marker';
 import type { FilterState } from '@/components/filters/filter-state';
 import { useRestaurants } from '@/hooks/use-restaurants';
 import { MapSkeleton } from '@/components/skeletons/MapSkeleton';
@@ -225,6 +226,13 @@ const OverseasMap: React.FC<OverseasMapProps> = ({
                 setMapIssue(null);
                 setIsMapLoaded(true);
             });
+            const interactionElement = mapContainer.current;
+            mapInstance.on('movestart', () => {
+                if (interactionElement) syncPopularityMarkerInteraction(interactionElement, true);
+            });
+            mapInstance.on('moveend', () => {
+                if (interactionElement) syncPopularityMarkerInteraction(interactionElement, false);
+            });
 
             mapInstance.on('error', () => {
                 if (!disposed && !loaded) setMapIssue('error');
@@ -368,6 +376,7 @@ const OverseasMap: React.FC<OverseasMapProps> = ({
                 el.innerHTML = buildOverseasMarkerHtml({
                     imagePath,
                     name: restaurant.name,
+                    popularityTier: restaurant.popularity_tier,
                 });
 
                 el.addEventListener('click', (e) => {
@@ -382,9 +391,18 @@ const OverseasMap: React.FC<OverseasMapProps> = ({
                     .addTo(map.current!);
 
                 markersRef.current.set(restaurant.id, marker);
+            } else {
+                const marker = markersRef.current.get(restaurant.id)!;
+                const element = marker.getElement();
+                const tier = restaurant.popularity_tier ?? 'standard';
+                if (element.querySelector('[data-popularity-tier]')?.getAttribute('data-popularity-tier') !== tier) {
+                    element.innerHTML = buildOverseasMarkerHtml({ imagePath: getRestaurantCategoryIcon(restaurant), name: restaurant.name, popularityTier: tier });
+                    const activeId = getOverseasMarkerActiveId({ searchedRestaurantId: searchedRestaurant?.id, selectedRestaurantId: selectedRestaurant?.id });
+                    applyOverseasMarkerSelectedState({ container: element.querySelector('.marker-container'), isSelected: restaurant.id === activeId, markerElement: element });
+                }
             }
         });
-    }, [restaurantsToShow, isMapLoaded, moveToRestaurant, onRestaurantSelect, onMarkerClick]);
+    }, [restaurantsToShow, isMapLoaded, moveToRestaurant, onRestaurantSelect, onMarkerClick, searchedRestaurant, selectedRestaurant]);
 
     // Handle Selection State (Update existing markers without re-creating)
     useEffect(() => {
diff --git a/apps/web/components/restaurant/PopularityBadge.tsx b/apps/web/components/restaurant/PopularityBadge.tsx
index 2325ca4a..77fdaa38 100644
--- a/apps/web/components/restaurant/PopularityBadge.tsx
+++ b/apps/web/components/restaurant/PopularityBadge.tsx
@@ -107,7 +107,7 @@ export function PopularityBadge({
   if (tier === "standard" || assetFailed) return null;
   const phase = badgeViewerPhase(experimental3D, open);
   return (
-    <section aria-label="인기 맛집 배지" className="tz-popularity-badge">
+    <section aria-label="인기 맛집 배지" className="tz-popularity-badge" title="연결된 쯔양 영상 조회수 기준 · 맛 평가가 아니에요">
       <style>{`
         .tz-popularity-badge img { transform: scale(1); }
         @media (hover: hover) and (prefers-reduced-motion: no-preference) {
@@ -124,6 +124,7 @@ export function PopularityBadge({
         height={40}
         onError={() => setAssetFailed(true)}
       />
+      <p className="text-xs text-muted-foreground">영상 조회수 상위권 · 2026년 6–7월 수집 기준</p>
       {phase !== "off" ? (
         <button
           ref={openerRef}
diff --git a/apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx b/apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx
index 840190d8..b27f7e9b 100644
--- a/apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx
+++ b/apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx
@@ -26,6 +26,11 @@ export function evidenceFrameEmbedRow(item: unknown): unknown {
 }
 
 export function publicEvidenceFrames(groups: readonly unknown[][]): RestaurantEvidenceFrame[] {
+  return publicReviewedVideoFrames(groups).filter(isLevel1SourceObserved);
+}
+
+// Reviewed video context may be shown, but does not become L1 identity proof.
+export function publicReviewedVideoFrames(groups: readonly unknown[][]): RestaurantEvidenceFrame[] {
   const parsed = groups.map((group) => group.flatMap((item) => {
     try {
       return [parseEvidenceFrame(evidenceFrameEmbedRow(item))];
@@ -34,10 +39,21 @@ export function publicEvidenceFrames(groups: readonly unknown[][]): RestaurantEv
     }
   }));
   return unionApprovedEvidenceFrames(parsed).filter(
-    (frame) => frame.evidence_level !== "SYNTHETIC_MOCK_TESTED" && isLevel1SourceObserved(frame),
+    (frame) => frame.evidence_level === "SOURCE_OBSERVED",
   );
 }
 
+export function publicEvidenceImageSource(frame: RestaurantEvidenceFrame): string {
+  const valid = parseEvidenceFrame(frame);
+  return valid.image_url ?? `/evidence-frames/${valid.storage_object_key}`;
+}
+
+function frameLabel(frame: RestaurantEvidenceFrame): string {
+  if (frame.frame_type === "storefront_sign") return "매장 간판";
+  if (frame.frame_type === "publisher_location_caption") return "영상의 매장 안내";
+  return frame.frame_type === "menu_receipt" ? "메뉴·영수증 장면" : "영상 속 현장 장면";
+}
+
 export function publicFramePresentation(frame: RestaurantEvidenceFrame): {
   href: string;
   loading: "lazy";
@@ -53,12 +69,15 @@ export function publicFramePresentation(frame: RestaurantEvidenceFrame): {
 }
 
 export function RestaurantEvidenceCarousel({ frames }: { frames: readonly RestaurantEvidenceFrame[][] }) {
-  const visible = publicEvidenceFrames(frames);
+  const visible = publicReviewedVideoFrames(frames);
   if (visible.length === 0) return null;
   return (
-    <section className="px-4 pb-[env(safe-area-inset-bottom)]" aria-label="쯔양 방문 확정 근거">
-      <h3 className="mb-2 text-sm font-semibold">이 맛집이 등록된 이유 (영상 속 실제 간판·장면)</h3>
-      <div className="flex gap-2 overflow-x-auto">
+    <section className="py-2 pb-[env(safe-area-inset-bottom)]" aria-label="쯔양 영상 근거와 방문 장면">
+      <h3 className="mb-2 text-sm font-semibold">영상에서 확인한 간판·방문 장면</h3>
+      {visible.some((frame) => !isLevel1SourceObserved(frame)) && (
+        <p className="mb-2 text-xs text-muted-foreground">현장 장면은 영상의 맥락을 보여주며, 매장 신원을 확인하는 간판·매장 안내와 구분해요.</p>
+      )}
+      <div className="flex gap-3 overflow-x-auto pb-2" tabIndex={0} aria-label="영상 장면 가로 스크롤">
         {visible.map((frame) => {
           const presentation = publicFramePresentation(frame);
           return (
@@ -67,21 +86,23 @@ export function RestaurantEvidenceCarousel({ frames }: { frames: readonly Restau
             href={presentation.href}
             target="_blank"
             rel="noopener noreferrer"
-            className="block w-40 shrink-0"
+            className="block w-[min(68vw,18rem)] shrink-0 rounded-lg border border-border bg-background sm:w-64 lg:w-72"
+            aria-label={`${frameLabel(frame)} ${Math.floor(frame.timestamp_ms / 60000)}분 ${Math.floor(frame.timestamp_ms / 1000) % 60}초 영상 열기`}
           >
-            {frame.image_url ? (
-              // eslint-disable-next-line @next/next/no-img-element -- Approved evidence frames stay native lazy images so unknown storage hosts are not sent through the optimizer.
+              {/* eslint-disable-next-line @next/next/no-img-element -- Immutable reviewed frames use native lazy images. */}
               <img
-                src={frame.image_url}
-                alt={frame.detected_shop_name ?? "방문 근거 프레임"}
-                width={160}
-                height={90}
+                src={publicEvidenceImageSource(frame)}
+                alt={frame.detected_shop_name ?? frameLabel(frame)}
+                width={640}
+                height={360}
                 loading={presentation.loading}
-                className="aspect-video w-full rounded-md object-cover"
+                decoding="async"
+                className="aspect-video w-full rounded-t-lg object-cover"
               />
-            ) : (
-              <span className="flex aspect-video w-full items-center justify-center rounded-md bg-muted text-xs">장면</span>
-            )}
+              <span className="flex items-center justify-between gap-2 px-2 py-2 text-xs">
+                <span>{frameLabel(frame)}</span>
+                <span className="tabular-nums text-muted-foreground">{Math.floor(frame.timestamp_ms / 60000)}:{String(Math.floor(frame.timestamp_ms / 1000) % 60).padStart(2, "0")}</span>
+              </span>
           </a>
           );
         })}
diff --git a/apps/web/hooks/use-restaurant-detail.tsx b/apps/web/hooks/use-restaurant-detail.tsx
index 59e53d82..c0ae2a17 100644
--- a/apps/web/hooks/use-restaurant-detail.tsx
+++ b/apps/web/hooks/use-restaurant-detail.tsx
@@ -2,7 +2,7 @@ import { useQuery } from "@tanstack/react-query";
 
 import type { Tables } from "@/integrations/supabase/types";
 import type { Restaurant } from "@/types/restaurant";
-import { publicEvidenceFrames } from "@/components/restaurant/RestaurantEvidenceCarousel";
+import { publicReviewedVideoFrames } from "@/components/restaurant/RestaurantEvidenceCarousel";
 import { hydrateRestaurantDetailWithMergeContext } from "@/lib/restaurant-merged-media";
 import { postgrestIn } from "@/lib/supabase-rest-client";
 import { fetchRestaurantsRecoveringMissingEmbed, mergeRestaurants, RESTAURANT_MERGE_SELECT } from "@/hooks/use-restaurants";
@@ -26,7 +26,7 @@ function hydrateDbRestaurant(dbData: DBRestaurant, publishedTier: PublishedPopul
     return {
         ...dbData,
         popularity_tier: publishedTier(dbData.id),
-        evidence_frames: publicEvidenceFrames([Array.isArray(embedded) ? embedded : []]),
+        evidence_frames: publicReviewedVideoFrames([Array.isArray(embedded) ? embedded : []]),
         address: dbData.road_address || dbData.jibun_address || '',
         category: dbData.categories,
     } as Restaurant;
diff --git a/apps/web/lib/evidence-engineering/popularity-marker.ts b/apps/web/lib/evidence-engineering/popularity-marker.ts
index f096dc43..87ee8943 100644
--- a/apps/web/lib/evidence-engineering/popularity-marker.ts
+++ b/apps/web/lib/evidence-engineering/popularity-marker.ts
@@ -1,5 +1,6 @@
 export const POPULARITY_MARKER_CSS = `
-.tz-popularity-marker { position: relative; }
+.tz-popularity-marker { position: relative; width: 100%; height: 100%; }
+.tz-popularity-flame { position: absolute; width: 20px; height: 26px; left: 50%; bottom: 72%; z-index: 2; pointer-events: none; transform: translateX(-50%); animation: tz-popularity-flame 1.4s ease-in-out infinite; }
 .tz-popularity-marker[data-popularity-tier="fire"]::before,
 .tz-popularity-marker[data-popularity-tier="rainbow"]::before {
   content: "";
@@ -17,8 +18,13 @@ export const POPULARITY_MARKER_CSS = `
   50% { transform: scale(1.12); opacity: 1; }
 }
 [data-map-interacting="true"] .tz-popularity-marker::before { animation-play-state: paused; }
+@keyframes tz-popularity-flame {
+  50% { transform: translateX(-50%) translateY(-2px) scale(1.06); opacity: 0.82; }
+}
+[data-map-interacting="true"] .tz-popularity-flame { animation-play-state: paused; }
 @media (prefers-reduced-motion: reduce) {
   .tz-popularity-marker::before { animation: none; }
+  .tz-popularity-flame { animation: none; }
 }
 `;
 
@@ -28,7 +34,8 @@ export function publicPopularityTier(value: unknown): "fire" | "rainbow" | "stan
 
 export function wrapMarkerWithPopularityTier(innerHtml: string, tier: "fire" | "rainbow" | "standard" | null | undefined): string {
   const safeTier = publicPopularityTier(tier);
-  return `<style>${POPULARITY_MARKER_CSS}</style><div class="tz-popularity-marker" data-popularity-tier="${safeTier}">${innerHtml}</div>`;
+  const flame = safeTier === "fire" ? '<svg class="tz-popularity-flame" viewBox="0 0 32 42" aria-hidden="true" focusable="false"><path fill="#f97316" stroke="#fff7ed" stroke-width="1.4" d="M17 1c3 12-7 14-6 22 3-2 5-5 5-8 12 9 17 26 0 26C-3 41-3 24 6 15c0 6 1 8 3 9C6 15 19 12 17 1Z"/><path fill="#fde047" d="M17 24c1 6-5 7-4 11 5 4 12-2 4-11Z"/></svg>' : '';
+  return `<style>${POPULARITY_MARKER_CSS}</style><div class="tz-popularity-marker" data-popularity-tier="${safeTier}">${flame}${innerHtml}</div>`;
 }
 
 export function syncPopularityMarkerInteraction(
diff --git a/apps/web/lib/overseas-map-marker-helpers.ts b/apps/web/lib/overseas-map-marker-helpers.ts
index f1a3f2c8..ee6081aa 100644
--- a/apps/web/lib/overseas-map-marker-helpers.ts
+++ b/apps/web/lib/overseas-map-marker-helpers.ts
@@ -1,4 +1,5 @@
 import { escapeHtmlAttribute, sanitizeMarkerImageUrl } from './html-escape';
+import { publicPopularityTier, wrapMarkerWithPopularityTier } from './evidence-engineering/popularity-marker';
 
 const OVERSEAS_MARKER_BASE_SIZE_CLASSES = ['!h-8', '!w-8'] as const;
 const OVERSEAS_MARKER_SELECTED_SIZE_CLASSES = ['!h-[42px]', '!w-[42px]'] as const;
@@ -6,18 +7,20 @@ const OVERSEAS_MARKER_SELECTED_SIZE_CLASSES = ['!h-[42px]', '!w-[42px]'] as cons
 export function buildOverseasMarkerHtml({
     imagePath,
     name,
+    popularityTier,
 }: {
     imagePath: string;
     name: string;
+    popularityTier?: unknown;
 }) {
     const safeImagePath = escapeHtmlAttribute(sanitizeMarkerImageUrl(imagePath));
     const safeName = escapeHtmlAttribute(name);
 
-    return `
+    return wrapMarkerWithPopularityTier(`
         <div class="marker-container relative h-full w-full cursor-pointer hover:scale-110">
             <img src="${safeImagePath}" class="h-full w-full object-contain" alt="${safeName}" draggable="false" />
         </div>
-    `;
+    `, publicPopularityTier(popularityTier));
 }
 
 export function getOverseasMarkerActiveId({

```

## apps/web/scripts/publish-evidence-frames.ts

```typescript
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { parseEvidenceFrame } from '../lib/evidence-engineering/frames';
import { uploadEvidenceWebp, type EvidenceObjectStore } from '../lib/evidence-engineering/upload-evidence-frame';
import { extractCanonicalYouTubeVideoId } from '../lib/youtube-url';

type ReviewedFrame = { restaurant_id: string; source_file: string; frame: unknown };

export async function previewFramePublication(manifestPath: string, sourceDirectory: string) {
  const source = await realpath(sourceDirectory);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { restaurantSourceSha256: string; frames?: ReviewedFrame[] };
  const restaurantBytes = await readFile(resolve(dirname(manifestPath), 'approved-source-rows.json'));
  if (createHash('sha256').update(restaurantBytes).digest('hex') !== manifest.restaurantSourceSha256) throw new Error('restaurant_source_hash_mismatch');
  const restaurants = JSON.parse(restaurantBytes.toString()) as { rows: Array<{ id: string; status: string; youtube_link: string }> };
  const byRestaurant = new Map(restaurants.rows.map((row) => [row.id, row]));
  if (!Array.isArray(manifest.frames) || manifest.frames.length < 1 || manifest.frames.length > 5000) throw new Error('invalid_frame_manifest');
  const seen = new Set<string>();
  const seenKeys = new Set<string>();
  const entries = [];
  for (const item of manifest.frames) {
    if (!/^[a-f0-9-]{36}$/.test(item.restaurant_id) || typeof item.source_file !== 'string') throw new Error('invalid_frame_owner');
    const frame = parseEvidenceFrame(item.frame);
    const restaurant = byRestaurant.get(item.restaurant_id);
    if (!restaurant || restaurant.status !== 'approved' || extractCanonicalYouTubeVideoId(restaurant.youtube_link) !== frame.video_id) throw new Error('frame_restaurant_video_mismatch');
    if (frame.moderation_status !== 'approved' || frame.evidence_level !== 'SOURCE_OBSERVED') throw new Error('frame_not_reviewed');
    if (seen.has(frame.frame_id) || seenKeys.has(frame.storage_object_key)) throw new Error('duplicate_frame');
    seen.add(frame.frame_id); seenKeys.add(frame.storage_object_key);
    const file = await realpath(resolve(source, item.source_file));
    if (!file.startsWith(source + sep)) throw new Error('source_path_outside_root');
    const bytes = await readFile(file);
    // Run exactly the production upload validation during preview too.
    await uploadEvidenceWebp({ videoId: frame.video_id, timestampMs: frame.timestamp_ms, contentSha256: frame.content_sha256, bytes }, { exists: async () => false, put: async () => ({ publicUrl: null }) });
    entries.push({ restaurant_id: item.restaurant_id, frame, file, bytes });
  }
  const digest = createHash('sha256').update(JSON.stringify(entries.map(({ restaurant_id, frame }) => ({ restaurant_id, frame })))).digest('hex');
  return { entries, previewHash: digest };
}

export async function publishFrameFiles(manifestPath: string, sourceDirectory: string, outputDirectory: string, confirmationHash: string) {
  const preview = await previewFramePublication(manifestPath, sourceDirectory);
  if (confirmationHash !== preview.previewHash) throw new Error('publication_confirmation_mismatch');
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const physicalOutput = await realpath(output);
  for (const { frame, bytes } of preview.entries) {
    const file = resolve(output, frame.storage_object_key);
    if (!file.startsWith(output + sep)) throw new Error('output_path_outside_root');
    await mkdir(dirname(file), { recursive: true });
    if (!(await realpath(dirname(file))).startsWith(physicalOutput + sep)) throw new Error('output_symlink_outside_root');
    let existing: Buffer | null = null;
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error('output_file_is_symlink');
      existing = await readFile(file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (existing) {
      if (!existing.equals(bytes)) throw new Error('immutable_frame_collision');
      continue;
    }
    const store: EvidenceObjectStore = {
      exists: async () => false,
      put: async (_key, body) => { await writeFile(file, body, { flag: 'wx' }); return { publicUrl: null }; },
    };
    await uploadEvidenceWebp({ videoId: frame.video_id, timestampMs: frame.timestamp_ms, contentSha256: frame.content_sha256, bytes }, store);
  }
  return { previewHash: preview.previewHash, frames: preview.entries.map(({ restaurant_id, frame }) => ({ restaurant_id, ...frame })) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (key: string) => args[args.indexOf(key) + 1];
  if (!args.includes('--manifest') || !args.includes('--source-dir')) throw new Error('manifest_and_source_required');
  const result = args.includes('--apply')
    ? await publishFrameFiles(arg('--manifest'), arg('--source-dir'), args.includes('--output-dir') ? arg('--output-dir') : 'public/evidence-frames', arg('--confirm'))
    : await previewFramePublication(arg('--manifest'), arg('--source-dir'));
  console.log(JSON.stringify({ previewHash: result.previewHash, frames: 'frames' in result ? result.frames.length : result.entries.length, applied: args.includes('--apply') }));
}

```

## apps/web/scripts/build-public-popularity.ts

```typescript
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { mergeRestaurants } from '../hooks/use-restaurants';
import { extractCanonicalYouTubeVideoId } from '../lib/youtube-url';
import { parsePublicPopularityPublication } from '../lib/evidence-engineering/published-popularity';
import { restaurantMatchesOverseasCountry } from '../lib/overseas-region-matching';
import { OVERSEAS_REGIONS } from '../constants/overseas-regions';
import type { Tables } from '../integrations/supabase/types';

export async function buildPublicPopularity(sourcePath: string, metricsPath: string, revision: string) {
  const sourceBytes = await readFile(sourcePath);
  const metricBytes = await readFile(metricsPath);
  const source = JSON.parse(sourceBytes.toString()) as { rows: Array<Record<string, unknown>> };
  const metrics = JSON.parse(metricBytes.toString()) as { rows: Array<{ video_id: string; view_count: number | string; fetched_at: string; bucket_started_at: string }> };
  const byVideo = new Map(metrics.rows.map((r) => [r.video_id, r]));
  const rows = source.rows.map((r) => ({ ...r, approved_name: r.name })) as unknown as Tables<'restaurants'>[];
  const countries = [...new Set(Object.values(OVERSEAS_REGIONS).map((r) => r.country))];
  const groups = mergeRestaurants(rows, () => 'standard').map((r) => {
    const members = r.mergedRestaurants?.length ? r.mergedRestaurants : [r];
    const ids = [...new Set(members.map((m) => m.id))].sort();
    const videos = [...new Set(members.map((m) => extractCanonicalYouTubeVideoId(m.youtube_link ?? '')).filter((v): v is string => !!v))];
    const observed = videos.flatMap((id) => {
      const metric = byVideo.get(id); const count = Number(metric?.view_count);
      return metric && Number.isSafeInteger(count) && count > 0 ? [{ videoId: id, count, observedAt: metric.fetched_at || metric.bucket_started_at }] : [];
    });
    const overseas = countries.some((country) => restaurantMatchesOverseasCountry(r, country)) || Number(r.lat) < 32 || Number(r.lat) > 40 || Number(r.lng) < 124 || Number(r.lng) > 132;
    return { restaurantId: ids[0], memberRestaurantIds: ids, name: r.name, cohort: overseas ? 'overseas' : 'domestic', viewCount: observed.length ? Math.max(...observed.map((m) => m.count)) : null, observed };
  });
  const thresholds = ['domestic', 'overseas'].map((cohort) => {
    const counts = groups.filter((g) => g.cohort === cohort && g.viewCount !== null).map((g) => g.viewCount!).sort((a, b) => a - b);
    const percentile = (p: number) => counts.length ? counts[Math.max(0, Math.ceil(counts.length * p) - 1)] : null;
    return { cohort, knownGroups: counts.length, fireAt: percentile(0.95), rainbowAt: percentile(0.85) };
  });
  const entries = groups.map((group) => {
    const cut = thresholds.find((c) => c.cohort === group.cohort)!;
    const tier = group.viewCount === null || cut.fireAt === null ? 'standard' : group.viewCount >= cut.fireAt ? 'fire' : group.viewCount >= cut.rainbowAt! ? 'rainbow' : 'standard';
    return { restaurantId: group.restaurantId, memberRestaurantIds: group.memberRestaurantIds, tier };
  }).sort((a, b) => a.restaurantId.localeCompare(b.restaurantId));
  const publication = parsePublicPopularityPublication({ schemaVersion: 2, publicationVersion: 'video-views-20261021-v1', sourceRevision: revision, entries });
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  return { publication, evidence: { policy: 'map-cohort-max-linked-video-views-nearest-rank-p95-p85-v1', definition: 'Most-viewed linked video per merged restaurant, ranked separately within domestic and overseas approved restaurant cohorts. This measures video reach, not food quality.', sourceSha256: sha(sourceBytes), metricsSha256: sha(metricBytes), thresholds, groups } };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const result = await buildPublicPopularity(args[0], args[1], args[2]);
  await writeFile(args[3], JSON.stringify(result.publication, null, 2) + '\n');
  await writeFile(args[4], JSON.stringify(result.evidence, null, 2) + '\n');
  console.log(JSON.stringify({ groups: result.publication.entries.length, tiers: result.publication.entries.reduce((a, e) => ({ ...a, [e.tier]: (a[e.tier] ?? 0) + 1 }), {} as Record<string, number>), thresholds: result.evidence.thresholds }));
}

```

## apps/web/tests-unit/evidence-publication-runtime.test.ts

```typescript
import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildEvidenceFrame } from '../lib/evidence-engineering/frames';
import { previewFramePublication, publishFrameFiles } from '../scripts/publish-evidence-frames';
import { buildPublicPopularity } from '../scripts/build-public-popularity';
import publication from '../lib/evidence-engineering/public-popularity-publication.json';
import { wrapMarkerWithPopularityTier } from '../lib/evidence-engineering/popularity-marker';
import { buildOverseasMarkerHtml } from '../lib/overseas-map-marker-helpers';

const cleanups: string[] = [];
afterEach(async () => { for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true }); });
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tzudong-publication-test-')); cleanups.push(root);
  const source = join(root, 'source'); const output = join(root, 'public'); await mkdir(source);
  const reviewed = JSON.parse(await readFile(resolve(import.meta.dir, '../../../docs/evidence/marker-evidence-live-20261021-v1/reviewed-frames.json'), 'utf8'));
  const first = reviewed.frames[0];
  const bytes = await readFile(resolve(import.meta.dir, '../public/evidence-frames', first.frame.storage_object_key));
  await writeFile(join(source, 'frame.webp'), bytes);
  const restaurantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const frame = buildEvidenceFrame({ ...first.frame, frame_id: 'test-frame' });
  const restaurantBytes = Buffer.from(JSON.stringify({ rows: [{ id: restaurantId, status: 'approved', youtube_link: `https://www.youtube.com/watch?v=${frame.video_id}` }] }));
  await writeFile(join(root, 'approved-source-rows.json'), restaurantBytes);
  const manifest = { restaurantSourceSha256: sha(restaurantBytes), frames: [{ restaurant_id: restaurantId, source_file: 'frame.webp', frame: { ...frame } }] };
  const path = join(root, 'manifest.json'); await writeFile(path, JSON.stringify(manifest));
  return { root, source, output, bytes, frame, manifest, path };
}

describe('reviewed evidence publication', () => {
  test('publishes hash-verified WebP idempotently and refuses a wrong confirmation or immutable collision', async () => {
    const f = await fixture(); const preview = await previewFramePublication(f.path, f.source);
    await expect(publishFrameFiles(f.path, f.source, f.output, 'wrong')).rejects.toThrow('publication_confirmation_mismatch');
    await publishFrameFiles(f.path, f.source, f.output, preview.previewHash);
    const target = join(f.output, f.frame.storage_object_key);
    expect(await readFile(target)).toEqual(f.bytes);
    await publishFrameFiles(f.path, f.source, f.output, preview.previewHash);
    await writeFile(target, 'collision');
    await expect(publishFrameFiles(f.path, f.source, f.output, preview.previewHash)).rejects.toThrow('immutable_frame_collision');
  });

  test('rejects unreviewed frames, altered bytes, source traversal and mismatched restaurant videos', async () => {
    const f = await fixture();
    f.manifest.frames[0].frame.moderation_status = 'pending'; await writeFile(f.path, JSON.stringify(f.manifest));
    await expect(previewFramePublication(f.path, f.source)).rejects.toThrow('frame_not_reviewed');
    f.manifest.frames[0].frame.moderation_status = 'approved';
    f.manifest.frames[0].frame.video_id = 'abc123DEF45';
    f.manifest.frames[0].frame = buildEvidenceFrame(f.manifest.frames[0].frame); await writeFile(f.path, JSON.stringify(f.manifest));
    await expect(previewFramePublication(f.path, f.source)).rejects.toThrow('frame_restaurant_video_mismatch');
    f.manifest.frames[0].frame = f.frame; f.manifest.frames[0].source_file = '../outside.webp';
    await writeFile(join(f.root, 'outside.webp'), f.bytes); await writeFile(f.path, JSON.stringify(f.manifest));
    await expect(previewFramePublication(f.path, f.source)).rejects.toThrow('source_path_outside_root');
    f.manifest.frames[0].source_file = 'frame.webp'; await writeFile(f.path, JSON.stringify(f.manifest)); await writeFile(join(f.source, 'frame.webp'), Buffer.concat([f.bytes, Buffer.from([1])]));
    await expect(previewFramePublication(f.path, f.source)).rejects.toThrow('content_hash_mismatch');
  });

  test('refuses publication through an output symlink', async () => {
    const f = await fixture(); const preview = await previewFramePublication(f.path, f.source);
    const outside = join(f.root, 'outside'); await mkdir(outside); await mkdir(f.output);
    await symlink(outside, dirname(join(f.output, f.frame.storage_object_key)), 'dir');
    await expect(publishFrameFiles(f.path, f.source, f.output, preview.previewHash)).rejects.toThrow('output_symlink_outside_root');
  });
});

describe('actual public popularity cohort', () => {
  test('reproduces every published member from the frozen public business rows and observed video metrics', async () => {
    const evidence = resolve(import.meta.dir, '../../../docs/evidence/marker-evidence-live-20261021-v1');
    const result = await buildPublicPopularity(join(evidence, 'approved-source-rows.json'), join(evidence, 'video-metrics-source.json'), publication.sourceRevision!);
    expect(result.publication).toEqual(publication);
    expect(result.evidence.thresholds.every((c) => c.knownGroups > 0 && c.fireAt! > 0)).toBe(true);
    const fire = publication.entries.find((e) => e.tier === 'fire')!;
    const domestic = wrapMarkerWithPopularityTier('<span>pin</span>', fire.tier as 'fire');
    const overseas = buildOverseasMarkerHtml({ imagePath: '/images/maker-images/webp/asian.webp', name: 'actual cohort marker', popularityTier: fire.tier });
    for (const html of [domestic, overseas]) {
      expect(html).toContain('class="tz-popularity-flame"');
      expect(html).toContain('data-popularity-tier="fire"');
      expect(html).not.toContain('<canvas');
    }
    expect(wrapMarkerWithPopularityTier('<span>pin</span>', 'standard')).not.toContain('<svg');
  });
});

```
