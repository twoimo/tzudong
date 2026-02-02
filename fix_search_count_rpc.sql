-- Dynamically drop ALL potential overloads of the function
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT oid::regprocedure as func_signature
        FROM pg_proc
        WHERE proname = 'increment_search_count'
        AND pronamespace = 'public'::regnamespace
    LOOP
        RAISE NOTICE 'Dropping function: %', r.func_signature;
        EXECUTE 'DROP FUNCTION ' || r.func_signature;
    END LOOP;
END $$;

-- Create the function with the specific signature used in the frontend
CREATE OR REPLACE FUNCTION public.increment_search_count(
    restaurant_id uuid,
    user_id uuid,
    session_id text,
    ip_address text,
    user_agent text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER -- Run as owner to bypass RLS for the increment if needed (or ensure policies allow it)
AS $$
DECLARE
    v_success boolean;
    v_message text;
BEGIN
    -- Increment the counters
    UPDATE public.restaurants
    SET 
        search_count = COALESCE(search_count, 0) + 1,
        weekly_search_count = COALESCE(weekly_search_count, 0) + 1,
        updated_at = NOW()
    WHERE id = restaurant_id;

    -- Optional: Log to a search_logs table if it existed (omitted as not found)
    -- INSERT INTO public.search_logs ...

    IF FOUND THEN
        RETURN json_build_object(
            'success', true,
            'reason', 'success',
            'message', 'Search count incremented'
        );
    ELSE
        RETURN json_build_object(
            'success', false,
            'reason', 'not_found',
            'message', 'Restaurant not found'
        );
    END IF;

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'success', false,
        'reason', 'error',
        'message', SQLERRM
    );
END;
$$;

-- Grant execute permission to public/authenticated
GRANT EXECUTE ON FUNCTION public.increment_search_count(uuid, uuid, text, text, text) TO public;
GRANT EXECUTE ON FUNCTION public.increment_search_count(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_search_count(uuid, uuid, text, text, text) TO service_role;
