-- ========================================
-- 알림 시스템 마이그레이션
-- ========================================

-- Create notification type enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE public.notification_type AS ENUM (
            'system',
            'user',
            'admin_announcement',
            'new_restaurant',
            'ranking_update',
            'review_approved',
            'review_rejected',
            'submission_approved',
            'submission_rejected'
        );
    END IF;
END
$$;

-- Drop existing table and type if they exist
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TYPE IF EXISTS public.notification_type CASCADE;

-- Create notification type enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE public.notification_type AS ENUM (
            'system',
            'user',
            'admin_announcement',
            'new_restaurant',
            'ranking_update',
            'review_approved',
            'review_rejected',
            'submission_approved',
            'submission_rejected'
        );
    END IF;
END
$$;

-- Create notifications table
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    type notification_type NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for notifications
CREATE POLICY "Users can view own notifications"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications"
    ON public.notifications FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Users can update own notifications (read status)"
    ON public.notifications FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications"
    ON public.notifications FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- Drop existing functions if they exist (with different signatures)
DROP FUNCTION IF EXISTS public.mark_notification_read(uuid);
DROP FUNCTION IF EXISTS public.mark_all_notifications_read();
DROP FUNCTION IF EXISTS public.create_user_notification(uuid, notification_type, text, text, jsonb);
DROP FUNCTION IF EXISTS public.create_admin_announcement_notification(text, text, jsonb);
DROP FUNCTION IF EXISTS public.create_new_restaurant_notification(text, text, jsonb);
DROP FUNCTION IF EXISTS public.create_ranking_notification(uuid, integer, text);
DROP FUNCTION IF EXISTS public.delete_notification(uuid);

-- Function to mark notification as read
CREATE OR REPLACE FUNCTION public.mark_notification_read(notification_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.notifications
    SET is_read = true
    WHERE id = notification_uuid AND user_id = auth.uid();
END;
$$;

-- Function to mark all notifications as read for current user
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.notifications
    SET is_read = true
    WHERE user_id = auth.uid() AND is_read = false;
END;
$$;

-- Function to create a user notification
CREATE OR REPLACE FUNCTION public.create_user_notification(
    p_user_id UUID,
    p_type notification_type,
    p_title TEXT,
    p_message TEXT,
    p_data JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    notification_id UUID;
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (p_user_id, p_type, p_title, p_message, p_data)
    RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$$;

-- Function to create admin announcement notification for all users
CREATE OR REPLACE FUNCTION public.create_admin_announcement_notification(
    p_title TEXT,
    p_message TEXT,
    p_data JSONB DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    SELECT
        p.user_id,
        'admin_announcement'::notification_type,
        p_title,
        p_message,
        p_data
    FROM public.profiles p;
END;
$$;

-- Function to create new restaurant notification for all users
CREATE OR REPLACE FUNCTION public.create_new_restaurant_notification(
    p_title TEXT,
    p_message TEXT,
    p_data JSONB DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    SELECT
        p.user_id,
        'new_restaurant'::notification_type,
        p_title,
        p_message,
        p_data
    FROM public.profiles p;
END;
$$;

-- Function to create ranking notification for specific user
CREATE OR REPLACE FUNCTION public.create_ranking_notification(
    p_user_id UUID,
    p_ranking INTEGER,
    p_period TEXT DEFAULT 'monthly'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    notification_id UUID;
    ranking_title TEXT;
    ranking_message TEXT;
BEGIN
    ranking_title := '랭킹 업데이트';
    ranking_message := p_period || ' 랭킹이 ' || p_ranking || '위로 업데이트되었습니다!';

    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
        p_user_id,
        'ranking_update'::notification_type,
        ranking_title,
        ranking_message,
        jsonb_build_object('ranking', p_ranking, 'period', p_period)
    )
    RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$$;

-- Function to delete a notification
CREATE OR REPLACE FUNCTION public.delete_notification(notification_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.notifications
    WHERE id = notification_uuid AND user_id = auth.uid();
END;
$$;

-- Grant permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.notifications TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_notification(UUID, notification_type, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_announcement_notification(TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_new_restaurant_notification(TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ranking_notification(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_notification(UUID) TO authenticated;
