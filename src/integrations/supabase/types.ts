export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export type Database = {
    public: {
        Tables: {
            profiles: {
                Row: {
                    id: string
                    user_id: string
                    nickname: string
                    email: string
                    profile_picture: string | null
                    created_at: string
                    last_login: string
                    nickname_changed: boolean
                }
                Insert: {
                    id?: string
                    user_id: string
                    nickname: string
                    email: string
                    profile_picture?: string | null
                    created_at?: string
                    last_login?: string
                    nickname_changed?: boolean
                }
                Update: {
                    id?: string
                    user_id?: string
                    nickname?: string
                    email?: string
                    profile_picture?: string | null
                    created_at?: string
                    last_login?: string
                    nickname_changed?: boolean
                }
                Relationships: [
                    {
                        foreignKeyName: "profiles_user_id_fkey"
                        columns: ["user_id"]
                        isOneToOne: true
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    }
                ]
            }
            restaurants: {
                Row: {
                    id: string
                    name: string
                    address: string
                    phone: string | null
                    category: string[]
                    youtube_link: string | null
                    tzuyang_review: string | null
                    lat: number
                    lng: number
                    ai_rating: number | null
                    visit_count: number
                    review_count: number
                    created_by: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    address: string
                    phone?: string | null
                    category: string[]
                    youtube_link?: string | null
                    tzuyang_review?: string | null
                    lat: number
                    lng: number
                    ai_rating?: number | null
                    visit_count?: number
                    review_count?: number
                    created_by?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    address?: string
                    phone?: string | null
                    category?: string[]
                    youtube_link?: string | null
                    tzuyang_review?: string | null
                    lat?: number
                    lng?: number
                    ai_rating?: number | null
                    visit_count?: number
                    review_count?: number
                    created_by?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "restaurants_created_by_fkey"
                        columns: ["created_by"]
                        isOneToOne: false
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    }
                ]
            }
            restaurant_submissions: {
                Row: {
                    id: string
                    user_id: string
                    restaurant_name: string
                    address: string
                    phone: string | null
                    category: string[]
                    youtube_link: string
                    description: string | null
                    status: string
                    rejection_reason: string | null
                    created_at: string
                    reviewed_by_admin_id: string | null
                    reviewed_at: string | null
                    approved_restaurant_id: string | null
                    submission_type: string
                    original_restaurant_id: string | null
                    changes_requested: Json | null
                }
                Insert: {
                    id?: string
                    user_id: string
                    restaurant_name: string
                    address: string
                    phone?: string | null
                    category: string[]
                    youtube_link: string
                    description?: string | null
                    status?: string
                    rejection_reason?: string | null
                    created_at?: string
                    reviewed_by_admin_id?: string | null
                    reviewed_at?: string | null
                    approved_restaurant_id?: string | null
                    submission_type?: string
                    original_restaurant_id?: string | null
                    changes_requested?: Json | null
                }
                Update: {
                    id?: string
                    user_id?: string
                    restaurant_name?: string
                    address?: string
                    phone?: string | null
                    category?: string[]
                    youtube_link?: string
                    description?: string | null
                    status?: string
                    rejection_reason?: string | null
                    created_at?: string
                    reviewed_by_admin_id?: string | null
                    reviewed_at?: string | null
                    approved_restaurant_id?: string | null
                    submission_type?: string
                    original_restaurant_id?: string | null
                    changes_requested?: Json | null
                }
                Relationships: [
                    {
                        foreignKeyName: "restaurant_submissions_user_id_fkey"
                        columns: ["user_id"]
                        isOneToOne: false
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "restaurant_submissions_reviewed_by_admin_id_fkey"
                        columns: ["reviewed_by_admin_id"]
                        isOneToOne: false
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "restaurant_submissions_approved_restaurant_id_fkey"
                        columns: ["approved_restaurant_id"]
                        isOneToOne: false
                        referencedRelation: "restaurants"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "restaurant_submissions_original_restaurant_id_fkey"
                        columns: ["original_restaurant_id"]
                        isOneToOne: false
                        referencedRelation: "restaurants"
                        referencedColumns: ["id"]
                    }
                ]
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
                    category: string[]
                    categories: string[] | null
                    is_verified: boolean
                    admin_note: string | null
                    is_pinned: boolean
                    edited_by_admin: boolean
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
                    category: string[]
                    categories?: string[] | null
                    is_verified?: boolean
                    admin_note?: string | null
                    is_pinned?: boolean
                    edited_by_admin?: boolean
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
                    category?: string[]
                    categories?: string[] | null
                    is_verified?: boolean
                    admin_note?: string | null
                    is_pinned?: boolean
                    edited_by_admin?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "reviews_user_id_fkey"
                        columns: ["user_id"]
                        isOneToOne: false
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "reviews_restaurant_id_fkey"
                        columns: ["restaurant_id"]
                        isOneToOne: false
                        referencedRelation: "restaurants"
                        referencedColumns: ["id"]
                    }
                ]
            }
            server_costs: {
                Row: {
                    id: string
                    item_name: string
                    monthly_cost: number
                    description: string | null
                    updated_by: string | null
                    updated_at: string
                }
                Insert: {
                    id?: string
                    item_name: string
                    monthly_cost: number
                    description?: string | null
                    updated_by?: string | null
                    updated_at?: string
                }
                Update: {
                    id?: string
                    item_name?: string
                    monthly_cost?: number
                    description?: string | null
                    updated_by?: string | null
                    updated_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "server_costs_updated_by_fkey"
                        columns: ["updated_by"]
                        isOneToOne: false
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    }
                ]
            }
            user_roles: {
                Row: {
                    id: string
                    user_id: string
                    role: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    role: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    role?: string
                    created_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "user_roles_user_id_fkey"
                        columns: ["user_id"]
                        isOneToOne: false
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    }
                ]
            }
            user_stats: {
                Row: {
                    id: string
                    user_id: string
                    review_count: number
                    verified_review_count: number
                    trust_score: number
                    last_updated: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    review_count?: number
                    verified_review_count?: number
                    trust_score?: number
                    last_updated?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    review_count?: number
                    verified_review_count?: number
                    trust_score?: number
                    last_updated?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "user_stats_user_id_fkey"
                        columns: ["user_id"]
                        isOneToOne: true
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    }
                ]
            }
        }
        Views: {
            submission_stats: {
                Row: {
                    user_id: string | null
                    pending_count: number | null
                    approved_count: number | null
                    rejected_count: number | null
                    total_count: number | null
                }
                Relationships: []
            }
        }
        Functions: {
            has_role: {
                Args: {
                    _user_id: string
                    _role: string
                }
                Returns: boolean
            }
        }
        Enums: {
            app_role: "admin" | "user"
        }
        CompositeTypes: {
            [_ in never]: never
        }
    }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
    PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
            Row: infer R
        }
    ? R
    : never
    : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
            Row: infer R
        }
    ? R
    : never
    : never

export type TablesInsert<
    PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Insert: infer I
    }
    ? I
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
    }
    ? I
    : never
    : never

export type TablesUpdate<
    PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Update: infer U
    }
    ? U
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
    }
    ? U
    : never
    : never

export type Enums<
    PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
    EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
    ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
    : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
    PublicEnumNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
    CompositeTypeName extends PublicEnumNameOrOptions extends {
        schema: keyof Database
    }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
    ? Database[PublicEnumNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
    : PublicEnumNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicEnumNameOrOptions]
    : never