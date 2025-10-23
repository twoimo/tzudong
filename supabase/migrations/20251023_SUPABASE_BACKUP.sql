-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  nickname text NOT NULL UNIQUE,
  email text NOT NULL,
  profile_picture text,
  created_at timestamp with time zone DEFAULT now(),
  last_login timestamp with time zone DEFAULT now(),
  nickname_changed boolean DEFAULT false,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.restaurant_submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  restaurant_name text NOT NULL,
  address text NOT NULL,
  phone text,
  youtube_link text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now(),
  reviewed_by_admin_id uuid,
  reviewed_at timestamp with time zone,
  approved_restaurant_id uuid,
  submission_type text DEFAULT 'new'::text CHECK (submission_type = ANY (ARRAY['new'::text, 'update'::text])),
  original_restaurant_id uuid,
  changes_requested jsonb,
  category ARRAY,
  CONSTRAINT restaurant_submissions_pkey PRIMARY KEY (id),
  CONSTRAINT restaurant_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT restaurant_submissions_reviewed_by_admin_id_fkey FOREIGN KEY (reviewed_by_admin_id) REFERENCES auth.users(id),
  CONSTRAINT restaurant_submissions_approved_restaurant_id_fkey FOREIGN KEY (approved_restaurant_id) REFERENCES public.restaurants(id),
  CONSTRAINT restaurant_submissions_original_restaurant_id_fkey FOREIGN KEY (original_restaurant_id) REFERENCES public.restaurants(id)
);
CREATE TABLE public.restaurants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL,
  phone text,
  youtube_link text,
  tzuyang_review text,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  ai_rating numeric CHECK (ai_rating >= 1::numeric AND ai_rating <= 10::numeric),
  visit_count integer DEFAULT 0,
  review_count integer DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  jjyang_visit_count integer DEFAULT 0,
  updated_by_admin_id uuid,
  description text,
  category ARRAY,
  CONSTRAINT restaurants_pkey PRIMARY KEY (id),
  CONSTRAINT restaurants_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  CONSTRAINT restaurants_updated_by_admin_id_fkey FOREIGN KEY (updated_by_admin_id) REFERENCES auth.users(id)
);
CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  visited_at timestamp with time zone NOT NULL,
  verification_photo text NOT NULL,
  food_photos ARRAY DEFAULT '{}'::text[],
  is_verified boolean DEFAULT false,
  admin_note text,
  is_pinned boolean DEFAULT false,
  edited_by_admin boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_edited_by_admin boolean DEFAULT false,
  edited_by_admin_id uuid,
  edited_at timestamp with time zone,
  category ARRAY,
  categories ARRAY,
  CONSTRAINT reviews_pkey PRIMARY KEY (id),
  CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT reviews_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
  CONSTRAINT reviews_edited_by_admin_id_fkey FOREIGN KEY (edited_by_admin_id) REFERENCES auth.users(id)
);
CREATE TABLE public.server_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  monthly_cost numeric NOT NULL,
  description text,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT server_costs_pkey PRIMARY KEY (id),
  CONSTRAINT server_costs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id)
);
CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role USER-DEFINED NOT NULL DEFAULT 'user'::app_role,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_roles_pkey PRIMARY KEY (id),
  CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  review_count integer DEFAULT 0,
  verified_review_count integer DEFAULT 0,
  trust_score numeric DEFAULT 0,
  last_updated timestamp with time zone DEFAULT now(),
  CONSTRAINT user_stats_pkey PRIMARY KEY (id),
  CONSTRAINT user_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);