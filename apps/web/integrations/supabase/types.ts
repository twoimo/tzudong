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
