export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
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
        }
        Functions: {
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
            mark_notification_read: {
                Args: { notification_uuid: string }
                Returns: void
            }
            mark_all_notifications_read: {
                Args: Record<string, never>
                Returns: void
            }
            create_user_notification: {
                Args: {
                    p_user_id: string
                    p_type: string
                    p_title: string
                    p_message: string
                    p_data: Json
                }
                Returns: void
            }
            delete_notification: {
                Args: { notification_uuid: string }
                Returns: void
            }
            create_admin_announcement_notification: {
                Args: {
                    p_title: string
                    p_message: string
                    p_data: Json
                }
                Returns: void
            }
            create_new_restaurant_notification: {
                Args: {
                    p_title: string
                    p_message: string
                    p_data: Json
                }
                Returns: void
            }
            create_ranking_notification: {
                Args: {
                    p_user_id: string
                    p_ranking: number
                    p_period: string
                }
                Returns: void
            }
        }
    }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
