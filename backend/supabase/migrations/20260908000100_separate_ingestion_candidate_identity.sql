-- A video can feature multiple restaurants. Keep the existing video + name
-- restaurant identity; reserve video-only uniqueness for crawler claims.
-- Coordinate publisher rollout with this migration. Historical migrations remain
-- immutable; an unapplied older video-only index needs a separately reviewed
-- hosted promotion plan when the hosted catalog already contains multiple places.
-- No restaurant names, statuses, links, timestamps, or IDs are changed here.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.restaurants IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.restaurants ADD COLUMN is_ingestion_candidate boolean NOT NULL DEFAULT false;

-- Reserve one existing active row per video without merging or deleting places.
WITH existing AS (
  SELECT DISTINCT ON (public.extract_youtube_video_id(youtube_link))
    id, public.extract_youtube_video_id(youtube_link) AS video_id
  FROM public.restaurants
  WHERE status <> 'deleted' AND public.extract_youtube_video_id(youtube_link) <> ''
  ORDER BY public.extract_youtube_video_id(youtube_link), id
)
UPDATE public.restaurants r SET is_ingestion_candidate = true
FROM existing e WHERE r.id = e.id;

CREATE UNIQUE INDEX idx_restaurants_active_ingestion_candidate
ON public.restaurants (public.extract_youtube_video_id(youtube_link))
WHERE status <> 'deleted' AND is_ingestion_candidate
  AND public.extract_youtube_video_id(youtube_link) <> '';

DROP INDEX IF EXISTS public.idx_restaurants_active_candidate_identity;
COMMENT ON COLUMN public.restaurants.is_ingestion_candidate IS
  'Crawler insert-if-absent claim, distinct from video + restaurant name identity. Set by candidate publishers; false for additional places.';
COMMIT;
