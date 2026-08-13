export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  auth: {
    Tables: {
      audit_log_entries: {
        Row: {
          created_at: string | null
          id: string
          instance_id: string | null
          ip_address: string
          payload: Json | null
        }
        Insert: {
          created_at?: string | null
          id: string
          instance_id?: string | null
          ip_address?: string
          payload?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          instance_id?: string | null
          ip_address?: string
          payload?: Json | null
        }
        Relationships: []
      }
      flow_state: {
        Row: {
          auth_code: string
          auth_code_issued_at: string | null
          authentication_method: string
          code_challenge: string
          code_challenge_method: Database["auth"]["Enums"]["code_challenge_method"]
          created_at: string | null
          id: string
          provider_access_token: string | null
          provider_refresh_token: string | null
          provider_type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          auth_code: string
          auth_code_issued_at?: string | null
          authentication_method: string
          code_challenge: string
          code_challenge_method: Database["auth"]["Enums"]["code_challenge_method"]
          created_at?: string | null
          id: string
          provider_access_token?: string | null
          provider_refresh_token?: string | null
          provider_type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          auth_code?: string
          auth_code_issued_at?: string | null
          authentication_method?: string
          code_challenge?: string
          code_challenge_method?: Database["auth"]["Enums"]["code_challenge_method"]
          created_at?: string | null
          id?: string
          provider_access_token?: string | null
          provider_refresh_token?: string | null
          provider_type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      identities: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          identity_data: Json
          last_sign_in_at: string | null
          provider: string
          provider_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          identity_data: Json
          last_sign_in_at?: string | null
          provider: string
          provider_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          identity_data?: Json
          last_sign_in_at?: string | null
          provider?: string
          provider_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      instances: {
        Row: {
          created_at: string | null
          id: string
          raw_base_config: string | null
          updated_at: string | null
          uuid: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          raw_base_config?: string | null
          updated_at?: string | null
          uuid?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          raw_base_config?: string | null
          updated_at?: string | null
          uuid?: string | null
        }
        Relationships: []
      }
      mfa_amr_claims: {
        Row: {
          authentication_method: string
          created_at: string
          id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          authentication_method: string
          created_at: string
          id: string
          session_id: string
          updated_at: string
        }
        Update: {
          authentication_method?: string
          created_at?: string
          id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mfa_amr_claims_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_challenges: {
        Row: {
          created_at: string
          factor_id: string
          id: string
          ip_address: unknown
          otp_code: string | null
          verified_at: string | null
          web_authn_session_data: Json | null
        }
        Insert: {
          created_at: string
          factor_id: string
          id: string
          ip_address: unknown
          otp_code?: string | null
          verified_at?: string | null
          web_authn_session_data?: Json | null
        }
        Update: {
          created_at?: string
          factor_id?: string
          id?: string
          ip_address?: unknown
          otp_code?: string | null
          verified_at?: string | null
          web_authn_session_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mfa_challenges_auth_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "mfa_factors"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_factors: {
        Row: {
          created_at: string
          factor_type: Database["auth"]["Enums"]["factor_type"]
          friendly_name: string | null
          id: string
          last_challenged_at: string | null
          last_webauthn_challenge_data: Json | null
          phone: string | null
          secret: string | null
          status: Database["auth"]["Enums"]["factor_status"]
          updated_at: string
          user_id: string
          web_authn_aaguid: string | null
          web_authn_credential: Json | null
        }
        Insert: {
          created_at: string
          factor_type: Database["auth"]["Enums"]["factor_type"]
          friendly_name?: string | null
          id: string
          last_challenged_at?: string | null
          last_webauthn_challenge_data?: Json | null
          phone?: string | null
          secret?: string | null
          status: Database["auth"]["Enums"]["factor_status"]
          updated_at: string
          user_id: string
          web_authn_aaguid?: string | null
          web_authn_credential?: Json | null
        }
        Update: {
          created_at?: string
          factor_type?: Database["auth"]["Enums"]["factor_type"]
          friendly_name?: string | null
          id?: string
          last_challenged_at?: string | null
          last_webauthn_challenge_data?: Json | null
          phone?: string | null
          secret?: string | null
          status?: Database["auth"]["Enums"]["factor_status"]
          updated_at?: string
          user_id?: string
          web_authn_aaguid?: string | null
          web_authn_credential?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mfa_factors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_authorizations: {
        Row: {
          approved_at: string | null
          authorization_code: string | null
          authorization_id: string
          client_id: string
          code_challenge: string | null
          code_challenge_method:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at: string
          expires_at: string
          id: string
          nonce: string | null
          redirect_uri: string
          resource: string | null
          response_type: Database["auth"]["Enums"]["oauth_response_type"]
          scope: string
          state: string | null
          status: Database["auth"]["Enums"]["oauth_authorization_status"]
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          authorization_code?: string | null
          authorization_id: string
          client_id: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string
          expires_at?: string
          id: string
          nonce?: string | null
          redirect_uri: string
          resource?: string | null
          response_type?: Database["auth"]["Enums"]["oauth_response_type"]
          scope: string
          state?: string | null
          status?: Database["auth"]["Enums"]["oauth_authorization_status"]
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          authorization_code?: string | null
          authorization_id?: string
          client_id?: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string
          expires_at?: string
          id?: string
          nonce?: string | null
          redirect_uri?: string
          resource?: string | null
          response_type?: Database["auth"]["Enums"]["oauth_response_type"]
          scope?: string
          state?: string | null
          status?: Database["auth"]["Enums"]["oauth_authorization_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_authorizations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_client_states: {
        Row: {
          code_verifier: string | null
          created_at: string
          id: string
          provider_type: string
        }
        Insert: {
          code_verifier?: string | null
          created_at: string
          id: string
          provider_type: string
        }
        Update: {
          code_verifier?: string | null
          created_at?: string
          id?: string
          provider_type?: string
        }
        Relationships: []
      }
      oauth_clients: {
        Row: {
          client_name: string | null
          client_secret_hash: string | null
          client_type: Database["auth"]["Enums"]["oauth_client_type"]
          client_uri: string | null
          created_at: string
          deleted_at: string | null
          grant_types: string
          id: string
          logo_uri: string | null
          redirect_uris: string
          registration_type: Database["auth"]["Enums"]["oauth_registration_type"]
          updated_at: string
        }
        Insert: {
          client_name?: string | null
          client_secret_hash?: string | null
          client_type?: Database["auth"]["Enums"]["oauth_client_type"]
          client_uri?: string | null
          created_at?: string
          deleted_at?: string | null
          grant_types: string
          id: string
          logo_uri?: string | null
          redirect_uris: string
          registration_type: Database["auth"]["Enums"]["oauth_registration_type"]
          updated_at?: string
        }
        Update: {
          client_name?: string | null
          client_secret_hash?: string | null
          client_type?: Database["auth"]["Enums"]["oauth_client_type"]
          client_uri?: string | null
          created_at?: string
          deleted_at?: string | null
          grant_types?: string
          id?: string
          logo_uri?: string | null
          redirect_uris?: string
          registration_type?: Database["auth"]["Enums"]["oauth_registration_type"]
          updated_at?: string
        }
        Relationships: []
      }
      oauth_consents: {
        Row: {
          client_id: string
          granted_at: string
          id: string
          revoked_at: string | null
          scopes: string
          user_id: string
        }
        Insert: {
          client_id: string
          granted_at?: string
          id: string
          revoked_at?: string | null
          scopes: string
          user_id: string
        }
        Update: {
          client_id?: string
          granted_at?: string
          id?: string
          revoked_at?: string | null
          scopes?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      one_time_tokens: {
        Row: {
          created_at: string
          id: string
          relates_to: string
          token_hash: string
          token_type: Database["auth"]["Enums"]["one_time_token_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          relates_to: string
          token_hash: string
          token_type: Database["auth"]["Enums"]["one_time_token_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          relates_to?: string
          token_hash?: string
          token_type?: Database["auth"]["Enums"]["one_time_token_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "one_time_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      refresh_tokens: {
        Row: {
          created_at: string | null
          id: number
          instance_id: string | null
          parent: string | null
          revoked: boolean | null
          session_id: string | null
          token: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          instance_id?: string | null
          parent?: string | null
          revoked?: boolean | null
          session_id?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          instance_id?: string | null
          parent?: string | null
          revoked?: boolean | null
          session_id?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refresh_tokens_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      saml_providers: {
        Row: {
          attribute_mapping: Json | null
          created_at: string | null
          entity_id: string
          id: string
          metadata_url: string | null
          metadata_xml: string
          name_id_format: string | null
          sso_provider_id: string
          updated_at: string | null
        }
        Insert: {
          attribute_mapping?: Json | null
          created_at?: string | null
          entity_id: string
          id: string
          metadata_url?: string | null
          metadata_xml: string
          name_id_format?: string | null
          sso_provider_id: string
          updated_at?: string | null
        }
        Update: {
          attribute_mapping?: Json | null
          created_at?: string | null
          entity_id?: string
          id?: string
          metadata_url?: string | null
          metadata_xml?: string
          name_id_format?: string | null
          sso_provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saml_providers_sso_provider_id_fkey"
            columns: ["sso_provider_id"]
            isOneToOne: false
            referencedRelation: "sso_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      saml_relay_states: {
        Row: {
          created_at: string | null
          flow_state_id: string | null
          for_email: string | null
          id: string
          redirect_to: string | null
          request_id: string
          sso_provider_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          flow_state_id?: string | null
          for_email?: string | null
          id: string
          redirect_to?: string | null
          request_id: string
          sso_provider_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          flow_state_id?: string | null
          for_email?: string | null
          id?: string
          redirect_to?: string | null
          request_id?: string
          sso_provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saml_relay_states_flow_state_id_fkey"
            columns: ["flow_state_id"]
            isOneToOne: false
            referencedRelation: "flow_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saml_relay_states_sso_provider_id_fkey"
            columns: ["sso_provider_id"]
            isOneToOne: false
            referencedRelation: "sso_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          version: string
        }
        Insert: {
          version: string
        }
        Update: {
          version?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          aal: Database["auth"]["Enums"]["aal_level"] | null
          created_at: string | null
          factor_id: string | null
          id: string
          ip: unknown
          not_after: string | null
          oauth_client_id: string | null
          refresh_token_counter: number | null
          refresh_token_hmac_key: string | null
          refreshed_at: string | null
          scopes: string | null
          tag: string | null
          updated_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          aal?: Database["auth"]["Enums"]["aal_level"] | null
          created_at?: string | null
          factor_id?: string | null
          id: string
          ip?: unknown
          not_after?: string | null
          oauth_client_id?: string | null
          refresh_token_counter?: number | null
          refresh_token_hmac_key?: string | null
          refreshed_at?: string | null
          scopes?: string | null
          tag?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          aal?: Database["auth"]["Enums"]["aal_level"] | null
          created_at?: string | null
          factor_id?: string | null
          id?: string
          ip?: unknown
          not_after?: string | null
          oauth_client_id?: string | null
          refresh_token_counter?: number | null
          refresh_token_hmac_key?: string | null
          refreshed_at?: string | null
          scopes?: string | null
          tag?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_oauth_client_id_fkey"
            columns: ["oauth_client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_domains: {
        Row: {
          created_at: string | null
          domain: string
          id: string
          sso_provider_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          domain: string
          id: string
          sso_provider_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          domain?: string
          id?: string
          sso_provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sso_domains_sso_provider_id_fkey"
            columns: ["sso_provider_id"]
            isOneToOne: false
            referencedRelation: "sso_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_providers: {
        Row: {
          created_at: string | null
          disabled: boolean | null
          id: string
          resource_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          disabled?: boolean | null
          id: string
          resource_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          disabled?: boolean | null
          id?: string
          resource_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          aud: string | null
          banned_until: string | null
          confirmation_sent_at: string | null
          confirmation_token: string | null
          confirmed_at: string | null
          created_at: string | null
          deleted_at: string | null
          email: string | null
          email_change: string | null
          email_change_confirm_status: number | null
          email_change_sent_at: string | null
          email_change_token_current: string | null
          email_change_token_new: string | null
          email_confirmed_at: string | null
          encrypted_password: string | null
          id: string
          instance_id: string | null
          invited_at: string | null
          is_anonymous: boolean
          is_sso_user: boolean
          is_super_admin: boolean | null
          last_sign_in_at: string | null
          phone: string | null
          phone_change: string | null
          phone_change_sent_at: string | null
          phone_change_token: string | null
          phone_confirmed_at: string | null
          raw_app_meta_data: Json | null
          raw_user_meta_data: Json | null
          reauthentication_sent_at: string | null
          reauthentication_token: string | null
          recovery_sent_at: string | null
          recovery_token: string | null
          role: string | null
          updated_at: string | null
        }
        Insert: {
          aud?: string | null
          banned_until?: string | null
          confirmation_sent_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          email_change?: string | null
          email_change_confirm_status?: number | null
          email_change_sent_at?: string | null
          email_change_token_current?: string | null
          email_change_token_new?: string | null
          email_confirmed_at?: string | null
          encrypted_password?: string | null
          id: string
          instance_id?: string | null
          invited_at?: string | null
          is_anonymous?: boolean
          is_sso_user?: boolean
          is_super_admin?: boolean | null
          last_sign_in_at?: string | null
          phone?: string | null
          phone_change?: string | null
          phone_change_sent_at?: string | null
          phone_change_token?: string | null
          phone_confirmed_at?: string | null
          raw_app_meta_data?: Json | null
          raw_user_meta_data?: Json | null
          reauthentication_sent_at?: string | null
          reauthentication_token?: string | null
          recovery_sent_at?: string | null
          recovery_token?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          aud?: string | null
          banned_until?: string | null
          confirmation_sent_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          email_change?: string | null
          email_change_confirm_status?: number | null
          email_change_sent_at?: string | null
          email_change_token_current?: string | null
          email_change_token_new?: string | null
          email_confirmed_at?: string | null
          encrypted_password?: string | null
          id?: string
          instance_id?: string | null
          invited_at?: string | null
          is_anonymous?: boolean
          is_sso_user?: boolean
          is_super_admin?: boolean | null
          last_sign_in_at?: string | null
          phone?: string | null
          phone_change?: string | null
          phone_change_sent_at?: string | null
          phone_change_token?: string | null
          phone_confirmed_at?: string | null
          raw_app_meta_data?: Json | null
          raw_user_meta_data?: Json | null
          reauthentication_sent_at?: string | null
          reauthentication_token?: string | null
          recovery_sent_at?: string | null
          recovery_token?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      email: { Args: never; Returns: string }
      jwt: { Args: never; Returns: Json }
      role: { Args: never; Returns: string }
      uid: { Args: never; Returns: string }
    }
    Enums: {
      aal_level: "aal1" | "aal2" | "aal3"
      code_challenge_method: "s256" | "plain"
      factor_status: "unverified" | "verified"
      factor_type: "totp" | "webauthn" | "phone"
      oauth_authorization_status: "pending" | "approved" | "denied" | "expired"
      oauth_client_type: "public" | "confidential"
      oauth_registration_type: "dynamic" | "manual"
      oauth_response_type: "code"
      one_time_token_type:
        | "confirmation_token"
        | "reauthentication_token"
        | "recovery_token"
        | "email_change_token_new"
        | "email_change_token_current"
        | "phone_change_token"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_deletion_data_classes: {
        Row: {
          code: string
          disposition: string
          mandatory: boolean
          policy_version: string
        }
        Insert: {
          code: string
          disposition: string
          mandatory?: boolean
          policy_version: string
        }
        Update: {
          code?: string
          disposition?: string
          mandatory?: boolean
          policy_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_data_classes_policy_version_fkey"
            columns: ["policy_version"]
            isOneToOne: false
            referencedRelation: "account_deletion_policies"
            referencedColumns: ["version"]
          },
        ]
      }
      account_deletion_policies: {
        Row: {
          confirmation_text: string
          created_at: string
          preview_ttl: string
          reauth_max_age: string
          status: string
          version: string
        }
        Insert: {
          confirmation_text: string
          created_at?: string
          preview_ttl: string
          reauth_max_age: string
          status: string
          version: string
        }
        Update: {
          confirmation_text?: string
          created_at?: string
          preview_ttl?: string
          reauth_max_age?: string
          status?: string
          version?: string
        }
        Relationships: []
      }
      account_deletion_request_items: {
        Row: {
          data_class_code: string
          disposition: string
          mandatory: boolean
          planned_count: number
          reason_code: string
          request_id: string
          status: string
          updated_at: string
        }
        Insert: {
          data_class_code: string
          disposition: string
          mandatory: boolean
          planned_count?: number
          reason_code: string
          request_id: string
          status: string
          updated_at?: string
        }
        Update: {
          data_class_code?: string
          disposition?: string
          mandatory?: boolean
          planned_count?: number
          reason_code?: string
          request_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "account_deletion_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletion_requests: {
        Row: {
          actor_user_id: string
          applied_at: string | null
          auth_readback_passed: boolean
          auth_receipt_ref: string | null
          count_summary: Json
          created_at: string
          db_readback_passed: boolean
          id: string
          idempotency_key: string | null
          policy_version: string
          preview_expires_at: string
          preview_hash: string
          reason_code: string
          reauthenticated_at: string
          session_readback_passed: boolean
          source_manifest_hash: string
          status: string
          storage_readback_passed: boolean
          storage_receipts_hash: string | null
          target_user_id: string
          updated_at: string
        }
        Insert: {
          actor_user_id: string
          applied_at?: string | null
          auth_readback_passed?: boolean
          auth_receipt_ref?: string | null
          count_summary?: Json
          created_at?: string
          db_readback_passed?: boolean
          id?: string
          idempotency_key?: string | null
          policy_version: string
          preview_expires_at: string
          preview_hash: string
          reason_code: string
          reauthenticated_at: string
          session_readback_passed?: boolean
          source_manifest_hash: string
          status: string
          storage_readback_passed?: boolean
          storage_receipts_hash?: string | null
          target_user_id: string
          updated_at?: string
        }
        Update: {
          actor_user_id?: string
          applied_at?: string | null
          auth_readback_passed?: boolean
          auth_receipt_ref?: string | null
          count_summary?: Json
          created_at?: string
          db_readback_passed?: boolean
          id?: string
          idempotency_key?: string | null
          policy_version?: string
          preview_expires_at?: string
          preview_hash?: string
          reason_code?: string
          reauthenticated_at?: string
          session_readback_passed?: boolean
          source_manifest_hash?: string
          status?: string
          storage_readback_passed?: boolean
          storage_receipts_hash?: string | null
          target_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_policy_version_fkey"
            columns: ["policy_version"]
            isOneToOne: false
            referencedRelation: "account_deletion_policies"
            referencedColumns: ["version"]
          },
        ]
      }
      ad_banners: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          display_target: string[]
          id: string
          image_url: string | null
          is_active: boolean
          link_url: string | null
          media_type: string | null
          priority: number
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_target?: string[]
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          media_type?: string | null
          priority?: number
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_target?: string[]
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          media_type?: string | null
          priority?: number
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      admin_ai_leaderboard_snapshots: {
        Row: {
          candidate_models: Json
          created_by_admin_id: string | null
          fetched_at: string
          id: string
          leaderboard_config: string
          payload: Json
          source: string
        }
        Insert: {
          candidate_models?: Json
          created_by_admin_id?: string | null
          fetched_at?: string
          id?: string
          leaderboard_config: string
          payload?: Json
          source: string
        }
        Update: {
          candidate_models?: Json
          created_by_admin_id?: string | null
          fetched_at?: string
          id?: string
          leaderboard_config?: string
          payload?: Json
          source?: string
        }
        Relationships: []
      }
      admin_ai_provider_keys: {
        Row: {
          api_key: string
          provider: string
          updated_at: string
          updated_by_admin_id: string | null
        }
        Insert: {
          api_key: string
          provider: string
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Update: {
          api_key?: string
          provider?: string
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Relationships: []
      }
      admin_ai_settings: {
        Row: {
          candidate_models: Json
          id: string
          manual_model: string | null
          manual_provider: string | null
          routing_mode: string
          updated_at: string
          updated_by_admin_id: string | null
        }
        Insert: {
          candidate_models?: Json
          id: string
          manual_model?: string | null
          manual_provider?: string | null
          routing_mode?: string
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Update: {
          candidate_models?: Json
          id?: string
          manual_model?: string | null
          manual_provider?: string | null
          routing_mode?: string
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Relationships: []
      }
      admin_audit_events: {
        Row: {
          action: string
          actor_user_id: string
          after_state: Json
          applied_at: string | null
          audit_counts: Json
          audit_flags: Json
          before_state: Json
          correlation_id: string | null
          created_at: string
          error_code: string | null
          id: string
          ip_hash: string | null
          reason: string | null
          request_id: string | null
          status: string
          target_user_id: string | null
          user_agent_hash: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          after_state?: Json
          applied_at?: string | null
          audit_counts?: Json
          audit_flags?: Json
          before_state?: Json
          correlation_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          ip_hash?: string | null
          reason?: string | null
          request_id?: string | null
          status?: string
          target_user_id?: string | null
          user_agent_hash?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          after_state?: Json
          applied_at?: string | null
          audit_counts?: Json
          audit_flags?: Json
          before_state?: Json
          correlation_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          ip_hash?: string | null
          reason?: string | null
          request_id?: string | null
          status?: string
          target_user_id?: string | null
          user_agent_hash?: string | null
        }
        Relationships: []
      }
      admin_restaurant_map_overlay_audit_events: {
        Row: {
          action: string
          actor_user_id: string
          after_snapshot: Json
          applied_at: string
          before_snapshot: Json
          correlation_id: string
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string
          overlay_type: string
          payload_hash: string
          reason: string
          request_metadata: Json
          restaurant_id: string
          status: string
        }
        Insert: {
          action: string
          actor_user_id: string
          after_snapshot?: Json
          applied_at?: string
          before_snapshot?: Json
          correlation_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key: string
          overlay_type: string
          payload_hash: string
          reason: string
          request_metadata?: Json
          restaurant_id: string
          status?: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          after_snapshot?: Json
          applied_at?: string
          before_snapshot?: Json
          correlation_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string
          overlay_type?: string
          payload_hash?: string
          reason?: string
          request_metadata?: Json
          restaurant_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_restaurant_map_overlay_audit_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_restaurant_map_overlay_proposal_review_events: {
        Row: {
          actor_user_id: string
          correlation_id: string
          created_at: string
          from_status: string
          id: string
          idempotency_key: string
          proposal_hash: string
          proposal_id: string
          reason: string
          request_hash: string
          request_metadata: Json
          reviewed_by_admin_id: string
          to_status: string
          transition: string
        }
        Insert: {
          actor_user_id: string
          correlation_id: string
          created_at?: string
          from_status: string
          id?: string
          idempotency_key: string
          proposal_hash: string
          proposal_id: string
          reason: string
          request_hash: string
          request_metadata?: Json
          reviewed_by_admin_id: string
          to_status: string
          transition: string
        }
        Update: {
          actor_user_id?: string
          correlation_id?: string
          created_at?: string
          from_status?: string
          id?: string
          idempotency_key?: string
          proposal_hash?: string
          proposal_id?: string
          reason?: string
          request_hash?: string
          request_metadata?: Json
          reviewed_by_admin_id?: string
          to_status?: string
          transition?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_restaurant_map_overlay_proposal_review_e_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_map_overlay_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_restaurant_map_overlay_proposals: {
        Row: {
          active_from: string | null
          active_until: string | null
          created_at: string
          description: string | null
          evidence: Json
          id: string
          label: string
          overlay_audit_id: string | null
          overlay_type: string
          proposal_hash: string
          proposal_status: string
          restaurant_id: string
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by_admin_id: string | null
          run_id: string
          score: number
          score_breakdown: Json
          supersedes_proposal_id: string | null
          updated_at: string
        }
        Insert: {
          active_from?: string | null
          active_until?: string | null
          created_at?: string
          description?: string | null
          evidence: Json
          id?: string
          label: string
          overlay_audit_id?: string | null
          overlay_type: string
          proposal_hash: string
          proposal_status?: string
          restaurant_id: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          run_id: string
          score: number
          score_breakdown: Json
          supersedes_proposal_id?: string | null
          updated_at?: string
        }
        Update: {
          active_from?: string | null
          active_until?: string | null
          created_at?: string
          description?: string | null
          evidence?: Json
          id?: string
          label?: string
          overlay_audit_id?: string | null
          overlay_type?: string
          proposal_hash?: string
          proposal_status?: string
          restaurant_id?: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          run_id?: string
          score?: number
          score_breakdown?: Json
          supersedes_proposal_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_restaurant_map_overlay_propos_supersedes_proposal_id_fkey"
            columns: ["supersedes_proposal_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_map_overlay_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_restaurant_map_overlay_proposals_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_restaurant_map_overlay_proposals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "admin_trend_signal_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_restaurant_map_overlays: {
        Row: {
          active_from: string | null
          active_until: string | null
          created_at: string
          created_by_admin_id: string | null
          description: string | null
          evidence: Json
          is_active: boolean
          label: string
          overlay_type: string
          restaurant_id: string
          updated_at: string
          updated_by_admin_id: string | null
        }
        Insert: {
          active_from?: string | null
          active_until?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          description?: string | null
          evidence?: Json
          is_active?: boolean
          label: string
          overlay_type: string
          restaurant_id: string
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Update: {
          active_from?: string | null
          active_until?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          description?: string | null
          evidence?: Json
          is_active?: boolean
          label?: string
          overlay_type?: string
          restaurant_id?: string
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_restaurant_map_overlays_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_storyboard_jobs: {
        Row: {
          cancelled_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          readiness: Json
          request_payload: Json
          requested_by_admin_id: string
          result_payload: Json | null
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          readiness?: Json
          request_payload?: Json
          requested_by_admin_id: string
          result_payload?: Json | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          readiness?: Json
          request_payload?: Json
          requested_by_admin_id?: string
          result_payload?: Json | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_trend_job_requests: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          correlation_id: string
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string
          parameters: Json
          parameters_hash: string
          request_hash: string
          request_kind: string
          requested_by_admin_id: string
          result_summary: Json
          run_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          correlation_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key: string
          parameters?: Json
          parameters_hash: string
          request_hash: string
          request_kind: string
          requested_by_admin_id: string
          result_summary?: Json
          run_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string
          parameters?: Json
          parameters_hash?: string
          request_hash?: string
          request_kind?: string
          requested_by_admin_id?: string
          result_summary?: Json
          run_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_trend_job_requests_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "admin_trend_signal_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_trend_signal_observations: {
        Row: {
          created_at: string
          id: string
          observed_at: string
          provenance: Json
          raw_excerpt: string | null
          restaurant_id: string | null
          run_id: string
          signal_key: string
          signal_value: number | null
          source_type: string
          source_url: string | null
          video_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          observed_at: string
          provenance?: Json
          raw_excerpt?: string | null
          restaurant_id?: string | null
          run_id: string
          signal_key: string
          signal_value?: number | null
          source_type: string
          source_url?: string | null
          video_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          observed_at?: string
          provenance?: Json
          raw_excerpt?: string | null
          restaurant_id?: string | null
          run_id?: string
          signal_key?: string
          signal_value?: number | null
          source_type?: string
          source_url?: string | null
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_trend_signal_observations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_trend_signal_observations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "admin_trend_signal_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_trend_signal_runs: {
        Row: {
          completed_at: string | null
          created_by_admin_id: string | null
          error_code: string | null
          id: string
          input_window: Json
          provenance: Json
          provider_status: Json
          rate_limit_summary: Json
          run_kind: string
          source_profile: string
          started_at: string
          status: string
          summary: Json
        }
        Insert: {
          completed_at?: string | null
          created_by_admin_id?: string | null
          error_code?: string | null
          id?: string
          input_window?: Json
          provenance?: Json
          provider_status?: Json
          rate_limit_summary?: Json
          run_kind: string
          source_profile: string
          started_at?: string
          status: string
          summary?: Json
        }
        Update: {
          completed_at?: string | null
          created_by_admin_id?: string | null
          error_code?: string | null
          id?: string
          input_window?: Json
          provenance?: Json
          provider_status?: Json
          rate_limit_summary?: Json
          run_kind?: string
          source_profile?: string
          started_at?: string
          status?: string
          summary?: Json
        }
        Relationships: []
      }
      admin_user_preferences: {
        Row: {
          created_at: string
          id: string
          preference_key: string
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          preference_key: string
          updated_at?: string
          user_id: string
          value?: Json
        }
        Update: {
          created_at?: string
          id?: string
          preference_key?: string
          updated_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: []
      }
      admin_workflow_runs: {
        Row: {
          channel_id: string | null
          channel_slug: string | null
          channel_url_normalized: string | null
          channel_url_raw: string | null
          completed_at: string | null
          correlation_key: string | null
          correlation_state: Database["public"]["Enums"]["admin_workflow_correlation_state"]
          created_at: string
          dedupe_of_run_id: string | null
          dispatch_request_id: string
          dispatched_at: string | null
          error_code: string | null
          error_message: string | null
          github_conclusion: string | null
          github_run_attempt: number | null
          github_run_id: number | null
          github_run_number: number | null
          github_status: string | null
          github_workflow_id: number | null
          matched_at: string | null
          requested_at: string
          requested_by_user_id: string | null
          run_id: string
          trigger_source: Database["public"]["Enums"]["admin_workflow_trigger_source"]
          updated_at: string
          workflow_file: string
          workflow_ref: string
        }
        Insert: {
          channel_id?: string | null
          channel_slug?: string | null
          channel_url_normalized?: string | null
          channel_url_raw?: string | null
          completed_at?: string | null
          correlation_key?: string | null
          correlation_state?: Database["public"]["Enums"]["admin_workflow_correlation_state"]
          created_at?: string
          dedupe_of_run_id?: string | null
          dispatch_request_id: string
          dispatched_at?: string | null
          error_code?: string | null
          error_message?: string | null
          github_conclusion?: string | null
          github_run_attempt?: number | null
          github_run_id?: number | null
          github_run_number?: number | null
          github_status?: string | null
          github_workflow_id?: number | null
          matched_at?: string | null
          requested_at?: string
          requested_by_user_id?: string | null
          run_id?: string
          trigger_source: Database["public"]["Enums"]["admin_workflow_trigger_source"]
          updated_at?: string
          workflow_file?: string
          workflow_ref?: string
        }
        Update: {
          channel_id?: string | null
          channel_slug?: string | null
          channel_url_normalized?: string | null
          channel_url_raw?: string | null
          completed_at?: string | null
          correlation_key?: string | null
          correlation_state?: Database["public"]["Enums"]["admin_workflow_correlation_state"]
          created_at?: string
          dedupe_of_run_id?: string | null
          dispatch_request_id?: string
          dispatched_at?: string | null
          error_code?: string | null
          error_message?: string | null
          github_conclusion?: string | null
          github_run_attempt?: number | null
          github_run_id?: number | null
          github_run_number?: number | null
          github_status?: string | null
          github_workflow_id?: number | null
          matched_at?: string | null
          requested_at?: string
          requested_by_user_id?: string | null
          run_id?: string
          trigger_source?: Database["public"]["Enums"]["admin_workflow_trigger_source"]
          updated_at?: string
          workflow_file?: string
          workflow_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_workflow_runs_dedupe_of_run_id_fkey"
            columns: ["dedupe_of_run_id"]
            isOneToOne: false
            referencedRelation: "admin_workflow_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      admin_workflow_signals: {
        Row: {
          created_at: string
          id: number
          payload: Json
          run_id: string | null
          signal_type: string
        }
        Insert: {
          created_at?: string
          id?: never
          payload?: Json
          run_id?: string | null
          signal_type: string
        }
        Update: {
          created_at?: string
          id?: never
          payload?: Json
          run_id?: string | null
          signal_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_workflow_signals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "admin_workflow_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      admin_workflow_steps: {
        Row: {
          attempt: number
          canonical_step_key: string
          canonical_step_no: number
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          id: string
          message: string | null
          row_delta: Json
          run_id: string
          script_step_label: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["admin_workflow_step_status"]
          updated_at: string
        }
        Insert: {
          attempt?: number
          canonical_step_key: string
          canonical_step_no: number
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          id?: string
          message?: string | null
          row_delta?: Json
          run_id: string
          script_step_label?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["admin_workflow_step_status"]
          updated_at?: string
        }
        Update: {
          attempt?: number
          canonical_step_key?: string
          canonical_step_no?: number
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          id?: string
          message?: string | null
          row_delta?: Json
          run_id?: string
          script_step_label?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["admin_workflow_step_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_workflow_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "admin_workflow_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      announcements: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          priority: number
          show_on_banner: boolean
          title: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          priority?: number
          show_on_banner?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          priority?: number
          show_on_banner?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_embeddings: {
        Row: {
          chunk_index: number
          created_at: string | null
          embedding: string | null
          id: number
          metadata: Json | null
          page_content: string
          recollect_id: number
          updated_at: string | null
          video_id: string
        }
        Insert: {
          chunk_index: number
          created_at?: string | null
          embedding?: string | null
          id?: number
          metadata?: Json | null
          page_content: string
          recollect_id?: number
          updated_at?: string | null
          video_id: string
        }
        Update: {
          chunk_index?: number
          created_at?: string | null
          embedding?: string | null
          id?: number
          metadata?: Json | null
          page_content?: string
          recollect_id?: number
          updated_at?: string | null
          video_id?: string
        }
        Relationships: []
      }
      document_embeddings_bge: {
        Row: {
          chunk_index: number
          created_at: string | null
          embedding: string | null
          id: number
          metadata: Json | null
          page_content: string
          recollect_id: number
          updated_at: string | null
          video_id: string
        }
        Insert: {
          chunk_index: number
          created_at?: string | null
          embedding?: string | null
          id?: never
          metadata?: Json | null
          page_content: string
          recollect_id?: number
          updated_at?: string | null
          video_id: string
        }
        Update: {
          chunk_index?: number
          created_at?: string | null
          embedding?: string | null
          id?: never
          metadata?: Json | null
          page_content?: string
          recollect_id?: number
          updated_at?: string | null
          video_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          content: string
          created_at: string
          embedding: string
          external_id: string
          id: string
          metadata: Json
          sparse_lexical_weights: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding: string
          external_id: string
          id?: string
          metadata?: Json
          sparse_lexical_weights?: Json
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string
          external_id?: string
          id?: string
          metadata?: Json
          sparse_lexical_weights?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      g038_deletion_commitment: {
        Row: {
          aad: string
          aad_sha256: string
          actor_assertion_digest: string
          actor_user_id: string
          algorithm: string
          assertion_id: string
          assertion_nonce: string
          assertion_root_head_sha256: string
          auth_tag: string
          ciphertext: string
          ciphertext_schema: string
          commitment_id: string
          confirmation_digest: string
          confirmation_text: string
          created_at: string
          expires_at: string
          hmac_head_sha256: string
          idempotency_key: string
          idempotency_key_digest: string
          key_reference: string
          mode: string
          nonce: string
          preflight_id: string
          preview_hash: string
          proof_id: string
          request_digest: string
          request_id: string
          response_body_sha256: string
          response_status: number
          session_id: string
          source_manifest_hash: string
          status: string
          target_user_id: string
        }
        Insert: {
          aad: string
          aad_sha256: string
          actor_assertion_digest: string
          actor_user_id: string
          algorithm: string
          assertion_id: string
          assertion_nonce: string
          assertion_root_head_sha256: string
          auth_tag: string
          ciphertext: string
          ciphertext_schema: string
          commitment_id: string
          confirmation_digest: string
          confirmation_text: string
          created_at?: string
          expires_at: string
          hmac_head_sha256: string
          idempotency_key: string
          idempotency_key_digest: string
          key_reference: string
          mode: string
          nonce: string
          preflight_id: string
          preview_hash: string
          proof_id: string
          request_digest: string
          request_id: string
          response_body_sha256: string
          response_status: number
          session_id: string
          source_manifest_hash: string
          status: string
          target_user_id: string
        }
        Update: {
          aad?: string
          aad_sha256?: string
          actor_assertion_digest?: string
          actor_user_id?: string
          algorithm?: string
          assertion_id?: string
          assertion_nonce?: string
          assertion_root_head_sha256?: string
          auth_tag?: string
          ciphertext?: string
          ciphertext_schema?: string
          commitment_id?: string
          confirmation_digest?: string
          confirmation_text?: string
          created_at?: string
          expires_at?: string
          hmac_head_sha256?: string
          idempotency_key?: string
          idempotency_key_digest?: string
          key_reference?: string
          mode?: string
          nonce?: string
          preflight_id?: string
          preview_hash?: string
          proof_id?: string
          request_digest?: string
          request_id?: string
          response_body_sha256?: string
          response_status?: number
          session_id?: string
          source_manifest_hash?: string
          status?: string
          target_user_id?: string
        }
        Relationships: []
      }
      g038_deletion_route: {
        Row: {
          commitment_id: string
          route_id: string
          route_kind: string
          secret_digest: string
        }
        Insert: {
          commitment_id: string
          route_id: string
          route_kind: string
          secret_digest: string
        }
        Update: {
          commitment_id?: string
          route_id?: string
          route_kind?: string
          secret_digest?: string
        }
        Relationships: [
          {
            foreignKeyName: "g038_deletion_route_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "g038_deletion_commitment"
            referencedColumns: ["commitment_id"]
          },
        ]
      }
      marketing_campaign_batches: {
        Row: {
          claim_token: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          eligible_count: number
          id: string
          idempotency_key: string
          operation_id: string
          status: string
        }
        Insert: {
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          eligible_count: number
          id?: string
          idempotency_key: string
          operation_id: string
          status: string
        }
        Update: {
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          eligible_count?: number
          id?: string
          idempotency_key?: string
          operation_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaign_batches_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaign_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaign_operations: {
        Row: {
          actor_ref_hash: string
          actor_user_id: string | null
          audit_id: string | null
          channel: string
          created_at: string
          data: Json
          expires_at: string
          id: string
          message: string
          preview_hash: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          actor_ref_hash: string
          actor_user_id?: string | null
          audit_id?: string | null
          channel: string
          created_at?: string
          data?: Json
          expires_at: string
          id?: string
          message: string
          preview_hash: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          actor_ref_hash?: string
          actor_user_id?: string | null
          audit_id?: string | null
          channel?: string
          created_at?: string
          data?: Json
          expires_at?: string
          id?: string
          message?: string
          preview_hash?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketing_campaign_recipients: {
        Row: {
          consent_event_id: string | null
          night_consent_event_id: string | null
          operation_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          consent_event_id?: string | null
          night_consent_event_id?: string | null
          operation_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          consent_event_id?: string | null
          night_consent_event_id?: string | null
          operation_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaign_recipients_consent_event_id_fkey"
            columns: ["consent_event_id"]
            isOneToOne: false
            referencedRelation: "privacy_consent_state"
            referencedColumns: ["consent_event_id"]
          },
          {
            foreignKeyName: "marketing_campaign_recipients_night_consent_event_id_fkey"
            columns: ["night_consent_event_id"]
            isOneToOne: false
            referencedRelation: "privacy_consent_state"
            referencedColumns: ["consent_event_id"]
          },
          {
            foreignKeyName: "marketing_campaign_recipients_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaign_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          campaign_operation_id: string | null
          channel: string
          classification: string
          consent_event_id: string | null
          created_at: string
          data: Json
          delivered_at: string | null
          id: string
          is_read: boolean
          message: string
          retention_class: string
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          campaign_operation_id?: string | null
          channel?: string
          classification?: string
          consent_event_id?: string | null
          created_at?: string
          data?: Json
          delivered_at?: string | null
          id?: string
          is_read?: boolean
          message: string
          retention_class?: string
          title: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          campaign_operation_id?: string | null
          channel?: string
          classification?: string
          consent_event_id?: string | null
          created_at?: string
          data?: Json
          delivered_at?: string | null
          id?: string
          is_read?: boolean
          message?: string
          retention_class?: string
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_campaign_operation_fk"
            columns: ["campaign_operation_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaign_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_consent_event_id_fkey"
            columns: ["consent_event_id"]
            isOneToOne: false
            referencedRelation: "privacy_consent_state"
            referencedColumns: ["consent_event_id"]
          },
        ]
      }
      ocr_logs: {
        Row: {
          created_at: string
          id: string
          image_hash: string
          metadata: Json | null
          model_used: string | null
          success: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_hash: string
          metadata?: Json | null
          model_used?: string | null
          success?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_hash?: string
          metadata?: Json | null
          model_used?: string | null
          success?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
      privacy_incident_actions: {
        Row: {
          actor_user_id: string
          audit_id: string
          correlation_id: string
          created_at: string
          expected_updated_at: string
          from_status: Database["public"]["Enums"]["privacy_incident_status"]
          id: string
          idempotency_key: string
          incident_id: string
          input_hash: string
          preview_hash: string
          readback_status: Database["public"]["Enums"]["privacy_incident_readback_status"]
          reason_code: string
          result_status: string
          to_status: Database["public"]["Enums"]["privacy_incident_status"]
        }
        Insert: {
          actor_user_id: string
          audit_id: string
          correlation_id: string
          created_at?: string
          expected_updated_at: string
          from_status: Database["public"]["Enums"]["privacy_incident_status"]
          id: string
          idempotency_key: string
          incident_id: string
          input_hash: string
          preview_hash: string
          readback_status: Database["public"]["Enums"]["privacy_incident_readback_status"]
          reason_code: string
          result_status: string
          to_status: Database["public"]["Enums"]["privacy_incident_status"]
        }
        Update: {
          actor_user_id?: string
          audit_id?: string
          correlation_id?: string
          created_at?: string
          expected_updated_at?: string
          from_status?: Database["public"]["Enums"]["privacy_incident_status"]
          id?: string
          idempotency_key?: string
          incident_id?: string
          input_hash?: string
          preview_hash?: string
          readback_status?: Database["public"]["Enums"]["privacy_incident_readback_status"]
          reason_code?: string
          result_status?: string
          to_status?: Database["public"]["Enums"]["privacy_incident_status"]
        }
        Relationships: [
          {
            foreignKeyName: "privacy_incident_actions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "privacy_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_incident_notices: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          audience: Database["public"]["Enums"]["privacy_incident_notice_audience"]
          content_sha256: string
          created_at: string
          external_receipt_ref: string | null
          id: string
          incident_id: string
          status: Database["public"]["Enums"]["privacy_incident_notice_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_version: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          audience: Database["public"]["Enums"]["privacy_incident_notice_audience"]
          content_sha256: string
          created_at?: string
          external_receipt_ref?: string | null
          id?: string
          incident_id: string
          status?: Database["public"]["Enums"]["privacy_incident_notice_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_version: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          audience?: Database["public"]["Enums"]["privacy_incident_notice_audience"]
          content_sha256?: string
          created_at?: string
          external_receipt_ref?: string | null
          id?: string
          incident_id?: string
          status?: Database["public"]["Enums"]["privacy_incident_notice_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_incident_notices_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "privacy_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_incident_transition_previews: {
        Row: {
          actor_user_id: string
          consumed_at: string | null
          correlation_id: string
          created_at: string
          expected_updated_at: string
          expires_at: string
          from_status: Database["public"]["Enums"]["privacy_incident_status"]
          incident_id: string
          input_hash: string
          operation_id: string
          preview_hash: string
          reason_code: string
          to_status: Database["public"]["Enums"]["privacy_incident_status"]
        }
        Insert: {
          actor_user_id: string
          consumed_at?: string | null
          correlation_id: string
          created_at?: string
          expected_updated_at: string
          expires_at: string
          from_status: Database["public"]["Enums"]["privacy_incident_status"]
          incident_id: string
          input_hash: string
          operation_id: string
          preview_hash: string
          reason_code: string
          to_status: Database["public"]["Enums"]["privacy_incident_status"]
        }
        Update: {
          actor_user_id?: string
          consumed_at?: string | null
          correlation_id?: string
          created_at?: string
          expected_updated_at?: string
          expires_at?: string
          from_status?: Database["public"]["Enums"]["privacy_incident_status"]
          incident_id?: string
          input_hash?: string
          operation_id?: string
          preview_hash?: string
          reason_code?: string
          to_status?: Database["public"]["Enums"]["privacy_incident_status"]
        }
        Relationships: [
          {
            foreignKeyName: "privacy_incident_transition_previews_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "privacy_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_incidents: {
        Row: {
          affected_count_estimate: number | null
          assessment_readback_at: string | null
          awareness_at: string | null
          created_at: string
          data_categories: Database["public"]["Enums"]["privacy_incident_data_category"][]
          deadline_at: string | null
          decision_code: string | null
          detected_at: string
          external_intrusion: boolean | null
          id: string
          owner_user_id: string
          sensitive_or_unique_id: boolean | null
          severity: string
          status: Database["public"]["Enums"]["privacy_incident_status"]
          updated_at: string
        }
        Insert: {
          affected_count_estimate?: number | null
          assessment_readback_at?: string | null
          awareness_at?: string | null
          created_at?: string
          data_categories?: Database["public"]["Enums"]["privacy_incident_data_category"][]
          deadline_at?: string | null
          decision_code?: string | null
          detected_at?: string
          external_intrusion?: boolean | null
          id?: string
          owner_user_id: string
          sensitive_or_unique_id?: boolean | null
          severity: string
          status?: Database["public"]["Enums"]["privacy_incident_status"]
          updated_at?: string
        }
        Update: {
          affected_count_estimate?: number | null
          assessment_readback_at?: string | null
          awareness_at?: string | null
          created_at?: string
          data_categories?: Database["public"]["Enums"]["privacy_incident_data_category"][]
          deadline_at?: string | null
          decision_code?: string | null
          detected_at?: string
          external_intrusion?: boolean | null
          id?: string
          owner_user_id?: string
          sensitive_or_unique_id?: boolean | null
          severity?: string
          status?: Database["public"]["Enums"]["privacy_incident_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          last_login: string
          nickname: string
          role: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id?: string
          last_login?: string
          nickname: string
          role?: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          last_login?: string
          nickname?: string
          role?: string
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      release_auth_identities: {
        Row: {
          created_at: string
          enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      release_auth_revocation_receipts: {
        Row: {
          binding_sha256: string
          created_at: string
          operation_id: string
          refresh_tokens_deleted: number
          revoked_at: string
          session_id: string
          sessions_deleted: number
          status: string
          user_id: string
        }
        Insert: {
          binding_sha256: string
          created_at?: string
          operation_id: string
          refresh_tokens_deleted: number
          revoked_at: string
          session_id: string
          sessions_deleted: number
          status: string
          user_id: string
        }
        Update: {
          binding_sha256?: string
          created_at?: string
          operation_id?: string
          refresh_tokens_deleted?: number
          revoked_at?: string
          session_id?: string
          sessions_deleted?: number
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      release_auth_session_leases: {
        Row: {
          created_at: string
          expires_at: string
          operation_id: string
          refresh_sha256: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          operation_id: string
          refresh_sha256: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          operation_id?: string
          refresh_sha256?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      restaurant_admin_destructive_audit_events: {
        Row: {
          action: string
          actor_user_id: string
          after_snapshot: Json
          applied_at: string
          before_snapshot: Json
          correlation_id: string
          created_at: string
          error_code: string | null
          id: string
          reason: string
          request_metadata: Json
          status: string
          target_restaurant_ids: string[]
        }
        Insert: {
          action: string
          actor_user_id: string
          after_snapshot?: Json
          applied_at?: string
          before_snapshot?: Json
          correlation_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          reason: string
          request_metadata?: Json
          status?: string
          target_restaurant_ids: string[]
        }
        Update: {
          action?: string
          actor_user_id?: string
          after_snapshot?: Json
          applied_at?: string
          before_snapshot?: Json
          correlation_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          reason?: string
          request_metadata?: Json
          status?: string
          target_restaurant_ids?: string[]
        }
        Relationships: []
      }
      restaurant_popular_rank_snapshots: {
        Row: {
          captured_at: string
          id: string
          period_end: string
          period_start: string
          rank: number
          restaurant_id: string
          scope_key: string
          weekly_search_count: number
        }
        Insert: {
          captured_at?: string
          id?: string
          period_end: string
          period_start: string
          rank: number
          restaurant_id: string
          scope_key: string
          weekly_search_count?: number
        }
        Update: {
          captured_at?: string
          id?: string
          period_end?: string
          period_start?: string
          rank?: number
          restaurant_id?: string
          scope_key?: string
          weekly_search_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_popular_rank_snapshots_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_refresh_candidates: {
        Row: {
          applied_at: string | null
          candidate_snapshot: Json
          candidate_status: string
          created_at: string
          decided_at: string | null
          decided_by_admin_id: string | null
          detected_change_types: string[]
          evidence: Json
          id: string
          operator_decision: string | null
          operator_notes: string | null
          previous_snapshot: Json
          restaurant_id: string
          run_id: string | null
        }
        Insert: {
          applied_at?: string | null
          candidate_snapshot: Json
          candidate_status?: string
          created_at?: string
          decided_at?: string | null
          decided_by_admin_id?: string | null
          detected_change_types?: string[]
          evidence?: Json
          id?: string
          operator_decision?: string | null
          operator_notes?: string | null
          previous_snapshot: Json
          restaurant_id: string
          run_id?: string | null
        }
        Update: {
          applied_at?: string | null
          candidate_snapshot?: Json
          candidate_status?: string
          created_at?: string
          decided_at?: string | null
          decided_by_admin_id?: string | null
          detected_change_types?: string[]
          evidence?: Json
          id?: string
          operator_decision?: string | null
          operator_notes?: string | null
          previous_snapshot?: Json
          restaurant_id?: string
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_refresh_candidates_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_refresh_candidates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "restaurant_refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_refresh_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          query: Json
          requested_by_admin_id: string | null
          restaurant_id: string
          run_type: string
          source_snapshot: Json
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          query?: Json
          requested_by_admin_id?: string | null
          restaurant_id: string
          run_type?: string
          source_snapshot?: Json
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          query?: Json
          requested_by_admin_id?: string | null
          restaurant_id?: string
          run_type?: string
          source_snapshot?: Json
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_refresh_runs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_request_review_audit: {
        Row: {
          action: string
          admin_note: string | null
          admin_user_id: string
          after_status: string
          before_status: string
          created_at: string
          id: string
          rejection_reason: string | null
          request_id: string
        }
        Insert: {
          action: string
          admin_note?: string | null
          admin_user_id: string
          after_status: string
          before_status: string
          created_at?: string
          id?: string
          rejection_reason?: string | null
          request_id: string
        }
        Update: {
          action?: string
          admin_note?: string | null
          admin_user_id?: string
          after_status?: string
          before_status?: string
          created_at?: string
          id?: string
          rejection_reason?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_request_review_audit_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "restaurant_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_requests: {
        Row: {
          address_elements: Json | null
          admin_note: string | null
          categories: string[] | null
          client_request_key: string | null
          created_at: string
          english_address: string | null
          geocoding_success: boolean
          id: string
          jibun_address: string | null
          lat: number | null
          lng: number | null
          origin_address: string
          phone: string | null
          recommendation_reason: string
          rejection_reason: string | null
          restaurant_name: string
          review_audit_id: string | null
          reviewed_at: string | null
          reviewed_by_admin_id: string | null
          road_address: string | null
          status: string
          updated_at: string
          user_id: string
          youtube_link: string | null
        }
        Insert: {
          address_elements?: Json | null
          admin_note?: string | null
          categories?: string[] | null
          client_request_key?: string | null
          created_at?: string
          english_address?: string | null
          geocoding_success?: boolean
          id?: string
          jibun_address?: string | null
          lat?: number | null
          lng?: number | null
          origin_address: string
          phone?: string | null
          recommendation_reason: string
          rejection_reason?: string | null
          restaurant_name: string
          review_audit_id?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          road_address?: string | null
          status?: string
          updated_at?: string
          user_id: string
          youtube_link?: string | null
        }
        Update: {
          address_elements?: Json | null
          admin_note?: string | null
          categories?: string[] | null
          client_request_key?: string | null
          created_at?: string
          english_address?: string | null
          geocoding_success?: boolean
          id?: string
          jibun_address?: string | null
          lat?: number | null
          lng?: number | null
          origin_address?: string
          phone?: string | null
          recommendation_reason?: string
          rejection_reason?: string | null
          restaurant_name?: string
          review_audit_id?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          road_address?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          youtube_link?: string | null
        }
        Relationships: []
      }
      restaurant_submission_items: {
        Row: {
          created_at: string
          id: string
          item_status: string
          rejection_reason: string | null
          submission_id: string
          target_restaurant_id: string | null
          tzuyang_review: string | null
          youtube_link: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_status?: string
          rejection_reason?: string | null
          submission_id: string
          target_restaurant_id?: string | null
          tzuyang_review?: string | null
          youtube_link: string
        }
        Update: {
          created_at?: string
          id?: string
          item_status?: string
          rejection_reason?: string | null
          submission_id?: string
          target_restaurant_id?: string | null
          tzuyang_review?: string | null
          youtube_link?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_submission_items_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "restaurant_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_submission_items_target_restaurant_id_fkey"
            columns: ["target_restaurant_id"]
            isOneToOne: false
            referencedRelation: "mv_restaurant_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_submission_items_target_restaurant_id_fkey"
            columns: ["target_restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants_backup"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_submissions: {
        Row: {
          admin_notes: string | null
          client_submission_key: string | null
          created_at: string
          id: string
          rejection_reason: string | null
          resolved_by_admin_id: string | null
          restaurant_address: string | null
          restaurant_categories: string[] | null
          restaurant_name: string
          restaurant_phone: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["submission_status"]
          submission_type: Database["public"]["Enums"]["submission_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          client_submission_key?: string | null
          created_at?: string
          id?: string
          rejection_reason?: string | null
          resolved_by_admin_id?: string | null
          restaurant_address?: string | null
          restaurant_categories?: string[] | null
          restaurant_name: string
          restaurant_phone?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          submission_type: Database["public"]["Enums"]["submission_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          client_submission_key?: string | null
          created_at?: string
          id?: string
          rejection_reason?: string | null
          resolved_by_admin_id?: string | null
          restaurant_address?: string | null
          restaurant_categories?: string[] | null
          restaurant_name?: string
          restaurant_phone?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          submission_type?: Database["public"]["Enums"]["submission_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      restaurants: {
        Row: {
          address_elements: Json | null
          approved_name: string | null
          categories: string[] | null
          channel_name: string | null
          created_at: string | null
          created_by: string | null
          db_error_details: Json | null
          db_error_message: string | null
          description_map_url: string | null
          english_address: string | null
          evaluation_results: Json | null
          geocoding_false_stage: number | null
          geocoding_success: boolean | null
          google_name: string | null
          id: string
          is_missing: boolean | null
          is_not_selected: boolean | null
          jibun_address: string | null
          lat: number | null
          lng: number | null
          naver_name: string | null
          origin_address: Json | null
          origin_name: string | null
          phone: string | null
          reasoning_basis: string | null
          recollect_version: Json | null
          review_count: number | null
          road_address: string | null
          search_count: number | null
          source_type: string | null
          status: string | null
          trace_id: string | null
          trace_id_name_source: string | null
          tzuyang_review: string | null
          updated_at: string | null
          updated_by_admin_id: string | null
          weekly_search_count: number | null
          youtube_link: string | null
          youtube_meta: Json | null
        }
        Insert: {
          address_elements?: Json | null
          approved_name?: string | null
          categories?: string[] | null
          channel_name?: string | null
          created_at?: string | null
          created_by?: string | null
          db_error_details?: Json | null
          db_error_message?: string | null
          description_map_url?: string | null
          english_address?: string | null
          evaluation_results?: Json | null
          geocoding_false_stage?: number | null
          geocoding_success?: boolean | null
          google_name?: string | null
          id?: string
          is_missing?: boolean | null
          is_not_selected?: boolean | null
          jibun_address?: string | null
          lat?: number | null
          lng?: number | null
          naver_name?: string | null
          origin_address?: Json | null
          origin_name?: string | null
          phone?: string | null
          reasoning_basis?: string | null
          recollect_version?: Json | null
          review_count?: number | null
          road_address?: string | null
          search_count?: number | null
          source_type?: string | null
          status?: string | null
          trace_id?: string | null
          trace_id_name_source?: string | null
          tzuyang_review?: string | null
          updated_at?: string | null
          updated_by_admin_id?: string | null
          weekly_search_count?: number | null
          youtube_link?: string | null
          youtube_meta?: Json | null
        }
        Update: {
          address_elements?: Json | null
          approved_name?: string | null
          categories?: string[] | null
          channel_name?: string | null
          created_at?: string | null
          created_by?: string | null
          db_error_details?: Json | null
          db_error_message?: string | null
          description_map_url?: string | null
          english_address?: string | null
          evaluation_results?: Json | null
          geocoding_false_stage?: number | null
          geocoding_success?: boolean | null
          google_name?: string | null
          id?: string
          is_missing?: boolean | null
          is_not_selected?: boolean | null
          jibun_address?: string | null
          lat?: number | null
          lng?: number | null
          naver_name?: string | null
          origin_address?: Json | null
          origin_name?: string | null
          phone?: string | null
          reasoning_basis?: string | null
          recollect_version?: Json | null
          review_count?: number | null
          road_address?: string | null
          search_count?: number | null
          source_type?: string | null
          status?: string | null
          trace_id?: string | null
          trace_id_name_source?: string | null
          tzuyang_review?: string | null
          updated_at?: string | null
          updated_by_admin_id?: string | null
          weekly_search_count?: number | null
          youtube_link?: string | null
          youtube_meta?: Json | null
        }
        Relationships: []
      }
      restaurants_backup: {
        Row: {
          address_elements: Json | null
          categories: string[] | null
          created_at: string
          created_by: string | null
          db_error_details: Json | null
          db_error_message: string | null
          english_address: string | null
          evaluation_results: Json | null
          geocoding_false_stage: number | null
          geocoding_success: boolean
          id: string
          is_missing: boolean
          is_not_selected: boolean
          jibun_address: string | null
          lat: number | null
          lng: number | null
          name: string | null
          origin_address: Json | null
          phone: string | null
          reasoning_basis: string | null
          review_count: number
          road_address: string | null
          search_count: number | null
          source_type: string | null
          status: string
          tzuyang_review: string | null
          unique_id: string | null
          updated_at: string
          updated_by_admin_id: string | null
          weekly_search_count: number | null
          youtube_link: string | null
          youtube_meta: Json | null
        }
        Insert: {
          address_elements?: Json | null
          categories?: string[] | null
          created_at?: string
          created_by?: string | null
          db_error_details?: Json | null
          db_error_message?: string | null
          english_address?: string | null
          evaluation_results?: Json | null
          geocoding_false_stage?: number | null
          geocoding_success?: boolean
          id?: string
          is_missing?: boolean
          is_not_selected?: boolean
          jibun_address?: string | null
          lat?: number | null
          lng?: number | null
          name?: string | null
          origin_address?: Json | null
          phone?: string | null
          reasoning_basis?: string | null
          review_count?: number
          road_address?: string | null
          search_count?: number | null
          source_type?: string | null
          status?: string
          tzuyang_review?: string | null
          unique_id?: string | null
          updated_at?: string
          updated_by_admin_id?: string | null
          weekly_search_count?: number | null
          youtube_link?: string | null
          youtube_meta?: Json | null
        }
        Update: {
          address_elements?: Json | null
          categories?: string[] | null
          created_at?: string
          created_by?: string | null
          db_error_details?: Json | null
          db_error_message?: string | null
          english_address?: string | null
          evaluation_results?: Json | null
          geocoding_false_stage?: number | null
          geocoding_success?: boolean
          id?: string
          is_missing?: boolean
          is_not_selected?: boolean
          jibun_address?: string | null
          lat?: number | null
          lng?: number | null
          name?: string | null
          origin_address?: Json | null
          phone?: string | null
          reasoning_basis?: string | null
          review_count?: number
          road_address?: string | null
          search_count?: number | null
          source_type?: string | null
          status?: string
          tzuyang_review?: string | null
          unique_id?: string | null
          updated_at?: string
          updated_by_admin_id?: string | null
          weekly_search_count?: number | null
          youtube_link?: string | null
          youtube_meta?: Json | null
        }
        Relationships: []
      }
      restaurants_duplicate: {
        Row: {
          address_elements: Json | null
          approved_name: string | null
          categories: string[] | null
          channel_name: string | null
          created_at: string | null
          created_by: string | null
          db_error_details: Json | null
          db_error_message: string | null
          description_map_url: string | null
          english_address: string | null
          evaluation_results: Json | null
          geocoding_false_stage: number | null
          geocoding_success: boolean | null
          id: string
          is_missing: boolean | null
          is_not_selected: boolean | null
          jibun_address: string | null
          lat: number | null
          lng: number | null
          naver_name: string | null
          origin_address: Json | null
          origin_name: string | null
          phone: string | null
          reasoning_basis: string | null
          recollect_version: Json | null
          review_count: number | null
          road_address: string | null
          search_count: number | null
          source_type: string | null
          status: string | null
          trace_id: string | null
          trace_id_name_source: string | null
          tzuyang_review: string | null
          updated_at: string | null
          updated_by_admin_id: string | null
          weekly_search_count: number | null
          youtube_link: string | null
          youtube_meta: Json | null
        }
        Insert: {
          address_elements?: Json | null
          approved_name?: string | null
          categories?: string[] | null
          channel_name?: string | null
          created_at?: string | null
          created_by?: string | null
          db_error_details?: Json | null
          db_error_message?: string | null
          description_map_url?: string | null
          english_address?: string | null
          evaluation_results?: Json | null
          geocoding_false_stage?: number | null
          geocoding_success?: boolean | null
          id?: string
          is_missing?: boolean | null
          is_not_selected?: boolean | null
          jibun_address?: string | null
          lat?: number | null
          lng?: number | null
          naver_name?: string | null
          origin_address?: Json | null
          origin_name?: string | null
          phone?: string | null
          reasoning_basis?: string | null
          recollect_version?: Json | null
          review_count?: number | null
          road_address?: string | null
          search_count?: number | null
          source_type?: string | null
          status?: string | null
          trace_id?: string | null
          trace_id_name_source?: string | null
          tzuyang_review?: string | null
          updated_at?: string | null
          updated_by_admin_id?: string | null
          weekly_search_count?: number | null
          youtube_link?: string | null
          youtube_meta?: Json | null
        }
        Update: {
          address_elements?: Json | null
          approved_name?: string | null
          categories?: string[] | null
          channel_name?: string | null
          created_at?: string | null
          created_by?: string | null
          db_error_details?: Json | null
          db_error_message?: string | null
          description_map_url?: string | null
          english_address?: string | null
          evaluation_results?: Json | null
          geocoding_false_stage?: number | null
          geocoding_success?: boolean | null
          id?: string
          is_missing?: boolean | null
          is_not_selected?: boolean | null
          jibun_address?: string | null
          lat?: number | null
          lng?: number | null
          naver_name?: string | null
          origin_address?: Json | null
          origin_name?: string | null
          phone?: string | null
          reasoning_basis?: string | null
          recollect_version?: Json | null
          review_count?: number | null
          road_address?: string | null
          search_count?: number | null
          source_type?: string | null
          status?: string | null
          trace_id?: string | null
          trace_id_name_source?: string | null
          tzuyang_review?: string | null
          updated_at?: string | null
          updated_by_admin_id?: string | null
          weekly_search_count?: number | null
          youtube_link?: string | null
          youtube_meta?: Json | null
        }
        Relationships: []
      }
      review_likes: {
        Row: {
          created_at: string | null
          id: string
          review_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          review_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_likes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "mv_popular_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_likes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          admin_note: string | null
          categories: string[] | null
          content: string
          created_at: string
          edited_at: string | null
          edited_by_admin_id: string | null
          food_photos: string[] | null
          id: string
          is_duplicate: boolean | null
          is_edited_by_admin: boolean
          is_pinned: boolean
          is_verified: boolean
          like_count: number
          ocr_processed_at: string | null
          receipt_data: Json | null
          receipt_hash: string | null
          restaurant_id: string
          title: string
          updated_at: string
          user_id: string
          verification_photo: string
          visited_at: string
        }
        Insert: {
          admin_note?: string | null
          categories?: string[] | null
          content: string
          created_at?: string
          edited_at?: string | null
          edited_by_admin_id?: string | null
          food_photos?: string[] | null
          id?: string
          is_duplicate?: boolean | null
          is_edited_by_admin?: boolean
          is_pinned?: boolean
          is_verified?: boolean
          like_count?: number
          ocr_processed_at?: string | null
          receipt_data?: Json | null
          receipt_hash?: string | null
          restaurant_id: string
          title: string
          updated_at?: string
          user_id: string
          verification_photo: string
          visited_at: string
        }
        Update: {
          admin_note?: string | null
          categories?: string[] | null
          content?: string
          created_at?: string
          edited_at?: string | null
          edited_by_admin_id?: string | null
          food_photos?: string[] | null
          id?: string
          is_duplicate?: boolean | null
          is_edited_by_admin?: boolean
          is_pinned?: boolean
          is_verified?: boolean
          like_count?: number
          ocr_processed_at?: string | null
          receipt_data?: Json | null
          receipt_hash?: string | null
          restaurant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
          verification_photo?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "mv_restaurant_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants_backup"
            referencedColumns: ["id"]
          },
        ]
      }
      search_logs: {
        Row: {
          counted: boolean | null
          id: string
          ip_address: unknown
          restaurant_id: string
          searched_at: string | null
          session_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          counted?: boolean | null
          id?: string
          ip_address?: unknown
          restaurant_id: string
          searched_at?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          counted?: boolean | null
          id?: string
          ip_address?: unknown
          restaurant_id?: string
          searched_at?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_logs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "mv_restaurant_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_logs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants_backup"
            referencedColumns: ["id"]
          },
        ]
      }
      short_urls: {
        Row: {
          code: string
          created_at: string | null
          id: string
          restaurant_id: string | null
          restaurant_name: string | null
          target_url: string
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          restaurant_id?: string | null
          restaurant_name?: string | null
          target_url: string
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          restaurant_id?: string | null
          restaurant_name?: string | null
          target_url?: string
        }
        Relationships: []
      }
      transcript_embeddings_bge: {
        Row: {
          chunk_index: number
          created_at: string | null
          embedding: string | null
          id: number
          metadata: Json | null
          page_content: string
          recollect_id: number
          sparse_embedding: Json | null
          updated_at: string | null
          video_id: string
        }
        Insert: {
          chunk_index: number
          created_at?: string | null
          embedding?: string | null
          id?: never
          metadata?: Json | null
          page_content: string
          recollect_id?: number
          sparse_embedding?: Json | null
          updated_at?: string | null
          video_id: string
        }
        Update: {
          chunk_index?: number
          created_at?: string | null
          embedding?: string | null
          id?: never
          metadata?: Json | null
          page_content?: string
          recollect_id?: number
          sparse_embedding?: Json | null
          updated_at?: string | null
          video_id?: string
        }
        Relationships: []
      }
      user_account_status: {
        Row: {
          account_status: string
          disabled_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_status?: string
          disabled_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_status?: string
          disabled_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_bookmarks: {
        Row: {
          created_at: string
          id: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_bookmarks_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "mv_restaurant_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_bookmarks_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants_backup"
            referencedColumns: ["id"]
          },
        ]
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
          last_updated: string
          review_count: number
          trust_score: number
          user_id: string
          verified_review_count: number
        }
        Insert: {
          id?: string
          last_updated?: string
          review_count?: number
          trust_score?: number
          user_id: string
          verified_review_count?: number
        }
        Update: {
          id?: string
          last_updated?: string
          review_count?: number
          trust_score?: number
          user_id?: string
          verified_review_count?: number
        }
        Relationships: []
      }
      video_frame_captions: {
        Row: {
          caption_auth_mode: string | null
          caption_generated_at: string | null
          caption_model: string | null
          caption_provenance: Json
          caption_provider: string | null
          caption_schema_version: number
          chronological_analysis: string | null
          created_at: string
          duration: number | null
          end_sec: number
          highlight_keywords: string[] | null
          id: number
          rank: number | null
          raw_caption: string | null
          recollect_id: number
          start_sec: number
          video_id: string
        }
        Insert: {
          caption_auth_mode?: string | null
          caption_generated_at?: string | null
          caption_model?: string | null
          caption_provenance?: Json
          caption_provider?: string | null
          caption_schema_version?: number
          chronological_analysis?: string | null
          created_at?: string
          duration?: number | null
          end_sec: number
          highlight_keywords?: string[] | null
          id?: number
          rank?: number | null
          raw_caption?: string | null
          recollect_id: number
          start_sec: number
          video_id: string
        }
        Update: {
          caption_auth_mode?: string | null
          caption_generated_at?: string | null
          caption_model?: string | null
          caption_provenance?: Json
          caption_provider?: string | null
          caption_schema_version?: number
          chronological_analysis?: string | null
          created_at?: string
          duration?: number | null
          end_sec?: number
          highlight_keywords?: string[] | null
          id?: number
          rank?: number | null
          raw_caption?: string | null
          recollect_id?: number
          start_sec?: number
          video_id?: string
        }
        Relationships: []
      }
      videos: {
        Row: {
          advertisers: string[] | null
          category: string | null
          channel_name: string
          comment_count: number | null
          created_at: string | null
          description: string | null
          duration: number | null
          id: string
          is_ads: boolean | null
          is_shorts: boolean | null
          latest_recollect_id: number | null
          like_count: number | null
          meta_history: Json | null
          published_at: string | null
          recollect_vars: string[] | null
          tags: string[] | null
          thumbnail_hash: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          view_count: number | null
          youtube_link: string
        }
        Insert: {
          advertisers?: string[] | null
          category?: string | null
          channel_name: string
          comment_count?: number | null
          created_at?: string | null
          description?: string | null
          duration?: number | null
          id: string
          is_ads?: boolean | null
          is_shorts?: boolean | null
          latest_recollect_id?: number | null
          like_count?: number | null
          meta_history?: Json | null
          published_at?: string | null
          recollect_vars?: string[] | null
          tags?: string[] | null
          thumbnail_hash?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          view_count?: number | null
          youtube_link: string
        }
        Update: {
          advertisers?: string[] | null
          category?: string | null
          channel_name?: string
          comment_count?: number | null
          created_at?: string | null
          description?: string | null
          duration?: number | null
          id?: string
          is_ads?: boolean | null
          is_shorts?: boolean | null
          latest_recollect_id?: number | null
          like_count?: number | null
          meta_history?: Json | null
          published_at?: string | null
          recollect_vars?: string[] | null
          tags?: string[] | null
          thumbnail_hash?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          view_count?: number | null
          youtube_link?: string
        }
        Relationships: []
      }
      youtube_channel_kpi_snapshots: {
        Row: {
          bucket_started_at: string
          channel_handle: string | null
          channel_id: string
          channel_title: string | null
          fetched_at: string
          hidden_subscriber_count: boolean
          id: string
          previous_bucket_started_at: string | null
          source: string
          subscriber_count: number | null
          subscriber_delta: number | null
          video_count: number | null
          video_delta: number | null
          view_count: number | null
          view_delta: number | null
        }
        Insert: {
          bucket_started_at: string
          channel_handle?: string | null
          channel_id: string
          channel_title?: string | null
          fetched_at?: string
          hidden_subscriber_count?: boolean
          id?: string
          previous_bucket_started_at?: string | null
          source?: string
          subscriber_count?: number | null
          subscriber_delta?: number | null
          video_count?: number | null
          video_delta?: number | null
          view_count?: number | null
          view_delta?: number | null
        }
        Update: {
          bucket_started_at?: string
          channel_handle?: string | null
          channel_id?: string
          channel_title?: string | null
          fetched_at?: string
          hidden_subscriber_count?: boolean
          id?: string
          previous_bucket_started_at?: string | null
          source?: string
          subscriber_count?: number | null
          subscriber_delta?: number | null
          video_count?: number | null
          video_delta?: number | null
          view_count?: number | null
          view_delta?: number | null
        }
        Relationships: []
      }
      youtube_thumbnail_releases: {
        Row: {
          browser_image_path: string
          candidate_id: string
          canvas: Json
          created_at: string
          height: number
          id: string
          issue_tags: Json
          mime_type: string
          model: string
          model_provenance: string
          provider_id: string
          published_at: string
          published_by: string | null
          release_key: string
          score: number
          sha256: string
          source_image_id: string
          source_manifest_id: string
          source_quality_gate: Json
          status: string
          storage_bucket: string
          storage_object_path: string
          superseded_at: string | null
          text_layers: Json
          updated_at: string
          width: number
        }
        Insert: {
          browser_image_path: string
          candidate_id: string
          canvas?: Json
          created_at?: string
          height?: number
          id?: string
          issue_tags?: Json
          mime_type?: string
          model?: string
          model_provenance?: string
          provider_id?: string
          published_at?: string
          published_by?: string | null
          release_key?: string
          score: number
          sha256: string
          source_image_id: string
          source_manifest_id: string
          source_quality_gate?: Json
          status?: string
          storage_bucket?: string
          storage_object_path: string
          superseded_at?: string | null
          text_layers?: Json
          updated_at?: string
          width?: number
        }
        Update: {
          browser_image_path?: string
          candidate_id?: string
          canvas?: Json
          created_at?: string
          height?: number
          id?: string
          issue_tags?: Json
          mime_type?: string
          model?: string
          model_provenance?: string
          provider_id?: string
          published_at?: string
          published_by?: string | null
          release_key?: string
          score?: number
          sha256?: string
          source_image_id?: string
          source_manifest_id?: string
          source_quality_gate?: Json
          status?: string
          storage_bucket?: string
          storage_object_path?: string
          superseded_at?: string | null
          text_layers?: Json
          updated_at?: string
          width?: number
        }
        Relationships: []
      }
      youtube_video_kpi_snapshots: {
        Row: {
          bucket_started_at: string
          category_id: string | null
          channel_id: string
          comment_count: number
          duration_seconds: number
          fetched_at: string
          id: string
          like_count: number
          published_at: string | null
          source: string
          title: string
          video_id: string
          view_count: number
        }
        Insert: {
          bucket_started_at: string
          category_id?: string | null
          channel_id: string
          comment_count?: number
          duration_seconds?: number
          fetched_at?: string
          id?: string
          like_count?: number
          published_at?: string | null
          source?: string
          title?: string
          video_id: string
          view_count?: number
        }
        Update: {
          bucket_started_at?: string
          category_id?: string | null
          channel_id?: string
          comment_count?: number
          duration_seconds?: number
          fetched_at?: string
          id?: string
          like_count?: number
          published_at?: string | null
          source?: string
          title?: string
          video_id?: string
          view_count?: number
        }
        Relationships: []
      }
    }
    Views: {
      mv_popular_reviews: {
        Row: {
          content: string | null
          created_at: string | null
          food_photos: string[] | null
          id: string | null
          is_pinned: boolean | null
          is_verified: boolean | null
          like_count: number | null
          restaurant_address: string | null
          restaurant_id: string | null
          restaurant_name: string | null
          title: string | null
          user_id: string | null
          user_nickname: string | null
          user_profile_picture: string | null
          verification_photo: string | null
          visited_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "mv_restaurant_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants_backup"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_restaurant_stats: {
        Row: {
          actual_review_count: number | null
          all_review_categories: string[] | null
          categories: string[] | null
          id: string | null
          last_review_at: string | null
          lat: number | null
          lng: number | null
          name: string | null
          review_count: number | null
          road_address: string | null
          status: string | null
          unique_reviewers: number | null
          verified_review_count: number | null
        }
        Relationships: []
      }
      mv_user_leaderboard: {
        Row: {
          nickname: string | null
          profile_picture: string | null
          rank: number | null
          review_count: number | null
          total_likes_received: number | null
          trust_score: number | null
          user_id: string | null
          verified_review_count: number | null
        }
        Relationships: []
      }
      privacy_consent_state: {
        Row: {
          channel: string | null
          consent_event_id: string | null
          decision: string | null
          guardian_verification_id: string | null
          occurred_at: string | null
          policy_version_id: string | null
          purpose: string | null
          subject_kind: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      account_deletion_is_active_admin: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      account_deletion_reason_code_is_safe: {
        Args: { p_value: string }
        Returns: boolean
      }
      account_deletion_require_service_role: { Args: never; Returns: undefined }
      account_deletion_subject_hash: {
        Args: { p_user_id: string }
        Returns: string
      }
      account_deletion_write_audit: {
        Args: {
          p_reason_code: string
          p_request: Database["public"]["Tables"]["account_deletion_requests"]["Row"]
          p_status: string
        }
        Returns: string
      }
      activate_account_deletion_policy: {
        Args: { p_idempotency_key: string; p_version: string }
        Returns: string
      }
      activate_privacy_retention_adapter: {
        Args: {
          p_adapter_code: string
          p_adapter_version: string
          p_basis_code: string
          p_class_code: string
          p_class_version: string
          p_data_class: string
          p_legal_approval_ref: string
          p_operator_approval_ref: string
          p_retention_period: string
          p_trigger_type: string
        }
        Returns: Json
      }
      admin_user_audit_counts_are_safe: {
        Args: { p_value: Json }
        Returns: boolean
      }
      admin_user_audit_event_is_safe: {
        Args: {
          p_action: string
          p_after_state: Json
          p_before_state: Json
          p_counts: Json
          p_error_code: string
          p_flags: Json
          p_ip_hash: string
          p_reason: string
          p_request_id: string
          p_status: string
          p_user_agent_hash: string
        }
        Returns: boolean
      }
      admin_user_audit_flags_are_safe: {
        Args: { p_value: Json }
        Returns: boolean
      }
      admin_user_audit_reason_code: {
        Args: { p_action: string; p_status: string }
        Returns: string
      }
      allocate_short_url: {
        Args: {
          p_candidate_codes: string[]
          p_client_bucket: string
          p_restaurant_id: string
          p_review_id: string
          p_target_url: string
        }
        Returns: {
          allocation_failed: boolean
          code: string
          is_existing: boolean
          rate_limited: boolean
          retry_after_seconds: number
        }[]
      }
      append_admin_user_audit_event: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_applied_at: string
          p_audit_counts: Json
          p_audit_flags: Json
          p_correlation_id: string
          p_error_code: string
          p_ip_hash: string
          p_reason: string
          p_request_id: string
          p_status: string
          p_target_user_id: string
          p_user_agent_hash: string
        }
        Returns: string
      }
      append_privacy_audit_event: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_count_summary: Json
          p_event_type: string
          p_operation_id: string
          p_reason_code: string
          p_request_metadata: Json
          p_status: string
          p_subject_user_id: string
        }
        Returns: string
      }
      apply_account_deletion_database_cleanup: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          db_readback_passed: boolean
          reason_code: string
          request_id: string
          session_readback_passed: boolean
          source_manifest_hash: string
          status: string
        }[]
      }
      apply_admin_restaurant_map_overlay_action: {
        Args: {
          p_action: string
          p_active_from: string
          p_active_until: string
          p_actor_user_id: string
          p_correlation_id: string
          p_description: string
          p_evidence: Json
          p_idempotency_key: string
          p_label: string
          p_overlay_type: string
          p_payload_hash: string
          p_preview_hash: string
          p_reason: string
          p_request_metadata?: Json
          p_restaurant_id: string
        }
        Returns: Json
      }
      apply_admin_user_db_mutation: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_after_state: Json
          p_before_state: Json
          p_correlation_id: string
          p_ip_hash?: string
          p_next_account_status?: string
          p_next_role?: string
          p_profile?: Json
          p_reason: string
          p_request_id?: string
          p_target_user_id: string
          p_user_agent_hash?: string
        }
        Returns: string
      }
      apply_privacy_incident_transition: {
        Args: {
          p_actor_user_id: string
          p_confirmation_text: string
          p_correlation_id: string
          p_expected_updated_at: string
          p_idempotency_key: string
          p_incident_id: string
          p_operation_id: string
          p_preview_hash: string
          p_reason_code: string
          p_to_status: Database["public"]["Enums"]["privacy_incident_status"]
          p_transition_input: Json
        }
        Returns: Json
      }
      apply_privacy_retention_run: {
        Args: {
          p_idempotency_key: string
          p_max_duration_ms?: number
          p_preview_hash: string
          p_run_id: string
        }
        Returns: Json
      }
      apply_restaurant_admin_destructive_action: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_correlation_id: string
          p_reason: string
          p_request_metadata?: Json
          p_target_restaurant_ids: string[]
        }
        Returns: Json
      }
      approve_admin_restaurant_map_overlay_proposal: {
        Args: {
          p_actor_user_id: string
          p_confirmation_text: string
          p_correlation_id: string
          p_expected_proposal_hash: string
          p_idempotency_key: string
          p_overlay_payload: Json
          p_payload_hash: string
          p_preview_hash: string
          p_proposal_id: string
          p_reason: string
          p_request_metadata?: Json
          p_required_confirmation_text: string
        }
        Returns: Json
      }
      approve_edit_restaurant_submission: {
        Args: {
          p_admin_user_id: string
          p_approved_unique_ids: string[]
          p_submission_id: string
        }
        Returns: {
          message: string
          success: boolean
          updated_count: number
        }[]
      }
      approve_edit_submission_item: {
        Args: {
          p_admin_user_id: string
          p_item_id: string
          p_updated_data: Json
        }
        Returns: {
          message: string
          restaurant_id: string
          success: boolean
        }[]
      }
      approve_new_restaurant_submission: {
        Args: {
          p_admin_user_id: string
          p_geocoded_data: Json
          p_submission_id: string
        }
        Returns: {
          created_restaurant_ids: string[]
          message: string
          success: boolean
        }[]
      }
      approve_restaurant: {
        Args: { admin_user_id: string; restaurant_id: string }
        Returns: boolean
      }
      approve_restaurant_submission: {
        Args: { admin_user_id: string; submission_id: string }
        Returns: boolean
      }
      approve_submission_item: {
        Args: {
          p_admin_user_id: string
          p_item_id: string
          p_restaurant_data: Json
        }
        Returns: {
          created_restaurant_id: string
          message: string
          success: boolean
        }[]
      }
      assert_marketing_service_role: { Args: never; Returns: undefined }
      assert_notification_content_safe: {
        Args: { p_data: Json; p_message: string; p_title: string }
        Returns: undefined
      }
      batch_insert_restaurants_from_jsonl: {
        Args: { jsonl_array: Json[] }
        Returns: {
          failed_count: number
          failed_records: Json[]
          inserted_count: number
          updated_count: number
        }[]
      }
      begin_account_deletion_apply: {
        Args: {
          p_actor_user_id: string
          p_confirmation_text: string
          p_idempotency_key: string
          p_preview_hash: string
          p_reauthenticated_at: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          anonymize_count: number
          auth_readback_passed: boolean
          auth_receipt_ref: string
          db_readback_passed: boolean
          delete_count: number
          reason_code: string
          request_id: string
          retain_count: number
          separate_count: number
          session_readback_passed: boolean
          source_manifest_hash: string
          status: string
          storage_readback_passed: boolean
          storage_receipt_refs: Json
        }[]
      }
      begin_account_deletion_apply_with_reauth: {
        Args: {
          p_actor_user_id: string
          p_confirmation_text: string
          p_idempotency_key: string
          p_preview_hash: string
          p_proof_id: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          anonymize_count: number
          auth_readback_passed: boolean
          auth_receipt_ref: string
          db_readback_passed: boolean
          delete_count: number
          reason_code: string
          request_id: string
          retain_count: number
          separate_count: number
          session_readback_passed: boolean
          source_manifest_hash: string
          status: string
          storage_readback_passed: boolean
          storage_receipt_refs: Json
        }[]
      }
      calculate_submission_status: {
        Args: { p_submission_id: string }
        Returns: Database["public"]["Enums"]["submission_status"]
      }
      calculate_word_match_score: {
        Args: { restaurant_name: string; search_query: string }
        Returns: number
      }
      canonicalize_youtube_link: { Args: { raw_url: string }; Returns: string }
      check_restaurant_duplicate: {
        Args: { p_jibun_address: string; p_name: string; p_unique_id?: string }
        Returns: {
          duplicate_type: string
          existing_address: string
          existing_name: string
          existing_restaurant_id: string
          is_duplicate: boolean
          similarity_score: number
        }[]
      }
      claim_account_deletion_external_job: {
        Args: {
          p_actor_user_id: string
          p_attempt_token: string
          p_idempotency_key: string
          p_phase: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          attempt_token: string
          checkpoint_state: string
          claim_status: string
          job_state: string
          lease_expires_at: string
          phase: string
          request_id: string
          source_manifest_hash: string
        }[]
      }
      claim_account_deletion_external_phase: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_phase: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          lease_expires_at: string
          lease_token: string
          phase: string
          request_id: string
          source_manifest_hash: string
        }[]
      }
      claim_admin_trend_job_request: {
        Args: { p_claimed_by: string; p_stale_after?: string }
        Returns: Json
      }
      claim_marketing_campaign_dispatch: {
        Args: {
          p_actor_user_id: string
          p_batch_id: string
          p_idempotency_key: string
          p_operation_id: string
          p_preview_hash: string
          p_timezone?: string
        }
        Returns: Json
      }
      claim_next_account_deletion_external_job: {
        Args: never
        Returns: {
          actor_user_id: string
          attempt_token: string
          idempotency_key: string
          phase: string
          preview_hash: string
          request_id: string
          source_manifest_hash: string
          target_user_id: string
        }[]
      }
      claim_privacy_retention_storage_items: {
        Args: {
          p_idempotency_key: string
          p_limit: number
          p_preview_hash: string
          p_run_id: string
        }
        Returns: Json
      }
      cleanup_old_notifications: {
        Args: { days_to_keep?: number }
        Returns: number
      }
      cleanup_old_search_logs: { Args: never; Returns: undefined }
      complete_admin_trend_job_request: {
        Args: {
          p_claimed_by: string
          p_request_id: string
          p_result_summary?: Json
          p_run_id: string
        }
        Returns: Json
      }
      confirm_privacy_onboarding: {
        Args: {
          p_challenge_id: string
          p_challenge_token: string
          p_guardian_verification_id: string
          p_oauth_nonce_hash: string
          p_source: string
          p_user_id: string
        }
        Returns: Json
      }
      confirm_privacy_retention_run: {
        Args: {
          p_confirmation_text: string
          p_idempotency_key: string
          p_preview_hash: string
          p_run_id: string
        }
        Returns: Json
      }
      consume_account_deletion_reauth_proof: {
        Args: {
          p_idempotency_key: string
          p_proof_id: string
          p_request_id: string
          p_target_user_id: string
        }
        Returns: {
          consumed_at: string
          proof_id: string
        }[]
      }
      consume_tzuyang_address_evidence_admin_approval: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_approval_envelope_sha256: string
          p_expires_at: string
          p_issued_at: string
          p_nonce_sha256: string
          p_operation_id: string
          p_review_manifest_sha256: string
          p_signer_id: string
        }
        Returns: {
          consumed: boolean
          reason: string
        }[]
      }
      create_admin_announcement_notification: {
        Args: { p_data?: Json; p_message: string; p_title: string }
        Returns: undefined
      }
      create_admin_transactional_notification: {
        Args: {
          p_actor_user_id: string
          p_data: Json
          p_message: string
          p_recipient_user_id: string
          p_title: string
          p_type: string
        }
        Returns: Json
      }
      create_new_restaurant_notification: {
        Args: { p_data?: Json; p_message: string; p_title: string }
        Returns: undefined
      }
      create_privacy_onboarding_challenge: {
        Args: {
          p_age_band: string
          p_expires_at?: string
          p_oauth_nonce_hash?: string
          p_policy_version_id: string
          p_requested_consents: Json
          p_token_hash: string
        }
        Returns: Json
      }
      create_ranking_notification: {
        Args: { p_period?: string; p_ranking: number; p_user_id: string }
        Returns: string
      }
      create_review_like_notification: {
        Args: {
          p_actor_user_id: string
          p_like_id: string
          p_review_id: string
        }
        Returns: Json
      }
      create_user_notification: {
        Args: {
          p_data?: Json
          p_message: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      decrement_review_count: {
        Args: { restaurant_id: string }
        Returns: undefined
      }
      delete_notification: {
        Args: { notification_uuid: string }
        Returns: undefined
      }
      delete_pending_restaurant_submission: {
        Args: {
          p_submission_id: string
          p_submission_type: string
          p_user_id: string
        }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      delete_user_account: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      evaluate_marketing_permission_state: {
        Args: {
          p_channel: string
          p_night_granted: boolean
          p_ordinary_granted: boolean
          p_scheduled_at: string
          p_timezone?: string
        }
        Returns: {
          allowed: boolean
          reason_code: string
        }[]
      }
      evaluate_notification_marketing_permission: {
        Args: {
          p_channel: string
          p_scheduled_at: string
          p_timezone?: string
          p_user_id: string
        }
        Returns: {
          allowed: boolean
          consent_event_id: string
          night_consent_event_id: string
          reason_code: string
        }[]
      }
      extract_youtube_video_id: { Args: { raw_url: string }; Returns: string }
      fail_account_deletion: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_preview_hash: string
          p_reason_code: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: undefined
      }
      fail_account_deletion_external_phase: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_lease_token: string
          p_phase: string
          p_preview_hash: string
          p_reason_code: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: undefined
      }
      fail_admin_trend_job_request: {
        Args: {
          p_claimed_by: string
          p_error_code: string
          p_request_id: string
          p_result_summary?: Json
        }
        Returns: Json
      }
      fail_marketing_campaign_batch: {
        Args: {
          p_actor_user_id: string
          p_batch_id: string
          p_error_code: string
          p_operation_id: string
          p_preview_hash: string
        }
        Returns: Json
      }
      fail_marketing_campaign_provider_attempt: {
        Args: {
          p_actor_user_id: string
          p_batch_id: string
          p_claim_token: string
          p_error_code: string
          p_operation_id: string
          p_preview_hash: string
          p_provider_attempt_id: string
          p_provider_payload_digest: string
          p_provider_receipt_hash: string
          p_provider_receipt_id: string
        }
        Returns: Json
      }
      fail_privacy_retention_storage_claims: {
        Args: {
          p_claim_tokens: string[]
          p_failure_code: string
          p_idempotency_key: string
          p_preview_hash: string
          p_run_id: string
        }
        Returns: number
      }
      finalize_account_deletion_auth: {
        Args: {
          p_actor_user_id: string
          p_auth_receipt_ref: string
          p_idempotency_key: string
          p_lease_token: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          anonymize_count: number
          auth_readback_passed: boolean
          auth_receipt_ref: string
          db_readback_passed: boolean
          delete_count: number
          reason_code: string
          request_id: string
          retain_count: number
          separate_count: number
          session_readback_passed: boolean
          source_manifest_hash: string
          status: string
          storage_readback_passed: boolean
          storage_receipt_refs: Json
        }[]
      }
      finalize_account_deletion_storage: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_lease_token: string
          p_preview_hash: string
          p_receipts_json: Json
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          db_readback_passed: boolean
          reason_code: string
          request_id: string
          session_readback_passed: boolean
          source_manifest_hash: string
          status: string
          storage_readback_passed: boolean
        }[]
      }
      finalize_marketing_campaign_batch: {
        Args: {
          p_accepted_user_ids: string[]
          p_actor_user_id: string
          p_batch_id: string
          p_claim_token: string
          p_operation_id: string
          p_preview_hash: string
          p_provider_attempt_id: string
          p_provider_payload_digest: string
          p_provider_receipt_hash: string
          p_provider_receipt_id: string
          p_timezone?: string
        }
        Returns: Json
      }
      finalize_privacy_retention_run: {
        Args: {
          p_idempotency_key: string
          p_preview_hash: string
          p_run_id: string
        }
        Returns: Json
      }
      g038_reserve_account_deletion_commitment: {
        Args: {
          p_aad: string
          p_aad_sha256: string
          p_actor_assertion_digest: string
          p_actor_user_id: string
          p_algorithm: string
          p_assertion_id: string
          p_assertion_nonce: string
          p_assertion_root_head_sha256: string
          p_auth_tag: string
          p_ciphertext: string
          p_ciphertext_schema: string
          p_cleanup_route_id: string
          p_cleanup_secret_digest: string
          p_commitment_expires_at: string
          p_commitment_id: string
          p_confirmation_digest: string
          p_confirmation_text: string
          p_hmac_head_sha256: string
          p_idempotency_key: string
          p_idempotency_key_digest: string
          p_key_reference: string
          p_nonce: string
          p_phase: string
          p_poll_route_id: string
          p_poll_secret_digest: string
          p_preflight_id: string
          p_preview_hash: string
          p_proof_id: string
          p_receipt_route_id: string
          p_receipt_secret_digest: string
          p_recovery_route_id: string
          p_recovery_secret_digest: string
          p_request_digest: string
          p_request_id: string
          p_response_body_sha256: string
          p_response_status: number
          p_session_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          commitment_id: string
          expires_at: string
          mode: string
          response_body_sha256: string
          response_status: number
          result: string
        }[]
      }
      generate_unique_id: {
        Args: {
          p_name: string
          p_tzuyang_review: string
          p_youtube_link: string
        }
        Returns: string
      }
      get_account_deletion_storage_work: {
        Args: {
          p_actor_user_id: string
          p_attempt_token: string
          p_idempotency_key: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          bucket_id: string
          object_id: string
          object_locator_hash: string
          object_name: string
          object_version: string
          object_version_hash: string
          provider_idempotency_key: string
          source_manifest_hash: string
          work_mode: string
          work_state: string
        }[]
      }
      get_all_approved_restaurant_names: {
        Args: never
        Returns: {
          categories: string[]
          name: string
        }[]
      }
      get_approved_restaurants: {
        Args: { limit_count?: number; offset_count?: number }
        Returns: {
          categories: string[]
          created_at: string
          english_address: string
          id: string
          jibun_address: string
          lat: number
          lng: number
          name: string
          phone: string
          review_count: number
          road_address: string
          tzuyang_reviews: Json
          youtube_links: string[]
        }[]
      }
      get_categories_by_restaurant_name_or_youtube_url: {
        Args: { p_restaurant_name?: string; p_video_id?: string }
        Returns: string[]
      }
      get_current_auth_session_id: { Args: never; Returns: string }
      get_current_privacy_eligibility: { Args: never; Returns: Json }
      get_current_privacy_policy_version: { Args: never; Returns: Json }
      get_index_usage: {
        Args: never
        Returns: {
          index_name: string
          index_scans: number
          index_size: string
          schema_name: string
          table_name: string
          tuples_fetched: number
          tuples_read: number
        }[]
      }
      get_ncp_monthly_usage: {
        Args: { p_service_type?: string; p_year_month?: string }
        Returns: {
          request_date: string
          service_type: string
          total_count: number
        }[]
      }
      get_ocr_daily_quota_status: {
        Args: never
        Returns: {
          allowed: boolean
          quota_limit: number
          remaining_count: number
          reset_at: string
          unlimited: boolean
          used_count: number
        }[]
      }
      get_popular_reviews: {
        Args: never
        Returns: {
          content: string | null
          created_at: string | null
          food_photos: string[] | null
          id: string | null
          is_pinned: boolean | null
          is_verified: boolean | null
          like_count: number | null
          restaurant_address: string | null
          restaurant_id: string | null
          restaurant_name: string | null
          title: string | null
          user_id: string | null
          user_nickname: string | null
          user_profile_picture: string | null
          verification_photo: string | null
          visited_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "mv_popular_reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_privacy_eligibility_for_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_privacy_retention_provider_reconciliation_work: {
        Args: {
          p_idempotency_key: string
          p_limit: number
          p_preview_hash: string
          p_provider_verifier_ref: string
          p_run_id: string
        }
        Returns: Json
      }
      get_restaurant_stats: {
        Args: never
        Returns: {
          actual_review_count: number | null
          all_review_categories: string[] | null
          categories: string[] | null
          id: string | null
          last_review_at: string | null
          lat: number | null
          lng: number | null
          name: string | null
          review_count: number | null
          road_address: string | null
          status: string | null
          unique_reviewers: number | null
          verified_review_count: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "mv_restaurant_stats"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_restaurant_stats_by_status: {
        Args: never
        Returns: {
          approval_rate: number
          approved_count: number
          geocoding_failed_count: number
          geocoding_success_count: number
          geocoding_success_rate: number
          missing_count: number
          not_selected_count: number
          pending_count: number
          rejected_count: number
          total_records: number
        }[]
      }
      get_review_like_count: {
        Args: { review_id_param: string }
        Returns: number
      }
      get_table_sizes: {
        Args: never
        Returns: {
          index_size: string
          schema_name: string
          table_name: string
          table_size: string
          total_size: string
        }[]
      }
      get_user_leaderboard: {
        Args: never
        Returns: {
          nickname: string | null
          profile_picture: string | null
          rank: number | null
          review_count: number | null
          total_likes_received: number | null
          trust_score: number | null
          user_id: string | null
          verified_review_count: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "mv_user_leaderboard"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_user_requests: {
        Args: { p_limit?: number; p_offset?: number; p_user_id: string }
        Returns: {
          address: string
          categories: string[]
          created_at: string
          geocoding_success: boolean
          id: string
          recommendation_reason: string
          restaurant_name: string
          youtube_link: string
        }[]
      }
      get_user_stats: {
        Args: never
        Returns: {
          avg_trust_score: number
          total_reviews: number
          total_users: number
          total_verified_reviews: number
        }[]
      }
      get_user_submissions: {
        Args: { p_limit?: number; p_offset?: number; p_user_id: string }
        Returns: {
          created_at: string
          id: string
          items: Json
          rejection_reason: string
          restaurant_name: string
          status: string
          submission_type: string
        }[]
      }
      get_video_captions_for_range: {
        Args: {
          p_end_sec: number
          p_recollect_id: number
          p_start_sec: number
          p_video_id: string
        }
        Returns: {
          caption_auth_mode: string | null
          caption_generated_at: string | null
          caption_model: string | null
          caption_provenance: Json
          caption_provider: string | null
          caption_schema_version: number
          chronological_analysis: string | null
          created_at: string
          duration: number | null
          end_sec: number
          highlight_keywords: string[] | null
          id: number
          rank: number | null
          raw_caption: string | null
          recollect_id: number
          start_sec: number
          video_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "video_frame_captions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_video_metadata_filtered: {
        Args: { min_view_count?: number; p_limit?: number; p_order_by?: string }
        Returns: {
          advertisers: string[] | null
          category: string | null
          channel_name: string
          comment_count: number | null
          created_at: string | null
          description: string | null
          duration: number | null
          id: string
          is_ads: boolean | null
          is_shorts: boolean | null
          latest_recollect_id: number | null
          like_count: number | null
          meta_history: Json | null
          published_at: string | null
          recollect_vars: string[] | null
          tags: string[] | null
          thumbnail_hash: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          view_count: number | null
          youtube_link: string
        }[]
        SetofOptions: {
          from: "*"
          to: "videos"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hold_privacy_onboarding_compensation: {
        Args: {
          p_challenge_id: string
          p_idempotency_key: string
          p_reason_code: string
          p_user_id: string
        }
        Returns: Json
      }
      increment_ncp_api_usage: {
        Args: { p_service_type: string }
        Returns: undefined
      }
      increment_review_count: {
        Args: { restaurant_id: string }
        Returns: undefined
      }
      increment_search_count: {
        Args: {
          ip_address: string
          restaurant_id: string
          session_id: string
          user_agent: string
          user_id: string
        }
        Returns: Json
      }
      insert_restaurant_from_jsonl: {
        Args: { jsonl_data: Json }
        Returns: string
      }
      is_current_auth_session_active: { Args: never; Returns: boolean }
      is_current_user_active_admin: { Args: never; Returns: boolean }
      is_marketing_night_window: {
        Args: { p_scheduled_at: string; p_timezone?: string }
        Returns: boolean
      }
      is_review_liked_by_user: {
        Args: { review_id_param: string; user_id_param: string }
        Returns: boolean
      }
      is_user_admin: { Args: { user_uuid: string }; Returns: boolean }
      issue_account_deletion_reauth_proof: {
        Args: { p_target_user_id: string }
        Returns: {
          expires_at: string
          proof_id: string
        }[]
      }
      make_user_admin: { Args: { target_email: string }; Returns: undefined }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_notification_read: {
        Args: { notification_uuid: string }
        Returns: undefined
      }
      marketing_campaign_receipt: {
        Args: { p_operation_id: string }
        Returns: Json
      }
      match_documents_bge: {
        Args: {
          filter?: Json
          match_count: number
          match_threshold: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          embedding: string
          id: number
          metadata: Json
          page_content: string
          recollect_id: number
          similarity: number
          video_id: string
        }[]
      }
      match_documents_hybrid: {
        Args: {
          dense_weight?: number
          match_count?: number
          match_threshold?: number
          query_embedding: string
          query_sparse: Json
        }
        Returns: {
          chunk_index: number
          dense_score: number
          embedding: string
          hybrid_score: number
          id: number
          metadata: Json
          page_content: string
          recollect_id: number
          sparse_score: number
          video_id: string
        }[]
      }
      match_storyboard_documents_hybrid: {
        Args: {
          p_candidate_count?: number
          p_dense_weight?: number
          p_match_count?: number
          p_metadata_filter?: Json
          p_query_embedding: string
          p_query_sparse: Json
          p_user_id: string
        }
        Returns: {
          content: string
          dense_score: number
          id: string
          metadata: Json
          rrf_score: number
          sparse_score: number
          title: string
          weighted_score: number
        }[]
      }
      match_storyboard_documents_hybrid_v2: {
        Args: {
          p_candidate_count?: number
          p_dense_weight?: number
          p_match_count?: number
          p_metadata_filter?: Json
          p_query_embedding: string
          p_query_sparse: Json
          p_user_id: string
        }
        Returns: {
          content: string
          dense_score: number
          id: string
          metadata: Json
          rrf_score: number
          sparse_score: number
          title: string
          weighted_score: number
        }[]
      }
      merge_restaurant_records_for_admin_review: {
        Args: {
          p_admin_user_id: string
          p_expected_target_updated_at: string
          p_new_category?: string
          p_new_tzuyang_review?: string
          p_new_youtube_link?: string
          p_new_youtube_meta?: Json
          p_source_restaurant_id: string
          p_target_restaurant_id: string
        }
        Returns: {
          message: string
          source_restaurant_id: string
          success: boolean
          target_restaurant_id: string
        }[]
      }
      normalize_restaurant_identity_name: {
        Args: { raw_name: string }
        Returns: string
      }
      ocr_log_metadata_is_safe: { Args: { p_metadata: Json }; Returns: boolean }
      preflight_release_auth_session_family: {
        Args: {
          p_expires_at: number
          p_operation_id: string
          p_refresh_sha256: string
          p_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      prepare_account_deletion_external_egress: {
        Args: {
          p_actor_user_id: string
          p_attempt_token: string
          p_idempotency_key: string
          p_phase: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          attempt_token: string
          egress_state: string
          lease_expires_at: string
          phase: string
          provider_idempotency_key: string
          request_id: string
          source_manifest_hash: string
        }[]
      }
      prepare_marketing_campaign_batch: {
        Args: {
          p_actor_user_id: string
          p_batch_limit?: number
          p_idempotency_key: string
          p_operation_id: string
          p_preview_hash: string
          p_timezone?: string
        }
        Returns: Json
      }
      preview_account_deletion: {
        Args: {
          p_actor_user_id: string
          p_reauthenticated_at: string
          p_target_user_id: string
        }
        Returns: {
          anonymize_count: number
          delete_count: number
          policy_version: string
          preview_expires_at: string
          preview_hash: string
          reason_code: string
          request_id: string
          retain_count: number
          separate_count: number
          source_manifest_hash: string
          status: string
        }[]
      }
      preview_marketing_campaign: {
        Args: {
          p_actor_user_id: string
          p_channel: string
          p_data: Json
          p_expires_at: string
          p_message: string
          p_preview_hash: string
          p_recipient_user_ids: string[]
          p_title: string
        }
        Returns: Json
      }
      preview_privacy_incident_transition: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_expected_updated_at: string
          p_incident_id: string
          p_reason_code: string
          p_to_status: Database["public"]["Enums"]["privacy_incident_status"]
          p_transition_input: Json
        }
        Returns: Json
      }
      preview_privacy_retention_run: {
        Args: {
          p_as_of: string
          p_batch_size: number
          p_class_code: string
          p_max_duration_ms?: number
        }
        Returns: Json
      }
      privacy_append_audit_event: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_count_summary: Json
          p_event_type: string
          p_operation_id: string
          p_reason_code: string
          p_request_metadata: Json
          p_status: string
          p_subject_user_id: string
        }
        Returns: string
      }
      privacy_audit_count_summary_is_safe: {
        Args: { p_value: Json }
        Returns: boolean
      }
      privacy_audit_metadata_is_safe: {
        Args: { p_value: Json }
        Returns: boolean
      }
      privacy_incident_audit_count_summary: {
        Args: { p_affected_count: number; p_category_count: number }
        Returns: Json
      }
      privacy_incident_audit_retention_until: {
        Args: { p_now: string }
        Returns: string
      }
      privacy_incident_decision_prompts: {
        Args: {
          p_affected_count: number
          p_external_intrusion: boolean
          p_sensitive_or_unique_id: boolean
        }
        Returns: Json
      }
      privacy_incident_input_hash: { Args: { p_input: Json }; Returns: string }
      privacy_incident_require_admin: {
        Args: { p_actor_user_id: string }
        Returns: undefined
      }
      privacy_incident_transition_is_allowed: {
        Args: {
          p_from: Database["public"]["Enums"]["privacy_incident_status"]
          p_to: Database["public"]["Enums"]["privacy_incident_status"]
        }
        Returns: boolean
      }
      privacy_incident_validate_input: {
        Args: {
          p_input: Json
          p_to_status: Database["public"]["Enums"]["privacy_incident_status"]
        }
        Returns: undefined
      }
      privacy_refresh_age_profile: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      privacy_requested_consents_are_valid: {
        Args: { p_value: Json }
        Returns: boolean
      }
      privacy_resolve_audit_retention_until: {
        Args: { p_class_code: string; p_now: string }
        Returns: string
      }
      privacy_under_14_is_eligible: {
        Args: { p_policy_version_id: string; p_user_id: string }
        Returns: boolean
      }
      publish_account_deletion_policy: {
        Args: {
          p_confirmation_text: string
          p_idempotency_key: string
          p_manifest: Json
          p_operator_approval_ref: string
          p_preview_ttl: string
          p_reauth_max_age: string
          p_version: string
        }
        Returns: string
      }
      publish_privacy_policy_version: {
        Args: {
          p_content_sha256: string
          p_effective_at: string
          p_idempotency_key: string
          p_locale: string
          p_operator_approval_ref: string
          p_supersedes_id: string
          p_version: string
        }
        Returns: Json
      }
      publish_youtube_thumbnail_release: {
        Args: {
          p_browser_image_path: string
          p_candidate_id: string
          p_canvas: Json
          p_id: string
          p_issue_tags: Json
          p_published_at: string
          p_published_by: string
          p_release_key: string
          p_score: number
          p_sha256: string
          p_source_image_id: string
          p_source_manifest_id: string
          p_source_quality_gate: Json
          p_storage_bucket: string
          p_storage_object_path: string
          p_text_layers: Json
        }
        Returns: {
          browser_image_path: string
          candidate_id: string
          canvas: Json
          created_at: string
          height: number
          id: string
          issue_tags: Json
          mime_type: string
          model: string
          model_provenance: string
          provider_id: string
          published_at: string
          published_by: string | null
          release_key: string
          score: number
          sha256: string
          source_image_id: string
          source_manifest_id: string
          source_quality_gate: Json
          status: string
          storage_bucket: string
          storage_object_path: string
          superseded_at: string | null
          text_layers: Json
          updated_at: string
          width: number
        }
        SetofOptions: {
          from: "*"
          to: "youtube_thumbnail_releases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reactivate_user: { Args: never; Returns: undefined }
      read_account_deletion_external_job: {
        Args: {
          p_actor_user_id: string
          p_attempt_token: string
          p_idempotency_key: string
          p_phase: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          attempt_state: string
          attempt_token: string
          authoritative_absent: boolean
          job_state: string
          lease_expires_at: string
          phase: string
          provider_proof_count: number
          request_id: string
          source_manifest_hash: string
        }[]
      }
      read_admin_user_audit_events: {
        Args: { p_limit: number }
        Returns: {
          action: string
          actor_user_id: string
          applied_at: string
          audit_counts: Json
          audit_flags: Json
          correlation_id: string
          created_at: string
          error_code: string
          id: string
          reason: string
          status: string
          target_user_id: string
        }[]
      }
      read_admin_user_ids_for_management: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      read_admin_user_management_metadata: {
        Args: { p_user_ids: string[] }
        Returns: {
          account_status: string
          avatar_url: string
          is_admin: boolean
          nickname: string
          profile_created_at: string
          profile_role: string
          profile_updated_at: string
          user_id: string
          username: string
        }[]
      }
      read_current_account_deletion_status: {
        Args: {
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
        }
        Returns: {
          anonymize_count: number
          auth_readback_passed: boolean
          auth_receipt_ref: string
          db_readback_passed: boolean
          delete_count: number
          idempotency_key_binding_sha256: string
          reason_code: string
          request_id: string
          retain_count: number
          separate_count: number
          session_readback_passed: boolean
          source_manifest_hash: string
          status: string
          storage_readback_passed: boolean
          storage_receipt_refs: Json
        }[]
      }
      read_privacy_guardian_status: {
        Args: { p_child_user_id: string }
        Returns: Json
      }
      read_public_profile_leaderboard: {
        Args: { p_limit: number; p_period: string }
        Returns: {
          avg_likes_per_review: number
          nickname: string
          quality_score: number
          review_count: number
          total_likes: number
          user_id: string
          verified_review_count: number
        }[]
      }
      read_public_profile_leaderboard_page: {
        Args: {
          p_after_quality_score: number
          p_after_user_id: string
          p_limit: number
          p_period: string
        }
        Returns: {
          avg_likes_per_review: number
          nickname: string
          quality_score: number
          review_count: number
          total_likes: number
          user_id: string
          verified_review_count: number
        }[]
      }
      read_public_profile_summaries: {
        Args: { p_user_ids: string[] }
        Returns: {
          avatar_url: string
          nickname: string
          user_id: string
        }[]
      }
      read_release_auth_revocation: {
        Args: {
          p_operation_id: string
          p_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      read_release_auth_revocation_by_operation: {
        Args: { p_operation_id: string }
        Returns: Json
      }
      reconcile_account_deletion_auth_job: {
        Args: {
          p_actor_user_id: string
          p_attempt_token: string
          p_idempotency_key: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          auth_readback_passed: boolean
          job_state: string
          provider_proof_count: number
          request_id: string
          source_manifest_hash: string
          status: string
        }[]
      }
      reconcile_account_deletion_storage_job: {
        Args: {
          p_actor_user_id: string
          p_attempt_token: string
          p_idempotency_key: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          expected_work_count: number
          job_state: string
          provider_proof_count: number
          request_id: string
          source_manifest_hash: string
          status: string
          storage_readback_passed: boolean
        }[]
      }
      record_account_deletion_external_provider_proof: {
        Args: {
          p_actor_user_id: string
          p_attempt_token: string
          p_idempotency_key: string
          p_object_locator_hash: string
          p_object_version_hash: string
          p_phase: string
          p_preview_hash: string
          p_provider_receipt_hash: string
          p_provider_receipt_ref: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          attempt_token: string
          phase: string
          proof_hash: string
          provider_receipt_ref: string
          request_id: string
          source_manifest_hash: string
        }[]
      }
      record_marketing_campaign_audit: {
        Args: {
          p_actor_user_id: string
          p_eligible: number
          p_error_code: string
          p_failed: number
          p_operation_id: string
          p_preview_hash: string
          p_reason_code: string
          p_requested: number
          p_status: string
          p_suppressed: number
        }
        Returns: string
      }
      record_privacy_guardian_verification: {
        Args: {
          p_child_user_id: string
          p_expires_at?: string
          p_provider: string
          p_provider_reference_hash: string
          p_status: string
          p_verification_id: string
          p_verified_at?: string
        }
        Returns: Json
      }
      record_privacy_incident_detection: {
        Args: {
          p_actor_user_id: string
          p_confirmation_text: string
          p_correlation_id: string
          p_detected_at: string
          p_incident_id: string
          p_severity: string
        }
        Returns: Json
      }
      record_privacy_retention_storage_provider_receipts: {
        Args: {
          p_idempotency_key: string
          p_preview_hash: string
          p_receipts: Json
          p_run_id: string
        }
        Returns: Json
      }
      refresh_materialized_views: { Args: never; Returns: undefined }
      reject_restaurant: {
        Args: {
          admin_user_id: string
          reject_reason?: string
          restaurant_id: string
        }
        Returns: boolean
      }
      reject_restaurant_submission: {
        Args: {
          p_admin_user_id: string
          p_rejection_reason: string
          p_submission_id: string
        }
        Returns: boolean
      }
      reject_submission: {
        Args: {
          p_admin_user_id: string
          p_rejection_reason: string
          p_submission_id: string
        }
        Returns: boolean
      }
      reject_submission_item: {
        Args: {
          p_admin_user_id: string
          p_item_id: string
          p_rejection_reason: string
        }
        Returns: boolean
      }
      reserve_admin_provider_budget: {
        Args: {
          p_actor_user_id: string
          p_operation_id: string
          p_provider: string
        }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      reserve_ocr_daily_quota: {
        Args: { p_operation_id: string }
        Returns: {
          allowed: boolean
          quota_limit: number
          remaining_count: number
          reset_at: string
          unlimited: boolean
          used_count: number
        }[]
      }
      reset_weekly_search_count: { Args: never; Returns: undefined }
      resolve_privacy_retention_provider_effect: {
        Args: {
          p_adapter_version: string
          p_claim_hash: string
          p_claim_token: string
          p_idempotency_key: string
          p_object_locator_hash: string
          p_object_version_hash: string
          p_preview_hash: string
          p_provider_verifier_ref: string
          p_run_id: string
          p_source_mapping_version: string
          p_work_item_id: string
        }
        Returns: Json
      }
      resolve_restaurant_identity_name: {
        Args: {
          p_approved_name: string
          p_google_name: string
          p_naver_name: string
          p_origin_name: string
        }
        Returns: string
      }
      review_admin_restaurant_map_overlay_proposal: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_expected_proposal_hash: string
          p_idempotency_key: string
          p_proposal_id: string
          p_reason: string
          p_request_hash: string
          p_request_metadata?: Json
          p_transition: string
        }
        Returns: Json
      }
      review_restaurant_request: {
        Args: {
          p_action: string
          p_admin_note?: string
          p_admin_user_id: string
          p_rejection_reason?: string
          p_request_id: string
        }
        Returns: {
          audit_id: string
          message: string
          success: boolean
        }[]
      }
      revoke_release_auth_session_family: {
        Args: {
          p_binding_sha256: string
          p_operation_id: string
          p_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      run_account_deletion_session_family_cleanup: {
        Args: {
          p_actor_user_id: string
          p_attempt_token: string
          p_idempotency_key: string
          p_preview_hash: string
          p_request_id: string
          p_source_manifest_hash: string
          p_target_user_id: string
        }
        Returns: {
          checkpoint_state: string
          job_state: string
          request_id: string
          session_readback_passed: boolean
          source_manifest_hash: string
          status: string
        }[]
      }
      search_restaurants: {
        Args: {
          max_results?: number
          search_categories?: string[]
          search_query: string
          similarity_threshold?: number
        }
        Returns: {
          categories: string[]
          edit_distance: number
          id: string
          jibun_address: string
          lat: number
          lng: number
          name: string
          review_count: number
          road_address: string
          similarity: number
        }[]
      }
      search_restaurants_by_category: {
        Args: { p_category: string; p_limit?: number }
        Returns: {
          categories: string[]
          description_map_url: string
          id: string
          name: string
          video_id: string
          youtube_link: string
        }[]
      }
      search_restaurants_by_name:
        | {
            Args: { keyword: string; p_limit?: number }
            Returns: {
              categories: string[]
              id: string
              name: string
              tzuyang_review: string
              video_id: string
              youtube_link: string
            }[]
          }
        | {
            Args: {
              include_all_status?: boolean
              korean_only?: boolean
              max_results?: number
              search_categories?: string[]
              search_query: string
            }
            Returns: {
              categories: string[]
              complete_match_score: number
              created_at: string
              english_address: string
              id: string
              jibun_address: string
              lat: number
              levenshtein_distance: number
              lng: number
              name: string
              phone: string
              road_address: string
              status: string
              trigram_similarity: number
              tzuyang_review: string
              updated_at: string
              word_match_score: number
              youtube_link: string
              youtube_meta: Json
            }[]
          }
      search_restaurants_by_youtube_title: {
        Args: {
          include_all_status?: boolean
          korean_only?: boolean
          max_results?: number
          search_query: string
        }
        Returns: {
          address_elements: Json
          categories: string[]
          complete_match_score: number
          english_address: string
          evaluation_results: Json
          id: string
          jibun_address: string
          lat: number
          levenshtein_distance: number
          lng: number
          name: string
          origin_address: Json
          phone: string
          reasoning_basis: string
          road_address: string
          status: string
          trigram_similarity: number
          tzuyang_review: string
          word_match_score: number
          youtube_link: string
          youtube_meta: Json
          youtube_title: string
        }[]
      }
      search_video_ids_by_query: {
        Args: {
          dense_weight?: number
          match_count?: number
          match_threshold?: number
          query_embedding: string
          query_sparse: Json
        }
        Returns: {
          best_score: number
          has_peak: boolean
          recollect_id: number
          sample_content: string
          video_id: string
        }[]
      }
      soft_delete_user: { Args: never; Returns: undefined }
      storyboard_sparse_dot_product: {
        Args: { document_weights: Json; query_weights: Json }
        Returns: number
      }
      submit_guardian_privacy_consent: {
        Args: {
          p_channel: string
          p_correlation_id: string
          p_decision: string
          p_guardian_verification_id: string
          p_idempotency_key: string
          p_notice_sha256: string
          p_policy_version_id: string
          p_purpose: string
        }
        Returns: Json
      }
      submit_privacy_consent: {
        Args: {
          p_channel: string
          p_correlation_id: string
          p_decision: string
          p_guardian_verification_id: string
          p_idempotency_key: string
          p_notice_sha256: string
          p_policy_version_id: string
          p_purpose: string
          p_source: string
        }
        Returns: Json
      }
      submit_restaurant_submission: {
        Args: {
          p_client_submission_key: string
          p_restaurant_address: string
          p_restaurant_categories?: string[]
          p_restaurant_name: string
          p_restaurant_phone?: string
          p_submission_type: string
          p_tzuyang_review?: string
          p_user_id: string
          p_youtube_link?: string
        }
        Returns: {
          client_submission_key: string
          item_id: string
          restaurant_address: string
          restaurant_categories: string[]
          restaurant_name: string
          restaurant_phone: string
          status: string
          submission_id: string
          submission_type: string
          tzuyang_review: string
          user_id: string
          youtube_link: string
        }[]
      }
      transition_privacy_onboarding_challenge: {
        Args: {
          p_challenge_id: string
          p_expected_state: string
          p_idempotency_key: string
          p_next_state: string
          p_user_id: string
        }
        Returns: Json
      }
      update_table_statistics: { Args: never; Returns: undefined }
      verify_review_like_counts: {
        Args: never
        Returns: {
          actual_count: number
          cached_count: number
          difference: number
          review_id: string
        }[]
      }
    }
    Enums: {
      admin_workflow_correlation_state:
        | "pending_dispatch"
        | "dispatched_unmatched"
        | "matched"
        | "reconciled_timeout"
        | "reconciled_error"
        | "completed"
      admin_workflow_step_status:
        | "queued"
        | "running"
        | "success"
        | "failed"
        | "timeout"
        | "partial"
        | "skipped"
      admin_workflow_trigger_source: "schedule" | "manual_admin"
      app_role: "admin" | "user"
      notification_type:
        | "system"
        | "user"
        | "admin_announcement"
        | "new_restaurant"
        | "ranking_update"
        | "review_approved"
        | "review_rejected"
        | "submission_approved"
        | "submission_rejected"
      privacy_incident_data_category:
        | "account"
        | "contact"
        | "authentication"
        | "device"
        | "usage"
        | "location"
        | "financial"
        | "sensitive"
        | "unique_identifier"
        | "other"
      privacy_incident_notice_audience: "data_subjects" | "pipc" | "kisa"
      privacy_incident_notice_status:
        | "draft"
        | "approved"
        | "submitted"
        | "failed"
      privacy_incident_readback_status: "passed" | "failed"
      privacy_incident_status:
        | "detected"
        | "triaged"
        | "contained"
        | "assessed"
        | "notice_drafted"
        | "notice_approved"
        | "notified"
        | "closed"
      submission_status:
        | "pending"
        | "approved"
        | "partially_approved"
        | "rejected"
      submission_type: "new" | "edit"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          level: number | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          level?: number | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          level?: number | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      prefixes: {
        Row: {
          bucket_id: string
          created_at: string | null
          level: number
          name: string
          updated_at: string | null
        }
        Insert: {
          bucket_id: string
          created_at?: string | null
          level?: number
          name: string
          updated_at?: string | null
        }
        Update: {
          bucket_id?: string
          created_at?: string | null
          level?: number
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prefixes_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_prefixes: {
        Args: { _bucket_id: string; _name: string }
        Returns: undefined
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      delete_leaf_prefixes: {
        Args: { bucket_ids: string[]; names: string[] }
        Returns: undefined
      }
      delete_prefix: {
        Args: { _bucket_id: string; _name: string }
        Returns: boolean
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_level: { Args: { name: string }; Returns: number }
      get_prefix: { Args: { name: string }; Returns: string }
      get_prefixes: { Args: { name: string }; Returns: string[] }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          start_after?: string
        }
        Returns: {
          id: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      lock_top_prefixes: {
        Args: { bucket_ids: string[]; names: string[] }
        Returns: undefined
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_legacy_v1: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v1_optimised: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  auth: {
    Enums: {
      aal_level: ["aal1", "aal2", "aal3"],
      code_challenge_method: ["s256", "plain"],
      factor_status: ["unverified", "verified"],
      factor_type: ["totp", "webauthn", "phone"],
      oauth_authorization_status: ["pending", "approved", "denied", "expired"],
      oauth_client_type: ["public", "confidential"],
      oauth_registration_type: ["dynamic", "manual"],
      oauth_response_type: ["code"],
      one_time_token_type: [
        "confirmation_token",
        "reauthentication_token",
        "recovery_token",
        "email_change_token_new",
        "email_change_token_current",
        "phone_change_token",
      ],
    },
  },
  public: {
    Enums: {
      admin_workflow_correlation_state: [
        "pending_dispatch",
        "dispatched_unmatched",
        "matched",
        "reconciled_timeout",
        "reconciled_error",
        "completed",
      ],
      admin_workflow_step_status: [
        "queued",
        "running",
        "success",
        "failed",
        "timeout",
        "partial",
        "skipped",
      ],
      admin_workflow_trigger_source: ["schedule", "manual_admin"],
      app_role: ["admin", "user"],
      notification_type: [
        "system",
        "user",
        "admin_announcement",
        "new_restaurant",
        "ranking_update",
        "review_approved",
        "review_rejected",
        "submission_approved",
        "submission_rejected",
      ],
      privacy_incident_data_category: [
        "account",
        "contact",
        "authentication",
        "device",
        "usage",
        "location",
        "financial",
        "sensitive",
        "unique_identifier",
        "other",
      ],
      privacy_incident_notice_audience: ["data_subjects", "pipc", "kisa"],
      privacy_incident_notice_status: [
        "draft",
        "approved",
        "submitted",
        "failed",
      ],
      privacy_incident_readback_status: ["passed", "failed"],
      privacy_incident_status: [
        "detected",
        "triaged",
        "contained",
        "assessed",
        "notice_drafted",
        "notice_approved",
        "notified",
        "closed",
      ],
      submission_status: [
        "pending",
        "approved",
        "partially_approved",
        "rejected",
      ],
      submission_type: ["new", "edit"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
