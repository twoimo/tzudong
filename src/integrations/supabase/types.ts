export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          created_at: string | null
          email: string
          id: string
          last_login: string | null
          nickname: string
          profile_picture: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          last_login?: string | null
          nickname: string
          profile_picture?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          last_login?: string | null
          nickname?: string
          profile_picture?: string | null
          user_id?: string
        }
        Relationships: []
      }
      restaurants: {
        Row: {
          address: string
          ai_rating: number | null
          category: Database["public"]["Enums"]["restaurant_category"]
          created_at: string | null
          created_by: string | null
          id: string
          lat: number
          lng: number
          name: string
          phone: string | null
          review_count: number | null
          tzuyang_review: string | null
          updated_at: string | null
          visit_count: number | null
          youtube_link: string | null
        }
        Insert: {
          address: string
          ai_rating?: number | null
          category: Database["public"]["Enums"]["restaurant_category"]
          created_at?: string | null
          created_by?: string | null
          id?: string
          lat: number
          lng: number
          name: string
          phone?: string | null
          review_count?: number | null
          tzuyang_review?: string | null
          updated_at?: string | null
          visit_count?: number | null
          youtube_link?: string | null
        }
        Update: {
          address?: string
          ai_rating?: number | null
          category?: Database["public"]["Enums"]["restaurant_category"]
          created_at?: string | null
          created_by?: string | null
          id?: string
          lat?: number
          lng?: number
          name?: string
          phone?: string | null
          review_count?: number | null
          tzuyang_review?: string | null
          updated_at?: string | null
          visit_count?: number | null
          youtube_link?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          admin_note: string | null
          category: Database["public"]["Enums"]["restaurant_category"]
          content: string
          created_at: string | null
          edited_by_admin: boolean | null
          food_photos: string[] | null
          id: string
          is_pinned: boolean | null
          is_verified: boolean | null
          restaurant_id: string
          title: string
          updated_at: string | null
          user_id: string
          verification_photo: string
          visited_at: string
        }
        Insert: {
          admin_note?: string | null
          category: Database["public"]["Enums"]["restaurant_category"]
          content: string
          created_at?: string | null
          edited_by_admin?: boolean | null
          food_photos?: string[] | null
          id?: string
          is_pinned?: boolean | null
          is_verified?: boolean | null
          restaurant_id: string
          title: string
          updated_at?: string | null
          user_id: string
          verification_photo: string
          visited_at: string
        }
        Update: {
          admin_note?: string | null
          category?: Database["public"]["Enums"]["restaurant_category"]
          content?: string
          created_at?: string | null
          edited_by_admin?: boolean | null
          food_photos?: string[] | null
          id?: string
          is_pinned?: boolean | null
          is_verified?: boolean | null
          restaurant_id?: string
          title?: string
          updated_at?: string | null
          user_id?: string
          verification_photo?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      server_costs: {
        Row: {
          description: string | null
          id: string
          item_name: string
          monthly_cost: number
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          description?: string | null
          id?: string
          item_name: string
          monthly_cost: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          description?: string | null
          id?: string
          item_name?: string
          monthly_cost?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_stats: {
        Row: {
          id: string
          last_updated: string | null
          review_count: number | null
          trust_score: number | null
          user_id: string
          verified_review_count: number | null
        }
        Insert: {
          id?: string
          last_updated?: string | null
          review_count?: number | null
          trust_score?: number | null
          user_id: string
          verified_review_count?: number | null
        }
        Update: {
          id?: string
          last_updated?: string | null
          review_count?: number | null
          trust_score?: number | null
          user_id?: string
          verified_review_count?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      restaurant_category:
        | "치킨"
        | "중식"
        | "돈까스·회"
        | "피자"
        | "패스트푸드"
        | "찜·탕"
        | "족발·보쌈"
        | "분식"
        | "카페·디저트"
        | "한식"
        | "고기"
        | "양식"
        | "아시안"
        | "야식"
        | "도시락"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      restaurant_category: [
        "치킨",
        "중식",
        "돈까스·회",
        "피자",
        "패스트푸드",
        "찜·탕",
        "족발·보쌈",
        "분식",
        "카페·디저트",
        "한식",
        "고기",
        "양식",
        "아시안",
        "야식",
        "도시락",
      ],
    },
  },
} as const
