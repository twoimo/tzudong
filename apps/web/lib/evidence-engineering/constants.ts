export const EVIDENCE_ENGINEERING_CONTRACT_VERSION = "2026-10-17.task1";

export const EVIDENCE_LEVELS = [
  "SOURCE_OBSERVED",
  "BOUNDARY_INTEGRATION_TESTED",
  "SYNTHETIC_MOCK_TESTED",
  "HOST_TESTED",
  "PROPOSED",
  "UNVERIFIED",
  "CONTRADICTED",
] as const;

/** Labels from the thesis. They are names, not a quality ordering. */
export const EVIDENCE_LEVEL_LABELS = {
  SOURCE_OBSERVED: "L1",
  BOUNDARY_INTEGRATION_TESTED: "L2",
  SYNTHETIC_MOCK_TESTED: "L3",
  HOST_TESTED: "L4",
  PROPOSED: "L5",
  UNVERIFIED: "L6",
  CONTRADICTED: "L7",
} as const;

export const EVIDENCE_FRAME_TYPES = [
  "storefront_sign",
  "publisher_location_caption",
  "on_site_scene",
  "menu_receipt",
] as const;

export const LEVEL1_FRAME_TYPES = ["storefront_sign", "publisher_location_caption"] as const;

export const CONFIDENCE_LEVELS = ["certain", "probable", "uncertain"] as const;

export const MODERATION_STATUSES = ["pending", "approved", "rejected"] as const;

export const POPULARITY_TIERS = ["fire", "ember", "rainbow", "standard"] as const;

export const IDENTITY_PIPELINE_STAGES = ["candidate_discovered", "identity_evidence_checked"] as const;

export const IDENTITY_TERMINAL_STATES = [
  "supported",
  "conflict",
  "needs_review",
  "closure_candidate",
] as const;

export const REVIEWED_OPERATIONAL_STATUSES = [
  "supported",
  "conflict",
  "closed_store",
  "relocated",
] as const;

export const FETCH_DECISIONS = ["accept", "retry_later", "stop_source"] as const;

export const EVIDENCE_FAMILIES = [
  "lexical_name_match",
  "exact_parcel_coordinate_match",
  "bounded_spatial_proximity",
  "telecom_identifier_match",
  "mois_public_license_closed",
] as const;

export const ADJUDICATION_VERDICTS = ["ACCEPT", "CONDITIONAL", "REJECT", "DEFER"] as const;

export const NAVER_QUERY_STAGES = [
  { stage: 1, kind: "exact", template: "origin_name_plus_road_address" },
  { stage: 2, kind: "exact", template: "origin_name_plus_jibun_address" },
  { stage: 3, kind: "exact", template: "sigungu_plus_origin_name" },
  { stage: 4, kind: "broad", template: "sigungu_plus_keyword_plus_category" },
  { stage: 5, kind: "broad", template: "historical_name_plus_admin_dong" },
] as const;

export const DECLARED_NAVER_QUERY_STAGE_COUNT = 10;
export const SPECIFIED_NAVER_QUERY_STAGE_COUNT = NAVER_QUERY_STAGES.length;

export const THESIS_HYPERBOLIC_LAMBDA = 0.0015;
export const THESIS_CLAIMED_HALF_LIFE_DAYS = 460;

/** Thesis weights and linear visit boost. Not the production score. */
export const THESIS_SCORE_WEIGHTS = {
  adopted: false,
  view: 1,
  comment: 2.5,
  like: 1.5,
  review: 3,
  visitLinearCoefficient: 0.2,
} as const;

/**
 * Shape adopted from the synthesis, coefficients explicitly unlocked.
 * visitGamma is Gemini's proposed coefficient, not a function default.
 */
export const PROPOSED_DECAY_DEFAULTS = {
  locked: false,
  classicFloor: 0.5,
  decayableHalfLifeDays: 460,
  visitGamma: 0.25,
} as const;

export const SCORING_GATES = {
  shadowCompareBeforePromotion: true,
  unreproducedCorrelationIsDeploymentGate: false,
  viewCountSplitAdopted: false,
  multipliedScoreAdopted: false,
} as const;

export const REVIEW_SIGNAL = {
  name: "parsed_review_count",
  bayesianPosterior: false,
} as const;

export const THESIS_PROXIMITY_RADIUS_METERS = 150;

export const FRAME_SAMPLING = {
  keyframeRole: "decode_start_only",
  sampleFpsAfterDecode: 2,
  windowMs: 5_000,
  thesisSceneChangeThreshold: 0.35,
  iFrameOnlyFpsGuaranteed: false,
  loadsFullVideoInNode: false,
} as const;

export const MARKER_EFFECT_CONTRACT = {
  renderer: "css_transform_opacity",
  webglContextsPerMarker: 0,
  animatedDropShadow: false,
  unconditionalWillChange: false,
  pauseWhileMapInteracting: true,
  prefersReducedMotion: true,
  threeJsOnMarkers: false,
} as const;

export const DETAIL_BADGE_CONTRACT = {
  defaultRenderer: "static_webp",
  experimental3d: "opt_in_dynamic_import",
  threeJsOnInitialRender: false,
  markerWebglContexts: 0,
} as const;

export const POPULARITY_PERSISTENCE = {
  table: "restaurant_popularity_metrics",
  mutatesRestaurantUpdatedAt: false,
  publicSelect: false,
} as const;

export const EVIDENCE_FRAME_PERSISTENCE = {
  table: "restaurant_evidence_frames",
  canonicalLocator: "storage_object_key",
  embedsInEvaluationResults: false,
  deleteCascadeDecided: false,
} as const;

export const ARCHITECTURE_INVARIANTS = {
  I01: "node_must_not_load_full_video",
  I02: "naver_markers_must_not_create_multiple_webgl_contexts",
  I03: "threejs_only_on_demand_inside_restaurant_detail_panel",
  I04: "popularity_score_runs_as_daily_batch",
  I05: "youtube_seek_timestamp_integrity",
} as const;

export const FORBIDDEN_PAYLOAD_KEYS = [
  "raw_ocr",
  "rawOcr",
  "ocr_text",
  "ocrText",
  "phone",
  "phone_number",
  "phoneNumber",
  "email",
  "face",
  "person_face",
  "license_plate",
  "licensePlate",
  "device_lat",
  "device_lng",
  "deviceLat",
  "deviceLng",
  "precise_location",
  "preciseLocation",
  "request_body",
  "requestBody",
  "provider_diagnostic",
  "providerDiagnostic",
  "cookie",
  "authorization",
  "session_token",
  "sessionToken",
] as const;

export const CONTENT_SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const FRAME_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const VERSION_TOKEN_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const CANONICAL_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export const DETECTED_NAME_MAX_LENGTH = 80;
export const NAME_COMPARE_MAX_CODE_POINTS = 200;
export const STORAGE_HASH_PREFIX_LENGTH = 12;

export const ADJUDICATION_RECORDS = [
  { id: "A01", verdict: "ACCEPT", subject: "hyperbolic_half_life_460_day_claim" },
  { id: "A02", verdict: "CONDITIONAL", subject: "age_decay_dominates_engagement" },
  { id: "A03", verdict: "CONDITIONAL", subject: "floor_decay_form_coefficients_unlocked" },
  { id: "A04", verdict: "REJECT", subject: "review_count_named_bayesian_posterior" },
  { id: "A05", verdict: "ACCEPT", subject: "separate_entity_and_video_aggregation" },
  { id: "A06", verdict: "ACCEPT", subject: "no_threejs_canvas_per_marker" },
  { id: "A07", verdict: "CONDITIONAL", subject: "detail_panel_threejs_opt_in_only" },
  { id: "A08", verdict: "REJECT", subject: "css_guarantees_60fps_and_zero_paint" },
  { id: "A09", verdict: "REJECT", subject: "iframe_only_2fps_guarantee" },
  { id: "A10", verdict: "CONDITIONAL", subject: "extend_existing_frame_pipeline" },
  { id: "A11", verdict: "REJECT", subject: "cookie_or_token_bypass_as_recovery" },
  { id: "A12", verdict: "REJECT", subject: "broad_query_auto_identity" },
  { id: "A13", verdict: "CONDITIONAL", subject: "license_closure_needs_identity_and_time" },
  { id: "A14", verdict: "DEFER", subject: "batch_upsert_200_row_cas_until_sql_verified" },
  { id: "A15", verdict: "ACCEPT", subject: "keep_manual_review_out_of_evaluation_results" },
  { id: "A16", verdict: "ACCEPT", subject: "popularity_must_not_touch_restaurant_updated_at" },
  { id: "A17", verdict: "REJECT", subject: "apply_gemini_sql_patch_verbatim" },
  { id: "A18", verdict: "ACCEPT", subject: "union_approved_frames_by_id" },
  { id: "A19", verdict: "REJECT", subject: "pick_highest_tier_across_cohorts" },
  { id: "A20", verdict: "ACCEPT", subject: "immutable_millisecond_hash_object_key" },
] as const;
