-- Migration to clean up duplicate restaurants
-- A duplicate is defined as rows with the same youtube_link, approved_name (or name), and jibun_address (or road_address).
-- We will keep the oldest row and delete the rest.

DO $$
DECLARE
    dup_record RECORD;
BEGIN
    FOR dup_record IN
        SELECT youtube_link, 
               approved_name as res_name, 
               COALESCE(jibun_address, road_address) as res_addr,
               MIN(created_at) as keep_created_at
        FROM public.restaurants
        GROUP BY youtube_link, approved_name, COALESCE(jibun_address, road_address)
        HAVING COUNT(*) > 1
    LOOP
        DELETE FROM public.restaurants
        WHERE youtube_link = dup_record.youtube_link
          AND approved_name = dup_record.res_name
          AND COALESCE(jibun_address, road_address) = dup_record.res_addr
          AND created_at > dup_record.keep_created_at;
    END LOOP;
END $$;
