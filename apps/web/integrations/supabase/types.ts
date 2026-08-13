export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export type OcrLogMetadata = {
    file_size?: number
    compressed_size?: number
    savings?: string
    store_found?: boolean
    provider?: string
    model?: string
    prompt_version?: string
    preprocess_version?: string
    extraction_schema_version?: string
    routing_mode?: string
    normalization_version?: string
    fallback_used?: boolean
    force_refresh?: boolean
    attempt_count?: number
    confidence?: number
    needs_review?: Array<
        | 'store_name'
        | 'restaurant_id'
        | 'date'
        | 'time'
        | 'total_amount'
        | 'items'
        | 'category'
        | 'review_draft'
    >
    restaurant_lookup?: {
        lookupCount: number
        lookupLimit: number
        stoppedByBudget: boolean
    }
    error_code?: string
}
export type AccountDeletionReasonCode =
    | 'ACTOR_NOT_ALLOWED'
    | 'ACTOR_OR_TARGET_REQUIRED'
    | 'APPLIED'
    | 'APPLY_NOT_STARTED'
    | 'APPLY_STARTED'
    | 'AUTH_CLEANUP_FAILED'
    | 'AUTH_READBACK_PASSED'
    | 'CONFIRMATION_REQUIRED'
    | 'DB_AND_SESSION_READBACK_PASSED'
    | 'DB_CLEANUP_FAILED'
    | 'DB_OR_SESSION_CLEANUP_FAILED'
    | 'DB_READBACK_PASSED'
    | 'IDEMPOTENCY_KEY_MISMATCH'
    | 'INVALID_APPLY_REQUEST'
    | 'LAST_ADMIN_PROTECTED'
    | 'LEGAL_HOLD_ACTIVE'
    | 'POLICY_CHANGED'
    | 'POLICY_UNAVAILABLE'
    | 'PREVIEW_EXPIRED'
    | 'PREVIEW_NOT_FOUND'
    | 'PREVIEW_READY'
    | 'REAUTH_REQUIRED'
    | 'REPLAYED_PREVIEW'
    | 'RETENTION_POLICY_UNAVAILABLE'
    | 'SESSION_READBACK_REQUIRED'
    | 'STORAGE_CLEANUP_FAILED'
    | 'STORAGE_READBACK_PASSED'
    | 'TARGET_NOT_FOUND'
interface DatabaseSource {
    public: {
        Tables: {
            admin_restaurant_map_overlays: {
                Row: {
                    restaurant_id: string
                    overlay_type: 'trend' | 'seasonal'
                    label: string
                    description: string | null
                    active_from: string | null
                    active_until: string | null
                    evidence: Json
                    is_active: boolean
                    created_by_admin_id: string | null
                    updated_by_admin_id: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    restaurant_id: string
                    overlay_type: 'trend' | 'seasonal'
                    label: string
                    description?: string | null
                    active_from?: string | null
                    active_until?: string | null
                    evidence?: Json
                    is_active?: boolean
                    created_by_admin_id?: string | null
                    updated_by_admin_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    restaurant_id?: string
                    overlay_type?: 'trend' | 'seasonal'
                    label?: string
                    description?: string | null
                    active_from?: string | null
                    active_until?: string | null
                    evidence?: Json
                    is_active?: boolean
                    created_by_admin_id?: string | null
                    updated_by_admin_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            admin_restaurant_map_overlay_audit_events: {
                Row: {
                    id: string
                    actor_user_id: string
                    action: 'upsert_overlay' | 'deactivate_overlay' | 'approve_proposal_overlay'
                    restaurant_id: string
                    overlay_type: 'trend' | 'seasonal'
                    reason: string
                    before_snapshot: Json
                    after_snapshot: Json
                    correlation_id: string
                    idempotency_key: string
                    payload_hash: string
                    request_metadata: Json
                    status: 'applied' | 'failed'
                    error_code: string | null
                    applied_at: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    actor_user_id: string
                    action: 'upsert_overlay' | 'deactivate_overlay' | 'approve_proposal_overlay'
                    restaurant_id: string
                    overlay_type: 'trend' | 'seasonal'
                    reason: string
                    before_snapshot?: Json
                    after_snapshot?: Json
                    correlation_id: string
                    idempotency_key: string
                    payload_hash: string
                    request_metadata?: Json
                    status?: 'applied' | 'failed'
                    error_code?: string | null
                    applied_at?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    actor_user_id?: string
                    action?: 'upsert_overlay' | 'deactivate_overlay' | 'approve_proposal_overlay'
                    restaurant_id?: string
                    overlay_type?: 'trend' | 'seasonal'
                    reason?: string
                    before_snapshot?: Json
                    after_snapshot?: Json
                    correlation_id?: string
                    idempotency_key?: string
                    payload_hash?: string
                    request_metadata?: Json
                    status?: 'applied' | 'failed'
                    error_code?: string | null
                    applied_at?: string
                    created_at?: string
                }
            }
            admin_trend_signal_runs: {
                Row: {
                    id: string
                    run_kind: 'scheduled' | 'manual_request' | 'backfill' | 'dry_run'
                    status: 'running' | 'succeeded' | 'failed' | 'partial' | 'cancelled'
                    source_profile: string
                    started_at: string
                    completed_at: string | null
                    created_by_admin_id: string | null
                    input_window: Json
                    rate_limit_summary: Json
                    provider_status: Json
                    provenance: Json
                    summary: Json
                    error_code: string | null
                }
                Insert: {
                    id?: string
                    run_kind: 'scheduled' | 'manual_request' | 'backfill' | 'dry_run'
                    status: 'running' | 'succeeded' | 'failed' | 'partial' | 'cancelled'
                    source_profile: string
                    started_at?: string
                    completed_at?: string | null
                    created_by_admin_id?: string | null
                    input_window?: Json
                    rate_limit_summary?: Json
                    provider_status?: Json
                    provenance?: Json
                    summary?: Json
                    error_code?: string | null
                }
                Update: {
                    id?: string
                    run_kind?: 'scheduled' | 'manual_request' | 'backfill' | 'dry_run'
                    status?: 'running' | 'succeeded' | 'failed' | 'partial' | 'cancelled'
                    source_profile?: string
                    started_at?: string
                    completed_at?: string | null
                    created_by_admin_id?: string | null
                    input_window?: Json
                    rate_limit_summary?: Json
                    provider_status?: Json
                    provenance?: Json
                    summary?: Json
                    error_code?: string | null
                }
            }
            admin_trend_signal_observations: {
                Row: {
                    id: string
                    run_id: string
                    source_type:
                        | 'youtube_kpi'
                        | 'web_search'
                        | 'seasonal_rule'
                        | 'internal_search_rank'
                        | 'review_activity'
                    restaurant_id: string | null
                    video_id: string | null
                    observed_at: string
                    signal_key: string
                    signal_value: number | null
                    raw_excerpt: string | null
                    source_url: string | null
                    provenance: Json
                    created_at: string
                }
                Insert: {
                    id?: string
                    run_id: string
                    source_type:
                        | 'youtube_kpi'
                        | 'web_search'
                        | 'seasonal_rule'
                        | 'internal_search_rank'
                        | 'review_activity'
                    restaurant_id?: string | null
                    video_id?: string | null
                    observed_at: string
                    signal_key: string
                    signal_value?: number | null
                    raw_excerpt?: string | null
                    source_url?: string | null
                    provenance?: Json
                    created_at?: string
                }
                Update: {
                    id?: string
                    run_id?: string
                    source_type?:
                        | 'youtube_kpi'
                        | 'web_search'
                        | 'seasonal_rule'
                        | 'internal_search_rank'
                        | 'review_activity'
                    restaurant_id?: string | null
                    video_id?: string | null
                    observed_at?: string
                    signal_key?: string
                    signal_value?: number | null
                    raw_excerpt?: string | null
                    source_url?: string | null
                    provenance?: Json
                    created_at?: string
                }
            }
            admin_restaurant_map_overlay_proposals: {
                Row: {
                    id: string
                    run_id: string
                    restaurant_id: string
                    overlay_type: 'trend' | 'seasonal'
                    proposal_status: 'pending' | 'approved' | 'rejected' | 'superseded' | 'expired'
                    label: string
                    description: string | null
                    active_from: string | null
                    active_until: string | null
                    score: number
                    score_breakdown: Json
                    evidence: Json
                    proposal_hash: string
                    supersedes_proposal_id: string | null
                    reviewed_by_admin_id: string | null
                    reviewed_at: string | null
                    review_reason: string | null
                    overlay_audit_id: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    run_id: string
                    restaurant_id: string
                    overlay_type: 'trend' | 'seasonal'
                    proposal_status?: 'pending' | 'approved' | 'rejected' | 'superseded' | 'expired'
                    label: string
                    description?: string | null
                    active_from?: string | null
                    active_until?: string | null
                    score: number
                    score_breakdown: Json
                    evidence: Json
                    proposal_hash: string
                    supersedes_proposal_id?: string | null
                    reviewed_by_admin_id?: string | null
                    reviewed_at?: string | null
                    review_reason?: string | null
                    overlay_audit_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    run_id?: string
                    restaurant_id?: string
                    overlay_type?: 'trend' | 'seasonal'
                    proposal_status?: 'pending' | 'approved' | 'rejected' | 'superseded' | 'expired'
                    label?: string
                    description?: string | null
                    active_from?: string | null
                    active_until?: string | null
                    score?: number
                    score_breakdown?: Json
                    evidence?: Json
                    proposal_hash?: string
                    supersedes_proposal_id?: string | null
                    reviewed_by_admin_id?: string | null
                    reviewed_at?: string | null
                    review_reason?: string | null
                    overlay_audit_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            admin_trend_job_requests: {
                Row: {
                    id: string
                    requested_by_admin_id: string
                    request_kind: 'trend_proposal_run' | 'dry_run'
                    status: 'queued' | 'claimed' | 'succeeded' | 'failed' | 'cancelled'
                    parameters: Json
                    parameters_hash: string
                    request_hash: string
                    correlation_id: string
                    idempotency_key: string
                    claimed_by: string | null
                    claimed_at: string | null
                    completed_at: string | null
                    run_id: string | null
                    error_code: string | null
                    result_summary: Json
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    requested_by_admin_id: string
                    request_kind: 'trend_proposal_run' | 'dry_run'
                    status?: 'queued' | 'claimed' | 'succeeded' | 'failed' | 'cancelled'
                    parameters: Json
                    parameters_hash: string
                    request_hash: string
                    correlation_id: string
                    idempotency_key: string
                    claimed_by?: string | null
                    claimed_at?: string | null
                    completed_at?: string | null
                    run_id?: string | null
                    error_code?: string | null
                    result_summary?: Json
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    requested_by_admin_id?: string
                    request_kind?: 'trend_proposal_run' | 'dry_run'
                    status?: 'queued' | 'claimed' | 'succeeded' | 'failed' | 'cancelled'
                    parameters?: Json
                    parameters_hash?: string
                    request_hash?: string
                    correlation_id?: string
                    idempotency_key?: string
                    claimed_by?: string | null
                    claimed_at?: string | null
                    completed_at?: string | null
                    run_id?: string | null
                    error_code?: string | null
                    result_summary?: Json
                    created_at?: string
                    updated_at?: string
                }
            }
            admin_restaurant_map_overlay_proposal_review_events: {
                Row: {
                    id: string
                    proposal_id: string
                    actor_user_id: string
                    transition: 'rejected' | 'superseded' | 'expired'
                    from_status: 'pending' | 'approved' | 'rejected' | 'superseded' | 'expired'
                    to_status: 'rejected' | 'superseded' | 'expired'
                    reason: string
                    correlation_id: string
                    idempotency_key: string
                    request_hash: string
                    proposal_hash: string
                    request_metadata: Json
                    reviewed_by_admin_id: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    proposal_id: string
                    actor_user_id: string
                    transition: 'rejected' | 'superseded' | 'expired'
                    from_status: 'pending' | 'approved' | 'rejected' | 'superseded' | 'expired'
                    to_status: 'rejected' | 'superseded' | 'expired'
                    reason: string
                    correlation_id: string
                    idempotency_key: string
                    request_hash: string
                    proposal_hash: string
                    request_metadata?: Json
                    reviewed_by_admin_id: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    proposal_id?: string
                    actor_user_id?: string
                    transition?: 'rejected' | 'superseded' | 'expired'
                    from_status?: 'pending' | 'approved' | 'rejected' | 'superseded' | 'expired'
                    to_status?: 'rejected' | 'superseded' | 'expired'
                    reason?: string
                    correlation_id?: string
                    idempotency_key?: string
                    request_hash?: string
                    proposal_hash?: string
                    request_metadata?: Json
                    reviewed_by_admin_id?: string
                    created_at?: string
                }
            }
            restaurants: {
                Row: {
                    id: string
                    approved_name: string | null
                    unique_id: string
                    name: string
                    phone: string | null
                    categories: string[]
                    status: string
                    source_type: string
                    youtube_meta: Json | null
                    evaluation_results: Json | null
                    reasoning_basis: string | null
                    tzuyang_review: string | null
                    trace_id: string | null
                    origin_address: Json | null
                    road_address: string | null
                    jibun_address: string | null
                    english_address: string | null
                    address_elements: Json | null
                    geocoding_success: boolean
                    geocoding_false_stage: number | null
                    is_missing: boolean
                    is_not_selected: boolean
                    lat: number | null
                    lng: number | null
                    youtube_link: string | null
                    ai_rating: number | null
                    visit_count: number | null
                    review_count: number | null
                    description: string | null
                    created_by: string | null
                    updated_by_admin_id: string | null
                    db_error_message: string | null
                    db_error_details: Json | null
                    search_count: number | null
                    weekly_search_count: number | null
                    origin_name: string | null
                    naver_name: string | null
                    google_name: string | null
                    trace_id_name_source: string | null
                    channel_name: string | null
                    description_map_url: string | null
                    recollect_version: Json | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    approved_name?: string | null
                    unique_id: string
                    name: string
                    phone?: string | null
                    categories?: string[]
                    status?: string
                    source_type?: string
                    youtube_meta?: Json | null
                    evaluation_results?: Json | null
                    reasoning_basis?: string | null
                    tzuyang_review?: string | null
                    trace_id?: string | null
                    origin_address?: Json | null
                    road_address?: string | null
                    jibun_address?: string | null
                    english_address?: string | null
                    address_elements?: Json | null
                    geocoding_success?: boolean
                    geocoding_false_stage?: number | null
                    is_missing?: boolean
                    is_not_selected?: boolean
                    lat?: number | null
                    lng?: number | null
                    youtube_link?: string | null
                    ai_rating?: number | null
                    visit_count?: number | null
                    review_count?: number | null
                    description?: string | null
                    created_by?: string | null
                    updated_by_admin_id?: string | null
                    db_error_message?: string | null
                    db_error_details?: Json | null
                    search_count?: number | null
                    weekly_search_count?: number | null
                    origin_name?: string | null
                    naver_name?: string | null
                    google_name?: string | null
                    trace_id_name_source?: string | null
                    channel_name?: string | null
                    description_map_url?: string | null
                    recollect_version?: Json | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    approved_name?: string | null
                    unique_id?: string
                    name?: string
                    phone?: string | null
                    categories?: string[]
                    status?: string
                    source_type?: string
                    youtube_meta?: Json | null
                    evaluation_results?: Json | null
                    reasoning_basis?: string | null
                    tzuyang_review?: string | null
                    trace_id?: string | null
                    origin_address?: Json | null
                    road_address?: string | null
                    jibun_address?: string | null
                    english_address?: string | null
                    address_elements?: Json | null
                    geocoding_success?: boolean
                    geocoding_false_stage?: number | null
                    is_missing?: boolean
                    is_not_selected?: boolean
                    lat?: number | null
                    lng?: number | null
                    youtube_link?: string | null
                    ai_rating?: number | null
                    visit_count?: number | null
                    review_count?: number | null
                    description?: string | null
                    created_by?: string | null
                    updated_by_admin_id?: string | null
                    db_error_message?: string | null
                    db_error_details?: Json | null
                    search_count?: number | null
                    weekly_search_count?: number | null
                    origin_name?: string | null
                    naver_name?: string | null
                    google_name?: string | null
                    trace_id_name_source?: string | null
                    channel_name?: string | null
                    description_map_url?: string | null
                    recollect_version?: Json | null
                    created_at?: string
                    updated_at?: string
                }
            }
            reviews: {
                Row: {
                    id: string
                    user_id: string
                    restaurant_id: string
                    title: string
                    content: string
                    visited_at: string
                    verification_photo: string
                    food_photos: string[]
                    categories: string[]
                    is_verified: boolean
                    admin_note: string | null
                    is_pinned: boolean
                    is_edited_by_admin: boolean
                    edited_by_admin_id: string | null
                    edited_at: string | null
                    like_count: number
                    created_at: string
                    updated_at: string
                    ocr_processed_at: string | null
                    receipt_data: Json | null
                    receipt_hash: string | null
                    is_duplicate: boolean
                }
                Insert: {
                    id?: string
                    user_id: string
                    restaurant_id: string
                    title: string
                    content: string
                    visited_at: string
                    verification_photo: string
                    food_photos?: string[]
                    categories?: string[]
                    is_verified?: boolean
                    admin_note?: string | null
                    is_pinned?: boolean
                    is_edited_by_admin?: boolean
                    edited_by_admin_id?: string | null
                    edited_at?: string | null
                    like_count?: number
                    created_at?: string
                    updated_at?: string
                    ocr_processed_at?: string | null
                    receipt_data?: Json | null
                    receipt_hash?: string | null
                    is_duplicate?: boolean
                }
                Update: {
                    id?: string
                    user_id?: string
                    restaurant_id?: string
                    title?: string
                    content?: string
                    visited_at?: string
                    verification_photo?: string
                    food_photos?: string[]
                    categories?: string[]
                    is_verified?: boolean
                    admin_note?: string | null
                    is_pinned?: boolean
                    is_edited_by_admin?: boolean
                    edited_by_admin_id?: string | null
                    edited_at?: string | null
                    like_count?: number
                    created_at?: string
                    updated_at?: string
                    ocr_processed_at?: string | null
                    receipt_data?: Json | null
                    receipt_hash?: string | null
                    is_duplicate?: boolean
                }
            }
            review_likes: {
                Row: {
                    id: string
                    review_id: string
                    user_id: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    review_id: string
                    user_id: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    review_id?: string
                    user_id?: string
                    created_at?: string
                }
            }
            restaurant_submissions: {
                Row: {
                    id: string
                    user_id: string
                    submission_type: string
                    restaurant_name: string
                    address: string
                    phone: string | null
                    category: string[]
                    youtube_link: string
                    tzuyang_review: string | null
                    description: string | null
                    status: string
                    rejection_reason: string | null
                    original_restaurant_id: string | null
                    approved_restaurant_id: string | null
                    changes_requested: Json | null
                    reviewed_by_admin_id: string | null
                    reviewed_at: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    submission_type: string
                    restaurant_name: string
                    address: string
                    phone?: string | null
                    category?: string[]
                    youtube_link: string
                    tzuyang_review?: string | null
                    description?: string | null
                    status?: string
                    rejection_reason?: string | null
                    original_restaurant_id?: string | null
                    approved_restaurant_id?: string | null
                    changes_requested?: Json | null
                    reviewed_by_admin_id?: string | null
                    reviewed_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    submission_type?: string
                    restaurant_name?: string
                    address?: string
                    phone?: string | null
                    category?: string[]
                    youtube_link?: string
                    tzuyang_review?: string | null
                    description?: string | null
                    status?: string
                    rejection_reason?: string | null
                    original_restaurant_id?: string | null
                    approved_restaurant_id?: string | null
                    changes_requested?: Json | null
                    reviewed_by_admin_id?: string | null
                    reviewed_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            profiles: {
                Row: {
                    id: string
                    user_id: string
                    username: string
                    nickname: string
                    avatar_url: string | null
                    role: string
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    username: string
                    nickname: string
                    avatar_url?: string | null
                    role?: string
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    username?: string
                    nickname?: string
                    avatar_url?: string | null
                    role?: string
                    created_at?: string
                    updated_at?: string
                }
            }
            admin_audit_events: {
                Row: {
                    id: string
                    actor_user_id: string
                    target_user_id: string | null
                    action:
                        | 'admin_user_created'
                        | 'admin_user_profile_updated'
                        | 'admin_user_role_granted'
                        | 'admin_user_role_revoked'
                        | 'admin_user_disabled'
                        | 'admin_user_reactivated'
                    reason: string | null
                    before_state: Json
                    after_state: Json
                    audit_counts: Json
                    audit_flags: Json
                    status: 'intent' | 'applied' | 'failed'
                    correlation_id: string | null
                    applied_at: string | null
                    error_code: string | null
                    request_id: string | null
                    ip_hash: string | null
                    user_agent_hash: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    actor_user_id: string
                    target_user_id?: string | null
                    action:
                        | 'admin_user_created'
                        | 'admin_user_profile_updated'
                        | 'admin_user_role_granted'
                        | 'admin_user_role_revoked'
                        | 'admin_user_disabled'
                        | 'admin_user_reactivated'
                    reason?: string | null
                    before_state?: Json
                    after_state?: Json
                    audit_counts?: Json
                    audit_flags?: Json
                    status?: 'intent' | 'applied' | 'failed'
                    correlation_id?: string | null
                    applied_at?: string | null
                    error_code?: string | null
                    request_id?: string | null
                    ip_hash?: string | null
                    user_agent_hash?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    actor_user_id?: string
                    target_user_id?: string | null
                    action?:
                        | 'admin_user_created'
                        | 'admin_user_profile_updated'
                        | 'admin_user_role_granted'
                        | 'admin_user_role_revoked'
                        | 'admin_user_disabled'
                        | 'admin_user_reactivated'
                    reason?: string | null
                    before_state?: Json
                    after_state?: Json
                    audit_counts?: Json
                    audit_flags?: Json
                    status?: 'intent' | 'applied' | 'failed'
                    correlation_id?: string | null
                    applied_at?: string | null
                    error_code?: string | null
                    request_id?: string | null
                    ip_hash?: string | null
                    user_agent_hash?: string | null
                    created_at?: string
                }
            }
            notifications: {
                Row: {
                    id: string
                    user_id: string
                    type: string
                    title: string
                    message: string
                    data: Json
                    is_read: boolean
                    created_at: string
                    classification: 'transactional' | 'marketing'
                    channel: 'in_app' | 'email' | 'sms' | 'push'
                    consent_event_id: string | null
                    retention_class: string
                    campaign_operation_id: string | null
                    delivered_at: string | null
                }
                Insert: {
                    id?: string
                    user_id: string
                    type: string
                    title: string
                    message: string
                    data?: Json
                    is_read?: boolean
                    created_at?: string
                    classification?: 'transactional' | 'marketing'
                    channel?: 'in_app' | 'email' | 'sms' | 'push'
                    consent_event_id?: string | null
                    retention_class?: string
                    campaign_operation_id?: string | null
                    delivered_at?: string | null
                }
                Update: {
                    id?: string
                    user_id?: string
                    type?: string
                    title?: string
                    message?: string
                    data?: Json
                    is_read?: boolean
                    created_at?: string
                    classification?: 'transactional' | 'marketing'
                    channel?: 'in_app' | 'email' | 'sms' | 'push'
                    consent_event_id?: string | null
                    retention_class?: string
                    campaign_operation_id?: string | null
                    delivered_at?: string | null
                }
            }
            marketing_campaign_operations: {
                Row: {
                    id: string
                    actor_user_id: string | null
                    actor_ref_hash: string
                    channel: 'email' | 'sms' | 'push'
                    title: string
                    message: string
                    data: Json
                    preview_hash: string
                    expires_at: string
                    status: 'previewed' | 'applying' | 'applied' | 'partial' | 'failed'
                    audit_id: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    actor_user_id?: string | null
                    actor_ref_hash: string
                    channel: 'email' | 'sms' | 'push'
                    title: string
                    message: string
                    data?: Json
                    preview_hash: string
                    expires_at: string
                    status?: 'previewed' | 'applying' | 'applied' | 'partial' | 'failed'
                    audit_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    actor_user_id?: string | null
                    actor_ref_hash?: string
                    channel?: 'email' | 'sms' | 'push'
                    title?: string
                    message?: string
                    data?: Json
                    preview_hash?: string
                    expires_at?: string
                    status?: 'previewed' | 'applying' | 'applied' | 'partial' | 'failed'
                    audit_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            marketing_campaign_recipients: {
                Row: {
                    operation_id: string
                    user_id: string
                    status: 'pending' | 'eligible' | 'suppressed' | 'sent' | 'failed'
                    consent_event_id: string | null
                    night_consent_event_id: string | null
                    updated_at: string
                }
                Insert: {
                    operation_id: string
                    user_id: string
                    status?: 'pending' | 'eligible' | 'suppressed' | 'sent' | 'failed'
                    consent_event_id?: string | null
                    night_consent_event_id?: string | null
                    updated_at?: string
                }
                Update: {
                    operation_id?: string
                    user_id?: string
                    status?: 'pending' | 'eligible' | 'suppressed' | 'sent' | 'failed'
                    consent_event_id?: string | null
                    night_consent_event_id?: string | null
                    updated_at?: string
                }
            }
            marketing_campaign_batches: {
                Row: {
                    id: string
                    operation_id: string
                    idempotency_key: string
                    status: 'prepared' | 'claimed' | 'provider_failed' | 'completed'
                    eligible_count: number
                    created_at: string
                    completed_at: string | null
                    claim_token: string | null
                    claimed_at: string | null
                }
                Insert: {
                    id?: string
                    operation_id: string
                    idempotency_key: string
                    status: 'prepared' | 'claimed' | 'provider_failed' | 'completed'
                    eligible_count: number
                    created_at?: string
                    completed_at?: string | null
                    claim_token?: string | null
                    claimed_at?: string | null
                }
                Update: {
                    id?: string
                    operation_id?: string
                    idempotency_key?: string
                    status?: 'prepared' | 'claimed' | 'provider_failed' | 'completed'
                    eligible_count?: number
                    created_at?: string
                    completed_at?: string | null
                    claim_token?: string | null
                    claimed_at?: string | null
                }
            }
            account_deletion_policies: {
                Row: {
                    version: string
                    status: 'active' | 'disabled'
                    preview_ttl: string
                    reauth_max_age: string
                    confirmation_text: string
                    created_at: string
                }
                Insert: {
                    version: string
                    status: 'active' | 'disabled'
                    preview_ttl: string
                    reauth_max_age: string
                    confirmation_text: string
                    created_at?: string
                }
                Update: {
                    version?: string
                    status?: 'active' | 'disabled'
                    preview_ttl?: string
                    reauth_max_age?: string
                    confirmation_text?: string
                    created_at?: string
                }
            }
            account_deletion_data_classes: {
                Row: {
                    policy_version: string
                    code: string
                    disposition: 'delete' | 'anonymize' | 'separate' | 'retain'
                    mandatory: boolean
                }
                Insert: {
                    policy_version: string
                    code: string
                    disposition: 'delete' | 'anonymize' | 'separate' | 'retain'
                    mandatory?: boolean
                }
                Update: {
                    policy_version?: string
                    code?: string
                    disposition?: 'delete' | 'anonymize' | 'separate' | 'retain'
                    mandatory?: boolean
                }
            }
            account_deletion_requests: {
                Row: {
                    id: string
                    actor_user_id: string
                    target_user_id: string
                    policy_version: string
                    preview_hash: string
                    preview_expires_at: string
                    reauthenticated_at: string
                    status: 'draft' | 'previewed' | 'applying' | 'applied' | 'partial' | 'failed'
                    idempotency_key: string | null
                    source_manifest_hash: string
                    reason_code: AccountDeletionReasonCode
                    count_summary: Json
                    db_readback_passed: boolean
                    storage_readback_passed: boolean
                    session_readback_passed: boolean
                    auth_readback_passed: boolean
                    storage_receipts_hash: string | null
                    auth_receipt_ref: string | null
                    created_at: string
                    updated_at: string
                    applied_at: string | null
                }
                Insert: {
                    id?: string
                    actor_user_id: string
                    target_user_id: string
                    policy_version: string
                    preview_hash: string
                    preview_expires_at: string
                    reauthenticated_at: string
                    status: 'draft' | 'previewed' | 'applying' | 'applied' | 'partial' | 'failed'
                    idempotency_key?: string | null
                    source_manifest_hash: string
                    reason_code: AccountDeletionReasonCode
                    count_summary?: Json
                    db_readback_passed?: boolean
                    storage_readback_passed?: boolean
                    session_readback_passed?: boolean
                    auth_readback_passed?: boolean
                    storage_receipts_hash?: string | null
                    auth_receipt_ref?: string | null
                    created_at?: string
                    updated_at?: string
                    applied_at?: string | null
                }
                Update: {
                    id?: string
                    actor_user_id?: string
                    target_user_id?: string
                    policy_version?: string
                    preview_hash?: string
                    preview_expires_at?: string
                    reauthenticated_at?: string
                    status?: 'draft' | 'previewed' | 'applying' | 'applied' | 'partial' | 'failed'
                    idempotency_key?: string | null
                    source_manifest_hash?: string
                    reason_code?: AccountDeletionReasonCode
                    count_summary?: Json
                    db_readback_passed?: boolean
                    storage_readback_passed?: boolean
                    session_readback_passed?: boolean
                    auth_readback_passed?: boolean
                    storage_receipts_hash?: string | null
                    auth_receipt_ref?: string | null
                    created_at?: string
                    updated_at?: string
                    applied_at?: string | null
                }
            }
            account_deletion_request_items: {
                Row: {
                    request_id: string
                    data_class_code: string
                    disposition: 'delete' | 'anonymize' | 'separate' | 'retain'
                    mandatory: boolean
                    planned_count: number
                    status: 'planned' | 'applied' | 'retained' | 'separated' | 'failed'
                    reason_code: AccountDeletionReasonCode
                    updated_at: string
                }
                Insert: {
                    request_id: string
                    data_class_code: string
                    disposition: 'delete' | 'anonymize' | 'separate' | 'retain'
                    mandatory: boolean
                    planned_count?: number
                    status: 'planned' | 'applied' | 'retained' | 'separated' | 'failed'
                    reason_code: AccountDeletionReasonCode
                    updated_at?: string
                }
                Update: {
                    request_id?: string
                    data_class_code?: string
                    disposition?: 'delete' | 'anonymize' | 'separate' | 'retain'
                    mandatory?: boolean
                    planned_count?: number
                    status?: 'planned' | 'applied' | 'retained' | 'separated' | 'failed'
                    reason_code?: AccountDeletionReasonCode
                    updated_at?: string
                }
            }
            privacy_incidents: {
                Row: {
                    id: string
                    status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    severity: 'low' | 'medium' | 'high' | 'critical'
                    detected_at: string
                    awareness_at: string | null
                    deadline_at: string | null
                    affected_count_estimate: number | null
                    data_categories: Array<
                        | 'account'
                        | 'contact'
                        | 'authentication'
                        | 'device'
                        | 'usage'
                        | 'location'
                        | 'financial'
                        | 'sensitive'
                        | 'unique_identifier'
                        | 'other'
                    >
                    sensitive_or_unique_id: boolean | null
                    external_intrusion: boolean | null
                    owner_user_id: string
                    decision_code: string | null
                    assessment_readback_at: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    status?:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    severity: 'low' | 'medium' | 'high' | 'critical'
                    detected_at?: string
                    awareness_at?: string | null
                    deadline_at?: string | null
                    affected_count_estimate?: number | null
                    data_categories?: Array<
                        | 'account'
                        | 'contact'
                        | 'authentication'
                        | 'device'
                        | 'usage'
                        | 'location'
                        | 'financial'
                        | 'sensitive'
                        | 'unique_identifier'
                        | 'other'
                    >
                    sensitive_or_unique_id?: boolean | null
                    external_intrusion?: boolean | null
                    owner_user_id: string
                    decision_code?: string | null
                    assessment_readback_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    status?:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    severity?: 'low' | 'medium' | 'high' | 'critical'
                    detected_at?: string
                    awareness_at?: string | null
                    deadline_at?: string | null
                    affected_count_estimate?: number | null
                    data_categories?: Array<
                        | 'account'
                        | 'contact'
                        | 'authentication'
                        | 'device'
                        | 'usage'
                        | 'location'
                        | 'financial'
                        | 'sensitive'
                        | 'unique_identifier'
                        | 'other'
                    >
                    sensitive_or_unique_id?: boolean | null
                    external_intrusion?: boolean | null
                    owner_user_id?: string
                    decision_code?: string | null
                    assessment_readback_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            privacy_incident_transition_previews: {
                Row: {
                    operation_id: string
                    incident_id: string
                    actor_user_id: string
                    from_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    to_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    expected_updated_at: string
                    preview_hash: string
                    input_hash: string
                    reason_code: string
                    correlation_id: string
                    expires_at: string
                    consumed_at: string | null
                    created_at: string
                }
                Insert: {
                    operation_id: string
                    incident_id: string
                    actor_user_id: string
                    from_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    to_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    expected_updated_at: string
                    preview_hash: string
                    input_hash: string
                    reason_code: string
                    correlation_id: string
                    expires_at: string
                    consumed_at?: string | null
                    created_at?: string
                }
                Update: {
                    operation_id?: string
                    incident_id?: string
                    actor_user_id?: string
                    from_status?:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    to_status?:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    expected_updated_at?: string
                    preview_hash?: string
                    input_hash?: string
                    reason_code?: string
                    correlation_id?: string
                    expires_at?: string
                    consumed_at?: string | null
                    created_at?: string
                }
            }
            privacy_incident_notices: {
                Row: {
                    id: string
                    incident_id: string
                    audience: 'data_subjects' | 'pipc' | 'kisa'
                    status: 'draft' | 'approved' | 'submitted' | 'failed'
                    template_version: string
                    content_sha256: string
                    approved_by: string | null
                    approved_at: string | null
                    submitted_by: string | null
                    submitted_at: string | null
                    external_receipt_ref: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    incident_id: string
                    audience: 'data_subjects' | 'pipc' | 'kisa'
                    status?: 'draft' | 'approved' | 'submitted' | 'failed'
                    template_version: string
                    content_sha256: string
                    approved_by?: string | null
                    approved_at?: string | null
                    submitted_by?: string | null
                    submitted_at?: string | null
                    external_receipt_ref?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    incident_id?: string
                    audience?: 'data_subjects' | 'pipc' | 'kisa'
                    status?: 'draft' | 'approved' | 'submitted' | 'failed'
                    template_version?: string
                    content_sha256?: string
                    approved_by?: string | null
                    approved_at?: string | null
                    submitted_by?: string | null
                    submitted_at?: string | null
                    external_receipt_ref?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            privacy_incident_actions: {
                Row: {
                    id: string
                    incident_id: string
                    from_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    to_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    actor_user_id: string
                    reason_code: string
                    preview_hash: string
                    input_hash: string
                    correlation_id: string
                    expected_updated_at: string
                    idempotency_key: string
                    result_status: 'applied'
                    readback_status: 'passed' | 'failed'
                    audit_id: string
                    created_at: string
                }
                Insert: {
                    id: string
                    incident_id: string
                    from_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    to_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    actor_user_id: string
                    reason_code: string
                    preview_hash: string
                    input_hash: string
                    correlation_id: string
                    expected_updated_at: string
                    idempotency_key: string
                    result_status: 'applied'
                    readback_status: 'passed' | 'failed'
                    audit_id: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    incident_id?: string
                    from_status?:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    to_status?:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    actor_user_id?: string
                    reason_code?: string
                    preview_hash?: string
                    input_hash?: string
                    correlation_id?: string
                    expected_updated_at?: string
                    idempotency_key?: string
                    result_status?: 'applied'
                    readback_status?: 'passed' | 'failed'
                    audit_id?: string
                    created_at?: string
                }
            }
            ocr_logs: {
                Row: {
                    id: string
                    user_id: string
                    image_hash: string
                    model_used: string | null
                    created_at: string
                    success: boolean | null
                    metadata: OcrLogMetadata | null
                }
                Insert: {
                    id?: string
                    user_id: string
                    image_hash: string
                    model_used?: string | null
                    created_at?: string
                    success?: boolean | null
                    metadata?: OcrLogMetadata | null
                }
                Update: {
                    id?: string
                    user_id?: string
                    image_hash?: string
                    model_used?: string | null
                    created_at?: string
                    success?: boolean | null
                    metadata?: OcrLogMetadata | null
                }
            }
        }
        Views: {
            privacy_consent_state: {
                Row: {
                    user_id: string
                    subject_kind: 'self' | 'child'
                    purpose:
                        | 'privacy_required'
                        | 'marketing'
                        | 'email_marketing'
                        | 'sms_marketing'
                        | 'push_marketing'
                        | 'night_marketing'
                    channel: 'email' | 'sms' | 'push' | 'in_app' | 'none'
                    decision: 'granted' | 'withdrawn'
                    policy_version_id: string
                    guardian_verification_id: string | null
                    consent_event_id: string
                    occurred_at: string
                }
            }
        }
        Functions: {
            allocate_short_url: {
                Args: {
                    p_target_url: string
                    p_restaurant_id: string
                    p_review_id: string
                    p_client_bucket: string
                    p_candidate_codes: string[]
                }
                Returns: {
                    code: string | null
                    is_existing: boolean
                    rate_limited: boolean
                    retry_after_seconds: number
                    allocation_failed: boolean
                }[]
            }
            begin_account_deletion_apply_with_reauth: {
                Args: {
                    p_proof_id: string
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_confirmation_text: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                }
                Returns: {
                    request_id: string
                    status: string
                    reason_code: string
                    delete_count: number
                    anonymize_count: number
                    separate_count: number
                    retain_count: number
                    db_readback_passed: boolean
                    storage_readback_passed: boolean
                    session_readback_passed: boolean
                    auth_readback_passed: boolean
                    storage_receipt_refs: Json | null
                    auth_receipt_ref: string | null
                    source_manifest_hash: string
                }[]
            }
            consume_account_deletion_reauth_proof: {
                Args: {
                    p_proof_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_idempotency_key: string
                }
                Returns: {
                    proof_id: string
                    consumed_at: string
                }[]
            }
            issue_account_deletion_reauth_proof: {
                Args: {
                    p_target_user_id: string
                }
                Returns: {
                    proof_id: string
                    expires_at: string
                }[]
            }
            get_ocr_daily_quota_status: {
                Args: Record<string, never>
                Returns: {
                    allowed: boolean
                    used_count: number
                    quota_limit: number | null
                    remaining_count: number | null
                    unlimited: boolean
                    reset_at: string
                }[]
            }
            reserve_ocr_daily_quota: {
                Args: { p_operation_id: string }
                Returns: {
                    allowed: boolean
                    used_count: number
                    quota_limit: number | null
                    remaining_count: number | null
                    unlimited: boolean
                    reset_at: string
                }[]
            }
            reserve_admin_provider_budget: {
                Args: {
                    p_actor_user_id: string
                    p_provider:
                        | 'naver_local_search'
                        | 'naver_geocode'
                        | 'youtube_metadata'
                        | 'naver_directions'
                        | 'openai_sponsor_analysis'
                    p_operation_id: string
                }
                Returns: {
                    allowed: boolean
                    retry_after_seconds: number
                }[]
            }
            apply_admin_restaurant_map_overlay_action: {
                Args: {
                    p_actor_user_id: string
                    p_action: 'upsert_overlay' | 'deactivate_overlay'
                    p_restaurant_id: string
                    p_overlay_type: 'trend' | 'seasonal'
                    p_label: string | null
                    p_description: string | null
                    p_active_from: string | null
                    p_active_until: string | null
                    p_evidence: Json | null
                    p_reason: string
                    p_preview_hash: string
                    p_payload_hash: string
                    p_correlation_id: string
                    p_idempotency_key: string
                    p_request_metadata?: Json
                }
                Returns: Json
            }
            claim_admin_trend_job_request: {
                Args: {
                    p_claimed_by: string
                    p_stale_after?: string
                }
                Returns: Json
            }
            complete_admin_trend_job_request: {
                Args: {
                    p_request_id: string
                    p_claimed_by: string
                    p_run_id: string
                    p_result_summary?: Json
                }
                Returns: Json
            }
            fail_admin_trend_job_request: {
                Args: {
                    p_request_id: string
                    p_claimed_by: string
                    p_error_code: string
                    p_result_summary?: Json
                }
                Returns: Json
            }
            review_admin_restaurant_map_overlay_proposal: {
                Args: {
                    p_actor_user_id: string
                    p_proposal_id: string
                    p_transition: 'rejected' | 'superseded' | 'expired'
                    p_reason: string
                    p_expected_proposal_hash: string
                    p_correlation_id: string
                    p_idempotency_key: string
                    p_request_hash: string
                    p_request_metadata?: Json
                }
                Returns: Json
            }
            approve_admin_restaurant_map_overlay_proposal: {
                Args: {
                    p_actor_user_id: string
                    p_proposal_id: string
                    p_expected_proposal_hash: string
                    p_confirmation_text: string
                    p_required_confirmation_text: string
                    p_reason: string
                    p_overlay_payload: Json
                    p_preview_hash: string
                    p_payload_hash: string
                    p_correlation_id: string
                    p_idempotency_key: string
                    p_request_metadata?: Json
                }
                Returns: Json
            }
            search_restaurants_by_youtube_title: {
                Args: {
                    search_query: string
                    max_results?: number
                    include_all_status?: boolean
                    korean_only?: boolean
                }
                Returns: {
                    id: string
                    name: string | null
                    road_address: string | null
                    jibun_address: string | null
                    phone: string | null
                    categories: string[] | null
                    youtube_link: string | null
                    tzuyang_review: string | null
                    lat: number | null
                    lng: number | null
                    status: string | null
                    english_address: string | null
                    youtube_title: string | null
                    youtube_meta: Json | null
                    origin_address: Json | null
                    address_elements: Json | null
                    reasoning_basis: string | null
                    evaluation_results: Json | null
                    complete_match_score: number | null
                    word_match_score: number | null
                    trigram_similarity: number | null
                    levenshtein_distance: number | null
                }[]
            }
            append_privacy_audit_event: {
                Args: {
                    p_event_type: string
                    p_actor_user_id: string | null
                    p_subject_user_id: string | null
                    p_operation_id: string
                    p_correlation_id: string
                    p_status: string
                    p_reason_code: string
                    p_count_summary: Json
                    p_request_metadata: Json
                }
                Returns: string
            }
            get_current_privacy_policy_version: {
                Args: Record<string, never>
                Returns: Json
            }
            publish_privacy_policy_version: {
                Args: {
                    p_version: string
                    p_locale: 'ko-KR'
                    p_content_sha256: string
                    p_effective_at: string
                    p_supersedes_id: string | null
                    p_operator_approval_ref: string
                    p_idempotency_key: string
                }
                Returns: Json
            }
            create_privacy_onboarding_challenge: {
                Args: {
                    p_token_hash: string
                    p_policy_version_id: string
                    p_age_band: 'unknown' | 'age_14_plus' | 'under_14'
                    p_requested_consents: Json
                    p_oauth_nonce_hash?: string | null
                    p_expires_at?: string | null
                }
                Returns: Json
            }
            transition_privacy_onboarding_challenge: {
                Args: {
                    p_challenge_id: string
                    p_expected_state: 'pending'
                    p_next_state: 'consumed'
                    p_user_id: string
                    p_idempotency_key: string
                }
                Returns: Json
            }
            confirm_privacy_onboarding: {
                Args: {
                    p_challenge_id: string
                    p_challenge_token: string
                    p_user_id: string
                    p_source: 'password_signup' | 'oauth'
                    p_guardian_verification_id: string | null
                    p_oauth_nonce_hash: string | null
                }
                Returns: Json
            }
            submit_privacy_consent: {
                Args: {
                    p_purpose:
                        | 'privacy_required'
                        | 'marketing'
                        | 'email_marketing'
                        | 'sms_marketing'
                        | 'push_marketing'
                        | 'night_marketing'
                    p_channel: 'email' | 'sms' | 'push' | 'in_app' | 'none'
                    p_decision: 'granted' | 'withdrawn'
                    p_policy_version_id: string
                    p_notice_sha256: string
                    p_source: 'settings'
                    p_guardian_verification_id: string | null
                    p_idempotency_key: string
                    p_correlation_id: string
                }
                Returns: Json
            }
            submit_guardian_privacy_consent: {
                Args: {
                    p_purpose:
                        | 'privacy_required'
                        | 'marketing'
                        | 'email_marketing'
                        | 'sms_marketing'
                        | 'push_marketing'
                        | 'night_marketing'
                    p_channel: 'email' | 'sms' | 'push' | 'in_app' | 'none'
                    p_decision: 'granted' | 'withdrawn'
                    p_policy_version_id: string
                    p_notice_sha256: string
                    p_guardian_verification_id: string
                    p_idempotency_key: string
                    p_correlation_id: string
                }
                Returns: Json
            }
            record_privacy_guardian_verification: {
                Args: {
                    p_verification_id: string
                    p_child_user_id: string
                    p_status: 'pending' | 'verified' | 'rejected' | 'expired' | 'withdrawn'
                    p_provider: string
                    p_provider_reference_hash: string
                    p_verified_at?: string | null
                    p_expires_at?: string | null
                }
                Returns: Json
            }
            read_privacy_guardian_status: {
                Args: { p_child_user_id: string }
                Returns: Json
            }
            hold_privacy_onboarding_compensation: {
                Args: {
                    p_challenge_id: string
                    p_user_id: string
                    p_reason_code: string
                    p_idempotency_key: string
                }
                Returns: Json
            }
            get_current_privacy_eligibility: {
                Args: Record<string, never>
                Returns: Json
            }
            get_privacy_eligibility_for_user: {
                Args: { p_user_id: string }
                Returns: Json
            }
            create_user_notification: {
                Args: {
                    p_user_id: string
                    p_type: string
                    p_title: string
                    p_message: string
                    p_data?: Json
                }
                Returns: void
            }
            mark_notification_read: {
                Args: { notification_uuid: string }
                Returns: void
            }
            mark_all_notifications_read: {
                Args: Record<string, never>
                Returns: void
            }
            delete_notification: {
                Args: { notification_uuid: string }
                Returns: void
            }
            create_admin_transactional_notification: {
                Args: {
                    p_actor_user_id: string
                    p_recipient_user_id: string
                    p_type: string
                    p_title: string
                    p_message: string
                    p_data: Json
                }
                Returns: {
                    schemaVersion: 1
                    status: 'created'
                    notificationId: string
                    actorUserId: string
                    recipientUserId: string
                    type: string
                }
            }
            create_review_like_notification: {
                Args: {
                    p_actor_user_id: string
                    p_review_id: string
                    p_like_id: string
                }
                Returns: {
                    schemaVersion: 1
                    status: 'created' | 'replayed'
                    notificationId: string
                    reviewId: string
                    recipientUserId: string
                }
            }
            evaluate_notification_marketing_permission: {
                Args: {
                    p_user_id: string
                    p_channel: 'email' | 'sms' | 'push'
                    p_scheduled_at: string
                    p_timezone?: 'Asia/Seoul'
                }
                Returns: {
                    allowed: boolean
                    reason_code: string
                    consent_event_id: string | null
                    night_consent_event_id: string | null
                }[]
            }
            preview_marketing_campaign: {
                Args: {
                    p_actor_user_id: string
                    p_channel: 'email' | 'sms' | 'push'
                    p_recipient_user_ids: string[]
                    p_title: string
                    p_message: string
                    p_data: Json
                    p_preview_hash: string
                    p_expires_at: string
                }
                Returns: Json
            }
            prepare_marketing_campaign_batch: {
                Args: {
                    p_operation_id: string
                    p_actor_user_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_batch_limit?: number
                    p_timezone?: 'Asia/Seoul'
                }
                Returns: Json
            }
            claim_marketing_campaign_dispatch: {
                Args: {
                    p_operation_id: string
                    p_batch_id: string
                    p_actor_user_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_timezone?: 'Asia/Seoul'
                }
                Returns: Json
            }
            fail_marketing_campaign_batch: {
                Args: {
                    p_operation_id: string
                    p_batch_id: string
                    p_actor_user_id: string
                    p_preview_hash: string
                    p_error_code: string
                }
                Returns: Json
            }
            fail_marketing_campaign_provider_attempt: {
                Args: {
                    p_operation_id: string
                    p_batch_id: string
                    p_actor_user_id: string
                    p_preview_hash: string
                    p_claim_token: string
                    p_provider_attempt_id: string
                    p_provider_receipt_id: string
                    p_provider_receipt_hash: string
                    p_provider_payload_digest: string
                    p_error_code: string
                }
                Returns: Json
            }
            finalize_marketing_campaign_batch: {
                Args: {
                    p_operation_id: string
                    p_batch_id: string
                    p_actor_user_id: string
                    p_preview_hash: string
                    p_claim_token: string
                    p_provider_attempt_id: string
                    p_provider_receipt_id: string
                    p_provider_receipt_hash: string
                    p_provider_payload_digest: string
                    p_accepted_user_ids: string[]
                    p_timezone?: 'Asia/Seoul'
                }
                Returns: Json
            }
            marketing_campaign_receipt: {
                Args: { p_operation_id: string }
                Returns: Json
            }
            preview_account_deletion: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_reauthenticated_at: string
                }
                Returns: {
                    request_id: string | null
                    preview_hash: string | null
                    preview_expires_at: string | null
                    policy_version: string | null
                    status: string
                    reason_code: AccountDeletionReasonCode
                    delete_count: number
                    anonymize_count: number
                    separate_count: number
                    retain_count: number
                    source_manifest_hash: string | null
                }[]
            }
            begin_account_deletion_apply: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_confirmation_text: string
                    p_idempotency_key: string
                    p_reauthenticated_at: string
                    p_source_manifest_hash: string
                }
                Returns: {
                    request_id: string | null
                    status: string
                    reason_code: AccountDeletionReasonCode
                    delete_count: number
                    anonymize_count: number
                    separate_count: number
                    retain_count: number
                    db_readback_passed: boolean
                    storage_readback_passed: boolean
                    session_readback_passed: boolean
                    auth_readback_passed: boolean
                    storage_receipt_refs: Json | null
                    auth_receipt_ref: string | null
                    source_manifest_hash: string | null
                }[]
            }
            apply_account_deletion_database_cleanup: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                }
                Returns: {
                    request_id: string | null
                    status: string
                    reason_code: AccountDeletionReasonCode
                    db_readback_passed: boolean
                    session_readback_passed: boolean
                    source_manifest_hash: string | null
                }[]
            }
            claim_account_deletion_external_job: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                    p_phase: 'session' | 'storage' | 'auth'
                    p_attempt_token: string | null
                }
                Returns: {
                    request_id: string
                    phase: string
                    claim_status: string
                    attempt_token: string | null
                    lease_expires_at: string | null
                    job_state: string
                    checkpoint_state: string
                    source_manifest_hash: string
                }[]
            }
            claim_next_account_deletion_external_job: {
                Args: Record<string, never>
                Returns: {
                    actor_user_id: string
                    target_user_id: string
                    request_id: string
                    preview_hash: string
                    idempotency_key: string
                    source_manifest_hash: string
                    phase: 'session' | 'storage' | 'auth'
                    attempt_token: string
                }[]
            }
            prepare_account_deletion_external_egress: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                    p_phase: 'session' | 'storage' | 'auth'
                    p_attempt_token: string
                }
                Returns: {
                    request_id: string
                    phase: string
                    attempt_token: string
                    egress_state: string
                    provider_idempotency_key: string
                    lease_expires_at: string
                    source_manifest_hash: string
                }[]
            }
            read_account_deletion_external_job: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                    p_phase: 'session' | 'storage' | 'auth'
                    p_attempt_token: string
                }
                Returns: {
                    request_id: string
                    phase: string
                    attempt_token: string
                    job_state: string
                    attempt_state: string
                    lease_expires_at: string
                    authoritative_absent: boolean
                    provider_proof_count: number
                    source_manifest_hash: string
                }[]
            }
            run_account_deletion_session_family_cleanup: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                    p_attempt_token: string
                }
                Returns: {
                    request_id: string
                    status: string
                    session_readback_passed: boolean
                    job_state: string
                    checkpoint_state: string
                    source_manifest_hash: string
                }[]
            }
            get_account_deletion_storage_work: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                    p_attempt_token: string
                }
                Returns: {
                    bucket_id: string
                    object_name: string
                    object_id: string
                    object_version: string
                    object_locator_hash: string
                    object_version_hash: string
                    provider_idempotency_key: string
                    work_state: string
                    work_mode: string
                    source_manifest_hash: string
                }[]
            }
            record_account_deletion_external_provider_proof: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                    p_phase: 'storage' | 'auth'
                    p_attempt_token: string
                    p_provider_receipt_ref: string
                    p_provider_receipt_hash: string
                    p_object_locator_hash: string | null
                    p_object_version_hash: string | null
                }
                Returns: {
                    request_id: string
                    phase: string
                    attempt_token: string
                    provider_receipt_ref: string
                    proof_hash: string
                    source_manifest_hash: string
                }[]
            }
            reconcile_account_deletion_storage_job: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                    p_attempt_token: string
                }
                Returns: {
                    request_id: string
                    status: string
                    storage_readback_passed: boolean
                    job_state: string
                    expected_work_count: number
                    provider_proof_count: number
                    source_manifest_hash: string
                }[]
            }
            reconcile_account_deletion_auth_job: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                    p_attempt_token: string
                }
                Returns: {
                    request_id: string
                    status: string
                    auth_readback_passed: boolean
                    job_state: string
                    provider_proof_count: number
                    source_manifest_hash: string
                }[]
            }
            read_current_account_deletion_status: {
                Args: {
                    p_request_id: string
                    p_preview_hash: string
                    p_source_manifest_hash: string
                }
                Returns: {
                    request_id: string
                    status: string
                    reason_code: string
                    delete_count: number
                    anonymize_count: number
                    separate_count: number
                    retain_count: number
                    db_readback_passed: boolean
                    storage_readback_passed: boolean
                    session_readback_passed: boolean
                    auth_readback_passed: boolean
                    storage_receipt_refs: Json | null
                    auth_receipt_ref: string | null
                    source_manifest_hash: string
                    idempotency_key_binding_sha256: string | null
                }[]
            }
            fail_account_deletion: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_request_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_source_manifest_hash: string
                    p_reason_code: string
                }
                Returns: void
            }
            preview_privacy_retention_run: {
                Args: {
                    p_class_code: string
                    p_as_of: string
                    p_batch_size: number
                    p_max_duration_ms?: number
                }
                Returns: Json
            }
            confirm_privacy_retention_run: {
                Args: {
                    p_run_id: string
                    p_preview_hash: string
                    p_confirmation_text: string
                    p_idempotency_key: string
                }
                Returns: Json
            }
            apply_privacy_retention_run: {
                Args: {
                    p_run_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_max_duration_ms?: number
                }
                Returns: Json
            }
            claim_privacy_retention_storage_items: {
                Args: {
                    p_run_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_limit: number
                }
                Returns: Json
            }
            resolve_privacy_retention_provider_effect: {
                Args: {
                    p_run_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_work_item_id: string
                    p_claim_token: string
                    p_claim_hash: string
                    p_object_locator_hash: string
                    p_object_version_hash: string
                    p_adapter_version: string
                    p_source_mapping_version: string
                    p_provider_verifier_ref: string
                }
                Returns: Json
            }
            get_privacy_retention_provider_reconciliation_work: {
                Args: {
                    p_run_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_provider_verifier_ref: string
                    p_limit: number
                }
                Returns: Json
            }
            record_privacy_retention_storage_provider_receipts: {
                Args: {
                    p_run_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_receipts: Json
                }
                Returns: Json
            }
            fail_privacy_retention_storage_claims: {
                Args: {
                    p_run_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                    p_claim_tokens: string[]
                    p_failure_code: string
                }
                Returns: number
            }
            finalize_privacy_retention_run: {
                Args: {
                    p_run_id: string
                    p_preview_hash: string
                    p_idempotency_key: string
                }
                Returns: Json
            }
            record_privacy_incident_detection: {
                Args: {
                    p_actor_user_id: string
                    p_incident_id: string
                    p_severity: 'low' | 'medium' | 'high' | 'critical'
                    p_detected_at: string
                    p_confirmation_text: string
                    p_correlation_id: string
                }
                Returns: Json
            }
            preview_privacy_incident_transition: {
                Args: {
                    p_actor_user_id: string
                    p_incident_id: string
                    p_to_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    p_expected_updated_at: string
                    p_reason_code: string
                    p_transition_input: Json
                    p_correlation_id: string
                }
                Returns: Json
            }
            apply_privacy_incident_transition: {
                Args: {
                    p_actor_user_id: string
                    p_operation_id: string
                    p_incident_id: string
                    p_to_status:
                        | 'detected'
                        | 'triaged'
                        | 'contained'
                        | 'assessed'
                        | 'notice_drafted'
                        | 'notice_approved'
                        | 'notified'
                        | 'closed'
                    p_expected_updated_at: string
                    p_preview_hash: string
                    p_confirmation_text: string
                    p_reason_code: string
                    p_transition_input: Json
                    p_correlation_id: string
                    p_idempotency_key: string
                }
                Returns: Json
            }
            ocr_log_metadata_is_safe: {
                Args: { p_metadata: Json }
                Returns: boolean
            }
            apply_admin_user_db_mutation: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string
                    p_action:
                        | 'admin_user_profile_updated'
                        | 'admin_user_role_granted'
                        | 'admin_user_role_revoked'
                        | 'admin_user_disabled'
                        | 'admin_user_reactivated'
                    p_reason: string
                    p_before_state: Json
                    p_after_state: Json
                    p_correlation_id: string
                    p_profile?: Json | null
                    p_next_role?: 'admin' | 'user' | null
                    p_next_account_status?: 'active' | 'disabled' | null
                    p_request_id?: string | null
                    p_ip_hash?: string | null
                    p_user_agent_hash?: string | null
                }
                Returns: string
            }
            append_admin_user_audit_event: {
                Args: {
                    p_actor_user_id: string
                    p_target_user_id: string | null
                    p_action: string
                    p_reason: string
                    p_status: string
                    p_correlation_id: string | null
                    p_audit_counts: Json
                    p_audit_flags: Json
                    p_applied_at: string | null
                    p_error_code: string | null
                    p_request_id: string
                    p_ip_hash: string | null
                    p_user_agent_hash: string | null
                }
                Returns: string
            }
            read_admin_user_management_metadata: {
                Args: { p_user_ids: string[] }
                Returns: {
                    user_id: string
                    username: string | null
                    nickname: string | null
                    avatar_url: string | null
                    profile_role: string | null
                    profile_created_at: string | null
                    profile_updated_at: string | null
                    is_admin: boolean
                    account_status: 'active' | 'disabled' | null
                }[]
            }
            read_admin_user_ids_for_management: {
                Args: Record<string, never>
                Returns: { user_id: string }[]
            }
            read_admin_user_audit_events: {
                Args: { p_limit: number }
                Returns: {
                    id: string
                    actor_user_id: string | null
                    target_user_id: string | null
                    action: string
                    reason: string
                    status: string
                    correlation_id: string | null
                    applied_at: string | null
                    error_code: string | null
                    created_at: string
                    audit_counts: Json
                    audit_flags: Json
                }[]
            }
        }
    }
}

type DatabaseTableWithRelationships<T> =
    T extends {
        Row: infer Row extends Record<string, unknown>
        Insert: infer Insert extends Record<string, unknown>
        Update: infer Update extends Record<string, unknown>
    }
        ? {
            Row: Row
            Insert: Insert
            Update: Update
            Relationships: []
        }
        : never

type DatabaseViewWithRelationships<T> =
    T extends { Row: infer Row extends Record<string, unknown> }
        ? T extends {
            Insert: infer Insert extends Record<string, unknown>
            Update: infer Update extends Record<string, unknown>
        }
            ? {
                Row: Row
                Insert: Insert
                Update: Update
                Relationships: []
            }
            : {
                Row: Row
                Relationships: []
            }
        : never


type DatabaseExactTableName =
    | 'notifications'
    | 'marketing_campaign_operations'
    | 'marketing_campaign_recipients'
    | 'marketing_campaign_batches'
    | 'account_deletion_policies'
    | 'account_deletion_data_classes'
    | 'account_deletion_requests'
    | 'account_deletion_request_items'
    | 'privacy_incidents'
    | 'privacy_incident_transition_previews'
    | 'privacy_incident_notices'
    | 'privacy_incident_actions'
type MissingDatabaseExactTableName = Exclude<
    DatabaseExactTableName,
    keyof DatabaseSource['public']['Tables']
>
type AssertNoMissingDatabaseTable<Name extends never> = Name
type ExactDatabaseTableCoverage = AssertNoMissingDatabaseTable<MissingDatabaseExactTableName>
type DatabaseLegacyTableName =
    | 'ad_banners'
    | 'admin_storyboard_jobs'
    | 'admin_user_preferences'
    | 'announcements'
    | 'restaurant_admin_destructive_audit_events'
    | 'restaurant_refresh_candidates'
    | 'restaurant_refresh_runs'
    | 'restaurant_requests'
    | 'restaurant_submission_items'
    | 'user_account_status'
    | 'user_bookmarks'
    | 'user_roles'
    | 'youtube_channel_kpi_snapshots'
    | 'youtube_thumbnail_releases'
    | 'youtube_video_kpi_snapshots'
type DatabaseLegacyFunctionName =
    | 'delete_pending_restaurant_submission'
    | 'publish_youtube_thumbnail_release'
    | 'review_restaurant_request'

type DatabaseLegacyRow = { [column: string]: Json | undefined }
type DatabaseLegacyTable = {
    Row: DatabaseLegacyRow
    Insert: DatabaseLegacyRow
    Update: DatabaseLegacyRow
    Relationships: []
}
type DatabaseLegacyFunction = {
    Args: { [argument: string]: Json | undefined }
    Returns: Json
}
export type Database = {
    __InternalSupabase: {
        PostgrestVersion: '13'
    }
    public: {
        Tables: {
            [Name in keyof DatabaseSource['public']['Tables']]:
                DatabaseTableWithRelationships<DatabaseSource['public']['Tables'][Name]>
        } & {
            [Name in DatabaseLegacyTableName]: DatabaseLegacyTable
        }
        Views: {
            [Name in keyof DatabaseSource['public']['Views']]:
                DatabaseViewWithRelationships<DatabaseSource['public']['Views'][Name]>
        }
        Functions: DatabaseSource['public']['Functions'] & {
            [Name in DatabaseLegacyFunctionName]: DatabaseLegacyFunction
        }
    }
}
export type RestaurantDatabaseRow = DatabaseSource['public']['Tables']['restaurants']['Row']
export type ReviewDatabaseRow = DatabaseSource['public']['Tables']['reviews']['Row']
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
