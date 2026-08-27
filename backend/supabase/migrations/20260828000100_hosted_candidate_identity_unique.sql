-- Feature: crawler-pipeline-orchestration (R4.5, R9.7)
-- Enforce a unique constraint on the stable candidate identity at the Hosted_Store
-- insert boundary so a losing concurrent writer observes a conflict.
--
-- Context: both Mac_Runner (apply_hosted_pending_candidates) and the GHA hosted-apply
-- path reflect pending candidates into public.restaurants keyed by the stable candidate
-- identity, which is the YouTube video id derived from youtube_link
-- (public.extract_youtube_video_id). The hosted classifier skips a candidate as
-- "skip_already_on_hosted" purely by that video id. To make the idempotent mutual-backup
-- contract safe under concurrency, at most one active hosted record may exist per
-- candidate identity, so that when two runners race to insert the same video id the
-- losing INSERT fails with a unique-violation conflict and the runner reclassifies the
-- candidate as already present (insert-if-absent).
--
-- Scope discipline:
--   * This migration is ADDITIVE only. It does NOT modify, delete, or overwrite any
--     already-applied migration.
--   * It does NOT alter or drop the existing composite index
--     idx_restaurants_active_video_identity (video id + resolved identity name) created
--     by 20260417_prevent_active_restaurant_identity_duplicates.sql; this index is a
--     strictly narrower guard on the candidate identity alone.
--   * public.extract_youtube_video_id(text) is IMMUTABLE (see 20260417) and is therefore
--     valid in a functional index expression.
--   * The index is partial: it excludes soft-deleted rows and rows with no resolvable
--     video id, matching the active-row and non-empty-identity semantics already used by
--     the insert boundary and the existing composite index.

create unique index if not exists idx_restaurants_active_candidate_identity
on public.restaurants (
  public.extract_youtube_video_id(youtube_link)
)
where status <> 'deleted'
  and public.extract_youtube_video_id(youtube_link) <> '';
