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
                    unique_id: string
                    name: string
                    phone: string | null
                    categories: string[]
                    status: string
                    source_type: string
                    youtube_meta: Json | null
                    evaluation_results: Json | null
                    reasoning_basis: string | null
                    tzuyang_reviews: Json[]
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
                    youtube_links: string[]
                    youtube_metas: Json[]
                    ai_rating: number | null
                    visit_count: number | null
                    review_count: number | null
                    description: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    unique_id: string
                    name: string
                    phone?: string | null
                    categories?: string[]
                    status?: string
                    source_type?: string
                    youtube_meta?: Json | null
                    evaluation_results?: Json | null
                    reasoning_basis?: string | null
                    tzuyang_reviews?: Json[]
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
                    youtube_links?: string[]
                    youtube_metas?: Json[]
                    ai_rating?: number | null
                    visit_count?: number | null
                    review_count?: number | null
                    description?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    unique_id?: string
                    name?: string
                    phone?: string | null
                    categories?: string[]
                    status?: string
                    source_type?: string
                    youtube_meta?: Json | null
                    evaluation_results?: Json | null
                    reasoning_basis?: string | null
                    tzuyang_reviews?: Json[]
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
                    youtube_links?: string[]
                    youtube_metas?: Json[]
                    ai_rating?: number | null
                    visit_count?: number | null
                    review_count?: number | null
                    description?: string | null
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
                    user_id: string | null
                    submission_type: string
                    restaurant_id: string | null
                    status: string
                    user_submitted_name: string | null
                    user_submitted_categories: string[]
                    user_submitted_phone: string | null
                    user_raw_address: string | null
                    name: string | null
                    phone: string | null
                    categories: string[]
                    lat: number | null
                    lng: number | null
                    road_address: string | null
                    jibun_address: string | null
                    english_address: string | null
                    address_elements: Json | null
                    admin_notes: string | null
                    resolved_by_admin_id: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string | null
                    submission_type: string
                    restaurant_id?: string | null
                    status?: string
                    user_submitted_name?: string | null
                    user_submitted_categories?: string[]
                    user_submitted_phone?: string | null
                    user_raw_address?: string | null
                    name?: string | null
                    phone?: string | null
                    categories?: string[]
                    lat?: number | null
                    lng?: number | null
                    road_address?: string | null
                    jibun_address?: string | null
                    english_address?: string | null
                    address_elements?: Json | null
                    admin_notes?: string | null
                    resolved_by_admin_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string | null
                    submission_type?: string
                    restaurant_id?: string | null
                    status?: string
                    user_submitted_name?: string | null
                    user_submitted_categories?: string[]
                    user_submitted_phone?: string | null
                    user_raw_address?: string | null
                    name?: string | null
                    phone?: string | null
                    categories?: string[]
                    lat?: number | null
                    lng?: number | null
                    road_address?: string | null
                    jibun_address?: string | null
                    english_address?: string | null
                    address_elements?: Json | null
                    admin_notes?: string | null
                    resolved_by_admin_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            profiles: {
                Row: {
                    id: string
                    user_id: string
                    username: string
                    avatar_url: string | null
                    role: string
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    username: string
                    avatar_url?: string | null
                    role?: string
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    username?: string
                    avatar_url?: string | null
                    role?: string
                    created_at?: string
                    updated_at?: string
                }
            }
        }
    }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
